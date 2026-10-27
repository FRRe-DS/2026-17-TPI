import { describe, expect, it } from 'vitest';
import { crearSesionSimulada, CLAVE_DE_SESION, ETIQUETA_SESION } from '../../../panel/cliente/src/fuentes/sesion-simulada.js';
import { ETIQUETA_VIAJES, fuenteDeViajes } from '../../../panel/cliente/src/fuentes/viajes-simulados.js';
import type { FuenteDeSesion } from '../../../panel/cliente/src/fuentes/fuente-de-sesion.js';
import { ROLES } from '../../../panel/cliente/src/rutas.js';

const CLIENTE = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';

// Un almacenamiento de sesión de mentira, que guarda en un mapa y puede fallar en lo que se le indique.
function almacenamiento(fallan: ('getItem' | 'setItem' | 'removeItem')[] = [], inicial: Record<string, string> = {}) {
  const datos = new Map(Object.entries(inicial));
  const probar = (operacion: (typeof fallan)[number]) => {
    if (fallan.includes(operacion)) throw new DOMException('Almacenamiento bloqueado', 'SecurityError');
  };
  return {
    datos,
    getItem: (clave: string) => (probar('getItem'), datos.get(clave) ?? null),
    setItem: (clave: string, valor: string) => (probar('setItem'), void datos.set(clave, valor)),
    removeItem: (clave: string) => (probar('removeItem'), void datos.delete(clave)),
  };
}

describe('la sesión simulada implementa FuenteDeSesion (RNF-12.9, RNF-02.2)', () => {
  it('sin sesión, actual() es undefined', () => {
    const fuente: FuenteDeSesion = crearSesionSimulada(almacenamiento());

    expect(fuente.actual()).toBeUndefined();
  });

  it.each(ROLES)('iniciar(%s, sub) deja la sesión actual', (rol) => {
    const fuente = crearSesionSimulada(almacenamiento());

    fuente.iniciar(rol, CLIENTE);

    expect(fuente.actual()).toEqual({ rol, sub: CLIENTE });
  });

  it('cerrar() olvida el rol y el cliente', () => {
    const fuente = crearSesionSimulada(almacenamiento());
    fuente.iniciar('CLIENTE', CLIENTE);

    fuente.cerrar();

    expect(fuente.actual()).toBeUndefined();
  });

  it('cerrar() sin sesión no falla', () => {
    expect(() => crearSesionSimulada(almacenamiento()).cerrar()).not.toThrow();
  });

  it('iniciar() reemplaza la sesión anterior', () => {
    const fuente = crearSesionSimulada(almacenamiento());
    fuente.iniciar('CLIENTE', CLIENTE);

    fuente.iniciar('OPERADOR', 'operador-1');

    expect(fuente.actual()).toEqual({ rol: 'OPERADOR', sub: 'operador-1' });
  });

  it.each([['CAJERO'], [''], ['cliente'], [undefined]])('un rol %j no se acepta y no cambia la sesión', (rol) => {
    const fuente = crearSesionSimulada(almacenamiento());
    fuente.iniciar('CLIENTE', CLIENTE);

    expect(() => fuente.iniciar(rol as never, CLIENTE)).toThrow(/rol/i);
    expect(fuente.actual()).toEqual({ rol: 'CLIENTE', sub: CLIENTE });
  });

  it.each([[''], ['   '], ['a'.repeat(129)]])('un identificador %j no se acepta', (sub) => {
    const fuente = crearSesionSimulada(almacenamiento());

    expect(() => fuente.iniciar('CLIENTE', sub)).toThrow(/identificador/i);
    expect(fuente.actual()).toBeUndefined();
  });

  it('el identificador se guarda sin espacios de más y 128 caracteres es el máximo', () => {
    const fuente = crearSesionSimulada(almacenamiento());

    fuente.iniciar('SERVICIO', `  ${'a'.repeat(128)} `);

    expect(fuente.actual()).toEqual({ rol: 'SERVICIO', sub: 'a'.repeat(128) });
  });
});

