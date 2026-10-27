import type { ApiM2, OpcionesDePedido } from '../api/m2.js';
import type { components } from '../generado/contrato.js';

// Los datos de una dirección frecuente tal como se escriben en el formulario (RF-2.2.6), sin React: las validaciones con los límites
// del contrato, el cuerpo del alta y lo que se manda al editar. M2 vuelve a comprobar todo.

type Esquemas = components['schemas'];
type Direccion = Esquemas['Direccion'];
type DireccionCambios = Esquemas['DireccionCambios'];

export type TipoDeDireccion = Esquemas['TipoDireccion'];
export const TIPOS_DE_DIRECCION: { valor: TipoDeDireccion; etiqueta: string }[] = [
  { valor: 'FAVORITA', etiqueta: 'Favorita' },
  { valor: 'RECIENTE', etiqueta: 'Reciente' },
];

// Un texto por casillero; las coordenadas, como se escriben (con punto o con coma).
export type CamposDireccion = { tipo: TipoDeDireccion; alias: string; texto: string; latitud: string; longitud: string };
export type ErroresDeDireccion = Partial<Record<keyof CamposDireccion, string>>;

export const LARGO_MAXIMO_ALIAS = 50;
export const LARGO_MAXIMO_TEXTO = 255;
const NUMERO = /^[+-]?\d+(\.\d+)?$/;

export const DIRECCION_NUEVA: CamposDireccion = { tipo: 'FAVORITA', alias: '', texto: '', latitud: '', longitud: '' };

// Un número escrito con punto o con coma, o `undefined` si no lo es. Nada de notación científica, hexadecimal ni infinitos.
function comoNumero(texto: string): number | undefined {
  const limpio = texto.trim().replace(',', '.');
  return NUMERO.test(limpio) ? Number(limpio) : undefined;
}

function errorDeCoordenada(texto: string, eje: 'latitud' | 'longitud'): string | undefined {
  const numero = comoNumero(texto);
  if (numero === undefined) return 'Escribí un número, por ejemplo -27.45.';
  const limite = eje === 'latitud' ? 90 : 180;
  return Math.abs(numero) > limite ? `Entre -${limite} y ${limite}.` : undefined;
}

// Un mensaje por campo con problema; sin problemas, un objeto vacío. Al editar, `actual` es la dirección de M2: el contrato no puede
// quitar las coordenadas que ya tiene, así que vaciarlas es un error y no un cambio.
export function validarDireccion(campos: CamposDireccion, actual?: Direccion): ErroresDeDireccion {
  const errores: ErroresDeDireccion = {};
  if (!TIPOS_DE_DIRECCION.some(({ valor }) => valor === campos.tipo)) errores.tipo = 'Elegí favorita o reciente.';

  const texto = campos.texto.trim();
  if (texto === '') errores.texto = 'El texto de la dirección es obligatorio.';
  else if (texto.length > LARGO_MAXIMO_TEXTO) errores.texto = `Hasta ${LARGO_MAXIMO_TEXTO} caracteres.`;
  if (campos.alias.trim().length > LARGO_MAXIMO_ALIAS) errores.alias = `Hasta ${LARGO_MAXIMO_ALIAS} caracteres.`;

  const latitud = campos.latitud.trim();
  const longitud = campos.longitud.trim();
  if (latitud === '' && longitud === '') {
    if (actual?.coordenadas !== undefined) errores.latitud = 'M2 no permite quitar las coordenadas: escribilas de nuevo o cambialas.';
  } else if (latitud === '') errores.latitud = 'Completá la latitud, o dejá las dos vacías.';
  else if (longitud === '') errores.longitud = 'Completá la longitud, o dejá las dos vacías.';
  else {
    const errorLatitud = errorDeCoordenada(latitud, 'latitud');
    const errorLongitud = errorDeCoordenada(longitud, 'longitud');
    if (errorLatitud !== undefined) errores.latitud = errorLatitud;
    if (errorLongitud !== undefined) errores.longitud = errorLongitud;
  }
  return errores;
}

