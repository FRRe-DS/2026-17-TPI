import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlmacenCerrado, CapacidadAgotada } from '../../../panel/servidor/auth/almacen.js';
import { crearAlmacenSesiones, type DatosSesion } from '../../../panel/servidor/auth/sesiones.js';
import { crearAlmacenTransacciones } from '../../../panel/servidor/auth/transacciones.js';

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const AHORA = Date.UTC(2026, 10, 23, 12);
const cerrar: (() => void)[] = [];

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(AHORA); });
afterEach(() => { for (const fn of cerrar.splice(0)) fn(); vi.useRealTimers(); });

function datosSesion(): DatosSesion {
  return {
    sub: 'cliente-1', roles: ['CLIENTE'], scopes: ['clientes:read'], nombre: 'Ana',
    credenciales: {
      accessToken: 'access-solo-servidor', refreshToken: 'refresh-solo-servidor',
      accessTokenVenceEn: AHORA + 5 * MINUTO, refreshTokenVenceEn: AHORA + 12 * HORA,
    },
  };
}

function sesiones() {
  const almacen = crearAlmacenSesiones(); cerrar.push(almacen.cerrar); return almacen;
}

function transacciones() {
  const almacen = crearAlmacenTransacciones(); cerrar.push(almacen.cerrar); return almacen;
}

const INGRESO = { tipo: 'ingreso' as const, nonce: 'nonce-servidor', verifier: 'verifier-servidor', retorno: '/' };

