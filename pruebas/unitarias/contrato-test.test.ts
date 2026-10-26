import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cargarContrato, type Contrato } from '../../src/contrato/cargar.js';
import { listarOperaciones } from '../../src/contrato/operaciones.js';
import { manejadores } from '../../src/operaciones/index.js';

const RUTA_PRUEBA = fileURLToPath(new URL('../ayudas/contrato-prueba.yml', import.meta.url));
const contratoPrueba = cargarContrato(RUTA_PRUEBA);

// Las operaciones de contrato-prueba.yml, en el orden en que aparecen en el archivo.
const OPERACIONES_DE_PRUEBA = [
  { operationId: 'verificarSalud', metodo: 'GET', ruta: '/health' },
  { operationId: 'probarProtegida', metodo: 'GET', ruta: '/pruebas/protegida' },
  { operationId: 'probarSinRoles', metodo: 'GET', ruta: '/pruebas/sin-roles' },
  { operationId: 'probarPublica', metodo: 'GET', ruta: '/pruebas/publica' },
  { operationId: 'probarListado', metodo: 'GET', ruta: '/pruebas/clientes' },
  { operationId: 'probarAlta', metodo: 'POST', ruta: '/pruebas/clientes' },
  { operationId: 'probarParametros', metodo: 'GET', ruta: '/pruebas/clientes/{clienteId}/direcciones/{direccionId}' },
  { operationId: 'probarAltaDuplicada', metodo: 'POST', ruta: '/pruebas/duplicados' },
  { operationId: 'probarFalla', metodo: 'GET', ruta: '/pruebas/falla' },
  { operationId: 'probarTarda', metodo: 'GET', ruta: '/pruebas/tarda' },
];
const [SALUD, PROTEGIDA, SIN_ROLES, PUBLICA, LISTADO, ALTA, PARAMETROS, DUPLICADA, FALLA, TARDA] = OPERACIONES_DE_PRUEBA;

// listarOperaciones solo mira que el manejador exista: cualquier valor sirve.
const manejador = () => undefined;

// Un contrato armado en la prueba: de él solo importa paths.
const conPaths = (paths: unknown): Contrato => ({
  openapi: '3.1.0',
  info: { title: 'Contrato armado en la prueba', version: '0.0.0' },
  paths,
});
const unaOperacion = (metodo: string, operationId = 'operacion') => conPaths({ '/x': { [metodo]: { operationId } } });

describe('listarOperaciones: contrato sin operaciones (RNF-07.2)', () => {
  it.each([[undefined], [null], [{}], [[]], ['texto']])('un paths %j no tiene operaciones', (paths) => {
    expect(listarOperaciones(conPaths(paths), manejadores)).toEqual({ implementadas: [], pendientes: [] });
  });

  it('un contrato sin paths, como el que tiene solo info, tampoco', () => {
    const soloInfo: Contrato = { openapi: '3.1.0', info: { title: 'Solo info', version: '0.0.0' } };

    expect(listarOperaciones(soloInfo, manejadores)).toEqual({ implementadas: [], pendientes: [] });
  });

  it('una ruta sin métodos no tiene operaciones', () => {
    const contrato = conPaths({ '/x': { summary: 'Sin métodos', parameters: [] } });

    expect(listarOperaciones(contrato, manejadores)).toEqual({ implementadas: [], pendientes: [] });
  });

  // El v1 trae todas las operaciones de M2; con la spec 008 el servicio tiene un manejador para cada una, en el orden del
  // contrato, y no queda ninguna pendiente.
  it('con el v1 y los manejadores del servicio, todas las operaciones quedan implementadas, en el orden del contrato', () => {
    const { implementadas, pendientes } = listarOperaciones(cargarContrato(), manejadores);

    expect(implementadas).toContainEqual(SALUD);
    expect(implementadas.map(({ operationId }) => operationId)).toEqual(Object.keys(manejadores));
    expect(implementadas.map(({ operationId }) => operationId)).toEqual(
      expect.arrayContaining(['listarCalificaciones', 'calificarConductor', 'obtenerCalificacion']),
    );
    expect(pendientes).toEqual([]);
  });
});