// Las coordenadas escritas como números, o `undefined` si no hay (las dos vacías) o no se pueden leer.
function coordenadasDe({ latitud, longitud }: CamposDireccion): { latitud: number; longitud: number } | undefined {
  const lat = comoNumero(latitud);
  const lon = comoNumero(longitud);
  return lat === undefined || lon === undefined ? undefined : { latitud: lat, longitud: lon };
}

// El cuerpo de `crearDireccion`: lo escrito sin espacios de más, el alias solo si se escribió y las coordenadas solo si están las dos.
export function cuerpoDeDireccion(campos: CamposDireccion): Esquemas['DireccionNueva'] {
  const alias = campos.alias.trim();
  const coordenadas = coordenadasDe(campos);
  return {
    tipo: campos.tipo,
    ...(alias === '' ? {} : { alias }),
    texto: campos.texto.trim(),
    ...(coordenadas === undefined ? {} : { coordenadas }),
  };
}

// Lo que trae escrito el formulario al editar: la dirección de M2, con lo que falte vacío.
export const camposDeDireccion = (direccion: Direccion): CamposDireccion => ({
  tipo: direccion.tipo,
  alias: direccion.alias ?? '',
  texto: direccion.texto,
  latitud: direccion.coordenadas === undefined ? '' : String(direccion.coordenadas.latitud),
  longitud: direccion.coordenadas === undefined ? '' : String(direccion.coordenadas.longitud),
});

// Los campos que cambiaron, o `undefined` si no cambió ninguno. Vaciar el alias es un cambio (M2 lo guarda vacío); vaciar las
// coordenadas no lo es (`validarDireccion` avisa). Las coordenadas se mandan juntas.
export function calcularCambiosDireccion(direccion: Direccion, campos: CamposDireccion): DireccionCambios | undefined {
  const cambios: DireccionCambios = {};
  if (campos.tipo !== direccion.tipo) cambios.tipo = campos.tipo;
  const alias = campos.alias.trim();
  if (alias !== (direccion.alias ?? '').trim()) cambios.alias = alias;
  const texto = campos.texto.trim();
  if (texto !== direccion.texto.trim()) cambios.texto = texto;
  const coordenadas = coordenadasDe(campos);
  const actual = direccion.coordenadas;
  if (coordenadas !== undefined && (actual === undefined || coordenadas.latitud !== actual.latitud || coordenadas.longitud !== actual.longitud)) {
    cambios.coordenadas = coordenadas;
  }
  return Object.keys(cambios).length === 0 ? undefined : cambios;
}

export type ResultadoDeGuardarDireccion = { tipo: 'sin-cambios' } | { tipo: 'guardada'; direccion: Direccion };

// «Guardar»: un pedido con los campos distintos, o ninguno. Si M2 rechaza, el error llega tal cual.
export async function guardarDireccion(
  api: ApiM2,
  clienteId: string,
  direccion: Direccion,
  campos: CamposDireccion,
  opciones?: OpcionesDePedido,
): Promise<ResultadoDeGuardarDireccion> {
  const cambios = calcularCambiosDireccion(direccion, campos);
  if (cambios === undefined) return { tipo: 'sin-cambios' };
  return { tipo: 'guardada', direccion: await api.actualizarDireccion(clienteId, direccion.direccionId, cambios, opciones) };
}

// El orden de los casilleros del formulario y el primero con error, al que va el foco al intentar enviar.
export const ORDEN_DE_CAMPOS_DE_DIRECCION: readonly (keyof CamposDireccion)[] = ['tipo', 'alias', 'texto', 'latitud', 'longitud'];
export const primerCampoDeDireccionConError = (errores: ErroresDeDireccion): keyof CamposDireccion | undefined =>
  ORDEN_DE_CAMPOS_DE_DIRECCION.find((campo) => errores[campo] !== undefined);
