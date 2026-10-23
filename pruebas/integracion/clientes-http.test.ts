import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../../src/bd/migraciones.js';
import { crearPool, type PoolBd } from '../../src/bd/pool.js';
import {
  actualizarCliente,
  crearBloqueo,
  crearCliente,
  listarBloqueos,
  obtenerBloqueo,
  obtenerCliente,
  obtenerEstadoCuenta,
} from '../../src/clientes/operaciones.js';
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
    const app = crearApp(
      { crearCliente, obtenerCliente, actualizarCliente, obtenerEstadoCuenta, crearBloqueo, listarBloqueos, obtenerBloqueo },
      { contrato, pool, flujoLog: logs.flujo });
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
      estadoCuenta: (sub: string, clienteId: string, roles: Rol[] = ['CLIENTE']) =>
        app.inject({
          method: 'GET',
          url: `/api/v1/clientes/${clienteId}/estado-cuenta`,
          headers: { authorization: autorizacion(sub, roles) },
        }),
      altaBloqueo: (sub: string, clienteId: string, clave: string, payload: object, roles: Rol[] = ['OPERADOR']) =>
        app.inject({
          method: 'POST',
          url: `/api/v1/clientes/${clienteId}/bloqueos`,
          headers: { authorization: autorizacion(sub, roles), 'idempotency-key': clave },
          payload,
        }),
      // `url` es la ruta del recurso: el historial (con su query) o un bloqueo, por ejemplo la de Location.
      lecturaBloqueos: (sub: string, url: string, roles: Rol[] = ['OPERADOR']) =>
        app.inject({ method: 'GET', url, headers: { authorization: autorizacion(sub, roles) } }),
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

  describe('obtenerEstadoCuenta', () => {
    const bloquear = (clienteId: string, motivo: string, hasta = 'NULL') =>
      pool.consultar(
        `INSERT INTO bloqueos_cliente (bloqueo_id, cliente_id, motivo, creado_por, hasta) VALUES ($1, $2, $3, 'operador-1', ${hasta})`,
        [randomUUID(), clienteId, motivo],
      );

    it('el CLIENTE ve su cuenta ACTIVA, sin bloqueos vigentes (RF-2.6)', async () => {
      const { alta, estadoCuenta } = crear();
      const sub = randomUUID();
      await alta(sub, randomUUID());

      const respuesta = await estadoCuenta(sub, sub);

      expect(respuesta.statusCode).toBe(200);
      expect(respuesta.headers['content-type']).toMatch(/^application\/json/);
      expect(respuesta.json()).toEqual({ clienteId: sub, estado: 'ACTIVO', bloqueosVigentes: [] });
    });

    it('con bloqueos vigentes es BLOQUEADO y los trae todos; los vencidos no (RF-2.6, RF-2.6.4)', async () => {
      const { alta, estadoCuenta } = crear();
      const sub = randomUUID();
      await alta(sub, randomUUID());
      await bloquear(sub, 'Indefinido');
      await bloquear(sub, 'Futuro', `now() + interval '1 day'`);
      await bloquear(sub, 'Vencido', `now() - interval '1 second'`);

      const respuesta = await estadoCuenta(sub, sub);

      expect(respuesta.statusCode).toBe(200);
      const cuenta = respuesta.json();
      expect(cuenta).toMatchObject({ clienteId: sub, estado: 'BLOQUEADO' });
      expect(cuenta.bloqueosVigentes.map((b: { motivo: string }) => b.motivo).sort()).toEqual(['Futuro', 'Indefinido']);
    });

    it('un OPERADOR, CLIENTE+OPERADOR sobre otro y un SERVICIO consultan la cuenta de cualquiera (RF-2.6)', async () => {
      const { alta, estadoCuenta } = crear();
      const sub = randomUUID();
      await alta(sub, randomUUID());
      await bloquear(sub, 'Indefinido');

      for (const roles of [['OPERADOR'], ['CLIENTE', 'OPERADOR'], ['SERVICIO']] as Rol[][]) {
        const respuesta = await estadoCuenta(randomUUID(), sub, roles);

        expect(respuesta.statusCode, roles.join('+')).toBe(200);
        expect(respuesta.json()).toMatchObject({ clienteId: sub, estado: 'BLOQUEADO' });
      }
    });

    it('un CLIENTE no ve la cuenta de otro: 403 (RF-2.1.1.1)', async () => {
      const { alta, estadoCuenta } = crear();
      const otro = randomUUID();
      await alta(otro, randomUUID());

      expect((await estadoCuenta(randomUUID(), otro)).statusCode).toBe(403);
    });

    it('una cuenta que no existe: 404 en problem+json, también para SERVICIO', async () => {
      const sub = randomUUID();

      const respuesta = await crear().estadoCuenta(randomUUID(), sub, ['SERVICIO']);

      expect(respuesta.statusCode).toBe(404);
      expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
      expect(respuesta.json()).toEqual({
        type: 'about:blank',
        title: 'No encontrado',
        status: 404,
        detail: 'No existe el cliente pedido',
        instance: `/api/v1/clientes/${sub}/estado-cuenta`,
      });
    });

    it('con el clienteId en mayúsculas en la ruta, es la misma cuenta', async () => {
      const { alta, estadoCuenta } = crear();
      const sub = randomUUID();
      await alta(sub, randomUUID());

      const respuesta = await estadoCuenta(sub, sub.toUpperCase());

      expect(respuesta.statusCode).toBe(200);
      expect(respuesta.json().clienteId).toBe(sub);
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

  describe('crearBloqueo, listarBloqueos y obtenerBloqueo (RF-2.6.1, RF-2.6.2)', () => {
    const OPERADOR = 'operador-con-sub-propio';
    const conPerfil = async (app: ReturnType<typeof crear>) => {
      const sub = randomUUID();
      await app.alta(sub, randomUUID());
      return sub;
    };

    it('201 con el bloqueo, el autor del token, desde igual a creadoEn y Location; Location lo devuelve igual', async () => {
      const app = crear();
      const clienteId = await conPerfil(app);

      const respuesta = await app.altaBloqueo(OPERADOR, clienteId, randomUUID(), { motivo: 'Deuda pendiente' });

      expect(respuesta.statusCode).toBe(201);
      const bloqueo = respuesta.json();
      expect(bloqueo).toEqual({
        bloqueoId: expect.any(String),
        motivo: 'Deuda pendiente',
        vigente: true,
        desde: bloqueo.creadoEn,
        creadoEn: expect.any(String),
        creadoPor: OPERADOR,
      });
      expect(respuesta.headers.location).toBe(`/api/v1/clientes/${clienteId}/bloqueos/${bloqueo.bloqueoId}`);
      const consulta = await app.lecturaBloqueos(randomUUID(), respuesta.headers.location as string);
      expect([consulta.statusCode, consulta.json()]).toEqual([200, bloqueo]);
    });

    it('con hasta futura: 201 y la cuenta queda BLOQUEADA con ese bloqueo', async () => {
      const app = crear();
      const clienteId = await conPerfil(app);

      const bloqueo = (await app.altaBloqueo(OPERADOR, clienteId, randomUUID(), { motivo: 'x', hasta: '2099-01-01T00:00:00Z' })).json();

      expect(bloqueo.hasta).toBe('2099-01-01T00:00:00.000Z');
      expect((await app.estadoCuenta(clienteId, clienteId)).json()).toMatchObject({ estado: 'BLOQUEADO', bloqueosVigentes: [bloqueo] });
    });

    it('la misma Idempotency-Key y el mismo cuerpo: la misma respuesta y un solo bloqueo (RNF-08)', async () => {
      const app = crear();
      const [clienteId, clave] = [await conPerfil(app), randomUUID()];

      const [una, otra] = await Promise.all([
        app.altaBloqueo(OPERADOR, clienteId, clave, { motivo: 'Deuda pendiente' }),
        app.altaBloqueo(OPERADOR, clienteId, clave, { motivo: 'Deuda pendiente' }),
      ]);
      const repetida = await app.altaBloqueo(OPERADOR, clienteId, clave, { motivo: 'Deuda pendiente' });

      expect([una.statusCode, otra.statusCode, repetida.statusCode]).toEqual([201, 201, 201]);
      expect(otra.json()).toEqual(una.json());
      expect(repetida.json()).toEqual(una.json());
      expect(repetida.headers.location).toBe(una.headers.location);
      expect((await app.lecturaBloqueos(OPERADOR, `/api/v1/clientes/${clienteId}/bloqueos`)).json().totalElementos).toBe(1);
    });

    it('la misma clave con otro cuerpo: 422 idempotencia-reutilizada, sin otro bloqueo', async () => {
      const app = crear();
      const [clienteId, clave] = [await conPerfil(app), randomUUID()];
      await app.altaBloqueo(OPERADOR, clienteId, clave, { motivo: 'Deuda pendiente' });

      const respuesta = await app.altaBloqueo(OPERADOR, clienteId, clave, { motivo: 'Otro motivo' });

      expect(respuesta.statusCode).toBe(422);
      expect(respuesta.json().type).toBe('/errores/idempotencia-reutilizada');
      expect((await app.lecturaBloqueos(OPERADOR, `/api/v1/clientes/${clienteId}/bloqueos`)).json().totalElementos).toBe(1);
    });

    it('la misma clave del mismo operador para otro cliente crea su propio bloqueo', async () => {
      const app = crear();
      const [uno, otro, clave] = [await conPerfil(app), await conPerfil(app), randomUUID()];

      const primero = await app.altaBloqueo(OPERADOR, uno, clave, { motivo: 'Deuda pendiente' });
      const segundo = await app.altaBloqueo(OPERADOR, otro, clave, { motivo: 'Deuda pendiente' });

      expect([primero.statusCode, segundo.statusCode]).toEqual([201, 201]);
      expect(segundo.json().bloqueoId).not.toBe(primero.json().bloqueoId);
      expect(segundo.headers.location).toContain(otro);
    });

    it('para un cliente sin perfil: 404 en problem+json', async () => {
      const respuesta = await crear().altaBloqueo(OPERADOR, randomUUID(), randomUUID(), { motivo: 'x' });

      expect(respuesta.statusCode).toBe(404);
      expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
      expect(respuesta.json().detail).toBe('No existe el cliente pedido');
    });

    it('el historial: página por defecto (0 de 20), orden del más nuevo al más antiguo, filtro y totales', async () => {
      const app = crear();
      const clienteId = await conPerfil(app);
      const motivos = [];
      for (const motivo of ['Primero', 'Segundo', 'Tercero']) {
        motivos.push((await app.altaBloqueo(OPERADOR, clienteId, randomUUID(), { motivo })).json().motivo);
      }
      await pool.consultar(`UPDATE bloqueos_cliente SET hasta = now() - interval '1 second' WHERE cliente_id = $1 AND motivo = 'Segundo'`, [
        clienteId,
      ]);
      const url = `/api/v1/clientes/${clienteId}/bloqueos`;

      const todo = (await app.lecturaBloqueos(OPERADOR, url)).json();
      const vigentes = (await app.lecturaBloqueos(OPERADOR, `${url}?vigente=true`)).json();
      const noVigentes = (await app.lecturaBloqueos(OPERADOR, `${url}?vigente=false`)).json();
      const segunda = (await app.lecturaBloqueos(OPERADOR, `${url}?page=1&size=2`)).json();
      const fuera = (await app.lecturaBloqueos(OPERADOR, `${url}?page=5&size=2`)).json();

      expect(todo).toMatchObject({ page: 0, size: 20, totalElementos: 3, totalPaginas: 1 });
      expect(todo.items.map((b: { motivo: string }) => b.motivo)).toEqual([...motivos].reverse());
      expect(vigentes.items.map((b: { motivo: string }) => b.motivo)).toEqual(['Tercero', 'Primero']);
      expect(noVigentes).toMatchObject({ totalElementos: 1, items: [{ motivo: 'Segundo', vigente: false }] });
      expect(segunda).toMatchObject({ page: 1, size: 2, totalElementos: 3, totalPaginas: 2, items: [{ motivo: 'Primero' }] });
      expect(fuera).toEqual({ page: 5, size: 2, totalElementos: 3, totalPaginas: 2, items: [] });
    });

    it('el historial de un cliente sin perfil: 404', async () => {
      expect((await crear().lecturaBloqueos(OPERADOR, `/api/v1/clientes/${randomUUID()}/bloqueos`)).statusCode).toBe(404);
    });

    it('un bloqueo pedido por otro cliente es 404, como uno que no existe (spec 004, Casos límite)', async () => {
      const app = crear();
      const [uno, otro] = [await conPerfil(app), await conPerfil(app)];
      const bloqueo = (await app.altaBloqueo(OPERADOR, otro, randomUUID(), { motivo: 'x' })).json();

      for (const url of [`/api/v1/clientes/${uno}/bloqueos/${bloqueo.bloqueoId}`, `/api/v1/clientes/${otro}/bloqueos/${randomUUID()}`]) {
        const respuesta = await app.lecturaBloqueos(OPERADOR, url);

        expect(respuesta.statusCode).toBe(404);
        expect(respuesta.headers['content-type']).toMatch(PROBLEMA_JSON);
        expect(respuesta.json().detail).toBe('No existe el bloqueo pedido');
      }
    });

    it('los logs no tienen motivos, claves ni tokens (RNF-19)', async () => {
      const app = crear();
      const [clienteId, clave] = [await conPerfil(app), 'clave-secreta-de-bloqueo-17'];

      await app.altaBloqueo(OPERADOR, clienteId, clave, { motivo: 'Motivo-confidencial-1' });
      await app.altaBloqueo(OPERADOR, clienteId, clave, { motivo: 'Motivo-confidencial-2' });
      await app.altaBloqueo(OPERADOR, clienteId, randomUUID(), { motivo: 'Motivo-confidencial-3', hasta: '2020-01-01T00:00:00Z' });
      await app.lecturaBloqueos(OPERADOR, `/api/v1/clientes/${clienteId}/bloqueos`);

      const texto = app.logs.texto();
      for (const dato of ['Motivo-confidencial', clave, 'Bearer']) expect(texto).not.toContain(dato);
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
