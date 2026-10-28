import { randomUUID } from 'node:crypto';
import type { ConfigPanel, ConfigTokens } from '../config.js';
import { ControlM6NoResponde, pedirControlM6, type PedidoControl } from '../m6-control.js';
import type { BaseDemo, ConteoFilas } from './base.js';
import { idDePedido, m2Directo, type RespuestaDirecta } from './m2-directo.js';

// Las pruebas simultáneas de la vista de demostración (spec 072, plan «Concurrencia»): N pedidos iguales a M2 a la vez, desde el
// servidor del panel, y después se cuenta en la base cuántas filas quedaron. Lo que se demuestra es la integridad: una sola fila
// (RNF-08.2 a RNF-08.4). Cada corrida usa un cliente nuevo, así no depende de lo que hayan dejado otras.

export type ModoAltas = 'misma-clave' | 'claves-distintas';

// Cuántas respuestas hubo de cada código. `0` es «sin respuesta».
export type PorCodigo = Record<string, number>;

export type ResultadoSimultaneo = {
  clienteId: string;
  n: number;
  porCodigo: PorCodigo;
  // Solo con la misma clave: si todos los 201 trajeron el mismo cuerpo, como manda la idempotencia.
  cuerposIguales?: boolean;
  // `null` si no se pudo contar, con el motivo.
  filas: number | null;
  motivoFilas?: string;
  esperado: { porCodigo: PorCodigo; filas: number };
  cumple: boolean;
  // El comienzo del `X-Request-Id` de los N pedidos, para buscarlos en `docker compose logs m2`.
  prefijoRequestId: string;
};

export type DependenciasConcurrencia = {
  config: Pick<ConfigPanel, 'urlM2' | 'urlM6Control'> & ConfigTokens;
  base: Pick<BaseDemo, 'contarClientes' | 'contarCalificaciones'>;
  // Cuánto se espera a cada pedido; por defecto, el de `m2Directo` (10 s).
  esperaMs?: number;
};

// No se pudo preparar la prueba (crear el cliente, leer o cambiar el modo del M6 simulado, cargar su ejemplo), así que no se
// lanzó ningún pedido simultáneo. El mensaje dice qué paso y por qué, sin direcciones (RNF-19.4).
export class PreparacionFallida extends Error {
  override readonly name = 'PreparacionFallida';
}

// Un perfil válido para el contrato; el mismo en los N pedidos, para que con la misma clave sean la misma solicitud.
const PERFIL_DE_EJEMPLO = { nombre: 'Ana', apellido: 'Gómez', telefono: '+5493624000000' };

const MODOS_M6 = ['normal', 'lento', 'caido'] as const;
type ModoM6 = (typeof MODOS_M6)[number];

function contarPorCodigo(respuestas: readonly RespuestaDirecta[]): PorCodigo {
  const porCodigo: PorCodigo = {};
  for (const { estado } of respuestas) porCodigo[estado] = (porCodigo[estado] ?? 0) + 1;
  return porCodigo;
}

const mismosCodigos = (a: PorCodigo, b: PorCodigo) =>
  Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([codigo, cantidad]) => b[codigo] === cantidad);

// Lo de cada corrida: un identificador corto que va en el `X-Request-Id` de sus pedidos.
function nuevaCorrida() {
  const corrida = randomUUID().slice(0, 8);
  return {
    requestId: (indice: number | string) => idDePedido(corrida, indice),
    prefijoRequestId: idDePedido(corrida, ''),
  };
}

// N pedidos a la vez: se arman todos y se lanzan juntos, ninguno espera a otro (el `fetch` de Node no limita las conexiones por
// servidor). `pedido(indice)` da el de cada uno.
const todosALaVez = (n: number, pedido: (indice: number) => Promise<RespuestaDirecta>) =>
  Promise.all(Array.from({ length: n }, (_, indice) => pedido(indice)));

