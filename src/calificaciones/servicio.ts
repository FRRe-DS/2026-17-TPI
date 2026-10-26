import { randomUUID } from 'node:crypto';
import type { Identidad } from '../auth/tokens.js';
import { buscarRespuesta, conIdempotencia, type RespuestaIdempotente, type SolicitudIdempotente } from '../bd/idempotencia.js';
import type { BaseDeDatos } from '../bd/pool.js';
import type { Consultar } from '../bd/transaccion.js';
import { exigirPerfil } from '../clientes/repositorio.js';
import { exigirPropietario, normalizarUuid } from '../clientes/servicio.js';
import { CalificacionDuplicada, NoEncontrado, ViajeNoCompletado } from '../errores.js';
import type { M6 } from '../historial/m6.js';
import type { CalificacionNueva } from './modelo.js';
import * as repositorio from './repositorio.js';

// Las reglas de las calificaciones que el contrato no expresa (plan, Estructura): la propiedad, la idempotencia, el perfil, el
// duplicado y lo que informa M6. No sabe de HTTP: lo llamará `operaciones.ts`. La propiedad es la de la spec 004
// (`exigirPropietario`): calificar solo admite CLIENTE, así que el sub tiene que ser el clienteId (RF-2.5.12). Los ids se
// normalizan como los devuelve PostgreSQL. Nada de esto escribe logs (RNF-19).

const VIAJE_NO_EXISTE = 'No existe el viaje pedido';

// `consultar` del pool, para el repositorio: es un método y necesita su `this`.
const delPool =
  (pool: BaseDeDatos): Consultar =>
  (sql, parametros) =>
    pool.consultar(sql, parametros);

// Califica al conductor del viaje `datos.viajeId` de `clienteId` (RF-2.5) con la Idempotency-Key `clave` (RF-2.5.4): 201 con
// Location, o la respuesta guardada si la solicitud se repite. El orden es el del plan (Lógica, Calificar): la propiedad (sin
// tocar la base ni M6), la respuesta guardada, el perfil y el duplicado, que solo leen y no llaman a M6 (RF-2.5.3, RF-2.5.11);
// después M6, fuera de toda transacción; y al final la transacción corta que reserva la clave e inserta. La respuesta guardada
// va primero: una repetición recibe el 201 original aunque la calificación ya exista y aunque M6 esté caído. Un viaje
// inexistente y uno ajeno dan el mismo 404 (RF-2.5.1); uno no completado, 422 (RF-2.5.2). Si algo falla, no queda ni la
// calificación ni la reserva, y la misma clave se evalúa de nuevo. Dos solicitudes iguales a la vez pueden llamar las dos a
// M6; en `conIdempotencia` la segunda espera a la primera y recibe su respuesta. Con claves distintas, la segunda choca con
// la restricción única de `calificaciones` y recibe 409 (RNF-08). El sujeto es el sub normalizado, que por la propiedad es el
// mismo cliente de la ruta. La huella lleva el cuerpo con el viajeId en minúsculas y el cliente de la ruta: el mismo viaje en
// mayúsculas es la misma solicitud.
export async function calificarConductor(
  pool: BaseDeDatos,
  m6: M6,
  identidad: Identidad,
  rolesOperacion: readonly string[],
  clienteId: string,
  clave: string,
  datos: CalificacionNueva,
  idCorrelacion: string,
): Promise<RespuestaIdempotente> {
  exigirPropietario(identidad, clienteId, rolesOperacion);
  const cliente = normalizarUuid(clienteId);
  const viajeId = normalizarUuid(datos.viajeId);
  const solicitud: SolicitudIdempotente = {
    operacion: 'calificarConductor',
    sujeto: normalizarUuid(identidad.sub),
    clienteId: cliente,
    clave,
    huella: { cuerpo: { ...datos, viajeId }, ruta: { clienteId: cliente } },
  };
  const consultar = delPool(pool);

  const guardada = await buscarRespuesta(consultar, solicitud);
  if (guardada !== null) return guardada;
  await exigirPerfil(consultar, cliente);
  if (await repositorio.existeCalificacion(consultar, cliente, viajeId)) {
    // La calificación puede ser de esta misma solicitud, confirmada por otra igual después de la primera lectura: entonces
    // corresponde su respuesta y no el 409.
    const confirmada = await buscarRespuesta(consultar, solicitud);
    if (confirmada !== null) return confirmada;
    throw new CalificacionDuplicada();
  }

  const viaje = await m6.obtenerViaje(viajeId, cliente, idCorrelacion);
  if (viaje === null) throw new NoEncontrado(VIAJE_NO_EXISTE);
  // `obtenerViaje` solo devuelve el conductor de un viaje completado.
  if (viaje.conductorId === undefined) throw new ViajeNoCompletado();
  const { conductorId } = viaje;

  return conIdempotencia(pool, solicitud, async (consultarEnTransaccion) => {
    const calificacion = await repositorio.crearCalificacion(consultarEnTransaccion, cliente, randomUUID(), {
      viajeId,
      conductorId,
      puntaje: datos.puntaje,
      ...(datos.comentario === undefined ? {} : { comentario: datos.comentario }),
    });
    return {
      estado: 201,
      ubicacion: `/api/v1/clientes/${cliente}/calificaciones/${calificacion.calificacionId}`,
      cuerpo: calificacion,
    };
  });
}
