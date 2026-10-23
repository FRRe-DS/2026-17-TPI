import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../../src/bd/migraciones.js';
import { crearPool, type PoolBd } from '../../src/bd/pool.js';
import { cargarContrato } from '../../src/contrato/cargar.js';
import {
  actualizarDireccion,
  crearDireccion,
  eliminarDireccion,
  listarDirecciones,
  obtenerDireccion,
} from '../../src/direcciones/operaciones.js';
import { crearApp } from '../ayudas/app.js';
import { type BaseDePrueba, crearBaseDePrueba } from '../ayudas/bd.js';
import { capturarLogs } from '../ayudas/logs.js';
import { armarToken } from '../ayudas/tokens.js';

// Las operaciones de direcciones por HTTP, con la base real (RF-2.2 a RF-2.2.5, RNF-03, RNF-08, RNF-19). Los rechazos que no
// llegan a la base están en pruebas/http/direcciones.test.ts. Todos los datos son ficticios.

const TIEMPO_BD_MS = 2000;
const contrato = cargarContrato();
const PROBLEMA_JSON = /^application\/problem\+json/;
const CASA = { tipo: 'FAVORITA', alias: 'Casa', texto: 'Calle Falsa 123', coordenadas: { latitud: -27.45, longitud: -58.98 } };

type Rol = 'CLIENTE' | 'CONDUCTOR' | 'OPERADOR' | 'SERVICIO';

