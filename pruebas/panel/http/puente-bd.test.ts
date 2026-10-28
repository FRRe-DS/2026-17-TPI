import { createServer, type Server, type Socket } from 'node:net';
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { crearPuente, leerConfigPuente } from '../../../panel/puente-bd/puente.js';

// El puente a la base (spec 072, T9, RNF-04.8): une cada conexión de su puerto con el destino. Un servidor TCP de eco hace de
// base: lo que se manda por el puente tiene que volver igual.
const servidores: Server[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  sockets.splice(0).forEach((socket) => socket.destroy());
  await Promise.all(servidores.splice(0).map((servidor) => new Promise<void>((listo) => servidor.close(() => listo()))));
});

const puertoDe = (servidor: Server) => (servidor.address() as net.AddressInfo).port;
const escuchar = (servidor: Server) => new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));

async function levantarEco(): Promise<{ eco: Server; conexiones: Socket[] }> {
  const conexiones: Socket[] = [];
  const eco = createServer((socket) => {
    conexiones.push(socket);
    sockets.push(socket);
    socket.on('error', () => {});
    socket.pipe(socket);
  });
  servidores.push(eco);
  await escuchar(eco);
  return { eco, conexiones };
}

async function levantarPuente(destinoPuerto: number, alError?: (codigo: string) => void) {
  const puente = crearPuente({ escucha: '127.0.0.1', puerto: 0, destino: { host: '127.0.0.1', puerto: destinoPuerto }, alError });
  servidores.push(puente);
  await escuchar(puente);
  return puerto(puente);
}
const puerto = puertoDe;

const conectar = (p: number) =>
  new Promise<Socket>((resolver, rechazar) => {
    const socket = net.connect(p, '127.0.0.1', () => resolver(socket));
    sockets.push(socket);
    socket.on('error', rechazar);
  });

const leerHasta = (socket: Socket, bytes: number) =>
  new Promise<Buffer>((resolver) => {
    const partes: Buffer[] = [];
    let total = 0;
    socket.on('data', (parte: Buffer) => {
      partes.push(parte);
      total += parte.length;
      if (total >= bytes) resolver(Buffer.concat(partes));
    });
  });

const alCerrarse = (socket: Socket) => new Promise<void>((listo) => socket.once('close', () => listo()));

describe('crearPuente: une cada conexión con el destino (RNF-04.8)', () => {
  it('lo que se manda llega al destino y la respuesta vuelve', async () => {
    const { eco } = await levantarEco();
    const cliente = await conectar(await levantarPuente(puertoDe(eco)));

    cliente.write('hola base');

    expect((await leerHasta(cliente, 9)).toString()).toBe('hola base');
  });

  it('pasa 2 MiB en los dos sentidos sin cambiarlos', async () => {
    const { eco } = await levantarEco();
    const cliente = await conectar(await levantarPuente(puertoDe(eco)));
    const datos = Buffer.alloc(2 * 1024 * 1024);
    datos.forEach((_, i) => (datos[i] = (i * 7) % 251));

    cliente.write(datos);

    expect((await leerHasta(cliente, datos.length)).equals(datos)).toBe(true);
  });

  it('atiende varias conexiones a la vez, cada una con su destino', async () => {
    const { eco, conexiones } = await levantarEco();
    const p = await levantarPuente(puertoDe(eco));
    const clientes = await Promise.all([conectar(p), conectar(p), conectar(p)]);

    clientes.forEach((cliente, i) => cliente.write(`cliente-${i}`));
    const respuestas = await Promise.all(clientes.map((cliente) => leerHasta(cliente, 9)));

    expect(respuestas.map((r) => r.toString())).toEqual(['cliente-0', 'cliente-1', 'cliente-2']);
    expect(conexiones).toHaveLength(3);
  });

  it('si el cliente corta, corta también la conexión con el destino', async () => {
    const { eco, conexiones } = await levantarEco();
    const cliente = await conectar(await levantarPuente(puertoDe(eco)));
    cliente.write('x');
    await leerHasta(cliente, 1);

    cliente.destroy();
    await alCerrarse(conexiones[0]!);

    expect(conexiones[0]!.destroyed).toBe(true);
  });

  it('si el destino corta, corta también al cliente', async () => {
    const { eco, conexiones } = await levantarEco();
    const cliente = await conectar(await levantarPuente(puertoDe(eco)));
    cliente.write('x');
    await leerHasta(cliente, 1);

    conexiones[0]!.destroy();
    await alCerrarse(cliente);

    expect(cliente.destroyed).toBe(true);
  });

  it('si el destino no está, cierra la conexión del cliente e informa solo el código de Node', async () => {
    const { eco } = await levantarEco();
    const caido = puertoDe(eco);
    await new Promise<void>((listo) => eco.close(() => listo()));
    const codigos: string[] = [];
    const cliente = await conectar(await levantarPuente(caido, (codigo) => codigos.push(codigo)));

    await alCerrarse(cliente);

    expect(codigos).toEqual(['ECONNREFUSED']);
  });

  it('el puente sigue andando después de una conexión fallida', async () => {
    const { eco } = await levantarEco();
    const p = await levantarPuente(puertoDe(eco));
    const primera = await conectar(p);
    primera.write('a');
    await leerHasta(primera, 1);
    primera.destroy();

    const segunda = await conectar(p);
    segunda.write('b');

    expect((await leerHasta(segunda, 1)).toString()).toBe('b');
  });
});

describe('leerConfigPuente (RNF-06.4)', () => {
  it('sin variables: escucha en 0.0.0.0:5433 y reenvía a bd:5432', () => {
    expect(leerConfigPuente({})).toEqual({ config: { escucha: '0.0.0.0', puerto: 5433, destino: { host: 'bd', puerto: 5432 } } });
  });

  it('lee PUENTE_PUERTO y PUENTE_DESTINO', () => {
    expect(leerConfigPuente({ PUENTE_PUERTO: '6000', PUENTE_DESTINO: 'otra-bd:5433' })).toEqual({
      config: { escucha: '0.0.0.0', puerto: 6000, destino: { host: 'otra-bd', puerto: 5433 } },
    });
  });

  it('una variable vacía cuenta como no definida', () => {
    expect(leerConfigPuente({ PUENTE_PUERTO: '', PUENTE_DESTINO: '' }).config?.puerto).toBe(5433);
  });

  it.each(['0', '65536', 'abc', '-1', '54.3'])('rechaza PUENTE_PUERTO=%j sin repetir el valor', (valor) => {
    const resultado = leerConfigPuente({ PUENTE_PUERTO: valor });

    expect(resultado.errores).toEqual([{ variable: 'PUENTE_PUERTO', motivo: 'no es un entero entre 1 y 65535' }]);
  });

  it.each(['bd', 'bd:', ':5432', 'bd:99999', 'bd:5432:1', 'postgres://bd:5432', 'bd :5432'])('rechaza PUENTE_DESTINO=%j', (valor) => {
    const resultado = leerConfigPuente({ PUENTE_DESTINO: valor });

    expect(resultado.errores).toEqual([{ variable: 'PUENTE_DESTINO', motivo: 'no es servidor:puerto' }]);
    expect(JSON.stringify(resultado)).not.toContain(valor);
  });
});
