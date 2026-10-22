import net, { type AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BaseNoDisponible, Conflicto } from '../../src/errores.js';
import { clasificarError, conTiempoMaximo, crearPool, type PoolBd, TiempoAgotado } from '../../src/bd/pool.js';

// Un error con el `code` con el que llega de pg (el SQLSTATE si lo contesta el servidor, o el código de Node si falla el
// socket).
const conCodigo = (code: string, mensaje = 'mensaje de prueba') => Object.assign(new Error(mensaje), { code });

describe('clasificarError (RNF-08.1, RNF-14.2)', () => {
  it('23505 (unique_violation) es un Conflicto, sin el nombre de la restricción ni la consulta', () => {
    const error = Object.assign(
      conCodigo('23505', 'duplicate key value violates unique constraint "clientes_documento_key"'),
      { constraint: 'clientes_documento_key', detail: 'Key (documento)=(30111222) already exists.' },
    );

    const problema = clasificarError(error);

    expect(problema).toBeInstanceOf(Conflicto);
    expect(JSON.stringify(problema)).not.toMatch(/clientes_documento_key|30111222|duplicate/);
    expect(problema?.message).not.toMatch(/clientes_documento_key|30111222|duplicate/);
  });

  // La lista del plan (Datos): los códigos de red de Node, los SQLSTATE 08xxx, 57P01 y 57P03 y los mensajes del cliente.
  it.each([
    ['ECONNREFUSED', conCodigo('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:5432')],
    ['ENOTFOUND', conCodigo('ENOTFOUND', 'getaddrinfo ENOTFOUND bd')],
    ['ETIMEDOUT', conCodigo('ETIMEDOUT')],
    ['ECONNRESET', conCodigo('ECONNRESET', 'read ECONNRESET')],
    ['08000 (connection_exception)', conCodigo('08000')],
    ['08001 (no se pudo establecer la conexión)', conCodigo('08001')],
    ['08003 (connection_does_not_exist)', conCodigo('08003')],
    ['08006 (connection_failure)', conCodigo('08006')],
    ['08P01 (de la clase 08)', conCodigo('08P01')],
    ['57P01 (admin_shutdown)', conCodigo('57P01', 'terminating connection due to administrator command')],
    ['57P03 (cannot_connect_now)', conCodigo('57P03', 'the database system is starting up')],
    ['el mensaje de un pool que no consigue conexión', new Error('timeout exceeded when trying to connect')],
    ['el mensaje de una consulta que no contesta', new Error('Query read timeout')],
    ['el mensaje de una conexión cortada', new Error('Connection terminated unexpectedly')],
    ['el mensaje de una conexión que no se abre', new Error('Connection terminated due to connection timeout')],
    // Lo que da localhost cuando falla en IPv4 y en IPv6: sin mensaje, con el código en el error.
    ['un AggregateError con ECONNREFUSED', Object.assign(new AggregateError([], ''), { code: 'ECONNREFUSED' })],
    ['el corte de conTiempoMaximo', new TiempoAgotado(2000)],
  ])('%s es BaseNoDisponible', (_caso, error) => {
    expect(clasificarError(error)).toBeInstanceOf(BaseNoDisponible);
  });

  // Todo lo demás lo deja pasar tal cual: el manejador de errores lo responde con 500 y lo registra (RNF-03.3).
  it.each([
    ['42P01 (la tabla no existe)', conCodigo('42P01', 'relation "x" does not exist')],
    ['42601 (error de sintaxis)', conCodigo('42601')],
    ['23502 (not_null_violation)', conCodigo('23502')],
    ['23503 (foreign_key_violation)', conCodigo('23503')],
    ['23514 (check_violation)', conCodigo('23514')],
    ['40P01 (deadlock_detected)', conCodigo('40P01')],
    ['57014 (query_canceled)', conCodigo('57014', 'canceling statement due to statement timeout')],
    ['otro código de Node', conCodigo('EACCES')],
    ['un SQLSTATE que solo contiene 08 en el medio', conCodigo('X08Y0')],
    ['un Error sin código', new Error('boom')],
    ['un mensaje que contiene el de pg sin empezar con él', new Error('el servidor dice: Connection terminated')],
    ['un TypeError', new TypeError('x is not a function')],
    ['un error con un código que no es texto', Object.assign(new Error('x'), { code: 23505 })],
    ['un texto', 'Connection terminated'],
    ['un objeto que no es un Error', { code: '23505' }],
    ['null', null],
    ['undefined', undefined],
  ])('%s se deja pasar', (_caso, error) => {
    expect(clasificarError(error)).toBeUndefined();
  });
});

