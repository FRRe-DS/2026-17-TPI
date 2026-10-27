import {
  LARGO_MAXIMO_NOMBRE,
  ORDEN_DE_CAMPOS,
  type CamposCliente,
  type ErroresDeCampos,
} from '../logica/campos-cliente.js';
import { Campo } from './formulario.js';

const ETIQUETAS: Record<keyof CamposCliente, string> = {
  nombre: 'Nombre',
  apellido: 'Apellido',
  telefono: 'Teléfono',
  fechaNacimiento: 'Fecha de nacimiento (opcional)',
};

type Props = {
  // El prefijo de los ids: el casillero de `nombre` es `{id}-nombre`, al que el formulario manda el foco si tiene un error.
  id: string;
  campos: CamposCliente;
  errores: ErroresDeCampos;
  alCambiar: (campo: keyof CamposCliente, valor: string) => void;
};

// Los cuatro casilleros de los datos del cliente, los mismos al darlo de alta (`ingresar`) y al editar su perfil (`perfil`).
export function CamposDeCliente({ id, campos, errores, alCambiar }: Props) {
  return ORDEN_DE_CAMPOS.map((campo, indice) => (
    <Campo
      key={campo}
      id={`${id}-${campo}`}
      numero={indice + 1}
      etiqueta={ETIQUETAS[campo]}
      valor={campos[campo]}
      alCambiar={(valor) => alCambiar(campo, valor)}
      error={errores[campo]}
      tipo={campo === 'telefono' ? 'tel' : campo === 'fechaNacimiento' ? 'date' : 'text'}
      maximo={campo === 'nombre' || campo === 'apellido' ? LARGO_MAXIMO_NOMBRE : undefined}
      ayuda={campo === 'telefono' ? 'Formato E.164, por ejemplo +5493624000000.' : undefined}
      requerido={campo !== 'fechaNacimiento'}
      // Son datos de prueba: el navegador no tiene que ofrecer los de quien evalúa.
      autoComplete="off"
    />
  ));
}
