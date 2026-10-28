import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cargarContrato } from '../../../src/contrato/cargar.js';
import { OPERACIONES } from '../../../panel/cliente/src/api/m2.js';
import {
  AREAS,
  CASOS,
  IDENTIDADES,
  VARIABLES_DEL_EJECUTOR,
  type Caso,
  type Paso,
} from '../../../panel/cliente/src/logica/casos.js';

// El catálogo de casos de la vista de demostración (spec 072, T10): datos, no código. Se comprueba entero contra el contrato, así
// que un caso que pide una ruta, un código o un error que M2 no tiene no llega a la pantalla (RNF-07.3, RNF-07.4).
const contrato = cargarContrato();
type Operacion = { operationId?: string; responses?: Record<string, unknown> };
const paths = contrato.paths as Record<string, Record<string, Operacion>>;

// `/api/v1/clientes/{clienteId}/x/{xId}` y `/api/v1/clientes/{clienteId}/x/{direccionId}` son la misma ruta: lo que cambia es el
// nombre de la variable.
const sinNombres = (ruta: string) => ruta.replace(/\{[^}]+\}/g, '{}').split('?', 1)[0] ?? '';
const delContrato = (metodo: string, ruta: string) =>
  Object.entries(paths).find(([camino, operaciones]) => sinNombres(camino) === sinNombres(ruta) && operaciones[metodo.toLowerCase()] !== undefined)?.[1][metodo.toLowerCase()];

const pasosDe = (caso: Caso): Paso[] => [...caso.preparar, caso.prueba];
const esDeM2 = (paso: Paso) => paso.ruta.startsWith('/api/v1/');

// Los `type` que M2 declara en src/errores.ts: los errores de negocio. Los demás errores son `about:blank`.
const TIPOS_DE_M2 = new Set([...readFileSync(new URL('../../../src/errores.ts', import.meta.url), 'utf8').matchAll(/'(\/errores\/[a-z-]+)'/g)].map((m) => m[1]));

const variablesDe = (valor: unknown): string[] => {
  if (typeof valor === 'string') return [...valor.matchAll(/\{([^}]+)\}/g)].map((m) => m[1] ?? '');
  if (Array.isArray(valor)) return valor.flatMap(variablesDe);
  if (typeof valor === 'object' && valor !== null) return Object.values(valor).flatMap(variablesDe);
  return [];
};

describe('las áreas, en el orden de docs/probar-m2.md', () => {
  const guia = readFileSync(new URL('../../../docs/probar-m2.md', import.meta.url), 'utf8');
  const tabla = guia.slice(guia.indexOf('| Requisito |'), guia.indexOf('## 2.'));
  const ENCABEZADO_EN_LA_GUIA: Record<(typeof AREAS)[number]['id'], string> = {
    perfil: 'RF-2.1 Perfil',
    direcciones: 'RF-2.2',
    preferencias: 'RF-2.3',
    historial: 'RF-2.4',
    calificacion: 'RF-2.5',
    'estado-cuenta': 'RF-2.6',
    seguridad: 'Seguridad y errores',
    resiliencia: 'Resiliencia',
  };

  it('son ocho, y siguen el orden de las filas de la tabla de la guía', () => {
    expect(AREAS).toHaveLength(8);
    const posiciones = AREAS.map(({ id }) => tabla.indexOf(ENCABEZADO_EN_LA_GUIA[id]));
    expect(posiciones.every((posicion) => posicion >= 0)).toBe(true);
    expect(posiciones).toEqual([...posiciones].sort((a, b) => a - b));
  });

  it('cada una tiene título y al menos un caso, y los casos de un área van juntos y en el orden de las áreas', () => {
    for (const { id, titulo } of AREAS) {
      expect(titulo, id).not.toBe('');
      expect(CASOS.filter((caso) => caso.area === id).length, id).toBeGreaterThan(0);
    }
    const ordenDeAparicion = [...new Set(CASOS.map((caso) => caso.area))];
    expect(ordenDeAparicion).toEqual(AREAS.map(({ id }) => id));
    // Juntos: la secuencia de áreas no vuelve a una anterior.
    const secuencia = CASOS.map((caso) => caso.area).filter((area, i, todas) => area !== todas[i - 1]);
    expect(secuencia).toEqual(ordenDeAparicion);
  });
});

