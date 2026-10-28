import { useId, useState } from 'react';
import { validarBusqueda } from '../logica/bloqueos.js';
import { BotonAccion } from './boton-accion.js';
import { Campo, Formulario } from './formulario.js';

type Props = { titulo: string; boton: string; alBuscar: (clienteId: string) => void };

// «Buscar un cliente por su UUID» (RF-2.6.6, RF-2.6.7): valida el formato antes de llamar a M2 y entrega el UUID en minúscula.
// Lo usan la vista del operador y la de otro módulo.
export function BuscarCliente({ titulo, boton, alBuscar }: Props) {
  const id = useId();
  const [texto, setTexto] = useState('');
  const [intentado, setIntentado] = useState(false);

  const enviar = () => {
    setIntentado(true);
    if (validarBusqueda(texto) !== undefined) return document.getElementById(`${id}-cliente`)?.focus();
    alBuscar(texto.trim().toLowerCase());
  };

  return (
    <Formulario
      titulo={titulo}
      alEnviar={enviar}
      acciones={
        <BotonAccion tipo="submit" esperando={false}>
          {boton}
        </BotonAccion>
      }
    >
      <Campo
        id={`${id}-cliente`}
        numero={1}
        etiqueta="UUID del cliente"
        valor={texto}
        alCambiar={setTexto}
        error={intentado ? validarBusqueda(texto) : undefined}
        ayuda="El identificador que M2 le dio al crear su perfil."
        autoComplete="off"
        completo
      />
    </Formulario>
  );
}
