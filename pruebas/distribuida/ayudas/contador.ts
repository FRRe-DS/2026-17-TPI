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

// `reintentosM2` es M2_REINTENTOS_MODULOS: cada pedido de M2 a M6 puede repetirse tantas veces como diga.
export function crearContador(opciones: { reintentosM2?: number } = {}): Contador {
  const reintentos = opciones.reintentosM2 ?? 1;
  let m6 = 0;
  let m2 = 0;
  return {
    pedidoAM6: () => {
      m6 += 1;
    },
    pedidoAM2: () => {
      m2 += 1;
    },
    pedidoAM2QueConsultaM6: () => {
      m2 += 1;
      m6 += 1 + reintentos;
    },
    totalM6: () => m6,
    totalM2: () => m2,
    superaElLimite: () => m6 > LIMITE_PRUEBA_M6,
  };
}
