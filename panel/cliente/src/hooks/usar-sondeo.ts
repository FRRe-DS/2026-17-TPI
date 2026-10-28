import { useEffect, useRef } from 'react';
import { INTERVALO_DE_SONDEO_MS } from '../logica/salud-en-vivo.js';

// El temporizador de la salud en vivo (spec 072, T13, RNF-13.4), sin React: pide enseguida y después `cadaMs` después de que
// termina cada pedido (nunca dos a la vez), y se corta al detener, cancelando el pedido en curso. Un pedido que falla no corta el
// sondeo: quien sondea decide qué hace con el fallo (acá, la salud «sin respuesta» es un dato más).
export function crearSondeo({ sondear, cadaMs = INTERVALO_DE_SONDEO_MS }: { sondear: (senal: AbortSignal) => Promise<void>; cadaMs?: number }) {
  let sesion = 0;
  let activo = false;
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  let control: AbortController | undefined;

  // `miSesion` evita que un pedido de antes de detener, que termina después, reanude el sondeo de una sesión nueva.
  const latir = async (miSesion: number): Promise<void> => {
    control = new AbortController();
    try {
      await sondear(control.signal);
    } catch {
      // Se sigue sondeando.
    }
    if (activo && miSesion === sesion) temporizador = setTimeout(() => void latir(miSesion), cadaMs);
  };

  return {
    iniciar() {
      if (activo) return;
      activo = true;
      sesion += 1;
      void latir(sesion);
    },
    detener() {
      activo = false;
      if (temporizador !== undefined) clearTimeout(temporizador);
      temporizador = undefined;
      control?.abort();
      control = undefined;
    },
  };
}

// Sondea mientras `activo` sea verdadero y se corta al salir de la pantalla. `sondear` puede cambiar entre renders sin reiniciar el
// temporizador: siempre se llama a la última.
export function usarSondeo(activo: boolean, sondear: (senal: AbortSignal) => Promise<void>, cadaMs: number = INTERVALO_DE_SONDEO_MS): void {
  const ultima = useRef(sondear);
  useEffect(() => {
    ultima.current = sondear;
  });
  useEffect(() => {
    if (!activo) return undefined;
    const sondeo = crearSondeo({ sondear: (senal) => ultima.current(senal), cadaMs });
    sondeo.iniciar();
    return sondeo.detener;
  }, [activo, cadaMs]);
}
