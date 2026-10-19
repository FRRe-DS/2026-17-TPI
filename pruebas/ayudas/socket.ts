import type { FastifyInstance } from 'fastify';
import net, { type AddressInfo } from 'node:net';

// Pone la app a escuchar en un puerto libre de 127.0.0.1 y devuelve el puerto. crearApp la cierra al terminar la prueba.
export async function escuchar(app: FastifyInstance): Promise<number> {
  await app.listen({ port: 0, host: '127.0.0.1' });
  return (app.server.address() as AddressInfo).port;
}

// Manda `pedido` tal cual por un socket y devuelve todo lo que llega hasta que el servidor cierra la conexión. Con
// `terminar`, el cliente cierra además su lado después de mandarlo, como uno que no tiene más para mandar. Con inject no
// alcanza: la respuesta a HEAD trae el cuerpo que escribió Fastify, aunque Node no lo manda.
export function porSocket(puerto: number, pedido: string, { terminar = false } = {}): Promise<string> {
  return new Promise((resolve) => {
    const partes: Buffer[] = [];
    const socket = net.connect(puerto, '127.0.0.1', () => (terminar ? socket.end(pedido) : socket.write(pedido)));
    socket.on('data', (parte: Buffer) => partes.push(parte));
    // Un RST también cierra la conexión: lo que importa es lo que llegó antes.
    socket.on('error', () => {});
    socket.on('close', () => resolve(Buffer.concat(partes).toString('latin1')));
  });
}

// Separa una respuesta HTTP cruda en la línea de estado, los encabezados (con el nombre en minúscula) y lo que vino después.
export function leerRespuesta(cruda: string) {
  const fin = cruda.indexOf('\r\n\r\n');
  if (fin === -1) throw new Error(`no llegó una respuesta HTTP completa: ${JSON.stringify(cruda)}`);
  const [estado, ...lineas] = cruda.slice(0, fin).split('\r\n');
  const encabezados = Object.fromEntries(
    lineas.map((linea) => [linea.slice(0, linea.indexOf(':')).toLowerCase(), linea.slice(linea.indexOf(':') + 1).trim()]),
  );
  return { estado, encabezados, resto: cruda.slice(fin + 4) };
}
