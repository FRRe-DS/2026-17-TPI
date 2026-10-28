import { useId, useState } from 'react';
import type { ApiM2 } from '../api/m2.js';
import { Aviso } from '../componentes/aviso.js';
import { BotonAccion } from '../componentes/boton-accion.js';
import { EstadoPantalla } from '../componentes/estado-pantalla.js';
import { Campo, Formulario, GrupoDeOpciones } from '../componentes/formulario.js';
import { Titulo } from '../componentes/titulo.js';
import type { Sesion } from '../fuentes/fuente-de-sesion.js';
import { usarAccion } from '../hooks/usar-accion.js';
import { usarCarga } from '../hooks/usar-carga.js';
import {
  alternarOpcion,
  CANALES,
  camposDePreferencias,
  cuerpoDePreferencias,
  LARGO_MAXIMO_OBSERVACIONES,
  NECESIDADES_DE_ACCESIBILIDAD,
  TIPOS_DE_VEHICULO,
  validarPreferencias,
  type CamposPreferencias,
  type Opcion,
  type Preferencias,
} from '../logica/preferencias.js';
import { TITULOS } from '../rutas.js';
import estilos from './preferencias.module.css';

type Props = { api: ApiM2; sesion: Sesion };

// Las preferencias del cliente (RF-2.3.6): se cargan con `obtenerPreferencias` (vacías si nunca las guardó) y se guardan con
// `guardarPreferencias`, eligiendo solo valores del contrato.
export function PantallaPreferencias({ api, sesion }: Props) {
  const { estado, reintentar } = usarCarga((senal) => api.obtenerPreferencias(sesion.sub, { senal }), [api, sesion.sub]);

  return (
    <>
      <Titulo>{TITULOS.preferencias}</Titulo>
      <EstadoPantalla estado={estado} vacio="No hay preferencias para mostrar." alReintentar={reintentar}>
        {(preferencias) => <EditarPreferencias key={sesion.sub} api={api} sesion={sesion} inicial={preferencias} />}
      </EstadoPantalla>
    </>
  );
}

function EditarPreferencias({ api, sesion, inicial }: { api: ApiM2; sesion: Sesion; inicial: Preferencias }) {
  const id = useId();
  // Lo guardado: las de la carga, o las que devolvió el último guardado.
  const [guardadas, setGuardadas] = useState(inicial);
  const [campos, setCampos] = useState<CamposPreferencias>(() => camposDePreferencias(inicial));
  const [intentado, setIntentado] = useState(false);
  const errores = intentado ? validarPreferencias(campos) : {};

  const { estado, esperando, enviar, reintentar, reiniciar } = usarAccion({
    ejecutar: async ({ senal }, escritos: CamposPreferencias) => {
      const devueltas = await api.guardarPreferencias(sesion.sub, cuerpoDePreferencias(escritos), { senal });
      setGuardadas(devueltas);
      setCampos(camposDePreferencias(devueltas));
      setIntentado(false);
      return devueltas;
    },
    aviso: 'Preferencias guardadas.',
  });

  const alEnviar = () => {
    setIntentado(true);
    if (validarPreferencias(campos).observaciones !== undefined) return document.getElementById(`${id}-observaciones`)?.focus();
    void enviar(campos);
  };
  // Seguir cambiando después de guardar borra el aviso viejo; lo escrito no se toca.
  const cambiar = (nuevos: Partial<CamposPreferencias>) => {
    if (estado.fase === 'hecha') reiniciar();
    setCampos((previos) => ({ ...previos, ...nuevos }));
  };
  const grupo = (clave: 'tiposVehiculo' | 'canales' | 'accesibilidad', opciones: Opcion[]) => (valor: string, marcado: boolean) =>
    cambiar({ [clave]: alternarOpcion(opciones, campos[clave], valor, marcado) });
  const descartar = () => {
    if (esperando) return;
    reiniciar();
    setIntentado(false);
    setCampos(camposDePreferencias(guardadas));
  };
  const error = estado.fase === 'fallida' ? estado.error : undefined;
  // Un 400 se corrige escribiendo otra cosa; repetir el mismo pedido solo sirve si M2 no contestó o falló por su cuenta.
  const sePuedeReintentar = error !== undefined && (error.sinRespuesta || error.estado >= 500);

  return (
    <div className={estilos.preferencias}>
      <Formulario
        titulo="Cómo querés viajar"
        alEnviar={alEnviar}
        error={error}
        alReintentar={sePuedeReintentar ? reintentar : undefined}
        acciones={
          <>
            <BotonAccion variante="contorno" esperando={false} onClick={descartar}>
              Restablecer
            </BotonAccion>
            <BotonAccion tipo="submit" esperando={esperando} textoEsperando="Guardando…">
              Guardar preferencias
            </BotonAccion>
          </>
        }
      >
        <GrupoDeOpciones
          id={`${id}-vehiculo`}
          numero={1}
          etiqueta="Tipo de vehículo"
          ayuda="Sin marcar ninguno, M2 entiende que aceptás cualquiera."
          opciones={TIPOS_DE_VEHICULO}
          seleccionados={campos.tiposVehiculo}
          alCambiar={grupo('tiposVehiculo', TIPOS_DE_VEHICULO)}
        />
        <GrupoDeOpciones
          id={`${id}-canales`}
          numero={2}
          etiqueta="Avisos por"
          ayuda="Sin marcar ninguno, no se te manda ningún aviso opcional."
          opciones={CANALES}
          seleccionados={campos.canales}
          alCambiar={grupo('canales', CANALES)}
        />
        <GrupoDeOpciones
          id={`${id}-accesibilidad`}
          numero={3}
          etiqueta="Accesibilidad"
          opciones={NECESIDADES_DE_ACCESIBILIDAD}
          seleccionados={campos.accesibilidad}
          alCambiar={grupo('accesibilidad', NECESIDADES_DE_ACCESIBILIDAD)}
        />
        <Campo
          id={`${id}-observaciones`}
          numero={4}
          etiqueta="Observaciones de accesibilidad (opcional)"
          valor={campos.observaciones}
          alCambiar={(observaciones) => cambiar({ observaciones })}
          error={errores.observaciones}
          ayuda={`${campos.observaciones.trim().length} de ${LARGO_MAXIMO_OBSERVACIONES} caracteres.`}
          maximo={undefined}
          multilinea
          autoComplete="off"
        />
      </Formulario>
      <Aviso estado={estado} />
    </div>
  );
}
