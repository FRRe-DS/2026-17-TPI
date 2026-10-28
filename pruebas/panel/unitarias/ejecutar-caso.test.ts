import { describe, expect, it } from 'vitest';
import type { EstadoM6, ModoM6 } from '../../../panel/cliente/src/api/panel.js';
import { CASOS, type Caso, type Paso } from '../../../panel/cliente/src/logica/casos.js';
import {
  ejecutarCaso,
  ejecutarTodo,
  leerCamino,
  type EntornoDeCasos,
  type PedidoDelCaso,
  type RespuestaDelCaso,
} from '../../../panel/cliente/src/logica/ejecutar-caso.js';

// Ejecutar un caso del catálogo, compararlo y ejecutarlos todos (spec 072, T11, RNF-07.4, RNF-07.6), con un `pedir` y un M6
// simulado de mentira: sin red, sin navegador.
const PROBLEMA = { 'content-type': 'application/problem+json' };

type Llamada = { pedido: PedidoDelCaso; modoDelM6: ModoM6 };

// Un M6 simulado de mentira que anota cada cambio de modo, y un `pedir` que responde según una función y anota cada pedido.
function entorno(
  responder: (pedido: PedidoDelCaso, llamadas: Llamada[]) => RespuestaDelCaso | Promise<RespuestaDelCaso> = () => ({ estado: 200, encabezados: {} }),
  opciones: { modoInicial?: ModoM6; fallaEstado?: boolean; fallaPonerModo?: (modo: ModoM6) => boolean } = {},
) {
  let modo: ModoM6 = opciones.modoInicial ?? 'normal';
  const llamadas: Llamada[] = [];
  const cambiosDeModo: ModoM6[] = [];
  let enCurso = 0;
  let maximoEnParalelo = 0;
  let n = 0;
  const e: EntornoDeCasos = {
    uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    pedir: async (pedido) => {
      enCurso++;
      maximoEnParalelo = Math.max(maximoEnParalelo, enCurso);
      llamadas.push({ pedido, modoDelM6: modo });
      try {
        await Promise.resolve();
        return await responder(pedido, llamadas);
      } finally {
        enCurso--;
      }
    },
    viajes: {
      estado: async () => {
        if (opciones.fallaEstado) throw new Error('el canal no responde');
        return { modo, retardoLentoMs: 5000 } satisfies EstadoM6;
      },
      ponerModo: async (nuevo) => {
        if (opciones.fallaPonerModo?.(nuevo)) throw new Error('el canal no responde');
        modo = nuevo;
        cambiosDeModo.push(nuevo);
        return { modo, retardoLentoMs: 5000 };
      },
    },
  };
  return { e, llamadas, cambiosDeModo, maximoEnParalelo: () => maximoEnParalelo, modo: () => modo };
}

const ESCENARIOS = {
  escenarios: [
    { nombre: 'completado', viajeId: 'v-completado', respuestaDeM2: 201 },
    { nombre: 'enCurso', viajeId: 'v-en-curso', respuestaDeM2: 422 },
    { nombre: 'ajeno', viajeId: 'v-ajeno', respuestaDeM2: 404 },
    { nombre: 'inexistente', viajeId: 'v-inexistente', respuestaDeM2: 404 },
  ],
};

const PERFIL: Paso = { metodo: 'POST', ruta: '/api/v1/clientes', identidad: { rol: 'CLIENTE', sub: 'cliente' }, clave: 'nueva', cuerpo: { nombre: 'Ana' } };
const caso = (cambios: Partial<Caso> = {}): Caso => ({
  id: 'perfil-prueba',
  area: 'perfil',
  titulo: 'Un caso',
  operacion: 'obtenerCliente',
  preparar: [],
  prueba: { metodo: 'GET', ruta: '/api/v1/clientes/{clienteId}', identidad: { rol: 'CLIENTE', sub: 'cliente' } },
  esperado: { estado: 200 },
  ...cambios,
});