describe('conTiempoMaximo (RNF-14.2)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('devuelve lo que la promesa devuelve y no deja el temporizador esperando', async () => {
    vi.useFakeTimers();

    await expect(conTiempoMaximo(Promise.resolve('listo'), 2000)).resolves.toBe('listo');

    expect(vi.getTimerCount()).toBe(0);
  });

  it('pasa el error de la promesa tal cual y no deja el temporizador esperando', async () => {
    vi.useFakeTimers();
    const error = new Error('falló');

    await expect(conTiempoMaximo(Promise.reject(error), 2000)).rejects.toBe(error);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('corta con TiempoAgotado cuando se cumple el tiempo, no antes', async () => {
    vi.useFakeTimers();
    const lenta = new Promise(() => {});
    const resultado = vi.fn();
    const corte = conTiempoMaximo(lenta, 2000).then(resultado, resultado);

    await vi.advanceTimersByTimeAsync(1999);
    expect(resultado).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await corte;

    expect(resultado).toHaveBeenCalledOnce();
    const error = resultado.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(TiempoAgotado);
    expect(error.message).toContain('2000');
    expect(vi.getTimerCount()).toBe(0);
  });

  // Lo que la consulta responda después del corte no tiene a quién llegar: si dejara una promesa rechazada sin atender,
  // Node tiraría el proceso. Vitest cuenta una promesa rechazada sin atender como un error de la corrida.
  it('lo que la promesa haga después del corte no deja un rechazo sin atender', async () => {
    vi.useFakeTimers();
    const tardia = Promise.withResolvers<string>();
    const corte = conTiempoMaximo(tardia.promise, 100);
    corte.catch(() => {});

    await vi.advanceTimersByTimeAsync(100);
    tardia.reject(new Error('llegó tarde'));
    await vi.advanceTimersByTimeAsync(10);

    await expect(corte).rejects.toBeInstanceOf(TiempoAgotado);
  });
});

describe('crearPool (RNF-14.2)', () => {
  const abiertos: PoolBd[] = [];
  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await Promise.all(abiertos.splice(0).map((pool) => pool.end()));
  });

  const crear = (...argumentos: Parameters<typeof crearPool>) => {
    const pool = crearPool(...argumentos);
    abiertos.push(pool);
    return pool;
  };

  const CONFIG_BD = { urlBd: 'postgres://m2:clave@127.0.0.1:5432/m2', tiempoBdMs: 1500 };

  it('arma el pool con la URL, 10 conexiones como máximo y el tiempo de base como límite de conexión y de consulta', () => {
    const pool = crear(CONFIG_BD);

    expect(pool.options).toMatchObject({
      connectionString: CONFIG_BD.urlBd,
      max: 10,
      connectionTimeoutMillis: 1500,
      query_timeout: 1500,
    });
  });

  it('no se conecta al crearlo', () => {
    const pool = crear(CONFIG_BD);

    expect(pool.totalCount).toBe(0);
  });

  // Sin un oyente de 'error', el error de una conexión inactiva tira el proceso (pg).
  it('un error del pool lo registra y sigue, sin tirar el proceso', () => {
    const registrar = vi.fn();
    const pool = crear(CONFIG_BD, registrar);
    const error = conCodigo('57P01', 'terminating connection due to administrator command');

    expect(() => pool.emit('error', error)).not.toThrow();

    expect(registrar).toHaveBeenCalledExactlyOnceWith(error, expect.any(String));
  });

  // Los límites de pg (conexión y consulta) valen por separado; este corte vale para el total. Con pg simulado como una
  // consulta que no termina, solo `consultar()` puede cortarla.
  it('consultar() corta la espera en el tiempo de base aunque pg no lo haga', async () => {
    vi.useFakeTimers();
    const registrar = vi.fn();
    const pool = crear(CONFIG_BD, registrar);
    vi.spyOn(pool, 'query').mockImplementation((() => new Promise(() => {})) as never);
    const resultado = vi.fn();
    const consulta = pool.consultar('SELECT 1').then(resultado, resultado);

    await vi.advanceTimersByTimeAsync(CONFIG_BD.tiempoBdMs - 1);
    expect(resultado).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await consulta;

    expect(resultado.mock.calls[0]?.[0]).toBeInstanceOf(BaseNoDisponible);
    expect(registrar).toHaveBeenCalledExactlyOnceWith(expect.any(TiempoAgotado), expect.any(String));
  });

  it('sin quien lo registre, un error del pool tampoco tira el proceso ni escribe en la consola', () => {
    const espias = (['debug', 'error', 'info', 'log', 'warn'] as const).map((metodo) => vi.spyOn(console, metodo));
    const pool = crear(CONFIG_BD);

    expect(() => pool.emit('error', new Error('se cortó'))).not.toThrow();

    for (const espia of espias) expect(espia).not.toHaveBeenCalled();
  });
});

describe('consultar con una base a la que no se llega (RNF-14.2)', () => {
  const abiertos: PoolBd[] = [];
  afterEach(async () => {
    await Promise.all(abiertos.splice(0).map((pool) => pool.end()));
  });

  // Un puerto donde no escucha nadie: lo pide al sistema y lo suelta.
  async function puertoCerrado(): Promise<number> {
    const servidor = net.createServer();
    await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
    const { port } = servidor.address() as AddressInfo;
    await new Promise((listo) => servidor.close(listo));
    return port;
  }

  // 127.0.0.1 da un ECONNREFUSED común; localhost prueba IPv4 e IPv6 y falla con un AggregateError que trae el mismo código.
  it.each(['127.0.0.1', 'localhost'])('rechazada la conexión en %s, da BaseNoDisponible y registra la causa', async (host) => {
    const registrar = vi.fn();
    const pool = crearPool({ urlBd: `postgres://m2:clave@${host}:${await puertoCerrado()}/m2`, tiempoBdMs: 2000 }, registrar);
    abiertos.push(pool);

    await expect(pool.consultar('SELECT 1')).rejects.toBeInstanceOf(BaseNoDisponible);

    expect(registrar).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: 'ECONNREFUSED' }), expect.any(String));
  });
});