function armarResultado(datos: {
  clienteId: string;
  respuestas: readonly RespuestaDirecta[];
  cuerposIguales?: boolean;
  conteo: ConteoFilas;
  esperado: ResultadoSimultaneo['esperado'];
  prefijoRequestId: string;
}): ResultadoSimultaneo {
  const { clienteId, respuestas, cuerposIguales, conteo, esperado, prefijoRequestId } = datos;
  const porCodigo = contarPorCodigo(respuestas);
  return {
    clienteId,
    n: respuestas.length,
    porCodigo,
    ...(cuerposIguales === undefined ? {} : { cuerposIguales }),
    filas: conteo.filas,
    ...(conteo.motivo === undefined ? {} : { motivoFilas: conteo.motivo }),
    esperado,
    // Si la base no se pudo contar, no cumple aunque M2 haya respondido bien: la integridad no se comprobó.
    cumple: mismosCodigos(porCodigo, esperado.porCodigo) && conteo.filas === esperado.filas && cuerposIguales !== false,
    prefijoRequestId,
  };
}

const describirRespuesta = ({ estado, motivo }: RespuestaDirecta) => (estado === 0 ? `sin respuesta (${motivo})` : String(estado));

// Crea el perfil de `clienteId` por M2, como lo haría el cliente. Lo usan las calificaciones simultáneas y la prueba de la
// restricción del puntaje, que necesitan un cliente que exista.
export async function crearClienteDeEjemplo(
  { config, esperaMs }: Pick<DependenciasConcurrencia, 'config' | 'esperaMs'>,
  clienteId: string,
  requestId: string,
): Promise<void> {
  const respuesta = await m2Directo(
    config,
    {
      metodo: 'POST',
      ruta: '/api/v1/clientes',
      identidad: { rol: 'CLIENTE', sub: clienteId },
      requestId,
      claveIdempotencia: randomUUID(),
      cuerpo: PERFIL_DE_EJEMPLO,
    },
    esperaMs,
  );
  if (respuesta.estado !== 201) throw new PreparacionFallida(`no se pudo crear el cliente: M2 respondió ${describirRespuesta(respuesta)}`);
}

// Un pedido al canal de control del M6 simulado que tiene que salir bien: si no, la prueba no se puede preparar. `paso` es lo
// que se estaba haciendo, para el mensaje.
async function controlM6(config: DependenciasConcurrencia['config'], pedido: PedidoControl, paso: string): Promise<unknown> {
  let estado: number;
  let contenido: Buffer;
  try {
    ({ estado, contenido } = await pedirControlM6(config, pedido));
  } catch (error) {
    if (error instanceof ControlM6NoResponde) throw new PreparacionFallida(`el canal de control del M6 simulado no responde (${paso})`);
    throw error;
  }
  if (estado !== 200) throw new PreparacionFallida(`el canal de control del M6 simulado respondió ${estado} (${paso})`);
  try {
    return JSON.parse(contenido.toString('utf8')) as unknown;
  } catch {
    throw new PreparacionFallida(`el canal de control del M6 simulado no respondió JSON (${paso})`);
  }
}

const esModo = (valor: unknown): valor is ModoM6 => (MODOS_M6 as readonly unknown[]).includes(valor);

export async function altasSimultaneas(
  { config, base, esperaMs }: DependenciasConcurrencia,
  { n, modo }: { n: number; modo: ModoAltas },
): Promise<ResultadoSimultaneo> {
  const clienteId = randomUUID();
  const { requestId, prefijoRequestId } = nuevaCorrida();
  const claveComun = randomUUID();

  const respuestas = await todosALaVez(n, (indice) =>
    m2Directo(
      config,
      {
        metodo: 'POST',
        ruta: '/api/v1/clientes',
        identidad: { rol: 'CLIENTE', sub: clienteId },
        requestId: requestId(indice),
        claveIdempotencia: modo === 'misma-clave' ? claveComun : randomUUID(),
        cuerpo: PERFIL_DE_EJEMPLO,
      },
      esperaMs,
    ),
  );

  const creados = respuestas.filter(({ estado }) => estado === 201).map(({ texto }) => texto);
  // Con la misma clave son la misma solicitud: todos reciben el 201 del alta. Con claves distintas, una gana y las demás chocan
  // con el perfil que ya existe (409 /errores/perfil-ya-existe). En los dos casos, una fila.
  return armarResultado({
    clienteId,
    respuestas,
    ...(modo === 'misma-clave' ? { cuerposIguales: creados.length > 0 && creados.every((texto) => texto === creados[0]) } : {}),
    conteo: await base.contarClientes(clienteId),
    esperado: { porCodigo: modo === 'misma-clave' ? { 201: n } : { 201: 1, 409: n - 1 }, filas: 1 },
    prefijoRequestId,
  });
}

