import {
  LARGO_MAXIMO_ALIAS,
  LARGO_MAXIMO_TEXTO,
  TIPOS_DE_DIRECCION,
  type CamposDireccion,
  type ErroresDeDireccion,
  type TipoDeDireccion,
} from '../logica/direcciones.js';
import { Campo } from './formulario.js';

type Props = {
  // El prefijo de los ids: el casillero de `texto` es `{id}-texto`, al que el formulario manda el foco si tiene un error.
  id: string;
  campos: CamposDireccion;
  errores: ErroresDeDireccion;
  alCambiar: (campo: keyof CamposDireccion, valor: string) => void;
};

// Los casilleros de una dirección, los mismos al crearla y al editarla (RF-2.2.6). El texto va en el medio, de ancho completo.
export function CamposDeDireccion({ id, campos, errores, alCambiar }: Props) {
  const campo = (nombre: keyof CamposDireccion) => ({ id: `${id}-${nombre}`, valor: campos[nombre], error: errores[nombre], alCambiar: (valor: string) => alCambiar(nombre, valor) });
  return (
    <>
      <Campo {...campo('tipo')} numero={1} etiqueta="Tipo" opciones={TIPOS_DE_DIRECCION.map(({ valor, etiqueta }) => ({ valor: valor satisfies TipoDeDireccion, etiqueta }))} />
      <Campo {...campo('alias')} numero={2} etiqueta="Alias (opcional)" maximo={LARGO_MAXIMO_ALIAS} ayuda="Un nombre corto, por ejemplo «Casa»." autoComplete="off" />
      <Campo {...campo('texto')} numero={3} etiqueta="Dirección" maximo={LARGO_MAXIMO_TEXTO} multilinea requerido autoComplete="off" />
      <Campo {...campo('latitud')} numero={4} etiqueta="Latitud (opcional)" teclado="decimal" ayuda="Entre -90 y 90, por ejemplo -27.45." autoComplete="off" />
      <Campo {...campo('longitud')} numero={5} etiqueta="Longitud (opcional)" teclado="decimal" ayuda="Entre -180 y 180, por ejemplo -58.98." autoComplete="off" />
    </>
  );
}
