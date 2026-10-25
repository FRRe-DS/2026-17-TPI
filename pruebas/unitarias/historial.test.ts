import { describe, expect, it } from 'vitest';
import { aPaginaDeM6, aPaginaViajes, aViajeResumen, type ViajeM6 } from '../../src/historial/modelo.js';

const CLIENTE = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const OTRO_CLIENTE = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const CONDUCTOR = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';

const viaje = (n: number, extra: Partial<ViajeM6> = {}): ViajeM6 => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  state: 'COMPLETED',
  clientId: CLIENTE,
  driverId: CONDUCTOR,
  ...extra,
});

describe('aViajeResumen (007/T3, RF-2.4.1)', () => {
  it('devuelve viajeId, estado y conductorId, y nada más de lo que M6 informa', () => {
    const resumen = aViajeResumen({ ...viaje(1), originLatitude: -27.4, distanceKm: 3.2, createdAt: '2026-10-01T10:00:00Z' } as ViajeM6);

    expect(resumen).toEqual({ viajeId: viaje(1).id, estado: 'COMPLETED', conductorId: CONDUCTOR });
  });

  it('sin driverId, el viaje se incluye sin conductorId (la clave no está)', () => {
    const resumen = aViajeResumen(viaje(2, { driverId: undefined, state: 'CANCELLED_BY_CLIENT' }));

    expect(resumen).toEqual({ viajeId: viaje(2).id, estado: 'CANCELLED_BY_CLIENT' });
    expect(Object.keys(resumen)).not.toContain('conductorId');
  });

  it('un driverId vacío tampoco es un conductor', () => {
    expect(Object.keys(aViajeResumen(viaje(3, { driverId: '' })))).not.toContain('conductorId');
  });

  it('un estado que M2 no conoce se devuelve tal cual, sin traducir', () => {
    expect(aViajeResumen(viaje(4, { state: 'EN_REVISION_MANUAL' })).estado).toBe('EN_REVISION_MANUAL');
    expect(aViajeResumen(viaje(5, { state: 'IN_PROGRESS' })).estado).toBe('IN_PROGRESS');
  });
});

describe('aPaginaDeM6 (007/T3, casos límite)', () => {
  it.each([
    [0, 1],
    [1, 2],
    [9, 10],
  ])('la página %i de M2 es la %i de M6', (page, deM6) => {
    expect(aPaginaDeM6(page)).toBe(deM6);
  });
});

describe('aPaginaViajes (007/T3, RF-2.4.1, RF-2.4.2, RF-2.4.3, RF-2.4.9)', () => {
  it('devuelve page y size pedidos, el total de M6 y los viajes convertidos en el orden de M6', () => {
    const pagina = aPaginaViajes({ items: [viaje(1), viaje(2, { driverId: undefined })], total: 2 }, CLIENTE, 0, 20);

    expect(pagina).toEqual({
      page: 0,
      size: 20,
      totalElementos: 2,
      totalPaginas: 1,
      items: [
        { viajeId: viaje(1).id, estado: 'COMPLETED', conductorId: CONDUCTOR },
        { viajeId: viaje(2).id, estado: 'COMPLETED' },
      ],
    });
  });

  it.each([
    [0, 20, 0],
    [1, 20, 1],
    [20, 20, 1],
    [21, 20, 2],
    [40, 20, 2],
    [41, 20, 3],
    [1, 1, 1],
    [7, 1, 7],
    [101, 100, 2],
  ])('con total %i y size %i, totalPaginas es %i (redondeo hacia arriba)', (total, size, totalPaginas) => {
    expect(aPaginaViajes({ items: [], total }, CLIENTE, 0, size).totalPaginas).toBe(totalPaginas);
  });

  it('una página vacía conserva los totales de M6 y el page pedido, aunque quede fuera del total', () => {
    expect(aPaginaViajes({ items: [], total: 45 }, CLIENTE, 9, 20)).toEqual({
      page: 9,
      size: 20,
      totalElementos: 45,
      totalPaginas: 3,
      items: [],
    });
  });

  it('un cliente sin viajes: items vacío y totales en cero', () => {
    expect(aPaginaViajes({ items: [], total: 0 }, CLIENTE, 0, 20)).toEqual({
      page: 0,
      size: 20,
      totalElementos: 0,
      totalPaginas: 0,
      items: [],
    });
  });

  it('descarta el viaje de otro cliente y deja los propios, sin tocar el total de M6', () => {
    const ajeno = viaje(2, { clientId: OTRO_CLIENTE });

    const pagina = aPaginaViajes({ items: [viaje(1), ajeno, viaje(3)], total: 3 }, CLIENTE, 0, 20);

    expect(pagina.items.map((item) => item.viajeId)).toEqual([viaje(1).id, viaje(3).id]);
    expect(pagina.totalElementos).toBe(3);
    expect(pagina.totalPaginas).toBe(1);
  });

  it('un clientId en mayúsculas o sin clientId: el UUID no distingue mayúsculas; sin clientId no es propio (007/T5)', () => {
    const pagina = aPaginaViajes(
      { items: [viaje(1, { clientId: CLIENTE.toUpperCase() }), viaje(2, { clientId: undefined }), viaje(3, { clientId: null })], total: 3 },
      CLIENTE,
      0,
      20,
    );

    expect(pagina.items.map((item) => item.viajeId)).toEqual([viaje(1).id]);
  });

  it('si todos son de otro cliente, items queda vacío', () => {
    const pagina = aPaginaViajes({ items: [viaje(1, { clientId: OTRO_CLIENTE })], total: 1 }, CLIENTE, 0, 20);

    expect(pagina.items).toEqual([]);
  });

  it('no modifica la respuesta de M6', () => {
    const cuerpo = { items: [viaje(1), viaje(2, { clientId: OTRO_CLIENTE })], total: 2 };
    const copia = structuredClone(cuerpo);

    aPaginaViajes(cuerpo, CLIENTE, 0, 20);

    expect(cuerpo).toEqual(copia);
  });
});
