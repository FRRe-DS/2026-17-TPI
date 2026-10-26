import { describe, expect, it } from 'vitest';
import { aCalificacion, aPaginaCalificaciones, type FilaCalificacion } from '../../src/calificaciones/modelo.js';
import { aProblema, CalificacionDuplicada, ViajeNoCompletado } from '../../src/errores.js';

const CALIFICACION_ID = 'b3c0f1a2-7d44-4c1e-9a55-1e2f3a4b5c6d';
const VIAJE_ID = '0b9f2d7e-5a1c-4e3b-8c64-2d9e7f1a3b50';
const CONDUCTOR_ID = '7e2a9c14-3f68-4b05-a1d7-6c4e8b2f9d03';

// Una fila como la entrega pg: `creado_en` como `Date` y el puntaje (smallint) como número. El `cliente_id` no está: la
// calificación se busca siempre por cliente y el contrato no lo expone.
const fila = (cambios: Partial<FilaCalificacion> = {}): FilaCalificacion => ({
  calificacion_id: CALIFICACION_ID,
  viaje_id: VIAJE_ID,
  conductor_id: CONDUCTOR_ID,
  puntaje: 4,
  comentario: 'Muy amable',
  creado_en: new Date('2026-10-26T12:00:00.123Z'),
  ...cambios,
});

describe('CalificacionDuplicada y ViajeNoCompletado (RF-2.5.2, RF-2.5.3)', () => {
  it('CalificacionDuplicada es un 409 con su tipo propio, sin ids ni comentario', () => {
    const { codigo, cuerpo } = aProblema(new CalificacionDuplicada(), '/api/v1/clientes/x/calificaciones');

    expect(codigo).toBe(409);
    expect(cuerpo).toEqual({
      type: '/errores/calificacion-duplicada',
      title: 'El viaje ya fue calificado',
      status: 409,
      detail: 'Ya existe una calificación de este viaje',
      instance: '/api/v1/clientes/x/calificaciones',
    });
  });

  it('ViajeNoCompletado es un 422 con su tipo propio, sin ids ni el estado del viaje', () => {
    const { codigo, cuerpo } = aProblema(new ViajeNoCompletado(), '/api/v1/clientes/x/calificaciones');

    expect(codigo).toBe(422);
    expect(cuerpo).toEqual({
      type: '/errores/viaje-no-completado',
      title: 'Viaje no completado',
      status: 422,
      detail: 'Solo se puede calificar un viaje completado',
      instance: '/api/v1/clientes/x/calificaciones',
    });
  });

  it('responden en problem+json y sin encabezados extra: ni Retry-After ni WWW-Authenticate', () => {
    const solo = { 'Content-Type': 'application/problem+json' };

    expect(aProblema(new CalificacionDuplicada(), '/x').encabezados).toEqual(solo);
    expect(aProblema(new ViajeNoCompletado(), '/x').encabezados).toEqual(solo);
  });
});

describe('aCalificacion(): de la fila al esquema Calificacion del contrato (RF-2.5, RF-2.5.10)', () => {
  it('pasa cada columna a su campo, con la fecha en ISO 8601', () => {
    expect(aCalificacion(fila())).toEqual({
      calificacionId: CALIFICACION_ID,
      viajeId: VIAJE_ID,
      conductorId: CONDUCTOR_ID,
      puntaje: 4,
      comentario: 'Muy amable',
      creadoEn: '2026-10-26T12:00:00.123Z',
    });
  });

  it('sin comentario, el campo no está: el contrato no admite null', () => {
    expect(aCalificacion(fila({ comentario: null }))).not.toHaveProperty('comentario');
  });

  it('un comentario vacío sigue ahí: no equivale a un comentario ausente', () => {
    expect(aCalificacion(fila({ comentario: '' }))).toHaveProperty('comentario', '');
  });

  it.each([1, 2, 3, 4, 5])('el puntaje %i sale como número', (puntaje) => {
    expect(aCalificacion(fila({ puntaje })).puntaje).toBe(puntaje);
  });

  it('solo trae los campos del esquema: ningún cliente_id', () => {
    expect(Object.keys(aCalificacion(fila())).sort()).toEqual(
      ['calificacionId', 'comentario', 'conductorId', 'creadoEn', 'puntaje', 'viajeId'].sort(),
    );
  });
});

describe('aPaginaCalificaciones(): una página del listado (RF-2.5.8, RF-2.5.9)', () => {
  it('devuelve las calificaciones en el orden recibido, con page y size pedidos y los totales del cliente', () => {
    const otra = fila({ calificacion_id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', puntaje: 2 });

    const pagina = aPaginaCalificaciones([fila(), otra], 45, 1, 20);

    expect(pagina).toEqual({
      page: 1,
      size: 20,
      totalElementos: 45,
      totalPaginas: 3,
      items: [aCalificacion(fila()), aCalificacion(otra)],
    });
  });

  it('redondea totalPaginas hacia arriba y no pasa de cero con cero calificaciones', () => {
    expect(aPaginaCalificaciones([], 41, 0, 20).totalPaginas).toBe(3);
    expect(aPaginaCalificaciones([], 40, 0, 20).totalPaginas).toBe(2);
    expect(aPaginaCalificaciones([], 1, 0, 100).totalPaginas).toBe(1);
    expect(aPaginaCalificaciones([], 0, 0, 20)).toEqual({ page: 0, size: 20, totalElementos: 0, totalPaginas: 0, items: [] });
  });

  it('una página fuera del total tiene items vacío y conserva los totales', () => {
    expect(aPaginaCalificaciones([], 3, 9, 20)).toEqual({ page: 9, size: 20, totalElementos: 3, totalPaginas: 1, items: [] });
  });
});
