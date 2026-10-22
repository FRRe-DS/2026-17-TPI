import net, { type AddressInfo, type Server, type Socket } from 'node:net';

// Donde escucha el proxy.
const HOST = '127.0.0.1';

// Una conexión que pasa por el proxy: el socket que abrió el pool y, desde que el proxy la deja pasar, el que abrió el proxy
// hacia la base. `pasando` dice si los dos están unidos.
type Conexion = { cliente: Socket; base?: Socket; pasando: boolean };

export type ProxyDeBase = {
  // La URL de la base que recibió, pero apuntando al proxy.
  urlBd: string;
  // Deja de pasar datos, en las dos direcciones, por las conexiones que ya están, y acepta las nuevas sin conectarlas con la
  // base: como una base colgada, que acepta la conexión y no contesta. Lo que llega queda retenido, no se pierde.
  colgar(): void;
  // Corta todas las conexiones y deja de escuchar: una conexión nueva se rechaza (ECONNREFUSED), como con la base caída.
  cerrar(): Promise<void>;
  // Vuelve a dejar pasar todo: escucha otra vez en el mismo puerto, si estaba cerrado, y suelta lo retenido, si estaba colgado.
  reabrir(): Promise<void>;
  // Corta todo y deja de escuchar. Va al terminar cada prueba.
  terminar(): Promise<void>;
};

// Un proxy TCP entre el pool y la base de una prueba, para que la base se cuelgue o se caiga con el servicio andando, y vuelva
// (RNF-14.2), sin tocar el contenedor, que comparten todas las pruebas. Escucha en un puerto libre de 127.0.0.1.
export async function crearProxy(urlBd: string): Promise<ProxyDeBase> {
  const destino = new URL(urlBd);
  const conexiones = new Set<Conexion>();
  let colgado = false;
  let servidor: Server | undefined;
  let puerto = 0;

  // Une los dos sockets de la conexión, si no lo están.
  function pasar(conexion: Conexion): void {
    if (conexion.pasando || conexion.base === undefined) return;
    conexion.cliente.pipe(conexion.base);
    conexion.base.pipe(conexion.cliente);
    conexion.pasando = true;
  }

  // Los separa. Un socket que se queda sin destino se pausa: lo que llega queda en él hasta que se vuelvan a unir.
  function retener(conexion: Conexion): void {
    if (!conexion.pasando || conexion.base === undefined) return;
    conexion.cliente.unpipe(conexion.base);
    conexion.base.unpipe(conexion.cliente);
    conexion.pasando = false;
  }

  function conectar(conexion: Conexion): void {
    const base = net.connect({ host: destino.hostname, port: Number(destino.port) });
    // Los errores de los sockets no importan: el que se corta cierra al otro.
    base.on('error', () => {});
    base.on('close', () => conexion.cliente.destroy());
    conexion.base = base;
    pasar(conexion);
  }

  function atender(cliente: Socket): void {
    const conexion: Conexion = { cliente, pasando: false };
    conexiones.add(conexion);
    cliente.on('error', () => {});
    cliente.on('close', () => {
      conexion.base?.destroy();
      conexiones.delete(conexion);
    });
    // Colgado, la conexión queda aceptada y sin base: el pool espera una respuesta que no llega.
    if (!colgado) conectar(conexion);
  }

  async function escuchar(): Promise<void> {
    const nuevo = net.createServer(atender);
    await new Promise<void>((listo, fallar) => {
      nuevo.once('error', fallar);
      nuevo.listen(puerto, HOST, () => {
        nuevo.off('error', fallar);
        listo();
      });
    });
    servidor = nuevo;
    puerto = (nuevo.address() as AddressInfo).port;
  }

  // Corta las conexiones y deja de escuchar; termina cuando el servidor se cerró del todo.
  async function cortar(): Promise<void> {
    const actual = servidor;
    servidor = undefined;
    const cerrado = actual && new Promise<void>((listo) => actual.close(() => listo()));
    for (const { cliente, base } of conexiones) {
      cliente.destroy();
      base?.destroy();
    }
    await cerrado;
  }

  await escuchar();
  const url = new URL(urlBd);
  url.hostname = HOST;
  url.port = String(puerto);

  return {
    urlBd: url.toString(),
    colgar() {
      colgado = true;
      for (const conexion of conexiones) retener(conexion);
    },
    cerrar: cortar,
    async reabrir() {
      colgado = false;
      if (servidor === undefined) await escuchar();
      for (const conexion of conexiones) {
        if (conexion.base === undefined) conectar(conexion);
        else pasar(conexion);
      }
    },
    terminar: cortar,
  };
}
