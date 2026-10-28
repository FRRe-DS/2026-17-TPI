import type { FastifyInstance } from 'fastify';

// El detalle técnico (RNF-14.9): los últimos pedidos que el panel le hizo a M2, en memoria y solo mientras el panel está
// arriba. Guarda lo que hace falta para mostrarlos y para armar el `curl` equivalente, y nada más: el token nunca se guarda,
// solo si el pedido lo llevaba (RNF-19.3).

export const CAPACIDAD = 50;
// Un cuerpo más grande no se guarda: 50 pedidos de 1 MiB serían 50 MiB en memoria por un `curl` que no se pega en una terminal.
export const LIMITE_CUERPO_GUARDADO = 16 * 1024;

export type Pedido = {
  // El `X-Request-Id` que el panel mandó a M2, el que se busca en `docker compose logs m2`.
  requestId: string;
  hora: string;
  metodo: string;
  // El camino con su query string, tal como se pidió.
  ruta: string;
  // Los encabezados que se reenviaron, sin `Authorization`, con el nombre como se escribe en un `curl`.
  encabezados: Record<string, string>;
  conToken: boolean;
  cuerpo?: string;
  cuerpoOmitido?: boolean;
  // El código con que el panel respondió: el de M2, o 504 si M2 no contestó.
  estado: number;
  duracionMs: number;
};

export function crearRegistroDePedidos(capacidad = CAPACIDAD) {
  const pedidos: Pedido[] = [];
  return {
    registrar(pedido: Pedido): void {
      const guardado = { ...pedido };
      if (guardado.cuerpo !== undefined && guardado.cuerpo.length > LIMITE_CUERPO_GUARDADO) {
        delete guardado.cuerpo;
        guardado.cuerpoOmitido = true;
      }
      pedidos.unshift(guardado);
      pedidos.length = Math.min(pedidos.length, capacidad);
    },
    // Una copia, el más nuevo primero.
    recientes: (): Pedido[] => [...pedidos],
  };
}

export type RegistroDePedidos = ReturnType<typeof crearRegistroDePedidos>;

// Entre comillas simples, que no expanden nada en un shell; una comilla simple dentro se cierra, se escapa y se vuelve a abrir.
const entreComillas = (texto: string) => `'${texto.replaceAll("'", `'\\''`)}'`;

export const TOKEN_ENMASCARADO = 'Bearer ••••';

// El `curl` que repite el pedido contra la dirección pública de M2, con `$TOKEN` en lugar del token: quien lo copia pone el
// suyo (por ejemplo, el que genera `npm run tokens`). Todo lo que sale del pedido va entre comillas simples, para que pegarlo
// en una terminal no ejecute nada que la persona no escribió; solo `$TOKEN` queda entre comillas dobles, para que se expanda.
export function curlEquivalente(pedido: Pedido, urlPublica: string): string {
  const partes = ['curl', '-X', pedido.metodo];
  if (pedido.conToken) partes.push('-H', '"Authorization: Bearer $TOKEN"');
  for (const [nombre, valor] of Object.entries(pedido.encabezados)) partes.push('-H', entreComillas(`${nombre}: ${valor}`));
  if (pedido.cuerpo !== undefined) partes.push('-d', entreComillas(pedido.cuerpo));
  else if (pedido.cuerpoOmitido) partes.push('-d', '@cuerpo.json');
  partes.push(entreComillas(urlPublica + pedido.ruta));
  return partes.join(' ');
}

// Lo que se entrega al navegador: el pedido con el `Authorization` enmascarado y el `curl` ya armado.
export function presentarPedido(pedido: Pedido, urlPublica: string) {
  const { conToken, encabezados, ...resto } = pedido;
  return {
    ...resto,
    encabezados: conToken ? { Authorization: TOKEN_ENMASCARADO, ...encabezados } : encabezados,
    curl: curlEquivalente(pedido, urlPublica),
  };
}

export function registrarPedidos(app: FastifyInstance, registro: RegistroDePedidos, urlPublica: string): void {
  app.get('/panel/pedidos', async () => ({ pedidos: registro.recientes().map((pedido) => presentarPedido(pedido, urlPublica)) }));
}
