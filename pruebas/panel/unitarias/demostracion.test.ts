import { TOKEN_ENMASCARADO } from '../../../panel/servidor/pedidos.js';
import { describe, expect, it } from 'vitest';
import { AREAS, CASOS, type Caso, type Esperado } from '../../../panel/cliente/src/logica/casos.js';
import type { PedidoDelCaso, ResultadoDeCaso, ResumenDeEjecucion } from '../../../panel/cliente/src/logica/ejecutar-caso.js';
import {
  casosPorArea,
  LIMITE_DE_CUERPO,
  lineaDelPedido,
  mostrarCuerpo,
  textoDeAvance,
  textoDeEsperado,
  textoDelResumen,
  textoDeIdentidad,
  textoDeAutorizacion,
  AUTORIZACION_ENMASCARADA,
} from '../../../panel/cliente/src/logica/demostracion.js';

// Lo que muestra la sección «Casos» de la vista de demostración (spec 072, T14), sin React.

describe('casosPorArea: los casos agrupados en el orden de la guía', () => {
  it('una sección por área, en el orden de AREAS, con todos los casos y ninguno repetido', () => {
    const grupos = casosPorArea(CASOS);

    expect(grupos.map((g) => g.area.id)).toEqual(AREAS.map((a) => a.id));
    expect(grupos.flatMap((g) => g.casos)).toHaveLength(CASOS.length);
    expect(new Set(grupos.flatMap((g) => g.casos.map((c) => c.id))).size).toBe(CASOS.length);
    for (const grupo of grupos) for (const caso of grupo.casos) expect(caso.area).toBe(grupo.area.id);
  });

  it('un área sin casos no se muestra', () => {
    const solo = CASOS.filter((c) => c.area === 'perfil');

    expect(casosPorArea(solo).map((g) => g.area.id)).toEqual(['perfil']);
    expect(casosPorArea([])).toEqual([]);
  });

  it('conserva el orden de los casos dentro del área', () => {
    const perfil = CASOS.filter((c) => c.area === 'perfil').map((c) => c.id);

    expect(casosPorArea(CASOS)[0]!.casos.map((c) => c.id)).toEqual(perfil);
  });
});

describe('textoDeAvance: «7 de 37»', () => {
  it.each([[0, 37, '0 de 37'], [7, 37, '7 de 37'], [37, 37, '37 de 37']])('%i de %i', (hechos, total, texto) => {
    expect(textoDeAvance(hechos, total)).toBe(texto);
  });
});

const resultado = (id: string, correcto: boolean): ResultadoDeCaso => ({
  casoId: id,
  esperado: { estado: 200 },
  veredicto: correcto ? { correcto: true } : { correcto: false, motivo: 'se esperaba 200, llegó 500' },
});
const resumen = (aciertos: number, fallos: number): ResumenDeEjecucion => ({
  correctos: aciertos,
  incorrectos: fallos,
  resultados: [...Array(aciertos)].map((_, i) => resultado(`a${i}`, true)).concat([...Array(fallos)].map((_, i) => resultado(`b${i}`, false))),
});

describe('textoDelResumen: lo que dice «Ejecutar todo» al terminar', () => {
  it('todos correctos', () => {
    expect(textoDelResumen(resumen(37, 0))).toEqual({ correcto: true, texto: 'Los 37 casos dieron lo esperado.' });
  });

  it('con alguno que no coincide dice cuántos', () => {
    expect(textoDelResumen(resumen(35, 2))).toEqual({ correcto: false, texto: '35 de 37 casos dieron lo esperado; 2 no coinciden.' });
    expect(textoDelResumen(resumen(36, 1)).texto).toBe('36 de 37 casos dieron lo esperado; 1 no coincide.');
  });

  it('ninguno correcto', () => {
    expect(textoDelResumen(resumen(0, 3))).toEqual({ correcto: false, texto: '0 de 3 casos dieron lo esperado; 3 no coinciden.' });
  });

  it('un solo caso', () => {
    expect(textoDelResumen(resumen(1, 0)).texto).toBe('El caso dio lo esperado.');
  });

  it('cortado a medias (la persona salió) lo dice', () => {
    expect(textoDelResumen(resumen(2, 0), 37).texto).toBe('Se cortó con 2 de 37 casos hechos: los 2 dieron lo esperado.');
    expect(textoDelResumen(resumen(1, 0), 37).texto).toBe('Se cortó con 1 de 37 casos hechos: el caso dio lo esperado.');
    expect(textoDelResumen(resumen(0, 0), 37).texto).toBe('Se cortó con 0 de 37 casos hechos: no se ejecutó ninguno.');
    expect(textoDelResumen(resumen(1, 1), 37).texto).toBe('Se cortó con 2 de 37 casos hechos: 1 dio lo esperado y 1 no coincide.');
  });
});

