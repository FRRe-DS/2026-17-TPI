import { randomUUID } from 'node:crypto';
import net, { type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../../../src/bd/migraciones.js';
import { crearBaseDemo } from '../../../panel/servidor/demo/base.js';
import { crearBaseDePrueba, type BaseDePrueba } from '../../ayudas/bd.js';
import { puertoLibre } from '../../ayudas/arranque.js';

// El acceso del panel a la base de M2 (spec 072, T2): dos conteos fijos y la disponibilidad. PostgreSQL real, con las migraciones
// de M2, porque lo que se comprueba es el SQL (RNF-05.4).
const CONTRASENA = 'contrasena-secreta-de-prueba';

let base: BaseDePrueba;
let acceso: ReturnType<typeof crearBaseDemo>;

beforeAll(async () => {
  base = await crearBaseDePrueba();
  await migrar({ urlBd: base.urlBd, tiempoBdMs: 2000 });
  acceso = crearBaseDemo(base.urlBd);
});

afterAll(async () => {
  await acceso.cerrar();
  await base.borrar();
});

async function crearCliente(): Promise<string> {
  const clienteId = randomUUID();
  await acceso.pool?.query(
    "INSERT INTO clientes (cliente_id, nombre, apellido, telefono) VALUES ($1, 'Ana', 'Pérez', '+5491122334455')",
    [clienteId],
  );
  return clienteId;
}

async function calificar(clienteId: string): Promise<void> {
  await acceso.pool?.query(
    'INSERT INTO calificaciones (calificacion_id, cliente_id, viaje_id, conductor_id, puntaje) VALUES ($1, $2, $3, $4, 5)',
    [randomUUID(), clienteId, randomUUID(), randomUUID()],
  );
}

// Una URL con contraseña que no lleva a ninguna base, para ver qué dice el motivo de la falla.
const urlA = (puerto: number) => `postgres://m2:${CONTRASENA}@127.0.0.1:${puerto}/m2`;

describe('crearBaseDemo: conteos (RNF-05.4)', () => {
  it('cuenta las filas de clientes de un cliente: 0 si no existe, 1 si existe', async () => {
    const clienteId = randomUUID();
    expect(await acceso.contarClientes(clienteId)).toEqual({ filas: 0 });

    await acceso.pool?.query("INSERT INTO clientes (cliente_id, nombre, apellido, telefono) VALUES ($1, 'Ana', 'Pérez', '+5491122334455')", [clienteId]);

    expect(await acceso.contarClientes(clienteId)).toEqual({ filas: 1 });
  });

  it('cuenta las calificaciones de un cliente y solo las suyas', async () => {
    const [clienteId, otro] = [await crearCliente(), await crearCliente()];
    await calificar(clienteId);
    await calificar(clienteId);
    await calificar(otro);

    expect(await acceso.contarCalificaciones(clienteId)).toEqual({ filas: 2 });
    expect(await acceso.contarCalificaciones(otro)).toEqual({ filas: 1 });
    expect(await acceso.contarCalificaciones(randomUUID())).toEqual({ filas: 0 });
  });

  it('el identificador va como parámetro: un texto con SQL no se ejecuta', async () => {
    const resultado = await acceso.contarClientes("x' OR '1'='1");

    // Un texto que no es un UUID lo rechaza PostgreSQL al convertirlo; no se llegó a contar nada.
    expect(resultado.filas).toBeNull();
    expect(resultado.motivo).toContain('22P02');
  });
});

describe('crearBaseDemo: disponibilidad', () => {
  it('con la base encendida está disponible', async () => {
    expect(await acceso.disponibilidad()).toEqual({ disponible: true });
  });

  it('sin PANEL_URL_BD informa «no configurada» sin conectarse a ninguna parte', async () => {
    const sinBase = crearBaseDemo(undefined);

    expect(sinBase.pool).toBeUndefined();
    expect(await sinBase.disponibilidad()).toMatchObject({ disponible: false, motivo: expect.stringContaining('no configurada') });
    expect(await sinBase.disponibilidad()).toMatchObject({ comoActivar: expect.stringContaining('PANEL_URL_BD') });
    expect(await sinBase.contarClientes(randomUUID())).toEqual({
      filas: null,
      motivo: expect.stringContaining('no configurada'),
    });
    expect(await sinBase.contarCalificaciones(randomUUID())).toMatchObject({ filas: null });
    await sinBase.cerrar();
  });
});

describe('crearBaseDemo: con la base detenida (RNF-19.4)', () => {
  it('devuelve filas null con el código de Node y no la dirección ni la contraseña', async () => {
    const puerto = await puertoLibre();
    const detenida = crearBaseDemo(urlA(puerto));

    const resultado = await detenida.contarClientes(randomUUID());
    const disponibilidad = await detenida.disponibilidad();
    await detenida.cerrar();

    expect(resultado.filas).toBeNull();
    expect(resultado.motivo).toContain('ECONNREFUSED');
    expect(disponibilidad.disponible).toBe(false);
    expect(disponibilidad.motivo).toContain('ECONNREFUSED');
    for (const texto of [JSON.stringify(resultado), JSON.stringify(disponibilidad)]) {
      expect(texto).not.toContain(CONTRASENA);
      expect(texto).not.toContain('127.0.0.1');
      expect(texto).not.toContain(String(puerto));
    }
  });

  it('con una contraseña equivocada informa el código de la base y tampoco repite la contraseña', async () => {
    const url = new URL(base.urlBd);
    url.password = CONTRASENA;
    const equivocada = crearBaseDemo(url.toString());

    const resultado = await equivocada.contarClientes(randomUUID());
    await equivocada.cerrar();

    expect(resultado.filas).toBeNull();
    expect(resultado.motivo).toContain('28P01');
    expect(JSON.stringify(resultado)).not.toContain(CONTRASENA);
  });
});

describe('crearBaseDemo: pool chico y con cortes (plan, Datos)', () => {
  it('no pasa de 2 conexiones y espera como mucho 2 s por una libre', () => {
    expect(acceso.pool?.options).toMatchObject({ max: 2, connectionTimeoutMillis: 2000, statement_timeout: 2000, query_timeout: 2500 });
  });

  it('con 6 consultas a la vez nunca hay más de 2 conexiones', async () => {
    const abiertas: number[] = [];
    const lecturas = Array.from({ length: 6 }, async () => {
      const resultado = await acceso.pool?.query('SELECT pg_sleep(0.1)');
      abiertas.push(acceso.pool?.totalCount ?? 0);
      return resultado;
    });

    await Promise.all(lecturas);

    expect(Math.max(...abiertas)).toBeLessThanOrEqual(2);
  });

  it('contra un servidor que acepta la conexión y no habla, corta cerca de los 2 s', async () => {
    // Acepta y calla. `close()` espera a las conexiones abiertas, así que se destruyen al cerrar.
    const conexiones: net.Socket[] = [];
    const mudo = net.createServer((socket) => conexiones.push(socket));
    await new Promise<void>((listo) => mudo.listen(0, '127.0.0.1', listo));
    const puerto = (mudo.address() as AddressInfo).port;
    const sinRespuesta = crearBaseDemo(urlA(puerto));

    const antes = Date.now();
    const resultado = await sinRespuesta.contarClientes(randomUUID());
    const duracion = Date.now() - antes;
    await sinRespuesta.cerrar();
    conexiones.forEach((socket) => socket.destroy());
    await new Promise((listo) => mudo.close(listo));

    expect(resultado.filas).toBeNull();
    expect(duracion).toBeGreaterThanOrEqual(1900);
    expect(duracion).toBeLessThan(3000);
    expect(JSON.stringify(resultado)).not.toContain(CONTRASENA);
  });
});
