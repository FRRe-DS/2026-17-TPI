import net from 'node:net';

// El puente a la base (spec 072, plan «Empaquetado y arranque», RNF-04.8): une cada conexión que llega a su puerto con el destino
// y copia los bytes en los dos sentidos. Existe para que el panel, cuando corre en la máquina, llegue a PostgreSQL sin publicar el
// puerto de `bd` (eso cambiaría el arranque de todos) y sin sumar una imagen de terceros. No mira ni guarda lo que pasa por él.

export type Destino = { host: string; puerto: number };
export type ConfigPuente = { escucha: string; puerto: number; destino: Destino };
export type ErrorConfigPuente = { variable: string; motivo: string };

const PUERTO_POR_DEFECTO = 5433;
const DESTINO_POR_DEFECTO: Destino = { host: 'bd', puerto: 5432 };

// Solo dígitos decimales, de 1 a 65535.
function aPuerto(texto: string): number | undefined {
  const numero = Number(texto);
  return /^\d+$/.test(texto) && numero >= 1 && numero <= 65535 ? numero : undefined;
}

// `servidor:puerto`, con el servidor de letras, números, punto y guion (un nombre de servicio de compose o una dirección).
function aDestino(texto: string): Destino | undefined {
  const partes = /^([A-Za-z0-9][A-Za-z0-9.-]*):(\d+)$/.exec(texto);
  const puerto = partes?.[2] === undefined ? undefined : aPuerto(partes[2]);
  return partes?.[1] === undefined || puerto === undefined ? undefined : { host: partes[1], puerto };
}

// Los errores nombran la variable y nunca repiten el valor recibido (RNF-06.2).
export function leerConfigPuente(
  env: Readonly<Record<string, string | undefined>>,
): { config: ConfigPuente; errores?: undefined } | { config?: undefined; errores: ErrorConfigPuente[] } {
  const errores: ErrorConfigPuente[] = [];
  const textoPuerto = env['PUENTE_PUERTO'] || undefined;
  const textoDestino = env['PUENTE_DESTINO'] || undefined;

  let puerto = PUERTO_POR_DEFECTO;
  if (textoPuerto !== undefined) {
    const leido = aPuerto(textoPuerto);
    if (leido === undefined) errores.push({ variable: 'PUENTE_PUERTO', motivo: 'no es un entero entre 1 y 65535' });
    else puerto = leido;
  }

  let destino = DESTINO_POR_DEFECTO;
  if (textoDestino !== undefined) {
    const leido = aDestino(textoDestino);
    if (leido === undefined) errores.push({ variable: 'PUENTE_DESTINO', motivo: 'no es servidor:puerto' });
    else destino = leido;
  }

  return errores.length > 0 ? { errores } : { config: { escucha: '0.0.0.0', puerto, destino } };
}

export type OpcionesPuente = ConfigPuente & {
  // Se llama con el código de Node (`ECONNREFUSED`) de lo que falló al unir una conexión, nunca con el mensaje, que trae la
  // dirección (RNF-19.4).
  alError?: ((codigo: string) => void) | undefined;
};

// El servidor sin escuchar todavía: quien lo crea llama a `listen`. Cierra las conexiones abiertas al cerrarse.
export function crearPuente({ destino, alError }: OpcionesPuente): net.Server {
  const abiertas = new Set<net.Socket>();

  const servidor = net.createServer((entrante) => {
    const saliente = net.connect(destino.puerto, destino.host);
    abiertas.add(entrante).add(saliente);

    // Si cae una punta, cae la otra: una conexión a medias no sirve para el protocolo de la base.
    const cerrarAmbas = () => {
      entrante.destroy();
      saliente.destroy();
      abiertas.delete(entrante);
      abiertas.delete(saliente);
    };
    entrante.on('error', cerrarAmbas).on('close', cerrarAmbas);
    saliente
      .on('error', (error: NodeJS.ErrnoException) => {
        alError?.(error.code ?? error.name);
        cerrarAmbas();
      })
      .on('close', cerrarAmbas);

    entrante.pipe(saliente);
    saliente.pipe(entrante);
  });

  // `close` solo termina cuando se cierran todas las conexiones: se cortan para que la parada no espere a nadie.
  const cerrar = servidor.close.bind(servidor);
  servidor.close = (callback) => {
    for (const socket of abiertas) socket.destroy();
    return cerrar(callback);
  };
  return servidor;
}
