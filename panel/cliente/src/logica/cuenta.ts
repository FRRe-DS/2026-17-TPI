import type { components } from '../generado/contrato.js';
import { instante } from './historial.js';

// Lo que dicen el estado de cuenta y sus bloqueos (RF-2.6.5 a RF-2.6.7), sin React. Lo comparten las tres vistas que lo muestran: la
// del cliente, la del operador y la de otro módulo.

type EstadoCuenta = components['schemas']['EstadoCuenta'];
type EstadoCliente = components['schemas']['EstadoCliente'];
type Bloqueo = components['schemas']['Bloqueo'];

// Lo decide el estado que informa M2, no la cantidad de bloqueos que traiga la lista.
export const estaBloqueado = (cuenta: Pick<EstadoCuenta, 'estado'>): boolean => cuenta.estado === 'BLOQUEADO';

// El estado dicho con palabras: el color solo no alcanza (RNF-15.3).
export const textoDeEstado = (estado: EstadoCliente): string =>
  estado === 'BLOQUEADO' ? 'Bloqueado: no puede solicitar viajes mientras haya un bloqueo vigente.' : 'Activo: puede solicitar viajes.';

export const textoDeVigencia = ({ hasta }: Pick<Bloqueo, 'hasta'>): string => (hasta === undefined ? 'Hasta que se levante' : `Hasta ${instante(hasta)} (UTC)`);