describe('leerCamino', () => {
  const cuerpo = { direccionId: 'd-1', anidado: { n: 7 }, ...ESCENARIOS };

  it.each([
    ['direccionId', 'd-1'],
    ['anidado.n', '7'],
    ['escenarios.nombre:completado.viajeId', 'v-completado'],
    ['escenarios.nombre:enCurso.viajeId', 'v-en-curso'],
  ])('«%s» da %s', (camino, valor) => {
    expect(leerCamino(cuerpo, camino)).toBe(valor);
  });

  it.each(['noExiste', 'anidado.noExiste', 'escenarios.nombre:otro.viajeId', 'direccionId.x', 'escenarios.viajeId', 'anidado'])('«%s» no se encuentra', (camino) => {
    expect(leerCamino(cuerpo, camino)).toBeUndefined();
  });

  it('un cuerpo que no es un objeto no tiene caminos', () => {
    expect(leerCamino(undefined, 'a')).toBeUndefined();
    expect(leerCamino('texto', 'a')).toBeUndefined();
    expect(leerCamino(null, 'a')).toBeUndefined();
  });
});

describe('ejecutarCaso: arma y manda los pasos (RNF-07.4)', () => {
  it('prepara, ejecuta la prueba y devuelve el pedido, la respuesta, lo esperado y el veredicto', async () => {
    const { e, llamadas } = entorno((pedido) => (pedido.metodo === 'POST' ? { estado: 201, encabezados: {} } : { estado: 200, encabezados: { 'x-request-id': 'r-1', 'content-type': 'application/json' }, cuerpo: { clienteId: 'x' } }));

    const resultado = await ejecutarCaso(caso({ preparar: [PERFIL] }), e);

    expect(llamadas.map(({ pedido }) => `${pedido.metodo} ${pedido.ruta.replace(/[0-9a-f-]{36}/, '{id}')}`)).toEqual(['POST /api/v1/clientes', 'GET /api/v1/clientes/{id}']);
    expect(resultado).toMatchObject({
      casoId: 'perfil-prueba',
      pedido: { metodo: 'GET', identidad: { rol: 'CLIENTE' } },
      respuesta: { estado: 200, encabezados: { 'x-request-id': 'r-1' } },
      esperado: { estado: 200 },
      veredicto: { correcto: true },
    });
  });

  it('reemplaza las variables: el cliente del caso en la ruta, en el sub de la identidad y en el cuerpo', async () => {
    const { e, llamadas } = entorno();

    await ejecutarCaso(
      caso({ prueba: { metodo: 'PUT', ruta: '/api/v1/clientes/{clienteId}/x', identidad: { rol: 'CLIENTE', sub: 'cliente' }, cuerpo: { dueno: '{clienteId}', otro: 'a-{otroCliente}-b', lista: ['{clienteId}'], n: 3 } }, esperado: { estado: 200 } }),
      e,
    );

    const { pedido } = llamadas[0]!;
    const clienteId = pedido.identidad?.sub;
    expect(pedido.ruta).toBe(`/api/v1/clientes/${clienteId}/x`);
    expect(pedido.cuerpo).toEqual({ dueno: clienteId, otro: expect.stringMatching(/^a-[0-9a-f-]{36}-b$/), lista: [clienteId], n: 3 });
    expect(JSON.stringify(pedido)).not.toMatch(/\{[A-Za-z]/);
  });

  it('cada ejecución usa clientes nuevos, y «otro-cliente» no es el cliente del caso', async () => {
    const { e, llamadas } = entorno();
    const sinPreparar = caso({ prueba: { metodo: 'GET', ruta: '/api/v1/clientes/{otroCliente}', identidad: { rol: 'CLIENTE', sub: 'otro-cliente' } } });

    await ejecutarCaso(sinPreparar, e);
    await ejecutarCaso(sinPreparar, e);

    const [primera, segunda] = llamadas.map(({ pedido }) => pedido.ruta);
    expect(primera).not.toBe(segunda);
  });

  it('la identidad de cada paso: el cliente, otro cliente, el módulo y el operador son distintos; sin identidad va sin token', async () => {
    const { e, llamadas } = entorno();
    const paso = (rol: 'CLIENTE' | 'OPERADOR' | 'SERVICIO', sub: 'cliente' | 'otro-cliente' | 'm5-despacho' | 'operador'): Paso => ({ metodo: 'GET', ruta: '/api/v1/clientes/{clienteId}', identidad: { rol, sub } });

    await ejecutarCaso(
      caso({ preparar: [paso('CLIENTE', 'cliente'), paso('CLIENTE', 'otro-cliente'), paso('SERVICIO', 'm5-despacho'), { ...paso('OPERADOR', 'operador'), identidad: null }], prueba: paso('OPERADOR', 'operador') }),
      e,
    );

    const subs = llamadas.map(({ pedido }) => pedido.identidad?.sub);
    expect(subs[4]).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set([subs[0], subs[1], subs[2], subs[4]]).size).toBe(4);
    expect(subs[3]).toBeUndefined();
    expect(llamadas[3]!.pedido.identidad).toBeNull();
  });

  it('una clave «nueva» es distinta en cada paso y «la-anterior» repite la del último paso con clave', async () => {
    const { e, llamadas } = entorno();

    await ejecutarCaso(caso({ preparar: [PERFIL, PERFIL], prueba: { ...PERFIL, clave: 'la-anterior' } }), e);

    const [a, b, c] = llamadas.map(({ pedido }) => pedido.clave);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a).not.toBe(b);
    expect(c).toBe(b);
  });

  it('guarda lo que dice «guardar» de la respuesta y lo usa en los pasos siguientes', async () => {
    const { e, llamadas } = entorno((pedido) => ({ estado: 201, encabezados: {}, cuerpo: pedido.metodo === 'POST' ? { direccionId: 'dir-9' } : {} }));
    const crear: Paso = { metodo: 'POST', ruta: '/api/v1/clientes/{clienteId}/direcciones', identidad: { rol: 'CLIENTE', sub: 'cliente' }, clave: 'nueva', cuerpo: {}, guardar: { direccionId: 'direccionId' } };

    await ejecutarCaso(
      caso({ preparar: [crear], prueba: { metodo: 'DELETE', ruta: '/api/v1/clientes/{clienteId}/direcciones/{direccionId}', identidad: { rol: 'CLIENTE', sub: 'cliente' }, cuerpo: { id: '{direccionId}' } }, esperado: { estado: 201 } }),
      e,
    );

    expect(llamadas[1]!.pedido.ruta).toMatch(/\/direcciones\/dir-9$/);
    expect(llamadas[1]!.pedido.cuerpo).toEqual({ id: 'dir-9' });
  });
});

