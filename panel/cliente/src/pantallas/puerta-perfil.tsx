import type { ReactNode } from 'react';
import type { ApiM2 } from '../api/m2.js';
import { EstadoPantalla } from '../componentes/estado-pantalla.js';
import { CompletarPerfil } from './completar-perfil.js';
import { usarCarga } from '../hooks/usar-carga.js';
import { consultarPerfilPropio } from '../logica/primer-perfil.js';
export function PuertaPerfil({ api, sub, children }: { api: ApiM2; sub: string; children: ReactNode }) {
  const { estado, reintentar } = usarCarga(senal => consultarPerfilPropio(api, sub, senal), [api, sub]);
  return <EstadoPantalla estado={estado} vacio="No hay perfil." alReintentar={reintentar}>{resultado => resultado.tipo === 'existente'
    ? children : <CompletarPerfil api={api} sub={sub} alCompletar={reintentar} />}</EstadoPantalla>;
}
