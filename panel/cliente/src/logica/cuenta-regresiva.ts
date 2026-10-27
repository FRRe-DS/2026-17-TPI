import type { DatosDeError } from '../api/errores.js';

// La cuenta regresiva del `503` (RF-2.4.13, RF-2.5.16), sin React: cuántos segundos contar y un contador chico. La cuenta solo
// informa cuándo conviene volver a intentar; no reintenta sola (plan, Decisiones): «Reintentar» queda siempre a mano.

const MINIMO_S = 1;
const MAXIMO_S = 3600;
const CADA_MS = 250;

// Los segundos del `Retry-After` de un `503`, o `undefined` si no vino, no es un entero de 1 a 3600 o el error es otro.
export function segundosDeCuenta(error: DatosDeError): number | undefined {
  const segundos = error.reintentarEnS;
  if (error.estado !== 503 || segundos === undefined) return undefined;
  return Number.isInteger(segundos) && segundos >= MINIMO_S && segundos <= MAXIMO_S ? segundos : undefined;
}

// «Podés reintentar en 1 min 5 s.»; en 0, «Ya podés reintentar.»
export function textoDeEspera(restantes: number): string {
  if (restantes <= 0) return 'Ya podés reintentar.';
  const minutos = Math.floor(restantes / 60);
  const segundos = restantes % 60;
  const partes = [minutos > 0 ? `${minutos} min` : '', segundos > 0 ? `${segundos} s` : ''].filter((parte) => parte !== '');
  return `Podés reintentar en ${partes.join(' ')}.`;
}

// Un contador que baja hasta 0. Mide contra la hora de fin y no contando avisos: una pestaña dormida que despierta tarde muestra lo
// que falta de verdad. Se compone con `useSyncExternalStore` (`suscribir` y `restantes`).
export function crearCuentaRegresiva(segundos: number) {
  let restantes = segundos;
  let fin = 0;
  let reloj: ReturnType<typeof setInterval> | undefined;
  const oyentes = new Set<() => void>();

  const detener = () => {
    if (reloj !== undefined) clearInterval(reloj);
    reloj = undefined;
  };

  const latir = () => {
    const faltan = Math.max(0, Math.ceil((fin - Date.now()) / 1000));
    if (faltan !== restantes) {
      restantes = faltan;
      oyentes.forEach((oyente) => oyente());
    }
    if (faltan === 0) detener();
  };

  return {
    restantes: () => restantes,
    suscribir(oyente: () => void): () => void {
      oyentes.add(oyente);
      return () => void oyentes.delete(oyente);
    },
    iniciar() {
      if (reloj !== undefined) return;
      fin = Date.now() + restantes * 1000;
      reloj = setInterval(latir, CADA_MS);
    },
    detener,
  };
}