describe('cada caso', () => {
  it('tiene un id único en minúsculas y guiones, y un título', () => {
    const ids = CASOS.map((caso) => caso.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const caso of CASOS) {
      expect(caso.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(caso.id.startsWith(`${caso.area}-`), caso.id).toBe(true);
      expect(caso.titulo.trim(), caso.id).not.toBe('');
    }
  });

  it.each(CASOS.map((caso) => [caso.id, caso] as const))('%s: su operación existe en el contrato con ese método y ruta', (_id, caso) => {
    const operacion = OPERACIONES[caso.operacion];
    expect(operacion, `operación ${caso.operacion}`).toBeDefined();
    expect(caso.prueba.metodo).toBe(operacion.metodo);
    expect(sinNombres(caso.prueba.ruta)).toBe(sinNombres(operacion.ruta));
    expect(delContrato(caso.prueba.metodo, caso.prueba.ruta)?.operationId).toBe(caso.operacion);
  });

  it.each(CASOS.map((caso) => [caso.id, caso] as const))('%s: todo pedido a M2 de sus pasos existe en el contrato', (_id, caso) => {
    for (const paso of pasosDe(caso).filter(esDeM2)) {
      expect(delContrato(paso.metodo, paso.ruta), `${paso.metodo} ${paso.ruta}`).toBeDefined();
    }
  });

  it.each(CASOS.map((caso) => [caso.id, caso] as const))('%s: el código que espera está declarado para esa operación', (_id, caso) => {
    const respuestas = Object.keys(delContrato(caso.prueba.metodo, caso.prueba.ruta)?.responses ?? {});
    expect(respuestas).toContain(String(caso.esperado.estado));
  });

  it.each(CASOS.filter((caso) => caso.esperado.type !== undefined).map((caso) => [caso.id, caso] as const))(
    '%s: el type que espera es un error de M2',
    (_id, caso) => {
      expect(TIPOS_DE_M2.has(caso.esperado.type ?? '')).toBe(true);
    },
  );

  it('un type solo se espera en un error, un Retry-After solo en un 503 y un Location solo en un 201', () => {
    for (const { id, esperado } of CASOS) {
      if (esperado.type !== undefined) expect(esperado.estado, id).toBeGreaterThanOrEqual(400);
      if (esperado.conRetryAfter === true) expect(esperado.estado, id).toBe(503);
      if (esperado.conLocation === true) expect(esperado.estado, id).toBe(201);
    }
  });

  it('los 503 de M2 traen Retry-After y los 201 de un alta traen Location (RNF-13, RF-2.1)', () => {
    for (const { id, esperado } of CASOS) {
      if (esperado.estado === 503) expect(esperado.conRetryAfter, id).toBe(true);
    }
    const altas = CASOS.filter((caso) => caso.prueba.metodo === 'POST' && esDeM2(caso.prueba) && caso.esperado.estado === 201 && !caso.prueba.clave?.startsWith('la-'));
    expect(altas.length).toBeGreaterThan(0);
    for (const { id, esperado } of altas) expect(esperado.conLocation, id).toBe(true);
  });
});

describe('los pasos', () => {
  it('cada POST a M2 lleva Idempotency-Key, y una clave «la-anterior» repite la de un paso previo del mismo caso', () => {
    for (const caso of CASOS) {
      const pasos = pasosDe(caso);
      pasos.forEach((paso, i) => {
        if (esDeM2(paso) && paso.metodo === 'POST') expect(paso.clave, `${caso.id} ${paso.ruta}`).toBeDefined();
        if (paso.clave === 'la-anterior') expect(pasos.slice(0, i).some((previo) => previo.clave !== undefined), caso.id).toBe(true);
      });
    }
  });

  it('solo los POST llevan clave', () => {
    for (const caso of CASOS) {
      for (const paso of pasosDe(caso)) if (paso.clave !== undefined) expect(paso.metodo, caso.id).toBe('POST');
    }
  });

  it('cada variable que usa una ruta o un cuerpo es del ejecutor o la guardó un paso anterior del mismo caso', () => {
    for (const caso of CASOS) {
      const guardadas = new Set<string>(VARIABLES_DEL_EJECUTOR);
      for (const paso of pasosDe(caso)) {
        for (const variable of [...variablesDe(paso.ruta), ...variablesDe(paso.cuerpo)]) {
          expect(guardadas.has(variable), `${caso.id}: {${variable}} en ${paso.metodo} ${paso.ruta}`).toBe(true);
        }
        for (const variable of Object.keys(paso.guardar ?? {})) guardadas.add(variable);
      }
    }
  });

  it('lo que se guarda tiene un camino en la respuesta, de campos separados por punto o campo:valor', () => {
    for (const caso of CASOS) {
      for (const paso of pasosDe(caso)) {
        for (const [variable, camino] of Object.entries(paso.guardar ?? {})) {
          expect(camino, `${caso.id} ${variable}`).toMatch(/^[A-Za-z][A-Za-z0-9]*(:[A-Za-z0-9-]+)?(\.[A-Za-z][A-Za-z0-9]*(:[A-Za-z0-9-]+)?)*$/);
        }
      }
    }
  });

  it('la identidad es una de las cuatro conocidas o ninguna (sin token)', () => {
    for (const caso of CASOS) {
      for (const { identidad } of pasosDe(caso)) {
        if (identidad === null) continue;
        expect(['CLIENTE', 'OPERADOR', 'SERVICIO', 'CONDUCTOR'], caso.id).toContain(identidad.rol);
        expect(IDENTIDADES, caso.id).toContain(identidad.sub);
      }
    }
  });

  it('los pasos que no son de M2 son del canal de control del M6 simulado (/panel/m6/…) y van sin token', () => {
    for (const caso of CASOS) {
      for (const paso of pasosDe(caso).filter((p) => !esDeM2(p))) {
        expect(paso.ruta, caso.id).toMatch(/^\/panel\/m6\//);
        expect(paso.identidad, caso.id).toBeNull();
      }
    }
  });

  it('el M6 simulado se carga cuando el caso usa un viaje o pide el historial, y solo entonces', () => {
    for (const caso of CASOS) {
      const usaViajes = pasosDe(caso).some((paso) => variablesDe(paso.cuerpo).some((variable) => variable.startsWith('viaje.')));
      const cargaViajes = caso.preparar.some((paso) => paso.ruta.startsWith('/panel/m6/'));
      expect(cargaViajes, caso.id).toBe(usaViajes || caso.operacion === 'listarHistorialViajes');
    }
  });
});

describe('lo que pide la spec (RF-2.x, RNF-07.3, RNF-07.4)', () => {
  const casos = (area: string) => CASOS.filter((caso) => caso.area === area).map((caso) => `${caso.esperado.estado}${caso.esperado.type ?? ''}`);

  it('la calificación recorre 201, la repetición, el duplicado, la clave reutilizada, el viaje en curso, el ajeno, el inexistente y el puntaje inválido', () => {
    expect(casos('calificacion')).toEqual([
      '201', '201', '409/errores/calificacion-duplicada', '422/errores/idempotencia-reutilizada', '422/errores/viaje-no-completado', '404', '404', '400',
    ]);
  });

  it('la resiliencia comprueba calificar y el historial con 503 y Retry-After, y que el perfil sigue en 200', () => {
    const resiliencia = CASOS.filter((caso) => caso.area === 'resiliencia');
    expect(resiliencia.map((caso) => [caso.operacion, caso.esperado.estado])).toEqual([
      ['calificarConductor', 503],
      ['listarHistorialViajes', 503],
      ['obtenerCliente', 200],
    ]);
    expect(resiliencia.filter((caso) => caso.esperado.estado === 503).every((caso) => caso.esperado.conRetryAfter)).toBe(true);
  });

  it('el perfil: crear, repetir, segundo perfil (409), cuerpo inválido, consultar y actualizar', () => {
    expect(casos('perfil')).toEqual(['201', '201', '409/errores/perfil-ya-existe', '400', '200', '200']);
  });

  it('la seguridad: sin token (401), CLIENTE sobre otro (403), rol CONDUCTOR (403) y un perfil inexistente (404)', () => {
    expect(casos('seguridad')).toEqual(['401', '403', '403', '404']);
  });

  it('el estado de cuenta: bloquear como OPERADOR, consultar como SERVICIO, levantar y consultar de nuevo', () => {
    const cuenta = CASOS.filter((caso) => caso.area === 'estado-cuenta');
    expect(cuenta.map((caso) => caso.prueba.identidad?.rol)).toEqual(['OPERADOR', 'SERVICIO', 'OPERADOR', 'CLIENTE']);
    expect(cuenta.map((caso) => caso.esperado.estado)).toEqual([201, 200, 200, 200]);
  });
});