describe('sesiones en memoria (083/T2, RNF-12.83.2)', () => {
  it('crea identificadores nuevos de 32 bytes y rechaza una identidad desconocida o su hash', () => {
    const almacen = sesiones();
    const id = almacen.crear(datosSesion());
    const otro = almacen.crear({ ...datosSesion(), sub: 'cliente-2' });
    expect(Buffer.from(id, 'base64url')).toHaveLength(32);
    expect(id).not.toBe(otro);
    expect(almacen.obtener(id)).toMatchObject({ sub: 'cliente-1', version: 0, creadaEn: AHORA, ultimaActividadEn: AHORA });
    expect(almacen.obtener(otro)?.sub).toBe('cliente-2');
    for (const desconocido of [undefined, '', 'ajeno', 'a'.repeat(43), createHash('sha256').update(id).digest('hex')]) {
      expect(almacen.obtener(desconocido)).toBeUndefined();
      expect(almacen.registrarActividad(desconocido)).toBe(false);
      expect(almacen.invalidar(desconocido)).toBe(false);
    }
  });

  it('la consulta de sesión no renueva la inactividad y el límite exacto vence', () => {
    const almacen = sesiones(); const id = almacen.crear(datosSesion());
    vi.setSystemTime(AHORA + 29 * MINUTO);
    expect(almacen.obtener(id)).toBeDefined();
    vi.setSystemTime(AHORA + 30 * MINUTO);
    expect(almacen.obtener(id)).toBeUndefined();
    expect(almacen.registrarActividad(id)).toBe(false);
  });

  it('la actividad explícita renueva la inactividad, pero nunca las ocho horas absolutas', () => {
    const almacen = sesiones(); const id = almacen.crear(datosSesion());
    for (let minuto = 20; minuto < 480; minuto += 20) {
      vi.setSystemTime(AHORA + minuto * MINUTO);
      expect(almacen.registrarActividad(id)).toBe(true);
    }
    expect(almacen.obtener(id)?.venceEn).toBe(AHORA + 8 * HORA);
    vi.setSystemTime(AHORA + 8 * HORA);
    expect(almacen.obtener(id)).toBeUndefined();
  });

  it('no supera el vencimiento de refresh de Keycloak aunque haya actividad', () => {
    const almacen = sesiones(); const datos = datosSesion();
    datos.credenciales.refreshTokenVenceEn = AHORA + 25 * MINUTO;
    const id = almacen.crear(datos);
    vi.setSystemTime(AHORA + 20 * MINUTO);
    expect(almacen.registrarActividad(id)).toBe(true);
    vi.setSystemTime(AHORA + 25 * MINUTO);
    expect(almacen.obtener(id)).toBeUndefined();
  });

  it('un access token vencido conserva la sesión para la futura renovación', () => {
    const almacen = sesiones(); const id = almacen.crear(datosSesion());
    vi.setSystemTime(AHORA + 6 * MINUTO);
    expect(almacen.obtener(id)?.credenciales.refreshToken).toBe('refresh-solo-servidor');
  });

  it('el logout elimina la sesión sin afectar a otra', () => {
    const almacen = sesiones(); const id = almacen.crear(datosSesion());
    const otro = almacen.crear(datosSesion());
    expect(almacen.invalidar(id)).toBe(true);
    expect(almacen.invalidar(id)).toBe(false);
    expect(almacen.obtener(id)).toBeUndefined();
    expect(almacen.obtener(otro)).toBeDefined();
  });

  it('copiar datos impide cambiar identidad, permisos, tokens o tiempos desde referencias ajenas', () => {
    const almacen = sesiones(); const datos = datosSesion(); const id = almacen.crear(datos);
    datos.roles.push('OPERADOR'); datos.credenciales.refreshToken = 'otro';
    const vista = almacen.obtener(id)!;
    Object.assign(vista, { sub: 'atacante', venceEn: Infinity });
    vista.scopes.push('clientes:write'); vista.credenciales.refreshTokenVenceEn = Infinity;
    expect(almacen.obtener(id)).toMatchObject({
      sub: 'cliente-1', roles: ['CLIENTE'], scopes: ['clientes:read'], venceEn: AHORA + 8 * HORA,
      credenciales: { refreshToken: 'refresh-solo-servidor', refreshTokenVenceEn: AHORA + 12 * HORA },
    });
  });

  it('admite 1000 y rechaza la siguiente sin expulsar sesiones activas ni revelar tokens', () => {
    const almacen = sesiones(); const ids = Array.from({ length: 1000 }, () => almacen.crear(datosSesion()));
    expect(() => almacen.crear(datosSesion())).toThrow(CapacidadAgotada);
    expect(almacen.cantidad()).toBe(1000);
    for (const id of ids) expect(almacen.obtener(id)).toBeDefined();
    expect(() => almacen.crear(datosSesion())).toThrow('Capacidad del almacén agotada');
  });

  it('libera espacio al acceder antes de admitir una nueva sesión', () => {
    const almacen = sesiones(); const ids = Array.from({ length: 1000 }, () => almacen.crear(datosSesion()));
    vi.setSystemTime(AHORA + 30 * MINUTO);
    const nueva = almacen.crear(datosSesion());
    expect(almacen.cantidad()).toBe(1);
    expect(almacen.obtener(ids[0])).toBeUndefined();
    expect(almacen.obtener(nueva)).toBeDefined();
  });

  it('limpia periódicamente sin solicitudes y cerrar borra datos y cancela el temporizador', () => {
    const antes = vi.getTimerCount(); const almacen = sesiones(); const id = almacen.crear(datosSesion());
    expect(vi.getTimerCount()).toBe(antes + 1);
    vi.advanceTimersByTime(30 * MINUTO);
    expect(almacen.cantidad()).toBe(0);
    almacen.cerrar(); almacen.cerrar();
    expect(vi.getTimerCount()).toBe(antes);
    expect(almacen.obtener(id)).toBeUndefined();
    expect(() => almacen.crear(datosSesion())).toThrow(AlmacenCerrado);
  });

  it('cerrar elimina también una sesión todavía vigente', () => {
    const almacen = sesiones(); const id = almacen.crear(datosSesion());
    almacen.cerrar(); expect(almacen.cantidad()).toBe(0);
    expect(almacen.obtener(id)).toBeUndefined();
  });

  it.each([NaN, Infinity, AHORA, AHORA - 1])('rechaza límites inválidos o vencidos de Keycloak (%s)', (vence) => {
    const almacen = sesiones(); const datos = datosSesion(); datos.credenciales.refreshTokenVenceEn = vence;
    expect(() => almacen.crear(datos)).toThrow('Vencimiento de credenciales inválido');
    expect(almacen.cantidad()).toBe(0);
  });
});