describe('ejecutarCaso: la preparación', () => {
  it('una preparación que no da 2xx es ✘ «no se pudo preparar» y no ejecuta la prueba', async () => {
    const { e, llamadas } = entorno(() => ({ estado: 503, encabezados: PROBLEMA }));

    const resultado = await ejecutarCaso(caso({ preparar: [PERFIL] }), e);

    expect(llamadas).toHaveLength(1);
    expect(resultado.veredicto).toEqual({ correcto: false, motivo: 'no se pudo preparar: POST /api/v1/clientes respondió 503' });
    expect(resultado.respuesta).toMatchObject({ estado: 503 });
  });

  it('una preparación sin respuesta también es ✘ «no se pudo preparar»', async () => {
    const { e } = entorno(() => {
      throw new Error('M2 no responde');
    });

    const resultado = await ejecutarCaso(caso({ preparar: [PERFIL] }), e);

    expect(resultado.veredicto).toEqual({ correcto: false, motivo: 'no se pudo preparar: POST /api/v1/clientes no tuvo respuesta (M2 no responde)' });
  });

  it('si la respuesta no trae lo que había que guardar, es ✘ «no se pudo preparar»', async () => {
    const { e, llamadas } = entorno(() => ({ estado: 201, encabezados: {}, cuerpo: {} }));
    const crear: Paso = { ...PERFIL, guardar: { direccionId: 'direccionId' } };

    const resultado = await ejecutarCaso(caso({ preparar: [crear] }), e);

    expect(llamadas).toHaveLength(1);
    expect(resultado.veredicto.motivo).toBe('no se pudo preparar: la respuesta de POST /api/v1/clientes no trae direccionId');
  });
});

