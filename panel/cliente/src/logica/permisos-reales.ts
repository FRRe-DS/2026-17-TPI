export type Espacio = 'CLIENTE' | 'OPERADOR';
type Permisos = { roles: readonly string[]; scopes: readonly string[] };
export const espaciosDe = ({ roles }: Permisos): Espacio[] => (['CLIENTE', 'OPERADOR'] as const).filter(rol => roles.includes(rol));
const CUENTA = ['perfil', 'direcciones', 'preferencias', 'historial', 'calificar', 'calificaciones', 'estado-cuenta'];
export function permiteRutaReal(pantalla: string, sesion: Permisos, espacio: Espacio): boolean {
  if (!sesion.roles.includes(espacio)) return false;
  if (pantalla === 'detalle-tecnico') return true;
  if (espacio === 'OPERADOR') return pantalla === 'operador' && sesion.scopes.includes('clientes:write');
  return CUENTA.includes(pantalla) && sesion.scopes.includes(pantalla === 'estado-cuenta' ? 'clientes.estado:read' : 'clientes:read');
}
