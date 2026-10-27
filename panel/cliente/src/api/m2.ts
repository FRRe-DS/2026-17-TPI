import type { components } from '../generado/contrato.js';
import type { Rol } from '../rutas.js';
import { ErrorDeApi, errorDeRespuesta, m2NoResponde } from './errores.js';

// El cliente de M2 que usan las pantallas: un método por operación de `contrato/openapi.yml` (RNF-02.3), que pide al servidor del
// panel y este reenvía a M2 con un token firmado (RNF-12.6). Los caminos son los mismos del contrato porque el panel los reenvía
// tal cual. No reintenta solo: reintenta la persona, con la misma clave de idempotencia en los `POST` (RNF-15.2).

// Más que esto, M2 «no responde» (RNF-15.4). El panel espera lo mismo a M2 (10 s): si se agota antes que acá, llega el `504`.
export const TIEMPO_MAXIMO_MS = 10_000;

type Esquemas = components['schemas'];
type Pagina = { page?: number; size?: number };

// Cada operación con su método y su ruta del contrato. La clave es el `operationId`; una prueba comprueba la tabla contra el YAML.
export const OPERACIONES = {
  verificarSalud: { metodo: 'GET', ruta: '/health' },
  crearCliente: { metodo: 'POST', ruta: '/api/v1/clientes' },
  obtenerCliente: { metodo: 'GET', ruta: '/api/v1/clientes/{clienteId}' },
  actualizarCliente: { metodo: 'PATCH', ruta: '/api/v1/clientes/{clienteId}' },
  listarDirecciones: { metodo: 'GET', ruta: '/api/v1/clientes/{clienteId}/direcciones' },
  crearDireccion: { metodo: 'POST', ruta: '/api/v1/clientes/{clienteId}/direcciones' },
  obtenerDireccion: { metodo: 'GET', ruta: '/api/v1/clientes/{clienteId}/direcciones/{direccionId}' },
  actualizarDireccion: { metodo: 'PATCH', ruta: '/api/v1/clientes/{clienteId}/direcciones/{direccionId}' },
  eliminarDireccion: { metodo: 'DELETE', ruta: '/api/v1/clientes/{clienteId}/direcciones/{direccionId}' },
  obtenerPreferencias: { metodo: 'GET', ruta: '/api/v1/clientes/{clienteId}/preferencias' },
  guardarPreferencias: { metodo: 'PUT', ruta: '/api/v1/clientes/{clienteId}/preferencias' },
  listarHistorialViajes: { metodo: 'GET', ruta: '/api/v1/clientes/{clienteId}/viajes' },
  listarCalificaciones: { metodo: 'GET', ruta: '/api/v1/clientes/{clienteId}/calificaciones' },
  calificarConductor: { metodo: 'POST', ruta: '/api/v1/clientes/{clienteId}/calificaciones' },
  obtenerCalificacion: { metodo: 'GET', ruta: '/api/v1/clientes/{clienteId}/calificaciones/{calificacionId}' },
  obtenerEstadoCuenta: { metodo: 'GET', ruta: '/api/v1/clientes/{clienteId}/estado-cuenta' },
  listarBloqueos: { metodo: 'GET', ruta: '/api/v1/clientes/{clienteId}/bloqueos' },
  crearBloqueo: { metodo: 'POST', ruta: '/api/v1/clientes/{clienteId}/bloqueos' },
  obtenerBloqueo: { metodo: 'GET', ruta: '/api/v1/clientes/{clienteId}/bloqueos/{bloqueoId}' },
  levantarBloqueo: { metodo: 'PATCH', ruta: '/api/v1/clientes/{clienteId}/bloqueos/{bloqueoId}' },
} as const satisfies Record<string, { metodo: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; ruta: string }>;
type Nombre = keyof typeof OPERACIONES;

// La identidad de prueba que el panel convierte en token (`X-Panel-Rol` y `X-Panel-Sub`). Sin ella el pedido va sin token y M2 responde 401.
export type Identidad = { rol: Rol; sub: string };

