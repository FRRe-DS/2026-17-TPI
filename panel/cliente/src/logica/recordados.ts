// Los clientes de prueba que se usaron antes en este navegador (RF-2.1.6, RF-2.1.7). Funciones puras: quien las usa decide dónde
// guardar el texto (el almacenamiento local del navegador). De cada cliente se guarda solo su UUID y su nombre, nada más.

export type Recordado = { id: string; nombre: string };

export const MAXIMO_RECORDADOS = 10;
// Nombre y apellido tienen hasta 100 caracteres cada uno en el contrato, y se guardan juntos con un espacio.
const LARGO_MAXIMO_NOMBRE = 201;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// El mismo cliente con el id en mayúsculas o en minúsculas es uno solo; se guarda en minúscula.
const normalizar = (id: string) => id.toLowerCase();

// Lo que sirve de un valor cualquiera: un `{ id: uuid, nombre: texto }` o nada. No copia ningún otro campo.
function comoRecordado(valor: unknown): Recordado | undefined {
  if (typeof valor !== 'object' || valor === null) return undefined;
  const { id, nombre } = valor as Record<string, unknown>;
  if (typeof id !== 'string' || !UUID.test(id) || typeof nombre !== 'string') return undefined;
  const limpio = nombre.trim();
  return limpio === '' || limpio.length > LARGO_MAXIMO_NOMBRE ? undefined : { id: normalizar(id), nombre: limpio };
}

// El cliente va primero; si ya estaba, se quita de su lugar (y se queda con el nombre nuevo); la lista se corta en 10.
export function agregar(lista: readonly Recordado[], cliente: Recordado): Recordado[] {
  const nuevo = comoRecordado(cliente);
  if (nuevo === undefined) return [...lista];
  return [nuevo, ...lista.filter((otro) => normalizar(otro.id) !== nuevo.id)].slice(0, MAXIMO_RECORDADOS);
}

export const quitar = (lista: readonly Recordado[], id: string): Recordado[] =>
  lista.filter((cliente) => normalizar(cliente.id) !== normalizar(id));

// Lo guardado puede estar roto o venir de otra versión: se descarta lo que no tenga la forma, los repetidos y lo que pase de 10.
export function leer(texto: string | null | undefined): Recordado[] {
  if (typeof texto !== 'string') return [];
  let guardado: unknown;
  try {
    guardado = JSON.parse(texto);
  } catch {
    return [];
  }
  if (!Array.isArray(guardado)) return [];
  const vistos = new Set<string>();
  const lista: Recordado[] = [];
  for (const entrada of guardado) {
    const cliente = comoRecordado(entrada);
    if (cliente === undefined || vistos.has(cliente.id)) continue;
    vistos.add(cliente.id);
    lista.push(cliente);
  }
  return lista.slice(0, MAXIMO_RECORDADOS);
}

export const escribir = (lista: readonly Recordado[]): string =>
  JSON.stringify(lista.map(({ id, nombre }) => ({ id, nombre })));
