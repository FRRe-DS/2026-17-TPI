import { ErrorDeApi } from '../api/errores.js';
import type { ApiM2, Identidad, OpcionesDePedido } from '../api/m2.js';
import type { FuenteDeSesion, Sesion } from '../fuentes/fuente-de-sesion.js';
import type { Almacenamiento } from '../fuentes/sesion-simulada.js';
import type { Rol } from '../rutas.js';
import { cuerpoDeAlta, type CamposCliente } from './campos-cliente.js';
import { agregar, escribir, leer, quitar, type Recordado } from './recordados.js';

// Lo que hace la pantalla `ingresar` (RF-2.1.5 a RF-2.1.7, RNF-12.9), sin React: entrar como cliente nuevo, volver a entrar como
// un cliente recordado o entrar con un rol y un identificador. La pantalla solo lo dibuja y lo conecta con `usarAccion`; la
// prueba de integración lo recorre contra M2 real.

// Lo que la pantalla recibe de `app.tsx`. `apiPara` da un cliente de M2 que pide como una identidad dada: el alta y el reingreso
// piden como el cliente antes de que exista la sesión, que se abre solo si M2 contesta bien.
export type Ingreso = {
  sesion: FuenteDeSesion;
  recordados: RecordadosGuardados;
  apiPara: (identidad: Identidad) => ApiM2;
};

// ---- Recordados guardados (RF-2.1.6) ----

// En el almacenamiento local, que dura entre visitas. Nunca guarda otra cosa que `{ id, nombre }`.
export const CLAVE_DE_RECORDADOS = 'panel.clientes';

export type RecordadosGuardados = {
  lista(): Recordado[];
  // Cada uno devuelve la lista nueva, ya guardada.
  agregar(cliente: Recordado): Recordado[];
  quitar(id: string): Recordado[];
};

// Como la sesión: la lista vive en memoria y el almacenamiento la conserva. Si el navegador lo bloquea, se recuerda mientras la
// página está abierta.
export function crearRecordadosGuardados(almacenamiento: Almacenamiento | undefined): RecordadosGuardados {
  const intentar = <T>(accion: (a: Almacenamiento) => T): T | undefined => {
    if (almacenamiento === undefined) return undefined;
    try {
      return accion(almacenamiento);
    } catch {
      return undefined;
    }
  };

  let lista = leer(intentar((a) => a.getItem(CLAVE_DE_RECORDADOS)));
  const guardar = (nueva: Recordado[]) => {
    lista = nueva;
    intentar((a) => a.setItem(CLAVE_DE_RECORDADOS, escribir(lista)));
    return lista;
  };

  return {
    lista: () => lista,
    agregar: (cliente) => guardar(agregar(lista, cliente)),
    quitar: (id) => guardar(quitar(lista, id)),
  };
}

// ---- Entrar ----

export const nombreCompleto = ({ nombre, apellido }: { nombre: string; apellido: string }) => `${nombre} ${apellido}`;

// Con el perfil que M2 confirmó: se abre la sesión como ese cliente y se lo recuerda con el nombre de hoy.
function entrarComoCliente({ sesion, recordados }: Ingreso, cliente: { clienteId: string; nombre: string; apellido: string }): Sesion {
  sesion.iniciar('CLIENTE', cliente.clienteId);
  recordados.agregar({ id: cliente.clienteId, nombre: nombreCompleto(cliente) });
  return sesion.actual()!;
}

// «Entrar como cliente nuevo» (RF-2.1.5): el UUID y la clave los genera la pantalla al abrir el formulario y los conserva hasta
// que M2 contesta bien, así «Reintentar» tras un error o un tiempo agotado manda los mismos y no crea otro cliente.
export async function entrarComoNuevo(
  ingreso: Ingreso,
  { clienteId, campos, clave }: { clienteId: string; campos: CamposCliente; clave: string },
  opciones?: OpcionesDePedido,
): Promise<Sesion> {
  const cliente = await ingreso.apiPara({ rol: 'CLIENTE', sub: clienteId }).crearCliente(cuerpoDeAlta(campos), clave, opciones);
  return entrarComoCliente(ingreso, cliente);
}

export type Reingreso = { tipo: 'entro'; sesion: Sesion } | { tipo: 'ya-no-existe'; id: string };

// Un clic en un recordado (RF-2.1.6): se pide su perfil como él y, si existe, se entra. Un `404` es que M2 ya no lo tiene (la
// base se borró): no se entra y la pantalla lo marca «ya no existe» (RF-2.1.7). Cualquier otro error llega tal cual.
export async function volverAEntrar(ingreso: Ingreso, recordado: Recordado, opciones?: OpcionesDePedido): Promise<Reingreso> {
  try {
    const cliente = await ingreso.apiPara({ rol: 'CLIENTE', sub: recordado.id }).obtenerCliente(recordado.id, opciones);
    return { tipo: 'entro', sesion: entrarComoCliente(ingreso, cliente) };
  } catch (error) {
    if (error instanceof ErrorDeApi && error.estado === 404) return { tipo: 'ya-no-existe', id: recordado.id };
    throw error;
  }
}

const LARGO_MAXIMO_SUB = 128;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Lo que trae escrito el identificador al elegir cada rol. El CLIENTE no tiene uno: es el UUID de un cliente que ya existe.
export const IDENTIFICADOR_DE_EJEMPLO: Record<Rol, string> = {
  CLIENTE: '',
  OPERADOR: 'operador-1',
  SERVICIO: 'm5-despacho',
  CONDUCTOR: 'conductor-1',
};

// El `sub` del token tiene de 1 a 128 caracteres; el de un CLIENTE es su UUID, porque M2 lo compara con el de la ruta.
export function validarIdentificador(rol: Rol, texto: string): string | undefined {
  const limpio = texto.trim();
  if (limpio === '') return 'Escribí un identificador.';
  if (limpio.length > LARGO_MAXIMO_SUB) return `Hasta ${LARGO_MAXIMO_SUB} caracteres.`;
  if (rol === 'CLIENTE' && !UUID.test(limpio)) return 'Para entrar como CLIENTE, el identificador es el UUID de un cliente (por ejemplo, uno recordado).';
  return undefined;
}

// Elegir rol e identificador (RNF-12.9): se entra sin preguntar a M2. Si el cliente no existe, lo dice su pantalla con el `404`.
export function entrarConRol({ sesion }: Ingreso, rol: Rol, identificador: string): Sesion {
  const error = validarIdentificador(rol, identificador);
  if (error !== undefined) throw new Error(error);
  sesion.iniciar(rol, identificador.trim());
  return sesion.actual()!;
}