// El contrato con solo GET /health (T20): con los manejadores del servicio, verificarSalud es una operación implementada.
describe('listarOperaciones: la salud del servicio (RNF-07.2, ADR de la base)', () => {
  const contratoSalud = cargarContrato(fileURLToPath(new URL('../ayudas/contrato-salud.yml', import.meta.url)));

  it('con los manejadores del servicio, verificarSalud queda implementada y no hay pendientes', () => {
    expect(listarOperaciones(contratoSalud, manejadores)).toEqual({
      implementadas: [{ operationId: 'verificarSalud', metodo: 'GET', ruta: '/health' }],
      pendientes: [],
    });
  });

  it('sin manejadores, verificarSalud queda pendiente', () => {
    expect(listarOperaciones(contratoSalud, {})).toEqual({
      implementadas: [],
      pendientes: [{ operationId: 'verificarSalud', metodo: 'GET', ruta: '/health' }],
    });
  });
});

describe('listarOperaciones: operaciones pendientes (RNF-07.2)', () => {
  it('sin manejadores, todas las operaciones del contrato quedan pendientes, en el orden del archivo', () => {
    expect(listarOperaciones(contratoPrueba, {})).toEqual({ implementadas: [], pendientes: OPERACIONES_DE_PRUEBA });
  });

  it('informa la ruta como está en el contrato, con {param}, y el método en mayúsculas', () => {
    const { pendientes } = listarOperaciones(contratoPrueba, {});

    expect(pendientes).toContainEqual({
      operationId: 'probarParametros',
      metodo: 'GET',
      ruta: '/pruebas/clientes/{clienteId}/direcciones/{direccionId}',
    });
  });

  it('los manejadores de verdad implementan del contrato de prueba solo verificarSalud, la única que es del v1', () => {
    expect(listarOperaciones(contratoPrueba, manejadores)).toEqual({
      implementadas: [SALUD],
      pendientes: OPERACIONES_DE_PRUEBA.slice(1),
    });
  });

  it.each([
    ['sin operationId', {}],
    ['null', { operationId: null }],
    ['un número', { operationId: 5 }],
    ['un booleano', { operationId: true }],
    ['una lista', { operationId: ['operacion'] }],
    ['un objeto', { operationId: { id: 'operacion' } }],
  ])('una operación con operationId %s no puede tener manejador: queda pendiente, sin operationId', (_caso, operacion) => {
    const contrato = conPaths({ '/x': { get: operacion } });

    expect(listarOperaciones(contrato, { operacion: manejador })).toEqual({
      implementadas: [],
      pendientes: [{ metodo: 'GET', ruta: '/x' }],
    });
  });

  it.each(['toString', 'constructor', 'hasOwnProperty', '__proto__'])(
    'un operationId %s no se confunde con un miembro heredado de Object: queda pendiente',
    (operationId) => {
      expect(listarOperaciones(unaOperacion('get', operationId), {}).pendientes).toEqual([
        { operationId, metodo: 'GET', ruta: '/x' },
      ]);
    },
  );

  it('un manejador heredado, que no es propio de los manejadores, no cuenta', () => {
    const heredados = Object.create({ probarPublica: manejador }) as Record<string, unknown>;

    expect(listarOperaciones(contratoPrueba, heredados).implementadas).toEqual([]);
  });
});

