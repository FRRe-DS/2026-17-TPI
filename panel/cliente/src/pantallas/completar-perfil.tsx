import { useId, useState } from 'react';
import type { ApiM2 } from '../api/m2.js';
import { Titulo } from '../componentes/titulo.js';
import { Formulario } from '../componentes/formulario.js';
import { CamposDeCliente } from '../componentes/campos-de-cliente.js';
import { BotonAccion } from '../componentes/boton-accion.js';
import { usarAccion } from '../hooks/usar-accion.js';
import { cuerpoDeAlta, validarCamposCliente, primerCampoConError, type CamposCliente } from '../logica/campos-cliente.js';
import { crearAltaPropia } from '../logica/primer-perfil.js';
export function CompletarPerfil({ api, sub, alCompletar }: { api: ApiM2; sub: string; alCompletar: () => void }) {
  const id = useId(); const [alta] = useState(() => crearAltaPropia(api, sub));
  const [campos, escribir] = useState<CamposCliente>({ nombre: '', apellido: '', telefono: '', fechaNacimiento: '' });
  const [intentado, intentar] = useState(false);
  const { estado, esperando, enviar } = usarAccion({ ejecutar: async (_contexto, escritos: CamposCliente) => {
    await alta.enviar(cuerpoDeAlta(escritos)); alCompletar();
  }, aviso: 'Perfil creado.' });
  const enviarCampos = () => { intentar(true); const primero = primerCampoConError(validarCamposCliente(campos));
    if (primero) { document.getElementById(`${id}-${primero}`)?.focus(); return; } void enviar(campos); };
  return <><Titulo>Completar perfil</Titulo><p>Completá tus datos para usar Mi cuenta.</p>
    <Formulario titulo="Tus datos" alEnviar={enviarCampos} error={estado.fase === 'fallida' ? estado.error : undefined}
      acciones={<BotonAccion tipo="submit" esperando={esperando} textoEsperando="Guardando…">Completar perfil</BotonAccion>}>
      <CamposDeCliente id={id} campos={campos} errores={intentado ? validarCamposCliente(campos) : {}}
        alCambiar={(campo, valor) => escribir(previos => ({ ...previos, [campo]: valor }))} />
    </Formulario></>;
}