export type OpcionesApiM2 = {
  identidad?: () => Identidad | undefined;
  // Solo para las pruebas.
  fetch?: typeof fetch;
  tiempoMaximoMs?: number;
};

// Lo que se puede indicar en cualquier pedido: una señal para que la persona lo cancele (eso no es «M2 no responde»).
export type OpcionesDePedido = { senal?: AbortSignal };

type Datos = {
  camino?: Record<string, string>;
  consulta?: Record<string, string | number | undefined>;
  cuerpo?: unknown;
  clave?: string;
};

export function crearApiM2({ identidad, fetch: pedirHttp = (...args) => globalThis.fetch(...args), tiempoMaximoMs = TIEMPO_MAXIMO_MS }: OpcionesApiM2 = {}) {
  async function pedir<T>(nombre: Nombre, { camino = {}, consulta = {}, cuerpo, clave }: Datos, { senal }: OpcionesDePedido = {}): Promise<T> {
    const { metodo, ruta } = OPERACIONES[nombre];
    const parametros = new URLSearchParams();
    for (const [campo, valor] of Object.entries(consulta)) if (valor !== undefined) parametros.set(campo, String(valor));
    const query = parametros.toString();
    const url = ruta.replace(/\{(\w+)\}/g, (_, campo: string) => encodeURIComponent(camino[campo] ?? '')) + (query === '' ? '' : `?${query}`);

    const encabezados: Record<string, string> = { Accept: 'application/json' };
    const quien = identidad?.();
    if (quien !== undefined) {
      encabezados['X-Panel-Rol'] = quien.rol;
      encabezados['X-Panel-Sub'] = quien.sub;
    }
    if (clave !== undefined) encabezados['Idempotency-Key'] = clave;
    if (cuerpo !== undefined) encabezados['Content-Type'] = 'application/json';

    // El tiempo máximo cuenta hasta tener el cuerpo entero, no solo hasta las cabeceras.
    const tiempo = new AbortController();
    const temporizador = setTimeout(() => tiempo.abort(), tiempoMaximoMs);
    try {
      const respuesta = await pedirHttp(url, {
        method: metodo,
        headers: encabezados,
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
        signal: senal === undefined ? tiempo.signal : AbortSignal.any([tiempo.signal, senal]),
      });
      if (!respuesta.ok) throw await errorDeRespuesta(respuesta);
      if (respuesta.status === 204) return undefined as T;
      try {
        return (await respuesta.json()) as T;
      } catch (error) {
        if (tiempo.signal.aborted || senal?.aborted) throw error;
        // Un éxito que no se puede leer no se da por bueno: sería mostrar como hecho algo que M2 no confirmó (RNF-03.6).
        throw new ErrorDeApi({ sinRespuesta: false, estado: respuesta.status, type: 'about:blank', title: 'La respuesta de M2 no se pudo leer' });
      }
    } catch (error) {
      if (error instanceof ErrorDeApi) throw error;
      // La persona canceló: se devuelve tal cual, no es un fallo de M2. Si el tiempo también se agotó, manda el tiempo.
      if (senal?.aborted && !tiempo.signal.aborted) throw error;
      throw m2NoResponde();
    } finally {
      clearTimeout(temporizador);
    }
  }

  const cliente = (clienteId: string) => ({ clienteId });

  return {
    verificarSalud: (o?: OpcionesDePedido) => pedir<Esquemas['Salud']>('verificarSalud', {}, o),

    crearCliente: (cuerpo: Esquemas['ClienteNuevo'], clave: string, o?: OpcionesDePedido) =>
      pedir<Esquemas['Cliente']>('crearCliente', { cuerpo, clave }, o),
    obtenerCliente: (clienteId: string, o?: OpcionesDePedido) =>
      pedir<Esquemas['Cliente']>('obtenerCliente', { camino: cliente(clienteId) }, o),
    actualizarCliente: (clienteId: string, cuerpo: Esquemas['ClienteCambios'], o?: OpcionesDePedido) =>
      pedir<Esquemas['Cliente']>('actualizarCliente', { camino: cliente(clienteId), cuerpo }, o),

    listarDirecciones: (clienteId: string, consulta: Pagina & { tipo?: Esquemas['TipoDireccion'] } = {}, o?: OpcionesDePedido) =>
      pedir<Esquemas['PaginaDirecciones']>('listarDirecciones', { camino: cliente(clienteId), consulta }, o),
    crearDireccion: (clienteId: string, cuerpo: Esquemas['DireccionNueva'], clave: string, o?: OpcionesDePedido) =>
      pedir<Esquemas['Direccion']>('crearDireccion', { camino: cliente(clienteId), cuerpo, clave }, o),
    obtenerDireccion: (clienteId: string, direccionId: string, o?: OpcionesDePedido) =>
      pedir<Esquemas['Direccion']>('obtenerDireccion', { camino: { clienteId, direccionId } }, o),
    actualizarDireccion: (clienteId: string, direccionId: string, cuerpo: Esquemas['DireccionCambios'], o?: OpcionesDePedido) =>
      pedir<Esquemas['Direccion']>('actualizarDireccion', { camino: { clienteId, direccionId }, cuerpo }, o),
    eliminarDireccion: (clienteId: string, direccionId: string, o?: OpcionesDePedido) =>
      pedir<undefined>('eliminarDireccion', { camino: { clienteId, direccionId } }, o),

    obtenerPreferencias: (clienteId: string, o?: OpcionesDePedido) =>
      pedir<Esquemas['Preferencias']>('obtenerPreferencias', { camino: cliente(clienteId) }, o),
    guardarPreferencias: (clienteId: string, cuerpo: Esquemas['Preferencias'], o?: OpcionesDePedido) =>
      pedir<Esquemas['Preferencias']>('guardarPreferencias', { camino: cliente(clienteId), cuerpo }, o),

    listarHistorialViajes: (clienteId: string, consulta: Pagina = {}, o?: OpcionesDePedido) =>
      pedir<Esquemas['PaginaViajes']>('listarHistorialViajes', { camino: cliente(clienteId), consulta }, o),

    listarCalificaciones: (clienteId: string, consulta: Pagina = {}, o?: OpcionesDePedido) =>
      pedir<Esquemas['PaginaCalificaciones']>('listarCalificaciones', { camino: cliente(clienteId), consulta }, o),
    calificarConductor: (clienteId: string, cuerpo: Esquemas['CalificacionNueva'], clave: string, o?: OpcionesDePedido) =>
      pedir<Esquemas['Calificacion']>('calificarConductor', { camino: cliente(clienteId), cuerpo, clave }, o),
    obtenerCalificacion: (clienteId: string, calificacionId: string, o?: OpcionesDePedido) =>
      pedir<Esquemas['Calificacion']>('obtenerCalificacion', { camino: { clienteId, calificacionId } }, o),

    obtenerEstadoCuenta: (clienteId: string, o?: OpcionesDePedido) =>
      pedir<Esquemas['EstadoCuenta']>('obtenerEstadoCuenta', { camino: cliente(clienteId) }, o),

    listarBloqueos: (clienteId: string, consulta: Pagina = {}, o?: OpcionesDePedido) =>
      pedir<Esquemas['PaginaBloqueos']>('listarBloqueos', { camino: cliente(clienteId), consulta }, o),
    crearBloqueo: (clienteId: string, cuerpo: Esquemas['BloqueoNuevo'], clave: string, o?: OpcionesDePedido) =>
      pedir<Esquemas['Bloqueo']>('crearBloqueo', { camino: cliente(clienteId), cuerpo, clave }, o),
    obtenerBloqueo: (clienteId: string, bloqueoId: string, o?: OpcionesDePedido) =>
      pedir<Esquemas['Bloqueo']>('obtenerBloqueo', { camino: { clienteId, bloqueoId } }, o),
    levantarBloqueo: (clienteId: string, bloqueoId: string, cuerpo: Esquemas['LevantamientoBloqueo'], o?: OpcionesDePedido) =>
      pedir<Esquemas['Bloqueo']>('levantarBloqueo', { camino: { clienteId, bloqueoId }, cuerpo }, o),
  };
}

export type ApiM2 = ReturnType<typeof crearApiM2>;