describe('transacciones de ingreso y salida (083/T2, RNF-12.83.2)', () => {
  it('genera state y vínculo independientes y consume exactamente una vez', () => {
    const almacen = transacciones(); const { state, vinculo } = almacen.crear(INGRESO);
    expect(Buffer.from(state, 'base64url')).toHaveLength(32);
    expect(Buffer.from(vinculo, 'base64url')).toHaveLength(32);
    expect(state).not.toBe(vinculo);
    expect(almacen.consumir(state, vinculo)).toEqual(INGRESO);
    expect(almacen.consumir(state, vinculo)).toBeUndefined();
  });

  it('otro navegador no consume la transacción del propietario aunque conozca state', () => {
    const almacen = transacciones(); const propia = almacen.crear(INGRESO); const ajena = almacen.crear(INGRESO);
    for (const vinculo of [undefined, '', 'ajeno', ajena.vinculo]) {
      expect(almacen.consumir(propia.state, vinculo)).toBeUndefined();
    }
    expect(almacen.consumir(propia.state, propia.vinculo)).toEqual(INGRESO);
    expect(almacen.consumir(ajena.state, ajena.vinculo)).toEqual(INGRESO);
  });

  it('un state desconocido no obtiene datos ni afecta a otra transacción', () => {
    const almacen = transacciones(); const propia = almacen.crear(INGRESO);
    expect(almacen.consumir('a'.repeat(43), propia.vinculo)).toBeUndefined();
    expect(almacen.consumir(undefined, propia.vinculo)).toBeUndefined();
    expect(almacen.consumir(propia.state, propia.vinculo)).toEqual(INGRESO);
  });

  it('a los cinco minutos vence, incluso justo en el límite', () => {
    const almacen = transacciones(); const primera = almacen.crear(INGRESO); const segunda = almacen.crear(INGRESO);
    vi.setSystemTime(AHORA + 5 * MINUTO - 1);
    expect(almacen.consumir(primera.state, primera.vinculo)).toEqual(INGRESO);
    vi.setSystemTime(AHORA + 5 * MINUTO);
    expect(almacen.consumir(segunda.state, segunda.vinculo)).toBeUndefined();
  });

  it('si vence mientras se comprueba el vínculo, tampoco entrega sus datos', () => {
    let consumir = false;
    let lecturas = 0;
    const almacen = crearAlmacenTransacciones(() => consumir
      ? AHORA + 5 * MINUTO - (lecturas++ === 0 ? 1 : 0)
      : AHORA);
    cerrar.push(almacen.cerrar);
    const propia = almacen.crear(INGRESO);
    consumir = true;
    expect(almacen.consumir(propia.state, propia.vinculo)).toBeUndefined();
    expect(almacen.cantidad()).toBe(0);
  });

  it('admite transacciones de salida y copia los datos recibidos', () => {
    const almacen = transacciones(); const datos = { tipo: 'salida' as const, retorno: '/' };
    const salida = almacen.crear(datos); datos.retorno = '/cambiado';
    expect(almacen.consumir(salida.state, salida.vinculo)).toEqual({ tipo: 'salida', retorno: '/' });
  });

  it('rechaza sobrepasar 1000 sin expulsar y recupera el lugar al consumir', () => {
    const almacen = transacciones();
    const ids = Array.from({ length: 1000 }, () => almacen.crear(INGRESO));
    expect(() => almacen.crear(INGRESO)).toThrow(CapacidadAgotada);
    for (const { state, vinculo } of ids) expect(almacen.consumir(state, vinculo)).toEqual(INGRESO);
    expect(almacen.cantidad()).toBe(0);
    expect(almacen.crear(INGRESO)).toHaveProperty('state');
  });

  it('recupera capacidad al crear después del vencimiento y limpia periódicamente', () => {
    const almacen = transacciones(); Array.from({ length: 1000 }, () => almacen.crear(INGRESO));
    vi.setSystemTime(AHORA + 5 * MINUTO);
    almacen.crear(INGRESO); expect(almacen.cantidad()).toBe(1);
    vi.advanceTimersByTime(5 * MINUTO); expect(almacen.cantidad()).toBe(0);
  });

  it('cerrar cancela el temporizador, vacía el almacén y no admite nuevas transacciones', () => {
    const antes = vi.getTimerCount(); const almacen = transacciones(); const datos = almacen.crear(INGRESO);
    expect(vi.getTimerCount()).toBe(antes + 1);
    almacen.cerrar(); almacen.cerrar();
    expect(vi.getTimerCount()).toBe(antes);
    expect(almacen.cantidad()).toBe(0);
    expect(almacen.consumir(datos.state, datos.vinculo)).toBeUndefined();
    expect(() => almacen.crear(INGRESO)).toThrow(AlmacenCerrado);
  });
});
