import type { Writable } from 'node:stream';
import type { ErrorConfig } from './config.js';

// Lo que comparten los dos procesos del perfil `panel` (el panel y el M6 simulado) para arrancar y parar.

// Qué hace el proceso con el código de salida: en el servicio, `process.exit`; las pruebas lo espían.
export type Salir = (codigo: number) => void;

// Las señales de parada: SIGTERM es la de `docker stop` y `docker compose stop`; SIGINT, la de Ctrl+C en una terminal.
const SENALES_DE_PARADA = ['SIGTERM', 'SIGINT'] as const;

// Una línea JSON por variable inválida, con su nombre y qué le pasa, nunca con su valor (RNF-06.2, RNF-19.3). Con el formato del
// logger de la app (pino): nivel 50, hora en milisegundos y el texto.
export function registrarErroresDeConfig(errores: ErrorConfig[], servicio: string, flujo: Writable = process.stdout): void {
  for (const { variable, motivo } of errores) {
    flujo.write(`${JSON.stringify({ level: 50, time: Date.now(), servicio, variable, motivo, msg: 'Configuración inválida' })}\n`);
  }
}

// Atiende las señales de parada desde antes de arrancar: si llegan antes de que el servicio exista, sale con 0 sin esperar nada;
// ya andando, lo detiene en orden. Una segunda señal no cambia nada: `detener` es una sola.
export function atenderParada(detenerDelServicio: () => (() => Promise<void>) | undefined, salir: Salir): void {
  for (const senal of SENALES_DE_PARADA) {
    process.on(senal, () => {
      const detener = detenerDelServicio();
      if (detener === undefined) salir(0);
      else void detener();
    });
  }
}

// El tipo y el mensaje de un error, para el log: sin la pila ni lo que haya traído de la configuración.
export const resumenDeError = (error: unknown) =>
  error instanceof Error ? { tipo: error.name, mensaje: error.message } : { tipo: typeof error, mensaje: 'Error no identificado' };
