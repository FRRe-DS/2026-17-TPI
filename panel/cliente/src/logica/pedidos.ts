import type { PedidoDelPanel } from '../api/panel.js';
import { instante } from './historial.js';

// Lo que dice el detalle técnico de cada pedido (RNF-14.9), sin React.

export const CAPACIDAD_DE_PEDIDOS = 50;

// La hora del pedido, sin la fecha: son los últimos de esta sesión del panel.
export const horaDelPedido = (hora: string): string => instante(hora).slice(11);

// Un código de 400 o más (incluye el 504 de «M2 no responde») se marca como falla.
export const esFalla = (estado: number): boolean => estado >= 400;

export function textoDelCuerpo(pedido: Pick<PedidoDelPanel, 'cuerpo' | 'cuerpoOmitido'>): string {
  if (pedido.cuerpo !== undefined) return pedido.cuerpo;
  return pedido.cuerpoOmitido === true ? 'Cuerpo demasiado grande para guardarlo; el curl lo pide desde un archivo (@cuerpo.json).' : 'Sin cuerpo.';
}

// Copiar al portapapeles: si el navegador no lo deja (sin HTTPS, sin permiso), la persona lo ve en lugar de creer que se copió.
export async function copiarAlPortapapeles(texto: string, portapapeles: Pick<Clipboard, 'writeText'> | undefined = globalThis.navigator?.clipboard): Promise<void> {
  if (portapapeles === undefined) throw new Error('Este navegador no deja copiar desde la página: seleccioná el texto y copialo a mano.');
  await portapapeles.writeText(texto);
}
