import type { ApiM2, OpcionesDePedido } from '../api/m2.js';
import type { components } from '../generado/contrato.js';
import { validarCamposCliente, type CamposCliente, type ErroresDeCampos } from './campos-cliente.js';

// Lo que hace la pantalla `perfil` al guardar (RF-2.1.8), sin React: compara lo escrito con el perfil cargado, manda a M2 solo los
// campos distintos y, si no hay ninguno, no lo llama.

type Cliente = components['schemas']['Cliente'];
type ClienteCambios = components['schemas']['ClienteCambios'];

const CAMPOS = ['nombre', 'apellido', 'telefono', 'fechaNacimiento'] as const;

// Lo que trae escrito el formulario al abrir: el perfil de M2, con la fecha vacía si no la tiene.
export const camposDePerfil = (perfil: Cliente): CamposCliente => ({
  nombre: perfil.nombre,
  apellido: perfil.apellido,
  telefono: perfil.telefono,
  fechaNacimiento: perfil.fechaNacimiento ?? '',
});

// Los campos que cambiaron, sin espacios de más, o `undefined` si no cambió ninguno. Se comparan sin espacios de los dos lados: lo
// que M2 ya traía con espacios no cuenta como cambio si no se tocó. Una fecha vacía no es un cambio: el contrato no tiene cómo
// borrarla (`validarEdicion` avisa si el perfil la tenía).
export function calcularCambios(perfil: Cliente, campos: CamposCliente): ClienteCambios | undefined {
  const actuales = camposDePerfil(perfil);
  const cambios: ClienteCambios = {};
  for (const campo of CAMPOS) {
    const nuevo = campos[campo].trim();
    if (nuevo === '' && campo === 'fechaNacimiento') continue;
    if (nuevo !== actuales[campo].trim()) cambios[campo] = nuevo;
  }
  return Object.keys(cambios).length === 0 ? undefined : cambios;
}

// Las reglas del alta (RF-2.1.5), y que no se borre una fecha que el perfil ya tiene.
export function validarEdicion(perfil: Cliente, campos: CamposCliente): ErroresDeCampos {
  const errores = validarCamposCliente(campos);
  if (perfil.fechaNacimiento !== undefined && campos.fechaNacimiento.trim() === '') {
    errores.fechaNacimiento = 'M2 no permite borrar la fecha de nacimiento: escribí otra.';
  }
  return errores;
}

export type ResultadoDeGuardar = { tipo: 'sin-cambios' } | { tipo: 'guardado'; perfil: Cliente };

// «Guardar»: un pedido con los campos distintos, o ninguno. Si M2 rechaza, el error llega tal cual (RF-2.1.9).
export async function guardarCambios(api: ApiM2, perfil: Cliente, campos: CamposCliente, opciones?: OpcionesDePedido): Promise<ResultadoDeGuardar> {
  const cambios = calcularCambios(perfil, campos);
  if (cambios === undefined) return { tipo: 'sin-cambios' };
  return { tipo: 'guardado', perfil: await api.actualizarCliente(perfil.clienteId, cambios, opciones) };
}