describe('el almacenamiento de sesión (RNF-19.3)', () => {
  it('guarda solo el rol y el identificador: ningún token ni secreto', () => {
    const memoria = almacenamiento();

    crearSesionSimulada(memoria).iniciar('CLIENTE', CLIENTE);

    expect([...memoria.datos.keys()]).toEqual([CLAVE_DE_SESION]);
    expect(JSON.parse(memoria.datos.get(CLAVE_DE_SESION)!)).toEqual({ rol: 'CLIENTE', sub: CLIENTE });
  });

  it('cerrar() borra lo guardado', () => {
    const memoria = almacenamiento();
    const fuente = crearSesionSimulada(memoria);
    fuente.iniciar('CLIENTE', CLIENTE);

    fuente.cerrar();

    expect(memoria.datos.size).toBe(0);
  });

  it('al recargar la página, otra fuente sobre el mismo almacenamiento recupera la sesión', () => {
    const memoria = almacenamiento();
    crearSesionSimulada(memoria).iniciar('OPERADOR', 'operador-1');

    expect(crearSesionSimulada(memoria).actual()).toEqual({ rol: 'OPERADOR', sub: 'operador-1' });
  });

  it.each([
    ['no es JSON', '{roto'],
    ['es un texto', '"CLIENTE"'],
    ['es null', 'null'],
    ['un rol inválido', JSON.stringify({ rol: 'CAJERO', sub: CLIENTE })],
    ['sin identificador', JSON.stringify({ rol: 'CLIENTE' })],
    ['identificador vacío', JSON.stringify({ rol: 'CLIENTE', sub: '' })],
    ['identificador que no es texto', JSON.stringify({ rol: 'CLIENTE', sub: 7 })],
    ['identificador demasiado largo', JSON.stringify({ rol: 'CLIENTE', sub: 'a'.repeat(129) })],
  ])('lo guardado que %s se ignora: no hay sesión', (_caso, guardado) => {
    const fuente = crearSesionSimulada(almacenamiento([], { [CLAVE_DE_SESION]: guardado }));

    expect(fuente.actual()).toBeUndefined();
  });

  it('de lo guardado toma solo rol y sub, aunque haya más campos (un token pegado a mano)', () => {
    const guardado = JSON.stringify({ rol: 'CLIENTE', sub: CLIENTE, token: 'eyJ.secreto.firma' });

    const sesion = crearSesionSimulada(almacenamiento([], { [CLAVE_DE_SESION]: guardado })).actual();

    expect(sesion).toEqual({ rol: 'CLIENTE', sub: CLIENTE });
  });
});

describe('si el almacenamiento falla, la sesión sigue andando en memoria (RNF-12.9)', () => {
  it.each([['getItem'], ['setItem'], ['removeItem']] as const)('si falla %s', (operacion) => {
    const fuente = crearSesionSimulada(almacenamiento([operacion]));

    fuente.iniciar('CLIENTE', CLIENTE);
    expect(fuente.actual()).toEqual({ rol: 'CLIENTE', sub: CLIENTE });
    fuente.cerrar();
    expect(fuente.actual()).toBeUndefined();
  });

  it('si no hay almacenamiento (undefined), también', () => {
    const fuente = crearSesionSimulada(undefined);

    fuente.iniciar('CLIENTE', CLIENTE);

    expect(fuente.actual()).toEqual({ rol: 'CLIENTE', sub: CLIENTE });
  });

  it('cerrar() no deja volver una sesión vieja que no se pudo borrar', () => {
    const memoria = almacenamiento(['removeItem']);
    const fuente = crearSesionSimulada(memoria);
    fuente.iniciar('CLIENTE', CLIENTE);

    fuente.cerrar();

    expect(fuente.actual()).toBeUndefined();
  });
});

describe('las etiquetas de lo simulado (RNF-12.7, RNF-02.2)', () => {
  it('las dos fuentes exponen su etiqueta «simulado, pendiente de M1 / M6»', () => {
    expect(crearSesionSimulada(almacenamiento()).etiqueta).toBe('simulado, pendiente de M1');
    expect(ETIQUETA_SESION).toBe('simulado, pendiente de M1');
    expect(fuenteDeViajes.etiqueta).toBe('simulado, pendiente de M6');
    expect(ETIQUETA_VIAJES).toBe('simulado, pendiente de M6');
  });
});