// N calificaciones del mismo viaje a la vez, cada una con su clave: una gana y las demás chocan con la restricción única de
// `calificaciones` (409 /errores/calificacion-duplicada). Para calificar, M2 le pregunta a M6 por el viaje, así que el M6
// simulado tiene que estar en modo normal durante la prueba; al terminar se repone el modo que tenía, también si algo falla.
export async function calificacionesSimultaneas(dependencias: DependenciasConcurrencia, { n }: { n: number }): Promise<ResultadoSimultaneo> {
  const { config, base, esperaMs } = dependencias;
  const clienteId = randomUUID();
  const { requestId, prefijoRequestId } = nuevaCorrida();

  await crearClienteDeEjemplo(dependencias, clienteId, requestId('cliente'));

  const estado = await controlM6(config, { metodo: 'GET', ruta: '/control/estado', requestId: requestId('modo') }, 'leer el modo');
  const modoAnterior = (estado as { modo?: unknown } | null)?.modo;
  if (!esModo(modoAnterior)) throw new PreparacionFallida('el canal de control del M6 simulado informó un modo desconocido');
  const ponerModo = (modo: ModoM6) =>
    controlM6(
      config,
      {
        metodo: 'PUT',
        ruta: '/control/modo',
        requestId: requestId(`modo-${modo}`),
        tipoContenido: 'application/json',
        cuerpo: new TextEncoder().encode(JSON.stringify({ modo })),
      },
      `poner el modo ${modo}`,
    );
  const cambiaElModo = modoAnterior !== 'normal';

  let respuestas: RespuestaDirecta[];
  try {
    if (cambiaElModo) await ponerModo('normal');
    const ejemplo = await controlM6(
      config,
      { metodo: 'POST', ruta: `/control/clientes/${clienteId}/ejemplo`, requestId: requestId('ejemplo') },
      'cargar el ejemplo',
    );
    const escenarios = (ejemplo as { escenarios?: unknown } | null)?.escenarios;
    const viajeId = Array.isArray(escenarios)
      ? (escenarios as { nombre?: unknown; viajeId?: unknown }[]).find(({ nombre }) => nombre === 'completado')?.viajeId
      : undefined;
    if (typeof viajeId !== 'string') throw new PreparacionFallida('el ejemplo del M6 simulado no trae un viaje completado');

    respuestas = await todosALaVez(n, (indice) =>
      m2Directo(
        config,
        {
          metodo: 'POST',
          ruta: `/api/v1/clientes/${clienteId}/calificaciones`,
          identidad: { rol: 'CLIENTE', sub: clienteId },
          requestId: requestId(indice),
          claveIdempotencia: randomUUID(),
          cuerpo: { viajeId, puntaje: 5 },
        },
        esperaMs,
      ),
    );
  } catch (error) {
    // Se intenta reponer el modo, pero lo que se informa es la falla original.
    if (cambiaElModo) await ponerModo(modoAnterior).catch(() => undefined);
    throw error;
  }
  // Sin poder reponerlo, el M6 simulado quedaría en normal sin que nadie lo sepa: mejor que la prueba falle y lo diga.
  if (cambiaElModo) await ponerModo(modoAnterior);

  return armarResultado({
    clienteId,
    respuestas,
    conteo: await base.contarCalificaciones(clienteId),
    esperado: { porCodigo: { 201: 1, 409: n - 1 }, filas: 1 },
    prefijoRequestId,
  });
}
