import { ErrorDeApi } from '../api/errores.js';
export async function consultarPerfilPropio<T>(api: { obtenerCliente: (sub: string, opciones?: { senal?: AbortSignal }) => Promise<T> }, sub: string, senal?: AbortSignal) {
  try { return { tipo: 'existente' as const, perfil: await api.obtenerCliente(sub, senal ? { senal } : {}) }; }
  catch (error) { if (error instanceof ErrorDeApi && error.estado === 404) return { tipo: 'nuevo' as const }; throw error; }
}
