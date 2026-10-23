import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../../src/bd/migraciones.js';
import { crearPool, type PoolBd } from '../../src/bd/pool.js';
import { actualizarCliente, crearCliente, obtenerCliente } from '../../src/clientes/operaciones.js';
import { cargarContrato } from '../../src/contrato/cargar.js';
import { crearApp } from '../ayudas/app.js';
import { type BaseDePrueba, crearBaseDePrueba } from '../ayudas/bd.js';
import { capturarLogs } from '../ayudas/logs.js';
import { armarToken } from '../ayudas/tokens.js';

// Las operaciones de perfil por HTTP, con la base real (RF-2.1 a RF-2.1.3.1, RNF-03, RNF-08, RNF-19). Los rechazos que no
// llegan a la base están en pruebas/http/clientes.test.ts.

const TIEMPO_BD_MS = 2000;
const contrato = cargarContrato();
const PROBLEMA_JSON = /^application\/problem\+json/;
const ANA = { nombre: 'Anastasia', apellido: 'Gomezcano', telefono: '+5493624987654', fechaNacimiento: '1990-05-17' };

type Rol = 'CLIENTE' | 'CONDUCTOR' | 'OPERADOR' | 'SERVICIO';

describe('las operaciones de perfil con la base (RF-2.1, RF-2.1.1, RF-2.1.2, RF-2.1.3, RF-2.1.3.1)', () => {
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

  function crear() {
    const logs = capturarLogs();
    const app = crearApp({ crearCliente, obtenerCliente, actualizarCliente }, { contrato, pool, flujoLog: logs.flujo });
    const autorizacion = (sub: string, roles: Rol[]) => `Bearer ${armarToken({ claims: { sub, roles } })}`;
    return {
      logs,
      alta: (sub: string, clave: string, payload: object = ANA, roles: Rol[] = ['CLIENTE']) =>
        app.inject({
          method: 'POST',
          url: '/api/v1/clientes',
          headers: { authorization: autorizacion(sub, roles), 'idempotency-key': clave },
          payload,
        }),
      lectura: (sub: string, clienteId: string, roles: Rol[] = ['CLIENTE']) =>
        app.inject({ method: 'GET', url: `/api/v1/clientes/${clienteId}`, headers: { authorization: autorizacion(sub, roles) } }),
      cambio: (sub: string, clienteId: string, payload: object, roles: Rol[] = ['CLIENTE']) =>
        app.inject({
          method: 'PATCH',
          url: `/api/v1/clientes/${clienteId}`,
          headers: { authorization: autorizacion(sub, roles) },
          payload,
        }),
    };
  }

  describe('crearCliente', () => {
    it('201 con el perfil del contrato, el clienteId del sub y Location (RF-2.1)', async () => {
      const sub = randomUUID();

      const respuesta = await crear().alta(sub, randomUUID());

      expect(respuesta.statusCode).toBe(201);
      expect(respuesta.headers['content-type']).toMatch(/^application\/json/);
      expect(respuesta.headers.location).toBe(`/api/v1/clientes/${sub}`);
      expect(respuesta.json()).toEqual({
        clienteId: sub,
        ...ANA,
        estado: 'ACTIVO',
        creadoEn: expect.any(String),
        actualizadoEn: expect.any(String),
      });
    });

    it('un sub en mayúsculas da el clienteId en minúsculas, como lo guarda la base', async () => {
      const sub = randomUUID();

      const respuesta = await crear().alta(sub.toUpperCase(), randomUUID());

      expect(respuesta.statusCode).toBe(201);
      expect(respuesta.json().clienteId).toBe(sub);
      expect(respuesta.headers.location).toBe(`/api/v1/clientes/${sub}`);
    });

    it('la misma clave y el mismo cuerpo: la misma respuesta, Location incluida, sin otro perfil (RNF-08)', async () => {
      const { alta } = crear();
      const [sub, clave] = [randomUUID(), randomUUID()];

      const primera = await alta(sub, clave);
      const segunda = await alta(sub, clave);

      expect(segunda.statusCode).toBe(201);
      expect(segunda.body).toBe(primera.body);
      expect(segunda.headers.location).toBe(primera.headers.location);
    });

    it('la misma clave con otro cuerpo: 422 con su tipo propio (spec 004, Casos límite)', async () => {
      const { alta } = crear();
      const [sub, clave] = [randomUUID(), randomUUID()];
      await alta(sub, clave);

      const respuesta = await alta(sub, clave, { ...ANA, nombre: 'Beatriz' });

      expect(respuesta.statusCode).toBe(422);
      expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
      expect(respuesta.json()).toEqual({
        type: '/errores/idempotencia-reutilizada',
        title: 'Clave de idempotencia reutilizada',
        status: 422,
        detail: 'La Idempotency-Key ya se usó con otra solicitud',
        instance: '/api/v1/clientes',
      });
    });

    it('otra clave para un perfil que ya existe: 409 con su tipo propio, sin cambiarlo (RF-2.1.3)', async () => {
      const { alta, lectura } = crear();
      const sub = randomUUID();
      const primera = await alta(sub, randomUUID());

      const respuesta = await alta(sub, randomUUID(), { ...ANA, nombre: 'Beatriz' });

      expect(respuesta.statusCode).toBe(409);
      expect(respuesta.json()).toEqual({
        type: '/errores/perfil-ya-existe',
        title: 'Perfil ya existe',
        status: 409,
        detail: 'Ya existe un perfil para este usuario',
        instance: '/api/v1/clientes',
      });
      expect((await lectura(sub, sub)).json()).toEqual(primera.json());
    });

    it('dos altas a la vez con claves distintas: un 201 y un 409, y un solo perfil (RNF-08)', async () => {
      const { alta } = crear();
      const sub = randomUUID();

      const respuestas = await Promise.all([alta(sub, randomUUID()), alta(sub, randomUUID())]);

      expect(respuestas.map((respuesta) => respuesta.statusCode).sort()).toEqual([201, 409]);
      const guardados = await pool.consultar('SELECT count(*)::int AS n FROM clientes WHERE cliente_id = $1', [sub]);
      expect(guardados.rows).toEqual([{ n: 1 }]);
    });

    it('dos altas a la vez con la misma clave y el mismo cuerpo: los dos 201, con la misma respuesta (spec 004, Casos límite)', async () => {
      const { alta } = crear();
      const [sub, clave] = [randomUUID(), randomUUID()];

      const [una, otra] = await Promise.all([alta(sub, clave), alta(sub, clave)]);

      expect([una.statusCode, otra.statusCode]).toEqual([201, 201]);
      expect(otra.body).toBe(una.body);
    });

    it('una Idempotency-Key de 255 caracteres sirve; con 256, 400 por el contrato, sin tocar la base', async () => {
      const { alta } = crear();
      const sub = randomUUID();

      const larga = await alta(sub, 'k'.repeat(256));
      const justa = await alta(sub, 'k'.repeat(255));

      expect([larga.statusCode, justa.statusCode]).toEqual([400, 201]);
    });
  });

  describe('obtenerCliente', () => {
    it('el CLIENTE lee su perfil: 200, igual al que creó (RF-2.1.1)', async () => {
      const { alta, lectura } = crear();
      const sub = randomUUID();
      const creado = await alta(sub, randomUUID());

      const respuesta = await lectura(sub, sub);

      expect(respuesta.statusCode).toBe(200);
      expect(respuesta.json()).toEqual(creado.json());
    });

    it('con el clienteId en mayúsculas en la ruta, también es el suyo', async () => {
      const { alta, lectura } = crear();
      const sub = randomUUID();
      await alta(sub, randomUUID());

      expect((await lectura(sub, sub.toUpperCase())).statusCode).toBe(200);
    });

    it('un OPERADOR lee cualquier perfil, y CLIENTE+OPERADOR también el de otro (spec 004, Contrato y dependencias)', async () => {
      const { alta, lectura } = crear();
      const sub = randomUUID();
      await alta(sub, randomUUID());

      expect((await lectura(randomUUID(), sub, ['OPERADOR'])).statusCode).toBe(200);
      expect((await lectura(randomUUID(), sub, ['CLIENTE', 'OPERADOR'])).statusCode).toBe(200);
    });

    it('un perfil que no existe: 404 en problem+json (RF-2.1.3.1)', async () => {
      const sub = randomUUID();

      const respuesta = await crear().lectura(sub, sub);

      expect(respuesta.statusCode).toBe(404);
      expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
      expect(respuesta.json()).toEqual({
        type: 'about:blank',
        title: 'No encontrado',
        status: 404,
        detail: 'No existe el cliente pedido',
        instance: `/api/v1/clientes/${sub}`,
      });
    });
  });

  describe('actualizarCliente', () => {
    it('cambia solo lo enviado y conserva lo demás: 200 con el perfil nuevo (RF-2.1.2)', async () => {
      const { alta, cambio, lectura } = crear();
      const sub = randomUUID();
      const creado = (await alta(sub, randomUUID())).json();

      const respuesta = await cambio(sub, sub, { telefono: '+5493624111111' });

      expect(respuesta.statusCode).toBe(200);
      expect(respuesta.json()).toEqual({ ...creado, telefono: '+5493624111111', actualizadoEn: expect.any(String) });
      expect((await lectura(sub, sub)).json()).toEqual(respuesta.json());
    });

    it('un perfil que no existe: 404 (RF-2.1.3.1)', async () => {
      const sub = randomUUID();

      expect((await crear().cambio(sub, sub, { nombre: 'Beatriz' })).statusCode).toBe(404);
    });

    it('CLIENTE+OPERADOR no cambia el perfil de otro: 403, y el perfil queda igual (RF-2.1.2.1)', async () => {
      const { alta, cambio, lectura } = crear();
      const sub = randomUUID();
      const creado = await alta(sub, randomUUID());

      const respuesta = await cambio(randomUUID(), sub, { nombre: 'Beatriz' }, ['CLIENTE', 'OPERADOR']);

      expect(respuesta.statusCode).toBe(403);
      expect((await lectura(sub, sub)).json()).toEqual(creado.json());
    });
  });

  describe('los logs no tienen datos del perfil, claves ni tokens (RNF-19)', () => {
    it('ni en las respuestas buenas ni en los rechazos', async () => {
      const { alta, lectura, cambio, logs } = crear();
      const [sub, clave] = [randomUUID(), 'clave-secreta-de-idempotencia-17'];

      await alta(sub, clave);
      await alta(sub, clave);
      await alta(sub, clave, { ...ANA, apellido: 'Otroapellido' });
      await alta(sub, randomUUID());
      await lectura(sub, sub);
      await cambio(sub, sub, { nombre: 'Nuevonombre', fechaNacimiento: '1985-12-31' });
      await cambio(sub, sub, { telefono: 'no-es-telefono' });

      const texto = logs.texto();
      expect(logs.lineas().length).toBeGreaterThan(0);
      for (const dato of [
        ANA.nombre,
        ANA.apellido,
        ANA.telefono,
        ANA.fechaNacimiento,
        'Otroapellido',
        'Nuevonombre',
        '1985-12-31',
        'no-es-telefono',
        clave,
        'Bearer',
      ]) {
        expect(texto).not.toContain(dato);
      }
    });
  });
});
