import type { components } from '../generado/contrato.js';

// Los datos del perfil tal como se escriben en el formulario (RF-2.1.5; el perfil los reutiliza en T20): un texto por casillero,
// la fecha vacía si no se completa. Las reglas son las de `ClienteNuevo` del contrato, más la de M2 sobre el año 0000 (RF-2.1.4);
// M2 las vuelve a comprobar. Un nombre de puros espacios cumple el contrato, pero el panel lo toma como vacío.
export type CamposCliente = { nombre: string; apellido: string; telefono: string; fechaNacimiento: string };
export type ErroresDeCampos = Partial<Record<keyof CamposCliente, string>>;

export const LARGO_MAXIMO_NOMBRE = 100;
// El orden de los casilleros del formulario, el del contrato.
export const ORDEN_DE_CAMPOS: readonly (keyof CamposCliente)[] = ['nombre', 'apellido', 'telefono', 'fechaNacimiento'];

// El primer casillero con error, al que va el foco al intentar enviar.
export const primerCampoConError = (errores: ErroresDeCampos): keyof CamposCliente | undefined =>
  ORDEN_DE_CAMPOS.find((campo) => errores[campo] !== undefined);
const TELEFONO = /^\+[1-9][0-9]{6,14}$/;
const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

// Lo que trae escrito el formulario de alta: se puede cambiar antes de entrar.
export const CLIENTE_DE_EJEMPLO: CamposCliente = { nombre: 'Ana', apellido: 'Gómez', telefono: '+5493624000000', fechaNacimiento: '1990-05-14' };

function errorDeFecha(texto: string): string | undefined {
  const partes = FECHA.exec(texto);
  if (partes === null) return 'La fecha va como AAAA-MM-DD.';
  const [año, mes, dia] = partes.slice(1).map(Number) as [number, number, number];
  if (año === 0) return 'La fecha tiene que ser del año 0001 o posterior.';
  // `setUTCFullYear` y no `Date.UTC`, que toma los años 0 a 99 como 1900 a 1999.
  const fecha = new Date(0);
  fecha.setUTCFullYear(año, mes - 1, dia);
  return fecha.getUTCFullYear() === año && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia ? undefined : 'Esa fecha no existe.';
}

function errorDeNombre(texto: string, campo: string): string | undefined {
  const limpio = texto.trim();
  if (limpio === '') return `${campo} es obligatorio.`;
  return limpio.length > LARGO_MAXIMO_NOMBRE ? `Hasta ${LARGO_MAXIMO_NOMBRE} caracteres.` : undefined;
}

// Un mensaje por campo con problema; sin problemas, un objeto vacío.
export function validarCamposCliente(campos: CamposCliente): ErroresDeCampos {
  const fecha = campos.fechaNacimiento.trim();
  const errores: ErroresDeCampos = {
    nombre: errorDeNombre(campos.nombre, 'El nombre'),
    apellido: errorDeNombre(campos.apellido, 'El apellido'),
    telefono: TELEFONO.test(campos.telefono.trim())
      ? undefined
      : 'Formato E.164: un + y de 7 a 15 dígitos, sin espacios.',
    fechaNacimiento: fecha === '' ? undefined : errorDeFecha(fecha),
  };
  return Object.fromEntries(Object.entries(errores).filter(([, error]) => error !== undefined));
}

// El cuerpo de `crearCliente`: lo escrito sin espacios de más, y la fecha solo si se completó.
export function cuerpoDeAlta(campos: CamposCliente): components['schemas']['ClienteNuevo'] {
  const fecha = campos.fechaNacimiento.trim();
  return {
    nombre: campos.nombre.trim(),
    apellido: campos.apellido.trim(),
    telefono: campos.telefono.trim(),
    ...(fecha === '' ? {} : { fechaNacimiento: fecha }),
  };
}
