import type { Escenario } from '../api/panel.js';
import type { ApiM2 } from '../api/m2.js';
import type { components } from '../generado/contrato.js';
import type { FuenteDeViajes } from '../fuentes/viajes-simulados.js';

// «Cargar ejemplo» (RF-2.1.10, RF-2.1.11), sin React: tres direcciones y unas preferencias por la API de M2, y los viajes del cliente
// en el M6 simulado. Los pasos van en orden y cada uno se informa; repetirlo no duplica nada porque las direcciones usan siempre las
// mismas `Idempotency-Key`, las preferencias son un `PUT` y el M6 simulado usa ids fijos por cliente.

type Esquemas = components['schemas'];

export const DIRECCIONES_DE_EJEMPLO: Esquemas['DireccionNueva'][] = [
  { tipo: 'FAVORITA', alias: 'Casa', texto: 'Av. Sarmiento 1500, Resistencia', coordenadas: { latitud: -27.45, longitud: -58.98 } },
  { tipo: 'RECIENTE', texto: 'Plaza 25 de Mayo, Resistencia' },
  { tipo: 'RECIENTE', texto: 'Terminal de Ómnibus, Resistencia' },
];

export const PREFERENCIAS_DE_EJEMPLO: Esquemas['Preferencias'] = { tiposVehiculo: ['AUTO'], canales: ['EMAIL', 'PUSH'], accesibilidad: [] };

// La misma clave para la misma dirección del mismo cliente: M2 devuelve la que ya creó (RF-2.1.11). `n` va de 1 a 3.
export const claveDeDireccionDeEjemplo = (n: number, clienteId: string): string => `ejemplo-dir-${n}-${clienteId}`;

export type IdDePaso = 'direccion-1' | 'direccion-2' | 'direccion-3' | 'preferencias' | 'viajes';
export type EstadoDePaso = 'pendiente' | 'en-curso' | 'hecho' | 'fallido';
export type InformeDePaso = { id: IdDePaso; estado: EstadoDePaso };

// Lo que dice la pantalla de cada paso.
export const PASOS: { id: IdDePaso; texto: string }[] = [
  { id: 'direccion-1', texto: 'Dirección favorita «Casa»' },
  { id: 'direccion-2', texto: 'Dirección reciente: Plaza 25 de Mayo' },
  { id: 'direccion-3', texto: 'Dirección reciente: Terminal de Ómnibus' },
  { id: 'preferencias', texto: 'Preferencias: auto, avisos por correo y notificación' },
  { id: 'viajes', texto: 'Viajes en el M6 simulado: uno completado y uno en curso' },
];

export const pasosIniciales = (): InformeDePaso[] => PASOS.map(({ id }) => ({ id, estado: 'pendiente' }));

export type EntornoDeEjemplo = { api: ApiM2; viajes: FuenteDeViajes };

// Los pasos en orden, informando cada cambio con la lista completa. Si uno falla, queda `fallido`, los siguientes quedan
// `pendiente` y el error llega tal cual: lo hecho antes se queda hecho, y repetir la carga lo retoma con las mismas claves. El M6
// va al final a propósito: si no está, lo de M2 ya quedó cargado.
export async function cargarEjemplo(
  { api, viajes }: EntornoDeEjemplo,
  clienteId: string,
  alCambiar: (pasos: InformeDePaso[]) => void,
  senal?: AbortSignal,
): Promise<{ escenarios: Escenario[] }> {
  const opciones = senal === undefined ? {} : { senal };
  let pasos = pasosIniciales();
  const marcar = (id: IdDePaso, estado: EstadoDePaso) => {
    pasos = pasos.map((paso) => (paso.id === id ? { id, estado } : paso));
    alCambiar(pasos);
  };
  const hacer = async <T>(id: IdDePaso, paso: () => Promise<T>): Promise<T> => {
    marcar(id, 'en-curso');
    try {
      const resultado = await paso();
      marcar(id, 'hecho');
      return resultado;
    } catch (error) {
      marcar(id, 'fallido');
      throw error;
    }
  };

  for (const [indice, direccion] of DIRECCIONES_DE_EJEMPLO.entries()) {
    const n = indice + 1;
    await hacer(`direccion-${n}` as IdDePaso, () => api.crearDireccion(clienteId, direccion, claveDeDireccionDeEjemplo(n, clienteId), opciones));
  }
  await hacer('preferencias', () => api.guardarPreferencias(clienteId, PREFERENCIAS_DE_EJEMPLO, opciones));
  const { escenarios } = await hacer('viajes', () => viajes.cargarEjemplo(clienteId, senal));
  return { escenarios };
}

// Lo que se le dice a la persona si la carga se cortó: qué quedó hecho y qué no, y que repetir es seguro (RF-2.1.11).
export function resumenDeFallo(pasos: InformeDePaso[]): string | undefined {
  const fallido = pasos.find((paso) => paso.estado === 'fallido');
  if (fallido === undefined) return undefined;
  const hechos = pasos.filter((paso) => paso.estado === 'hecho').length;
  const quedo = hechos === 0 ? 'No quedó cargado nada.' : `Quedaron cargados ${hechos} de ${pasos.length} pasos.`;
  const que = fallido.id === 'viajes' ? 'Los viajes no se pudieron registrar en el M6 simulado.' : 'Un paso falló y los siguientes no se hicieron.';
  return `${que} ${quedo} Reintentar es seguro: no repite lo que ya está.`;
}
