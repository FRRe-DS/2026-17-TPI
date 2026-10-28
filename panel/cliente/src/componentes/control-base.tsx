import type { DatosDeError } from '../api/errores.js';
import type { Disponibilidad } from '../api/panel.js';
import { modeloControlBase, textoDeSalud, type EstadoSalud } from '../logica/salud-en-vivo.js';
import { BotonAccion } from './boton-accion.js';
import { ErrorDeM2 } from './error-de-m2.js';
import seccion from './seccion-demostracion.module.css';
import estilos from './control-base.module.css';

type Props = {
  // `undefined` mientras se consulta si el panel puede usar Docker.
  docker: Disponibilidad | undefined;
  salud: EstadoSalud;
  // La clave del cerrojo de la vista: lo que está corriendo, o nada.
  activa: string | undefined;
  // El comando de encender falló: el error completo, con «Reintentar».
  error?: DatosDeError | undefined;
  // Abre la confirmación: apagar deja a M2 sin base para cualquiera que lo esté usando.
  alApagar: () => void;
  alEncender: () => void;
};

// La sección «Base de datos» de la vista «Demostración» (spec 072, T16, RNF-13.4, RNF-13.6, RNF-15.6): «Apagar la base» y «Encender
// la base», y debajo la salud de M2 en vivo. Sin Docker, los dos botones quedan deshabilitados con el motivo y cómo activarlos, en el
// mismo lugar donde estaría la salud; el resto de la vista no se entera.
export function ControlBase({ docker, salud, activa, error, alApagar, alEncender }: Props) {
  const modelo = modeloControlBase(docker, salud, activa);

  return (
    <section className={seccion.seccion} aria-labelledby="demo-base">
      <h2 id="demo-base" className={seccion.subtitulo}>
        Base de datos
      </h2>
      <p className={seccion.nota}>
        «Apagar la base» ejecuta <code>docker compose stop bd</code>: M2 se queda sin base y su salud pasa a 503. «Encender la base» ejecuta{' '}
        <code>docker compose start bd</code> y espera hasta 60 s a que vuelva a 200. Mientras tanto, la salud se consulta cada 2 s.
      </p>
      <div className={estilos.control}>
        <div className={estilos.acciones}>
          <BotonAccion
            variante="peligro"
            esperando={modelo.apagar.esperando}
            textoEsperando="Apagando…"
            deshabilitado={modelo.apagar.deshabilitado}
            onClick={alApagar}
          >
            Apagar la base
          </BotonAccion>
          <BotonAccion
            variante="contorno"
            esperando={modelo.encender.esperando}
            textoEsperando="Encendiendo…"
            deshabilitado={modelo.encender.deshabilitado}
            onClick={alEncender}
          >
            Encender la base
          </BotonAccion>
        </div>
        <div className={modelo.aviso === undefined ? estilos[modelo.tono] : estilos.sinDocker}>
          {/* Una sola región que se anuncia: primero «consultando», después la salud o el motivo. */}
          <p role="status" aria-live="polite" className={estilos.texto}>
            {modelo.aviso?.texto ?? textoDeSalud(salud)}
          </p>
          {modelo.aviso?.comoActivar !== undefined && <p className={estilos.comoActivar}>{modelo.aviso.comoActivar}</p>}
        </div>
      </div>
      {error !== undefined && (
        <div role="alert">
          <ErrorDeM2 error={error} alReintentar={alEncender} esperando={modelo.encender.esperando} mensaje="No se pudo encender la base." />
        </div>
      )}
    </section>
  );
}
