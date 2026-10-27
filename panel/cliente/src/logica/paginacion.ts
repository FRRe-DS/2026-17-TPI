// La página que devuelve M2 en toda lista (`Pagina` del contrato): las páginas empiezan en 0.
export type DatosDePagina = { page: number; size: number; totalElementos: number; totalPaginas: number };

export const hayAnterior = ({ page }: DatosDePagina): boolean => page > 0;
export const haySiguiente = ({ page, totalPaginas }: DatosDePagina): boolean => page + 1 < totalPaginas;

// «Página 2 de 3 · 12 en total». Con la lista vacía, «0 en total».
export function textoDePagina({ page, totalPaginas, totalElementos }: DatosDePagina): string {
  const paginas = totalPaginas === 0 ? '' : `Página ${page + 1} de ${totalPaginas} · `;
  return `${paginas}${totalElementos} en total`;
}

// Cuántos elementos trae cada página en las pantallas (el contrato admite de 1 a 100; el valor por defecto de M2 es 20).
export const TAMANO_DE_PAGINA = 10;
