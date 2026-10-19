import { Writable } from 'node:stream';

// Una línea del log tal como la escribe el logger: un objeto JSON con al menos el nivel (50 es error).
export type LineaDeLog = {
  level: number;
  msg?: string;
  idCorrelacion?: string;
  err?: Record<string, unknown>;
  [clave: string]: unknown;
};

// Un flujo para pasarle a construirApp y leer después lo que el logger escribió, una línea JSON por evento.
export function capturarLogs() {
  const partes: string[] = [];
  const flujo = new Writable({
    decodeStrings: false,
    write(parte: string, _codificacion, listo) {
      partes.push(parte);
      listo();
    },
  });
  const texto = () => partes.join('');
  return {
    flujo,
    texto,
    lineas: (): LineaDeLog[] =>
      texto()
        .split('\n')
        .filter((linea) => linea !== '')
        .map((linea) => JSON.parse(linea) as LineaDeLog),
  };
}

// Un flujo que descarta todo: las pruebas que no miran el log no llenan la salida de líneas JSON.
export const descartarLogs = new Writable({
  write(_parte, _codificacion, listo) {
    listo();
  },
});
