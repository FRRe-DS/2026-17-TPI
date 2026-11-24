import type { ReactNode } from 'react';
import type { ApiM2 } from '../api/m2.js';
import { EstadoPantalla } from '../componentes/estado-pantalla.js';
import { Titulo } from '../componentes/titulo.js';
import { usarCarga } from '../hooks/usar-carga.js';
import { consultarPerfilPropio } from '../logica/primer-perfil.js';
export function PuertaPerfil({ api, sub, children }: { api: ApiM2; sub: string; children: ReactNode }) {
  const { estado, reintentar } = usarCarga(senal => consultarPerfilPropio(api, sub, senal), [api, sub]);
  return <EstadoPantalla estado={estado} vacio="No hay perfil." alReintentar={reintentar}>{resultado => resultado.tipo === 'existente'
    ? children : <><Titulo>Completar perfil</Titulo><p>Este usuario todavía no tiene perfil en M2.</p></>}</EstadoPantalla>;
}