describe('textoDeEsperado: lo que tiene que pasar', () => {
  it.each<[Esperado, string]>([
    [{ estado: 200 }, '200'],
    [{ estado: 201, conLocation: true }, '201, con el encabezado Location'],
    [{ estado: 409, type: '/errores/perfil-ya-existe' }, '409, error /errores/perfil-ya-existe'],
    [{ estado: 503, conRetryAfter: true }, '503, con el encabezado Retry-After'],
    [{ estado: 503, type: '/errores/dependencia-no-disponible', conRetryAfter: true }, '503, error /errores/dependencia-no-disponible, con el encabezado Retry-After'],
  ])('%j → «%s»', (esperado, texto) => {
    expect(textoDeEsperado(esperado)).toBe(texto);
  });

  it('un error (4xx o 5xx) dice además que tiene que ser application/problem+json', () => {
    expect(textoDeEsperado({ estado: 404 }, true)).toBe('404, como application/problem+json');
    expect(textoDeEsperado({ estado: 409, type: '/errores/x' }, true)).toBe('409, como application/problem+json, error /errores/x');
    expect(textoDeEsperado({ estado: 200 }, true)).toBe('200');
  });
});

const pedido = (cambios: Partial<PedidoDelCaso> = {}): PedidoDelCaso => ({ metodo: 'POST', ruta: '/api/v1/clientes', identidad: { rol: 'CLIENTE', sub: 'c-1' }, clave: 'k-1', cuerpo: undefined, ...cambios });

describe('lineaDelPedido y textoDeIdentidad', () => {
  it('«POST /api/v1/clientes»', () => {
    expect(lineaDelPedido(pedido())).toBe('POST /api/v1/clientes');
  });

  it('la identidad: el rol y el sub, o «sin token»', () => {
    expect(textoDeIdentidad(pedido())).toBe('CLIENTE (c-1)');
    expect(textoDeIdentidad(pedido({ identidad: null }))).toBe('sin token');
  });
});

describe('textoDeAutorizacion: el Authorization enmascarado, como en el detalle técnico (RNF-19.4)', () => {
  it('con identidad: «Bearer ••••», nunca el token', () => {
    expect(textoDeAutorizacion(pedido())).toBe('Bearer ••••');
  });

  it('sin token no hay encabezado que mostrar', () => {
    expect(textoDeAutorizacion(pedido({ identidad: null }))).toBeUndefined();
  });

  it('es el mismo texto con el que el servidor enmascara los pedidos de la 071', () => {
    expect(AUTORIZACION_ENMASCARADA).toBe(TOKEN_ENMASCARADO);
  });
});

describe('mostrarCuerpo: el cuerpo como texto, sin interpretarlo', () => {
  it('nada si no hay cuerpo', () => {
    expect(mostrarCuerpo(undefined)).toBeUndefined();
  });

  it('JSON con sangría', () => {
    expect(mostrarCuerpo({ nombre: 'Ana', n: 1 })).toBe('{\n  "nombre": "Ana",\n  "n": 1\n}');
  });

  it('un texto con etiquetas HTML queda como texto: es la vista la que lo pone en un nodo de texto', () => {
    expect(mostrarCuerpo({ detail: '<img src=x onerror=alert(1)>' })).toContain('<img src=x onerror=alert(1)>');
  });

  it('un cuerpo muy largo se recorta y dice cuánto', () => {
    const largo = mostrarCuerpo({ texto: 'x'.repeat(LIMITE_DE_CUERPO * 2) })!;

    expect(largo.length).toBeLessThan(LIMITE_DE_CUERPO + 100);
    expect(largo).toMatch(/… \(se recortó: \d+ caracteres más\)$/);
  });

  it('un cuerpo que no se puede escribir como JSON no rompe la vista', () => {
    const circular: Record<string, unknown> = {};
    circular.yo = circular;

    expect(mostrarCuerpo(circular)).toBe('(no se puede mostrar)');
  });
});

describe('el catálogo se muestra completo', () => {
  it('todo caso tiene título y esperado que la vista sabe escribir', () => {
    for (const caso of CASOS as readonly Caso[]) {
      expect(caso.titulo.trim(), caso.id).not.toBe('');
      expect(textoDeEsperado(caso.esperado, true), caso.id).toMatch(/^\d{3}/);
    }
  });
});
