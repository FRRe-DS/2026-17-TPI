import { ErrorDeApi } from '../api/errores.js';
import type { components } from '../generado/contrato.js';
export async function consultarPerfilPropio<T>(api: { obtenerCliente: (sub: string, opciones?: { senal?: AbortSignal }) => Promise<T> }, sub: string, senal?: AbortSignal) {
  try { return { tipo: 'existente' as const, perfil: await api.obtenerCliente(sub, senal ? { senal } : {}) }; }
  catch (error) { if (error instanceof ErrorDeApi && error.estado === 404) return { tipo: 'nuevo' as const }; throw error; }
}
export function crearAltaPropia<T extends { clienteId: string }>(api: {
  obtenerCliente: (sub: string) => Promise<T>;
  crearCliente: (cuerpo: components['schemas']['ClienteNuevo'], clave: string) => Promise<T>;
}, sub: string) {
  let ultimoCuerpo: string | undefined; let clave = crypto.randomUUID(); let incierto = false;
  let pendiente: Promise<T> | undefined;
  async function ejecutar(cuerpo: components['schemas']['ClienteNuevo']): Promise<T> {
    const serializado = JSON.stringify(cuerpo);
    if (ultimoCuerpo !== undefined && ultimoCuerpo !== serializado) {
      if (incierto) {
        const resultado = await consultarPerfilPropio(api, sub);
        if (resultado.tipo === 'existente') return resultado.perfil;
      }
      clave = crypto.randomUUID();
    }
    ultimoCuerpo = serializado;
    try { const perfil = await api.crearCliente(cuerpo, clave); incierto = false; return perfil; }
    catch (error) {
      if (error instanceof ErrorDeApi && error.estado === 409) {
        const resultado = await consultarPerfilPropio(api, sub);
        if (resultado.tipo === 'existente') return resultado.perfil;
      }
      incierto = !(error instanceof ErrorDeApi) || error.sinRespuesta || error.estado >= 500;
      throw error;
    }
  }
  return { enviar(cuerpo: components['schemas']['ClienteNuevo']): Promise<T> {
    pendiente ??= ejecutar(cuerpo).finally(() => { pendiente = undefined; });
    return pendiente;
  } };
}