describe('listarOperaciones: operaciones implementadas (RNF-03.4)', () => {
  it('pasa a implementadas la operación que tiene manejador y deja pendientes las demás', () => {
    const resultado = listarOperaciones(contratoPrueba, { probarPublica: manejador, probarAlta: manejador });

    expect(resultado.implementadas).toEqual([PUBLICA, ALTA]);
    expect(resultado.pendientes).toEqual([SALUD, PROTEGIDA, SIN_ROLES, LISTADO, PARAMETROS, DUPLICADA, FALLA, TARDA]);
  });

  it('dos métodos de la misma ruta se tratan por separado', () => {
    const resultado = listarOperaciones(contratoPrueba, { probarAlta: manejador });

    expect(resultado.implementadas).toEqual([ALTA]);
    expect(resultado.pendientes).toContainEqual(LISTADO);
  });

  it('con un manejador para cada operación no queda ninguna pendiente', () => {
    const todos = Object.fromEntries(OPERACIONES_DE_PRUEBA.map(({ operationId }) => [operationId, manejador]));

    expect(listarOperaciones(contratoPrueba, todos)).toEqual({ implementadas: OPERACIONES_DE_PRUEBA, pendientes: [] });
  });

  it('un manejador que no corresponde a ninguna operación del contrato no agrega nada', () => {
    const resultado = listarOperaciones(contratoPrueba, { noExiste: manejador });

    expect(resultado).toEqual({ implementadas: [], pendientes: OPERACIONES_DE_PRUEBA });
  });
});

describe('listarOperaciones: qué cuenta como operación', () => {
  it.each(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'])(
    'reconoce %s como método de una operación y lo informa en mayúsculas',
    (metodo) => {
      expect(listarOperaciones(unaOperacion(metodo), {}).pendientes).toEqual([
        { operationId: 'operacion', metodo: metodo.toUpperCase(), ruta: '/x' },
      ]);
    },
  );

  it('las demás claves de una ruta no son operaciones, aunque tengan un operationId', () => {
    const contrato = conPaths({
      '/x': {
        $ref: '#/components/pathItems/X',
        summary: 'Resumen',
        description: 'Descripción',
        servers: [{ url: '/' }],
        parameters: [{ name: 'p', in: 'query', schema: { type: 'string' } }],
        'x-interno': { operationId: 'extension' },
        GET: { operationId: 'enMayusculas' },
        connect: { operationId: 'connect' },
        get: { operationId: 'real' },
      },
    });

    expect(listarOperaciones(contrato, {}).pendientes).toEqual([{ operationId: 'real', metodo: 'GET', ruta: '/x' }]);
  });

  it.each([[null], ['texto'], [5], [['lista']]])('salta un método cuyo valor es %j y sigue con los demás', (valor) => {
    const contrato = conPaths({
      '/x': { get: valor, post: { operationId: 'alta' } },
      '/y': { put: { operationId: 'cambio' } },
    });

    expect(listarOperaciones(contrato, {}).pendientes).toEqual([
      { operationId: 'alta', metodo: 'POST', ruta: '/x' },
      { operationId: 'cambio', metodo: 'PUT', ruta: '/y' },
    ]);
  });

  it.each([[null], ['texto'], [['lista']]])('salta una ruta cuyo valor es %j y sigue con las demás', (valor) => {
    const contrato = conPaths({ '/x': valor, '/y': { get: { operationId: 'lista' } } });

    expect(listarOperaciones(contrato, {}).pendientes).toEqual([{ operationId: 'lista', metodo: 'GET', ruta: '/y' }]);
  });

  it('respeta el orden del archivo: las rutas como vienen y, en cada ruta, los métodos como vienen', () => {
    const contrato = conPaths({
      '/b': { post: { operationId: 'altaB' }, get: { operationId: 'listaB' } },
      '/a': { get: { operationId: 'listaA' } },
    });

    expect(listarOperaciones(contrato, {}).pendientes.map(({ operationId }) => operationId)).toEqual(['altaB', 'listaB', 'listaA']);
  });
});