describe('ejecutarCaso: la prueba y el veredicto', () => {
  it('✘ con el motivo si el código no es el esperado', async () => {
    const { e } = entorno(() => ({ estado: 201, encabezados: {} }));

    const resultado = await ejecutarCaso(caso({ esperado: { estado: 409 } }), e);

    expect(resultado.veredicto).toEqual({ correcto: false, motivo: 'se esperaba 409, llegó 201' });
  });

  it('toma el type del problem+json de la respuesta', async () => {
    const { e } = entorno(() => ({ estado: 409, encabezados: PROBLEMA, cuerpo: { type: '/errores/perfil-ya-existe', status: 409 } }));

    const resultado = await ejecutarCaso(caso({ esperado: { estado: 409, type: '/errores/perfil-ya-existe' } }), e);

    expect(resultado.veredicto.correcto).toBe(true);
    expect(resultado.respuesta?.type).toBe('/errores/perfil-ya-existe');
  });

  it('una prueba sin respuesta es ✘ y deja el pedido que se mandó', async () => {
    const { e } = entorno((pedido) => {
      if (pedido.metodo === 'GET') throw new Error('M2 no responde');
      return { estado: 201, encabezados: {} };
    });

    const resultado = await ejecutarCaso(caso({ preparar: [PERFIL] }), e);

    expect(resultado.veredicto).toEqual({ correcto: false, motivo: 'sin respuesta: M2 no responde' });
    expect(resultado.pedido).toMatchObject({ metodo: 'GET' });
    expect(resultado.respuesta).toBeUndefined();
  });

  it('el pedido devuelto lleva solo método, ruta, identidad, clave y cuerpo', async () => {
    const { e } = entorno();

    const resultado = await ejecutarCaso(caso({ prueba: { ...PERFIL, clave: 'nueva' } }), e);

    expect(Object.keys(resultado.pedido ?? {}).sort()).toEqual(['clave', 'cuerpo', 'identidad', 'metodo', 'ruta']);
  });

  it('la respuesta devuelta trae solo los encabezados relevantes', async () => {
    const { e } = entorno(() => ({
      estado: 200,
      encabezados: { 'content-type': 'application/json', 'x-request-id': 'r-1', 'set-cookie': 'a=b', server: 'x', location: '/l' },
    }));

    const resultado = await ejecutarCaso(caso(), e);

    expect(resultado.respuesta?.encabezados).toEqual({ 'content-type': 'application/json', 'x-request-id': 'r-1', location: '/l' });
  });
});

