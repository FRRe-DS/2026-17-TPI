import { randomUUID } from 'node:crypto';
import type { ConfigPanel, ConfigTokens } from '../config.js';
import type { BaseDemo } from './base.js';
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

// Un perfil válido para el contrato; el mismo en los N pedidos, para que con la misma clave sean la misma solicitud.
const PERFIL_DE_EJEMPLO = { nombre: 'Ana', apellido: 'Gómez', telefono: '+5493624000000' };

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
  return { requestId: (indice: number) => idDePedido(corrida, indice), prefijoRequestId: idDePedido(corrida, 0).slice(0, -1) };
}

export async function altasSimultaneas(
  { config, base, esperaMs }: DependenciasConcurrencia,
  { n, modo }: { n: number; modo: ModoAltas },
): Promise<ResultadoSimultaneo> {
  const clienteId = randomUUID();
  const { requestId, prefijoRequestId } = nuevaCorrida();
  const claveComun = randomUUID();

  // Se arman todos y se lanzan juntos: ninguno espera a otro (el `fetch` de Node no limita las conexiones por servidor).
  const respuestas = await Promise.all(
    Array.from({ length: n }, (_, indice) =>
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
    ),
  );

  const porCodigo = contarPorCodigo(respuestas);
  const creados = respuestas.filter(({ estado }) => estado === 201).map(({ texto }) => texto);
  const cuerposIguales = modo === 'misma-clave' ? creados.length > 0 && creados.every((texto) => texto === creados[0]) : undefined;
  const { filas, motivo } = await base.contarClientes(clienteId);
  // Con la misma clave son la misma solicitud: todos reciben el 201 del alta. Con claves distintas, una gana y las demás chocan
  // con el perfil que ya existe (409 /errores/perfil-ya-existe). En los dos casos, una fila.
  const esperado: ResultadoSimultaneo['esperado'] = { porCodigo: modo === 'misma-clave' ? { 201: n } : { 201: 1, 409: n - 1 }, filas: 1 };

  return {
    clienteId,
    n,
    porCodigo,
    ...(cuerposIguales === undefined ? {} : { cuerposIguales }),
    filas,
    ...(motivo === undefined ? {} : { motivoFilas: motivo }),
    esperado,
    cumple: mismosCodigos(porCodigo, esperado.porCodigo) && filas === esperado.filas && cuerposIguales !== false,
    prefijoRequestId,
  };
}
