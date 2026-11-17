import { createServer, type Server, type Socket } from 'node:net';

// Un Redis de juguete para las pruebas unitarias (spec 107): habla RESP2 por TCP real y entiende GET, SET (con PX), INCR y
// PEXPIRE; cualquier otro comando (CLIENT SETINFO, SELECT…) lo contesta +OK. Sin Docker. La prueba con Redis de verdad es la de
// integración (T8).
export type RedisFalso = {
  puerto: number;
  url: string;
  // Cada comando recibido, con sus argumentos, en orden.
  comandos: string[][];
  // Los vencimientos pedidos, en milisegundos, por clave.
  vencimientos: Map<string, number>;
  // Con `true`, acepta conexiones pero no contesta nada: un Redis colgado. Las órdenes se guardan y, con `soltar()`, se
  // ejecutan y se contestan en orden, como haría un Redis congelado que vuelve.
  colgado: boolean;
  soltar: () => void;
  cerrar: () => Promise<void>;
};

function leerComandos(buffer: string): { comandos: string[][]; resto: string } {
  const comandos: string[][] = [];
  let resto = buffer;
  for (;;) {
    const cabecera = /^\*(\d+)\r\n/.exec(resto);
    if (!cabecera) break;
    const cantidad = Number(cabecera[1]);
    let posicion = cabecera[0].length;
    const argumentos: string[] = [];
    for (let i = 0; i < cantidad; i += 1) {
      const largo = /^\$(\d+)\r\n/.exec(resto.slice(posicion));
      if (!largo) return { comandos, resto };
      const bytes = Number(largo[1]);
      const inicio = posicion + largo[0].length;
      if (resto.length < inicio + bytes + 2) return { comandos, resto };
      argumentos.push(resto.slice(inicio, inicio + bytes));
      posicion = inicio + bytes + 2;
    }
    comandos.push(argumentos);
    resto = resto.slice(posicion);
  }
  return { comandos, resto };
}

// Con `puerto`, escucha en ese (para volver a levantar el que se cerró); sin él, en uno libre.
export async function levantarRedisFalso(puerto = 0): Promise<RedisFalso> {
  const datos = new Map<string, string>();
  const sockets = new Set<Socket>();
  const falso: RedisFalso = {
    puerto: 0,
    url: '',
    comandos: [],
    vencimientos: new Map(),
    colgado: false,
    soltar: () => soltar(),
    cerrar: () => cerrar(),
  };
  const retenidas: [Socket, string[]][] = [];
  const soltar = () => {
    falso.colgado = false;
    for (const [socket, comando] of retenidas.splice(0)) if (!socket.destroyed) responder(socket, comando);
  };

  const responder = (socket: Socket, [nombre = '', clave = '', valor = '', ...opciones]: string[]) => {
    switch (nombre.toUpperCase()) {
      case 'GET':
        socket.write(datos.has(clave) ? `$${Buffer.byteLength(datos.get(clave) ?? '')}\r\n${datos.get(clave)}\r\n` : '$-1\r\n');
        return;
      case 'SET':
        datos.set(clave, valor);
        if (opciones[0]?.toUpperCase() === 'PX') falso.vencimientos.set(clave, Number(opciones[1]));
        socket.write('+OK\r\n');
        return;
      case 'INCR': {
        const siguiente = Number(datos.get(clave) ?? '0') + 1;
        datos.set(clave, String(siguiente));
        socket.write(`:${siguiente}\r\n`);
        return;
      }
      case 'PEXPIRE':
        falso.vencimientos.set(clave, Number(valor));
        socket.write(':1\r\n');
        return;
      default:
        socket.write('+OK\r\n');
    }
  };

  const servidor: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    let pendiente = '';
    socket.on('data', (trozo) => {
      const { comandos, resto } = leerComandos(pendiente + trozo.toString('utf8'));
      pendiente = resto;
      for (const comando of comandos) {
        const [nombre = ''] = comando;
        // Lo que manda el cliente al conectar no es de la prueba: no se cuenta ni se cuelga.
        const deLaConexion = ['CLIENT', 'HELLO', 'SELECT', 'AUTH'].includes(nombre.toUpperCase());
        if (!deLaConexion) falso.comandos.push(comando);
        if ((falso.colgado || retenidas.length > 0) && !deLaConexion) {
          retenidas.push([socket, comando]);
          continue;
        }
        responder(socket, comando);
      }
    });
  });

  await new Promise<void>((listo, fallar) => {
    servidor.once('error', fallar);
    servidor.listen(puerto, '127.0.0.1', listo);
  });
  const direccion = servidor.address();
  if (direccion === null || typeof direccion === 'string') throw new Error('El Redis falso no escucha en un puerto');
  falso.puerto = direccion.port;
  falso.url = `redis://127.0.0.1:${direccion.port}`;

  function cerrar(): Promise<void> {
    for (const socket of sockets) socket.destroy();
    return new Promise((listo) => servidor.close(() => listo()));
  }
  return falso;
}