// schemathesis.toml, la configuración con la que `npm run contrato:test` corre Schemathesis (spec 004, T10). El ajuste es
// acotado a propósito: no genera el carácter nulo, que PostgreSQL no guarda, y `positive_data_acceptance` acepta además el 422
// solo en las operaciones que lo declaran en el contrato, y `not_a_server_error` acepta además el 503 solo en el historial y en
// calificarConductor, que dependen de M6 y en la prueba de contrato no lo hay (specs 007, T7, y 008, T10). Se lee sin una biblioteca de TOML: el archivo es chico y de
// forma fija.
describe('schemathesis.toml: el ajuste de Schemathesis queda acotado (RNF-07.2)', () => {
  const texto = readFileSync(fileURLToPath(new URL('../../schemathesis.toml', import.meta.url)), 'utf8');
  const sinComentarios = texto.replace(/#.*$/gm, '');
  // Lo que Schemathesis acepta por defecto en positive_data_acceptance, tal como lo informa al fallar.
  const POR_DEFECTO = ['"2xx"', '"3xx"', '401', '403', '404', '409', '429', '"5xx"'];
  // Lo que Schemathesis no cuenta como error del servidor por defecto en not_a_server_error.
  const SIN_ERROR_DE_SERVIDOR = ['"2xx"', '"3xx"', '"4xx"'];
  const bloques = sinComentarios.split('[[operations]]').slice(1);
  // Los estados que un bloque acepta para un chequeo, con el operationId al que se aplican.
  const aceptados = (chequeo: string) =>
    bloques.flatMap((bloque) => {
      const operationId = /include-operation-id\s*=\s*"([^"]+)"/.exec(bloque)?.[1] as string;
      const lista = new RegExp(`checks\\.${chequeo}\\.expected-statuses\\s*=\\s*\\[([^\\]]*)\\]`).exec(bloque)?.[1];
      if (lista === undefined) return [];
      return [{ operationId, estados: lista.split(',').map((estado) => estado.trim()).filter(Boolean) }];
    });
  const contrato = cargarContrato();
  const respuestasDe = (operationId: string) => {
    for (const ruta of Object.values(contrato.paths ?? {}) as Record<string, { operationId?: string; responses?: object }>[]) {
      const operacion = Object.values(ruta).find((candidata) => candidata.operationId === operationId);
      if (operacion !== undefined) return Object.keys(operacion.responses ?? {});
    }
    return undefined;
  };

  it('no genera el carácter nulo y no cambia ningún otro chequeo ni la generación', () => {
    const encabezados = [...sinComentarios.matchAll(/^\s*\[([^\]]+)\]\s*$/gm)].map(([, nombre]) => nombre);
    // Las tablas simples: solo [generation]. Los [[operations]] son los bloques de la otra prueba.
    expect(encabezados).toEqual(['generation']);
    expect(sinComentarios).toMatch(/^\s*allow-x00\s*=\s*false\s*$/m);
    expect(sinComentarios.match(/=/g)?.length).toBe(1 + bloques.length * 2);
  });

  it('acepta 422 solo en crearCliente, crearBloqueo, crearDireccion y calificarConductor, que lo declaran en el contrato, y ningún otro código de más', () => {
    const operaciones = aceptados('positive_data_acceptance');

    expect(operaciones.map(({ operationId }) => operationId)).toEqual([
      'crearCliente',
      'crearBloqueo',
      'crearDireccion',
      'calificarConductor',
    ]);
    for (const { operationId, estados } of operaciones) {
      expect(estados.sort()).toEqual([...POR_DEFECTO, '422'].sort());
      expect(respuestasDe(operationId)).toContain('422');
    }
  });

  // No hay un M6 en la prueba de contrato (planes 007 y 008, Decisiones): el historial y calificarConductor responden el 503 que
  // el contrato declara para la dependencia, y Schemathesis lo contaría como un error del servidor.
  it('acepta 503 como respuesta del servidor solo en listarHistorialViajes y calificarConductor, que lo declaran en el contrato, y ningún otro código de más', () => {
    const operaciones = aceptados('not_a_server_error');

    expect(operaciones.map(({ operationId }) => operationId)).toEqual(['listarHistorialViajes', 'calificarConductor']);
    for (const { operationId, estados } of operaciones) {
      expect(estados.sort()).toEqual([...SIN_ERROR_DE_SERVIDOR, '503'].sort());
      expect(respuestasDe(operationId)).toContain('503');
    }
  });

  it('cada bloque ajusta un solo chequeo de una sola operación, y no hay otros bloques', () => {
    expect(bloques).toHaveLength(aceptados('positive_data_acceptance').length + aceptados('not_a_server_error').length);
  });
});