describe('ejecutarCaso: resiliencia (RNF-13)', () => {
  const resiliencia = (esperado = { estado: 503, conRetryAfter: true }) =>
    caso({
      area: 'resiliencia',
      preparar: [PERFIL, { metodo: 'POST', ruta: '/panel/m6/clientes/{clienteId}/ejemplo', identidad: null, guardar: { 'viaje.completado': 'escenarios.nombre:completado.viajeId' } }],
      prueba: { metodo: 'POST', ruta: '/api/v1/clientes/{clienteId}/calificaciones', identidad: { rol: 'CLIENTE', sub: 'cliente' }, clave: 'nueva', cuerpo: { viajeId: '{viaje.completado}', puntaje: 4 } },
      esperado,
    });
  const respuestaDeM6 = (modoDelM6: () => ModoM6) => (pedido: PedidoDelCaso): RespuestaDelCaso =>
    pedido.ruta.startsWith('/panel/m6/')
      ? { estado: 200, encabezados: {}, cuerpo: ESCENARIOS }
      : modoDelM6() === 'caido'
        ? { estado: 503, encabezados: { ...PROBLEMA, 'retry-after': '5' } }
        : { estado: 201, encabezados: {} };

  it('pone el M6 simulado en «caído» solo para la prueba, y lo repone', async () => {
    const m = entorno(undefined);
    const e = { ...m.e, pedir: async (pedido: PedidoDelCaso) => (m.llamadas.push({ pedido, modoDelM6: m.modo() }), respuestaDeM6(m.modo)(pedido)) };

    const resultado = await ejecutarCaso(resiliencia(), e);

    expect(m.cambiosDeModo).toEqual(['caido', 'normal']);
    expect(m.llamadas.map(({ modoDelM6 }) => modoDelM6)).toEqual(['normal', 'normal', 'caido']);
    expect(resultado.veredicto).toEqual({ correcto: true });
    expect(m.modo()).toBe('normal');
  });

  it.each<ModoM6>(['caido', 'lento'])('repone el modo en que estaba (%s), no «normal» a ciegas', async (inicial) => {
    const m = entorno(undefined, { modoInicial: inicial });
    const e = { ...m.e, pedir: async (pedido: PedidoDelCaso) => respuestaDeM6(m.modo)(pedido) };

    await ejecutarCaso(resiliencia(), e);

    expect(m.modo()).toBe(inicial);
  });

  it('lo repone aunque la prueba no tenga respuesta', async () => {
    const m = entorno(undefined);
    const e = {
      ...m.e,
      pedir: async (pedido: PedidoDelCaso) => {
        if (pedido.ruta.includes('calificaciones')) throw new Error('M2 no responde');
        return respuestaDeM6(m.modo)(pedido);
      },
    };

    const resultado = await ejecutarCaso(resiliencia(), e);

    expect(m.modo()).toBe('normal');
    expect(resultado.veredicto.correcto).toBe(false);
  });

  it('lo repone aunque la prueba dé ✘ por otro motivo', async () => {
    const m = entorno(undefined);
    const e = { ...m.e, pedir: async (pedido: PedidoDelCaso) => respuestaDeM6(m.modo)(pedido) };

    const resultado = await ejecutarCaso(resiliencia({ estado: 200 } as never), e);

    expect(resultado.veredicto.correcto).toBe(false);
    expect(m.modo()).toBe('normal');
  });

  it('no toca el modo si falla la preparación', async () => {
    const m = entorno(() => ({ estado: 500, encabezados: PROBLEMA }));

    await ejecutarCaso(resiliencia(), m.e);

    expect(m.cambiosDeModo).toEqual([]);
  });

  it('si no puede leer o poner el modo, es ✘ «no se pudo preparar» y no manda la prueba', async () => {
    for (const opciones of [{ fallaEstado: true }, { fallaPonerModo: (modo: ModoM6) => modo === 'caido' }]) {
      const m = entorno(undefined, opciones);
      const e = { ...m.e, pedir: async (pedido: PedidoDelCaso) => respuestaDeM6(m.modo)(pedido) };

      const resultado = await ejecutarCaso(resiliencia(), e);

      expect(resultado.veredicto.motivo).toBe('no se pudo preparar: el canal de control del M6 simulado no respondió (el canal no responde)');
      expect(m.llamadas.some(({ pedido }) => pedido.ruta.includes('calificaciones'))).toBe(false);
    }
  });

  it('si no puede reponer el modo, es ✘ aunque la prueba haya dado lo esperado, y lo dice', async () => {
    const m = entorno(undefined, { fallaPonerModo: (modo) => modo === 'normal' });
    const e = { ...m.e, pedir: async (pedido: PedidoDelCaso) => respuestaDeM6(m.modo)(pedido) };

    const resultado = await ejecutarCaso(resiliencia(), e);

    expect(resultado.veredicto).toEqual({ correcto: false, motivo: 'no se pudo reponer el modo normal del M6 simulado (el canal no responde)' });
  });

  it('los demás casos no cambian el modo', async () => {
    const m = entorno();

    await ejecutarCaso(caso(), m.e);

    expect(m.cambiosDeModo).toEqual([]);
  });
});

