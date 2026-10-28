import { describe, expect, it } from 'vitest';
import { enlace, inicioDe, interpretar, PANTALLAS, resolver, TITULOS } from '../../../panel/cliente/src/rutas.js';

const ID = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';

describe('las doce pantallas (plan, Estructura)', () => {
  it('son doce y cada una tiene título', () => {
    expect(PANTALLAS).toHaveLength(12);
    expect(new Set(PANTALLAS).size).toBe(12);
    for (const pantalla of PANTALLAS) expect(TITULOS[pantalla].trim(), pantalla).not.toBe('');
  });

  it.each(PANTALLAS)('#/%s se interpreta (con su parámetro si lo pide)', (pantalla) => {
    const pideId = pantalla === 'calificar';
    const hash = pideId ? `#/${pantalla}/${ID}` : `#/${pantalla}`;

    expect(interpretar(hash)).toEqual(pideId ? { pantalla, id: ID } : { pantalla });
  });

  it.each(PANTALLAS)('enlace(%s) es la ruta que interpretar entiende', (pantalla) => {
    const id = pantalla === 'calificar' ? ID : undefined;

    expect(interpretar(enlace(pantalla, id))).toEqual(id === undefined ? { pantalla } : { pantalla, id });
  });
});

describe('parámetros de ruta', () => {
  it.each([['direcciones'], ['calificaciones']] as const)('%s admite un id opcional, que tiene que ser un UUID', (pantalla) => {
    expect(interpretar(`#/${pantalla}`)).toEqual({ pantalla });
    expect(interpretar(`#/${pantalla}/${ID}`)).toEqual({ pantalla, id: ID });
    expect(interpretar(`#/${pantalla}/no-es-un-uuid`)).toEqual({ pantalla: 'no-encontrada' });
  });

  it('calificar exige el id del viaje', () => {
    expect(interpretar('#/calificar')).toEqual({ pantalla: 'no-encontrada' });
    expect(interpretar(`#/calificar/${ID}`)).toEqual({ pantalla: 'calificar', id: ID });
  });

  it('las demás no admiten nada después', () => {
    expect(interpretar(`#/perfil/${ID}`)).toEqual({ pantalla: 'no-encontrada' });
    expect(interpretar('#/historial/otra')).toEqual({ pantalla: 'no-encontrada' });
  });

  it('el id en mayúsculas es el mismo UUID', () => {
    expect(interpretar(`#/direcciones/${ID.toUpperCase()}`)).toEqual({ pantalla: 'direcciones', id: ID.toUpperCase() });
  });

  it('una barra final se tolera', () => {
    expect(interpretar('#/perfil/')).toEqual({ pantalla: 'perfil' });
  });
});

describe('lo que no es una ruta', () => {
  it.each([
    ['una pantalla que no existe', '#/nada'],
    ['mayúsculas', '#/PERFIL'],
    ['sin la barra', '#perfil'],
    ['sin el #', '/perfil'],
    ['una barra codificada', '#/perfil%2Fx'],
    ['subir un nivel', '#/perfil/..'],
    ['una consulta', '#/historial?page=2'],
    ['espacios', '#/ perfil'],
    ['dos barras', '#//perfil'],
  ])('%s: no encontrada', (_nombre, hash) => {
    expect(interpretar(hash)).toEqual({ pantalla: 'no-encontrada' });
  });

  it.each([[''], ['#'], ['#/']])('el hash vacío (%j) es la raíz', (hash) => {
    expect(interpretar(hash)).toEqual({ pantalla: 'raiz' });
  });
});

describe('sin sesión todo manda a #/ingresar (RNF-12.9)', () => {
  it.each([...PANTALLAS.filter((p) => p !== 'ingresar'), 'raiz', 'no-encontrada'])('%s', (pantalla) => {
    const hash = pantalla === 'raiz' ? '' : pantalla === 'no-encontrada' ? '#/nada' : pantalla === 'calificar' ? `#/calificar/${ID}` : `#/${pantalla}`;

    expect(resolver(hash, undefined)).toEqual({ ruta: { pantalla: 'ingresar' }, redirigirA: '#/ingresar' });
  });

  it('#/ingresar sin sesión se queda donde está', () => {
    expect(resolver('#/ingresar', undefined)).toEqual({ ruta: { pantalla: 'ingresar' } });
  });
});

describe('con sesión', () => {
  const conRol = (rol: 'CLIENTE' | 'OPERADOR' | 'SERVICIO' | 'CONDUCTOR') => ({ rol });

  it('una pantalla se muestra tal cual, sin redirigir', () => {
    expect(resolver(`#/calificar/${ID}`, conRol('CLIENTE'))).toEqual({ ruta: { pantalla: 'calificar', id: ID } });
  });

  it('#/ingresar sigue disponible: es donde se cierra la sesión o se cambia de identidad', () => {
    expect(resolver('#/ingresar', conRol('CLIENTE'))).toEqual({ ruta: { pantalla: 'ingresar' } });
  });

  it('la raíz va al inicio del rol', () => {
    for (const rol of ['CLIENTE', 'OPERADOR', 'SERVICIO', 'CONDUCTOR'] as const) {
      expect(resolver('', conRol(rol))).toEqual({ ruta: interpretar(enlace(inicioDe(rol))), redirigirA: enlace(inicioDe(rol)) });
    }
    expect(inicioDe('OPERADOR')).toBe('operador');
    expect(inicioDe('SERVICIO')).toBe('otro-modulo');
    expect(inicioDe('CLIENTE')).toBe('perfil');
  });

  it('una ruta inexistente es «no encontrada» y no redirige', () => {
    expect(resolver('#/nada', conRol('CLIENTE'))).toEqual({ ruta: { pantalla: 'no-encontrada' } });
  });
});
