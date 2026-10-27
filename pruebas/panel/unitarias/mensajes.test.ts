import { describe, expect, it } from 'vitest';
import { ErrorDeApi } from '../../../panel/cliente/src/api/errores.js';
import { mensajeDeCalificacion } from '../../../panel/cliente/src/logica/mensajes.js';

// Lo que dice el panel cuando M2 rechaza una calificación (T26, RF-2.5.16): un texto distinto según el código y el `type`. Todo lo
// demás no tiene texto propio y se muestra con el error de M2 completo (RNF-03.6).

const error = (estado: number, type = 'about:blank') => new ErrorDeApi({ sinRespuesta: false, estado, type, title: 'T' });

describe('mensajeDeCalificacion: un texto por cada rechazo conocido (RF-2.5.16)', () => {
  it.each([
    ['404 viaje no encontrado', error(404, '/errores/no-encontrado'), 'Viaje no encontrado.'],
    ['404 con cualquier type', error(404), 'Viaje no encontrado.'],
    ['409 calificación duplicada', error(409, '/errores/calificacion-duplicada'), 'Ya calificaste este viaje.'],
    ['422 viaje no completado', error(422, '/errores/viaje-no-completado'), 'El viaje todavía no está completado.'],
    [
      '422 clave reutilizada',
      error(422, '/errores/idempotencia-reutilizada'),
      'Esta calificación ya se envió con otros datos. Cerrá el formulario y abrilo de nuevo para enviar otra.',
    ],
    ['503 dependencia', error(503, '/errores/dependencia-no-disponible'), 'Calificar depende del módulo de viajes (M6), que no contestó.'],
  ])('%s', (_, e, texto) => {
    expect(mensajeDeCalificacion(e)).toBe(texto);
  });

  it('los cuatro textos de rechazo son distintos entre sí', () => {
    const textos = [
      mensajeDeCalificacion(error(404)),
      mensajeDeCalificacion(error(409, '/errores/calificacion-duplicada')),
      mensajeDeCalificacion(error(422, '/errores/viaje-no-completado')),
      mensajeDeCalificacion(error(422, '/errores/idempotencia-reutilizada')),
      mensajeDeCalificacion(error(503)),
    ];
    expect(new Set(textos).size).toBe(5);
  });

  it('un 409 o un 422 con otro type no tiene texto propio', () => {
    expect(mensajeDeCalificacion(error(409, '/errores/otro'))).toBeUndefined();
    expect(mensajeDeCalificacion(error(422, '/errores/otro'))).toBeUndefined();
    expect(mensajeDeCalificacion(error(409))).toBeUndefined();
  });

  it.each([[400], [401], [403], [500], [502]])('un %i no tiene texto propio: va el error de M2', (estado) => {
    expect(mensajeDeCalificacion(error(estado, '/errores/calificacion-duplicada'))).toBeUndefined();
  });

  it('M2 sin respuesta no tiene texto propio: ya lo dice «M2 no responde»', () => {
    expect(mensajeDeCalificacion(new ErrorDeApi({ sinRespuesta: true, estado: 504, type: 'x', title: 'M2 no responde' }))).toBeUndefined();
  });
});