describe('las operaciones de direcciones con la base (RF-2.2 a RF-2.2.5)', () => {
  let base: BaseDePrueba;
  let pool: PoolBd;

  beforeAll(async () => {
    base = await crearBaseDePrueba();
    await migrar({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS });
    pool = crearPool({ urlBd: base.urlBd, tiempoBdMs: TIEMPO_BD_MS });
  });

  afterAll(async () => {
    await pool?.end();
    await base?.borrar();
  });

  // Un cliente con perfil: el sub del token es su clienteId.
  const cliente = async () => {
    const clienteId = randomUUID();
    await pool.consultar(
      `INSERT INTO clientes (cliente_id, nombre, apellido, telefono) VALUES ($1, 'Ana', 'Gómez', '+5493624000000')`,
      [clienteId],
    );
    return clienteId;
  };

  function crear() {
    const logs = capturarLogs();
    const app = crearApp(
      { crearDireccion, listarDirecciones, obtenerDireccion, actualizarDireccion, eliminarDireccion },
      { contrato, pool, flujoLog: logs.flujo },
    );
    const autorizacion = (sub: string, roles: Rol[]) => `Bearer ${armarToken({ claims: { sub, roles } })}`;
    return {
      logs,
      alta: (sub: string, clienteId: string, clave: string, payload: object = CASA, roles: Rol[] = ['CLIENTE']) =>
        app.inject({
          method: 'POST',
          url: `/api/v1/clientes/${clienteId}/direcciones`,
          headers: { authorization: autorizacion(sub, roles), 'idempotency-key': clave },
          payload,
        }),
      // `url` es la ruta del recurso: la colección (con su query) o una dirección, por ejemplo la de Location.
      lectura: (sub: string, url: string, roles: Rol[] = ['CLIENTE']) =>
        app.inject({ method: 'GET', url, headers: { authorization: autorizacion(sub, roles) } }),
      cambio: (sub: string, url: string, payload: object, roles: Rol[] = ['CLIENTE']) =>
        app.inject({ method: 'PATCH', url, headers: { authorization: autorizacion(sub, roles) }, payload }),
      baja: (sub: string, url: string, roles: Rol[] = ['CLIENTE']) =>
        app.inject({ method: 'DELETE', url, headers: { authorization: autorizacion(sub, roles) } }),
    };
  }

  const coleccion = (clienteId: string, query = '') => `/api/v1/clientes/${clienteId}/direcciones${query}`;

  describe('crearDireccion', () => {
    it('201 con la dirección del contrato, Location a ella y el direccionId que genera M2 (RF-2.2)', async () => {
      const { alta, lectura } = crear();
      const clienteId = await cliente();

      const respuesta = await alta(clienteId, clienteId, randomUUID());

      expect(respuesta.statusCode).toBe(201);
      expect(respuesta.headers['content-type']).toMatch(/^application\/json/);
      expect(respuesta.json()).toEqual({ direccionId: expect.stringMatching(/^[0-9a-f-]{36}$/), ...CASA, creadoEn: expect.any(String) });
      expect(respuesta.headers.location).toBe(coleccion(clienteId, `/${respuesta.json().direccionId}`));
      const leida = await lectura(clienteId, respuesta.headers.location as string);
      expect([leida.statusCode, leida.json()]).toEqual([200, respuesta.json()]);
    });

    it('solo con tipo y texto: sin alias ni coordenadas en la respuesta', async () => {
      const respuesta = await (async () => {
        const clienteId = await cliente();
        return crear().alta(clienteId, clienteId, randomUUID(), { tipo: 'RECIENTE', texto: 'Plaza 25' });
      })();

      expect(respuesta.statusCode).toBe(201);
      expect(respuesta.json()).toEqual({ direccionId: expect.any(String), tipo: 'RECIENTE', texto: 'Plaza 25', creadoEn: expect.any(String) });
    });

    it('el texto y el alias se guardan tal cual: acentos, comillas y emojis', async () => {
      const clienteId = await cliente();
      const cuerpo = { tipo: 'FAVORITA', alias: `Mi "casa" 🏠`, texto: `Av. O'Higgins 1; ñandú — 3° "B"` };

      const respuesta = await crear().alta(clienteId, clienteId, randomUUID(), cuerpo);

      expect(respuesta.json()).toMatchObject(cuerpo);
    });

    it('un texto con el carácter nulo (U+0000), que PostgreSQL no guarda: 400 y no un 500', async () => {
      const clienteId = await cliente();

      const respuesta = await crear().alta(clienteId, clienteId, randomUUID(), { tipo: 'FAVORITA', texto: 'Calle\u0000Falsa' });

      expect(respuesta.statusCode).toBe(400);
      expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
    });

    it('la misma clave y el mismo cuerpo: la misma respuesta, Location incluida, y una sola dirección (RNF-08)', async () => {
      const { alta, lectura } = crear();
      const clienteId = await cliente();
      const clave = randomUUID();

      const primera = await alta(clienteId, clienteId, clave);
      const segunda = await alta(clienteId, clienteId, clave);

      expect(segunda.statusCode).toBe(201);
      expect(segunda.body).toBe(primera.body);
      expect(segunda.headers.location).toBe(primera.headers.location);
      expect((await lectura(clienteId, coleccion(clienteId))).json().totalElementos).toBe(1);
    });

    it('la misma clave con otro cuerpo: 422 con su tipo propio, sin otra dirección (spec, Decisiones)', async () => {
      const { alta, lectura } = crear();
      const clienteId = await cliente();
      const clave = randomUUID();
      await alta(clienteId, clienteId, clave);

      const respuesta = await alta(clienteId, clienteId, clave, { ...CASA, texto: 'Otra calle' });

      expect(respuesta.statusCode).toBe(422);
      expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
      expect(respuesta.json()).toEqual({
        type: '/errores/idempotencia-reutilizada',
        title: 'Clave de idempotencia reutilizada',
        status: 422,
        detail: 'La Idempotency-Key ya se usó con otra solicitud',
        instance: coleccion(clienteId),
      });
      expect((await lectura(clienteId, coleccion(clienteId))).json().totalElementos).toBe(1);
    });

    it('cinco altas a la vez con la misma clave y el mismo cuerpo: cinco 201 idénticos y una sola dirección (RNF-08)', async () => {
      const { alta, lectura } = crear();
      const clienteId = await cliente();
      const clave = randomUUID();

      const respuestas = await Promise.all(Array.from({ length: 5 }, () => alta(clienteId, clienteId, clave)));

      expect(respuestas.map((r) => r.statusCode)).toEqual([201, 201, 201, 201, 201]);
      expect(new Set(respuestas.map((r) => r.body)).size).toBe(1);
      expect((await lectura(clienteId, coleccion(clienteId))).json().totalElementos).toBe(1);
    });

    it('altas a la vez con la misma clave y cuerpos distintos: un 201, el resto 422, y una sola dirección', async () => {
      const { alta, lectura } = crear();
      const clienteId = await cliente();
      const clave = randomUUID();

      const respuestas = await Promise.all(
        ['Uno', 'Dos', 'Tres', 'Cuatro'].map((texto) => alta(clienteId, clienteId, clave, { tipo: 'FAVORITA', texto })),
      );

      expect(respuestas.map((r) => r.statusCode).sort()).toEqual([201, 422, 422, 422]);
      expect((await lectura(clienteId, coleccion(clienteId))).json().totalElementos).toBe(1);
    });

    it('claves distintas con el mismo cuerpo: dos direcciones (la spec no define igualdad semántica)', async () => {
      const { alta, lectura } = crear();
      const clienteId = await cliente();

      await alta(clienteId, clienteId, randomUUID());
      await alta(clienteId, clienteId, randomUUID());

      expect((await lectura(clienteId, coleccion(clienteId))).json().totalElementos).toBe(2);
    });

    it('un cliente sin perfil: 404 y, con el perfil creado, la misma clave hace el alta', async () => {
      const { alta } = crear();
      const clienteId = randomUUID();
      const clave = randomUUID();

      const sinPerfil = await alta(clienteId, clienteId, clave);
      await pool.consultar(
        `INSERT INTO clientes (cliente_id, nombre, apellido, telefono) VALUES ($1, 'Ana', 'Gómez', '+5493624000000')`,
        [clienteId],
      );
      const conPerfil = await alta(clienteId, clienteId, clave);

      expect(sinPerfil.statusCode).toBe(404);
      expect(sinPerfil.headers['content-type']).toMatch(PROBLEMA_JSON);
      expect(conPerfil.statusCode).toBe(201);
    });

    it('un CLIENTE para el perfil de otro: 403 aunque ese perfil exista, y no se crea nada', async () => {
      const { alta, lectura } = crear();
      const [dueño, intruso] = [await cliente(), await cliente()];

      const respuesta = await alta(intruso, dueño, randomUUID());

      expect(respuesta.statusCode).toBe(403);
      expect((await lectura(dueño, coleccion(dueño))).json().totalElementos).toBe(0);
    });
  });

  describe('listarDirecciones', () => {
    // Un cliente con tres direcciones, creadas una detrás de la otra: la más nueva primero.
    const conDirecciones = async () => {
      const { alta } = crear();
      const clienteId = await cliente();
      for (const [tipo, texto] of [
        ['FAVORITA', 'Primera'],
        ['RECIENTE', 'Segunda'],
        ['FAVORITA', 'Tercera'],
      ]) {
        await alta(clienteId, clienteId, randomUUID(), { tipo, texto });
      }
      return clienteId;
    };
    const textos = (respuesta: { json: () => { items: { texto: string }[] } }) => respuesta.json().items.map((d) => d.texto);

    it('200 con la página: del más nuevo al más viejo, con los valores por defecto del contrato (page 0, size 20)', async () => {
      const { lectura } = crear();
      const clienteId = await conDirecciones();

      const respuesta = await lectura(clienteId, coleccion(clienteId));

      expect(respuesta.statusCode).toBe(200);
      expect(respuesta.headers['content-type']).toMatch(/^application\/json/);
      expect(textos(respuesta)).toEqual(['Tercera', 'Segunda', 'Primera']);
      expect(respuesta.json()).toMatchObject({ page: 0, size: 20, totalElementos: 3, totalPaginas: 1 });
    });

    it('?tipo=FAVORITA y ?tipo=RECIENTE filtran, con sus totales', async () => {
      const { lectura } = crear();
      const clienteId = await conDirecciones();

      const favoritas = await lectura(clienteId, coleccion(clienteId, '?tipo=FAVORITA'));
      const recientes = await lectura(clienteId, coleccion(clienteId, '?tipo=RECIENTE'));

      expect([textos(favoritas), favoritas.json().totalElementos]).toEqual([['Tercera', 'Primera'], 2]);
      expect([textos(recientes), recientes.json().totalElementos]).toEqual([['Segunda'], 1]);
    });

    it('pagina con page y size, y una página fuera del total es 200 con items vacío y los totales', async () => {
      const { lectura } = crear();
      const clienteId = await conDirecciones();

      const segunda = await lectura(clienteId, coleccion(clienteId, '?page=1&size=2'));
      const fuera = await lectura(clienteId, coleccion(clienteId, '?page=9&size=2'));

      expect([textos(segunda), segunda.json().totalPaginas]).toEqual([['Primera'], 2]);
      expect(fuera.statusCode).toBe(200);
      expect(fuera.json()).toEqual({ page: 9, size: 2, totalElementos: 3, totalPaginas: 2, items: [] });
    });

    it('un cliente con perfil y sin direcciones: 200 con la página vacía', async () => {
      const clienteId = await cliente();

      const respuesta = await crear().lectura(clienteId, coleccion(clienteId));

      expect(respuesta.statusCode).toBe(200);
      expect(respuesta.json()).toEqual({ page: 0, size: 20, totalElementos: 0, totalPaginas: 0, items: [] });
    });

    it('un OPERADOR lista las de un cliente existente (HU-4); CLIENTE+OPERADOR también', async () => {
      const { lectura } = crear();
      const clienteId = await conDirecciones();

      const operador = await lectura(randomUUID(), coleccion(clienteId), ['OPERADOR']);
      const mixto = await lectura(randomUUID(), coleccion(clienteId), ['CLIENTE', 'OPERADOR']);

      expect([operador.statusCode, mixto.statusCode]).toEqual([200, 200]);
      expect(textos(operador)).toEqual(['Tercera', 'Segunda', 'Primera']);
    });

    it('un OPERADOR sobre un cliente sin perfil: 404', async () => {
      const respuesta = await crear().lectura(randomUUID(), coleccion(randomUUID()), ['OPERADOR']);

      expect(respuesta.statusCode).toBe(404);
      expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
    });

    it('un CLIENTE no ve las direcciones de otro: 403, y las suyas no incluyen las ajenas', async () => {
      const { lectura } = crear();
      const [dueño, otro] = [await conDirecciones(), await cliente()];

      const ajena = await lectura(otro, coleccion(dueño));
      const propia = await lectura(otro, coleccion(otro));

      expect(ajena.statusCode).toBe(403);
      expect(propia.json().totalElementos).toBe(0);
    });
  });

  describe('obtenerDireccion', () => {
    it('200 con la dirección al dueño y a un OPERADOR (RF-2.2.2)', async () => {
      const { alta, lectura } = crear();
      const clienteId = await cliente();
      const creada = (await alta(clienteId, clienteId, randomUUID())).json();
      const url = coleccion(clienteId, `/${creada.direccionId}`);

      const propia = await lectura(clienteId, url);
      const deOperador = await lectura(randomUUID(), url, ['OPERADOR']);

      expect([propia.statusCode, propia.json()]).toEqual([200, creada]);
      expect([deOperador.statusCode, deOperador.json()]).toEqual([200, creada]);
    });

    it('la dirección de otro cliente o inexistente: 404, igual para el operador (RF-2.2.2.1)', async () => {
      const { alta, lectura } = crear();
      const [dueño, otro] = [await cliente(), await cliente()];
      const creada = (await alta(dueño, dueño, randomUUID())).json();

      const ajena = await lectura(randomUUID(), coleccion(otro, `/${creada.direccionId}`), ['OPERADOR']);
      const inexistente = await lectura(randomUUID(), coleccion(otro, `/${randomUUID()}`), ['OPERADOR']);

      expect([ajena.statusCode, inexistente.statusCode]).toEqual([404, 404]);
      expect(ajena.headers['content-type']).toMatch(PROBLEMA_JSON);
      expect({ ...ajena.json(), instance: '' }).toEqual({ ...inexistente.json(), instance: '' });
    });

    it('un CLIENTE que pide una de otro cliente: 403 antes de mirar si existe (RF-2.2.5)', async () => {
      const { alta, lectura } = crear();
      const [dueño, intruso] = [await cliente(), await cliente()];
      const creada = (await alta(dueño, dueño, randomUUID())).json();

      const respuesta = await lectura(intruso, coleccion(dueño, `/${creada.direccionId}`));

      expect(respuesta.statusCode).toBe(403);
    });
  });

  describe('actualizarDireccion', () => {
    it('200 cambia solo lo enviado y conserva el resto, también creadoEn y el direccionId (RF-2.2.3)', async () => {
      const { alta, cambio, lectura } = crear();
      const clienteId = await cliente();
      const creada = (await alta(clienteId, clienteId, randomUUID())).json();
      const url = coleccion(clienteId, `/${creada.direccionId}`);

      const respuesta = await cambio(clienteId, url, { texto: 'Nuevo texto' });

      expect(respuesta.statusCode).toBe(200);
      expect(respuesta.json()).toEqual({ ...creada, texto: 'Nuevo texto' });
      expect((await lectura(clienteId, url)).json()).toEqual(respuesta.json());
    });

    it('varios campos a la vez, coordenadas completas, y un alias vacío reemplaza al alias', async () => {
      const { alta, cambio } = crear();
      const clienteId = await cliente();
      const creada = (await alta(clienteId, clienteId, randomUUID())).json();

      const respuesta = await cambio(clienteId, coleccion(clienteId, `/${creada.direccionId}`), {
        tipo: 'RECIENTE',
        alias: '',
        coordenadas: { latitud: 10, longitud: -20 },
      });

      expect(respuesta.json()).toEqual({ ...creada, tipo: 'RECIENTE', alias: '', coordenadas: { latitud: 10, longitud: -20 } });
    });

    it('404 si no existe o es de otro cliente (nunca cambia la ajena)', async () => {
      const { alta, cambio, lectura } = crear();
      const [dueño, otro] = [await cliente(), await cliente()];
      const creada = (await alta(dueño, dueño, randomUUID())).json();

      const ajena = await cambio(otro, coleccion(otro, `/${creada.direccionId}`), { texto: 'Robada' });
      const inexistente = await cambio(otro, coleccion(otro, `/${randomUUID()}`), { texto: 'X' });

      expect([ajena.statusCode, inexistente.statusCode]).toEqual([404, 404]);
      expect((await lectura(dueño, coleccion(dueño, `/${creada.direccionId}`))).json()).toEqual(creada);
    });

    it('403 para un CLIENTE ajeno y para CLIENTE+OPERADOR ajeno; 403 por el rol para un OPERADOR solo', async () => {
      const { alta, cambio } = crear();
      const dueño = await cliente();
      const creada = (await alta(dueño, dueño, randomUUID())).json();
      const url = coleccion(dueño, `/${creada.direccionId}`);

      const ajeno = await cambio(randomUUID(), url, { texto: 'X' });
      const mixto = await cambio(randomUUID(), url, { texto: 'X' }, ['CLIENTE', 'OPERADOR']);
      const operador = await cambio(randomUUID(), url, { texto: 'X' }, ['OPERADOR']);

      expect([ajeno.statusCode, mixto.statusCode, operador.statusCode]).toEqual([403, 403, 403]);
      expect([ajeno.json().detail, mixto.json().detail, operador.json().detail]).toEqual([
        'El perfil pedido es de otro cliente',
        'El perfil pedido es de otro cliente',
        'El rol del token no permite esta operación',
      ]);
    });

    it('un texto con el carácter nulo (U+0000): 400 y no un 500', async () => {
      const { alta, cambio } = crear();
      const clienteId = await cliente();
      const creada = (await alta(clienteId, clienteId, randomUUID())).json();

      const respuesta = await cambio(clienteId, coleccion(clienteId, `/${creada.direccionId}`), { alias: 'Ca\u0000sa' });

      expect(respuesta.statusCode).toBe(400);
    });
  });

  describe('eliminarDireccion', () => {
    it('204 sin cuerpo; después la dirección da 404 y no figura en el listado (RF-2.2.4)', async () => {
      const { alta, baja, lectura } = crear();
      const clienteId = await cliente();
      const creada = (await alta(clienteId, clienteId, randomUUID())).json();
      const url = coleccion(clienteId, `/${creada.direccionId}`);

      const respuesta = await baja(clienteId, url);

      expect(respuesta.statusCode).toBe(204);
      expect(respuesta.body).toBe('');
      expect(respuesta.headers['content-type']).toBeUndefined();
      expect((await lectura(clienteId, url)).statusCode).toBe(404);
      expect((await lectura(clienteId, coleccion(clienteId))).json().totalElementos).toBe(0);
    });

    it('borrar otra vez: 404 (RF-2.2.4.1)', async () => {
      const { alta, baja } = crear();
      const clienteId = await cliente();
      const creada = (await alta(clienteId, clienteId, randomUUID())).json();
      const url = coleccion(clienteId, `/${creada.direccionId}`);
      await baja(clienteId, url);

      const repetido = await baja(clienteId, url);

      expect(repetido.statusCode).toBe(404);
      expect(repetido.headers['content-type']).toMatch(PROBLEMA_JSON);
    });

    it('borra una sola: las demás del cliente y las de otros quedan', async () => {
      const { alta, baja, lectura } = crear();
      const [clienteId, otro] = [await cliente(), await cliente()];
      const [una, otra] = [
        (await alta(clienteId, clienteId, randomUUID())).json(),
        (await alta(clienteId, clienteId, randomUUID())).json(),
      ];
      await alta(otro, otro, randomUUID());

      await baja(clienteId, coleccion(clienteId, `/${una.direccionId}`));

      expect((await lectura(clienteId, coleccion(clienteId))).json().items).toEqual([otra]);
      expect((await lectura(otro, coleccion(otro))).json().totalElementos).toBe(1);
    });

    it('404 si es de otro cliente (no se borra) o no existe; 403 a un CLIENTE ajeno y por el rol a un OPERADOR', async () => {
      const { alta, baja, lectura } = crear();
      const [dueño, otro] = [await cliente(), await cliente()];
      const creada = (await alta(dueño, dueño, randomUUID())).json();
      const propia = coleccion(dueño, `/${creada.direccionId}`);

      const bajoOtro = await baja(otro, coleccion(otro, `/${creada.direccionId}`));
      const inexistente = await baja(otro, coleccion(otro, `/${randomUUID()}`));
      const ajeno = await baja(otro, propia);
      const operador = await baja(randomUUID(), propia, ['OPERADOR']);

      expect([bajoOtro.statusCode, inexistente.statusCode, ajeno.statusCode, operador.statusCode]).toEqual([404, 404, 403, 403]);
      expect((await lectura(dueño, propia)).json()).toEqual(creada);
    });
  });

  describe('los logs no tienen textos, alias, coordenadas, claves ni tokens (RNF-19)', () => {
    it('ni en las respuestas buenas ni en los rechazos', async () => {
      const { alta, lectura, cambio, baja, logs } = crear();
      const clienteId = await cliente();
      const clave = 'clave-secreta-de-idempotencia-17';
      const secreto = {
        tipo: 'FAVORITA',
        alias: 'Alias-secreto-17',
        texto: 'Direccion-secreta-17',
        coordenadas: { latitud: 12.3456789, longitud: 98.7654321 },
      };

      const creada = await alta(clienteId, clienteId, clave, secreto);
      await alta(clienteId, clienteId, clave, secreto);
      await alta(clienteId, clienteId, clave, { ...secreto, texto: 'Otro-texto-secreto-17' });
      await alta(clienteId, clienteId, randomUUID(), { ...secreto, tipo: 'INVALIDO' });
      await alta(clienteId, clienteId, randomUUID(), { ...secreto, texto: 'Texto\u0000-secreto-17' });
      const url = coleccion(clienteId, `/${creada.json().direccionId}`);
      await lectura(clienteId, coleccion(clienteId, '?tipo=FAVORITA'));
      await lectura(clienteId, url);
      await cambio(clienteId, url, { texto: 'Nuevo-texto-secreto-17', alias: 'Nuevo-alias-17' });
      await cambio(clienteId, url, { coordenadas: { latitud: 55.5555555, longitud: 200 } });
      await lectura(randomUUID(), url);
      await baja(clienteId, url);
      await baja(clienteId, url);

      const texto = logs.texto();
      expect(logs.lineas().length).toBeGreaterThan(0);
      for (const dato of [
        'Alias-secreto-17',
        'Direccion-secreta-17',
        'Otro-texto-secreto-17',
        'Nuevo-texto-secreto-17',
        'Nuevo-alias-17',
        'secreto-17',
        '12.3456789',
        '98.7654321',
        '55.5555555',
        clave,
        'Bearer',
      ]) {
        expect(texto).not.toContain(dato);
      }
    });
  });
});