describe('ejecutarTodo (RNF-07.6)', () => {
  const casos = ['a', 'b', 'c', 'd'].map((id) => caso({ id: `perfil-${id}`, titulo: id }));

  it('ejecuta uno tras otro, nunca en paralelo', async () => {
    const m = entorno();

    await ejecutarTodo(casos, m.e);

    expect(m.maximoEnParalelo()).toBe(1);
    expect(m.llamadas).toHaveLength(4);
  });

  it('informa el avance: «0 de 4» al empezar y después de cada caso', async () => {
    const m = entorno();
    const avances: [number, number, string | undefined][] = [];

    await ejecutarTodo(casos, m.e, ({ hechos, total, ultimo }) => avances.push([hechos, total, ultimo?.casoId]));

    expect(avances).toEqual([
      [0, 4, undefined],
      [1, 4, 'perfil-a'],
      [2, 4, 'perfil-b'],
      [3, 4, 'perfil-c'],
      [4, 4, 'perfil-d'],
    ]);
  });

  it('sigue después de un ✘ y termina con { correctos, incorrectos }', async () => {
    const m = entorno((_pedido, llamadas) => ({ estado: llamadas.length === 2 ? 500 : 200, encabezados: PROBLEMA }));

    const resumen = await ejecutarTodo(casos, m.e);

    expect(resumen).toMatchObject({ correctos: 3, incorrectos: 1 });
    expect(resumen.resultados.map((r) => r.veredicto.correcto)).toEqual([true, false, true, true]);
  });

  it('sigue después de una excepción inesperada y la anota como ✘', async () => {
    const m = entorno();
    const e: EntornoDeCasos = {
      ...m.e,
      viajes: { ...m.e.viajes, estado: async () => m.e.viajes.estado() },
      uuid: () => {
        throw new Error('sin crypto');
      },
    };

    const resumen = await ejecutarTodo(casos, e);

    expect(resumen).toMatchObject({ correctos: 0, incorrectos: 4 });
    expect(resumen.resultados[0]).toMatchObject({ casoId: 'perfil-a', veredicto: { correcto: false, motivo: 'error inesperado: sin crypto' } });
  });

  it('un caso que da ✘ con M6 caído no deja el modo cambiado para el siguiente', async () => {
    const m = entorno(() => ({ estado: 200, encabezados: {} }));
    const todos = [caso({ id: 'resiliencia-a', area: 'resiliencia', esperado: { estado: 503 } }), caso({ id: 'resiliencia-b', area: 'resiliencia', esperado: { estado: 503 } })];

    await ejecutarTodo(todos, m.e);

    expect(m.modo()).toBe('normal');
    expect(m.cambiosDeModo).toEqual(['caido', 'normal', 'caido', 'normal']);
  });

  it('una señal cancelada corta entre un caso y otro', async () => {
    const m = entorno();
    const control = new AbortController();

    const resumen = await ejecutarTodo(casos, m.e, ({ hechos }) => hechos === 2 && control.abort(), control.signal);

    expect(resumen.resultados).toHaveLength(2);
    expect(m.llamadas).toHaveLength(2);
  });

  it('sin casos, termina en cero', async () => {
    expect(await ejecutarTodo([], entorno().e)).toMatchObject({ correctos: 0, incorrectos: 0, resultados: [] });
  });
});

describe('el catálogo completo con un M2 de mentira', () => {
  // Un M2 que responde lo que cada caso espera, sin mirar nada más: sirve para comprobar que ningún paso queda con variables sin
  // reemplazar y que cada «guardar» encuentra lo suyo.
  const responderLoEsperado = (actual: () => Caso, inicio: () => number) => (pedido: PedidoDelCaso, llamadas: Llamada[]): RespuestaDelCaso => {
    if (pedido.ruta.startsWith('/panel/m6/')) return { estado: 200, encabezados: {}, cuerpo: ESCENARIOS };
    const cuerpo = { direccionId: 'dir-1', bloqueoId: 'blq-1', calificacionId: 'cal-1' };
    const caso = actual();
    // La prueba es el pedido que viene después de todos los de preparación.
    if (llamadas.length - 1 - inicio() !== caso.preparar.length) return { estado: pedido.metodo === 'DELETE' ? 204 : 200, encabezados: {}, cuerpo };
    return {
      estado: caso.esperado.estado,
      encabezados: {
        ...(caso.esperado.estado >= 400 ? PROBLEMA : {}),
        ...(caso.esperado.conLocation ? { location: '/api/v1/x' } : {}),
        ...(caso.esperado.conRetryAfter ? { 'retry-after': '5' } : {}),
      },
      cuerpo: caso.esperado.type === undefined ? cuerpo : { type: caso.esperado.type },
    };
  };

  it('todos los casos dan ✔ y ningún pedido sale con variables sin reemplazar', async () => {
    let actual = CASOS[0]!;
    let inicio = 0;
    const m = entorno((pedido, llamadas) => responderLoEsperado(() => actual, () => inicio)(pedido, llamadas));

    for (const c of CASOS) {
      actual = c;
      inicio = m.llamadas.length;
      const resultado = await ejecutarCaso(c, m.e);
      expect(resultado.veredicto, c.id).toEqual({ correcto: true });
    }

    for (const { pedido } of m.llamadas) expect(JSON.stringify(pedido), pedido.ruta).not.toMatch(/\{[A-Za-z]/);
    expect(m.modo()).toBe('normal');
  });
});
