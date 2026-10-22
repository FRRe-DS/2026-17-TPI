import net, { type AddressInfo } from 'node:net';
import type { Entorno } from '../../src/config.js';
import { CONFIG_TOKENS } from './tokens.js';

// Un puerto que estaba libre recién: se abre uno cualquiera y se cierra, porque M2_PUERTO no admite 0.
export async function puertoLibre(): Promise<number> {
  const servidor = net.createServer();
  await new Promise<void>((listo) => servidor.listen(0, '0.0.0.0', listo));
  const { port } = servidor.address() as AddressInfo;
  await new Promise<void>((listo) => servidor.close(() => listo()));
  return port;
}

// Si algo acepta conexiones en el puerto, en 127.0.0.1.
export function escucha(puerto: number): Promise<boolean> {
  return new Promise((resolver) => {
    const socket = net.connect({ port: puerto, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolver(true);
    });
    socket.once('error', () => resolver(false));
  });
}

// Las variables de un arranque que anda, con la base y el puerto que se pasen y los cambios del caso (undefined: falta).
export const entorno = (urlBd: string, puerto: number, cambios: Entorno = {}): Entorno => ({
  M2_URL_BD: urlBd,
  M2_PUERTO: String(puerto),
  M2_CLAVE_TOKENS: CONFIG_TOKENS.claveTokens,
  M2_EMISOR_TOKENS: CONFIG_TOKENS.emisorTokens,
  M2_AUDIENCIA_TOKENS: CONFIG_TOKENS.audienciaTokens,
  ...cambios,
});
