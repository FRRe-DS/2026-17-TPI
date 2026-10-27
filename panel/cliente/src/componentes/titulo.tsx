import type { ReactNode } from 'react';

// El título de cada pantalla: un solo `<h1>` por vista, que puede recibir el foco (lo lleva `Marco` al cambiar de ruta).
export function Titulo({ children }: { children: ReactNode }) {
  return <h1 tabIndex={-1}>{children}</h1>;
}
