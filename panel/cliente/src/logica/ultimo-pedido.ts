// El último pedido a M2 (RNF-14.9), el que muestra la franja del pie: método, ruta, código, duración y folio (`X-Request-Id`), el
// puente con los logs de M2. Lo publica el cliente de M2 cada vez que un pedido termina y lo lee la franja con
// `useSyncExternalStore`. El folio falta cuando el pedido no llegó a tener respuesta del panel.
export type UltimoPedido = { metodo: string; ruta: string; estado: number; ms: number; requestId?: string | undefined };

export function crearUltimoPedido() {
  let actual: UltimoPedido | undefined;
  const oyentes = new Set<() => void>();
  return {
    actual: (): UltimoPedido | undefined => actual,
    suscribir(oyente: () => void): () => void {
      oyentes.add(oyente);
      return () => void oyentes.delete(oyente);
    },
    publicar(pedido: UltimoPedido): void {
      actual = pedido;
      oyentes.forEach((oyente) => oyente());
    },
  };
}
