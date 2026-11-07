import { appendFileSync, existsSync, statSync } from 'node:fs';

// Cuenta los pedidos de la prueba distribuida para no acercarse al límite de M6: 1200 por minuto. La prueba se queda en la mitad
// (spec 081, plan «Límite de M6»).
export const LIMITE_PRUEBA_M6 = 600;

export type Contador = {
  // Un pedido que la prueba le hace directo a M6.
  pedidoAM6: () => void;
  // Un pedido a M2 que no consulta a M6 (el perfil, las direcciones).
  pedidoAM2: () => void;
  // Un pedido a M2 que sí consulta a M6 (el historial, la calificación): M6 puede recibir el pedido y todos sus reintentos.
  pedidoAM2QueConsultaM6: () => void;
  totalM6: () => number;
  totalM2: () => number;
  superaElLimite: () => boolean;
};

// `reintentosM2` es M2_REINTENTOS_MODULOS: cada pedido de M2 a M6 puede repetirse tantas veces como diga. Con `archivo`, los pedidos a
// M6 se suman ahí, un byte por pedido, y todos los contadores con ese archivo ven el mismo total: Vitest aísla cada archivo de
// prueba, y esta es la forma de contar los de toda la corrida. Los pedidos a M2 son solo de este contador.
export function crearContador(opciones: { reintentosM2?: number; archivo?: string } = {}): Contador {
  const reintentos = opciones.reintentosM2 ?? 1;
  const { archivo } = opciones;
  let m6 = 0;
  let m2 = 0;
  const sumarM6 = (cantidad: number) => {
    if (archivo === undefined) m6 += cantidad;
    else appendFileSync(archivo, 'x'.repeat(cantidad));
  };
  const totalM6 = () => {
    if (archivo === undefined) return m6;
    return existsSync(archivo) ? statSync(archivo).size : 0;
  };
  return {
    pedidoAM6: () => {
      sumarM6(1);
    },
    pedidoAM2: () => {
      m2 += 1;
    },
    pedidoAM2QueConsultaM6: () => {
      m2 += 1;
      sumarM6(1 + reintentos);
    },
    totalM6,
    totalM2: () => m2,
    superaElLimite: () => totalM6() > LIMITE_PRUEBA_M6,
  };
}
