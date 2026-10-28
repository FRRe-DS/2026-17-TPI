import { useId, useState } from 'react';
import type { ApiM2 } from '../api/m2.js';
import { Aviso } from '../componentes/aviso.js';
import { BotonAccion } from '../componentes/boton-accion.js';
import { DependenciaNoDisponible } from '../componentes/dependencia-no-disponible.js';
import { Campo, Formulario, GrupoDeOpciones } from '../componentes/formulario.js';
import { Titulo } from '../componentes/titulo.js';
import type { Sesion } from '../fuentes/fuente-de-sesion.js';
import { usarAccion } from '../hooks/usar-accion.js';
import { usarClaveDeIdempotencia } from '../hooks/usar-clave-idempotencia.js';
import type { components } from '../generado/contrato.js';
import {
  CALIFICACION_NUEVA,
  cuerpoDeCalificacion,
  LARGO_MAXIMO_COMENTARIO,
  PUNTAJES,
  validarCalificacion,
  type CamposCalificacion,
} from '../logica/calificacion.js';
import type { EstadoAccion } from '../logica/estados.js';
import { instante } from '../logica/historial.js';
import { mensajeDeCalificacion } from '../logica/mensajes.js';
import { enlace, TITULOS } from '../rutas.js';
import estilos from './calificar.module.css';

type Calificacion = components['schemas']['Calificacion'];
type Props = { api: ApiM2; sesion: Sesion; viajeId: string };

// Calificar al conductor de un viaje (RF-2.5.15, RF-2.5.16): `#/calificar/{viajeId}`. La `Idempotency-Key` se genera al abrir el
// formulario y se conserva ante un error o un tiempo agotado, así «Reintentar» (y volver a enviar tras un corte) no califica dos
// veces; se descarta al enviar bien o al cerrar la pantalla. Mientras espera, el botón está deshabilitado: dos toques son un pedido.
export function Calificar({ api, sesion, viajeId }: Props) {
  const id = useId();
  const clave = usarClaveDeIdempotencia();
  const [campos, setCampos] = useState<CamposCalificacion>(CALIFICACION_NUEVA);
  const [intentado, setIntentado] = useState(false);
  const errores = intentado ? validarCalificacion(campos) : {};

  const { estado, esperando, enviar, reintentar } = usarAccion({
    ejecutar: ({ clave: idempotencia, senal }, escritos: CamposCalificacion) =>
      api.calificarConductor(sesion.sub, cuerpoDeCalificacion(viajeId, escritos), idempotencia!, { senal }),
    aviso: 'Calificación enviada.',
    clave,
  });

  const alEnviar = () => {
    setIntentado(true);
    const { puntaje, comentario } = validarCalificacion(campos);
    if (puntaje !== undefined) return document.querySelector<HTMLInputElement>(`input[name="${id}-puntaje"]`)?.focus();
    if (comentario !== undefined) return document.getElementById(`${id}-comentario`)?.focus();
    void enviar(campos);
  };

  const error = estado.fase === 'fallida' ? estado.error : undefined;
  const dependencia = error?.estado === 503;
  // Un rechazo de M2 se corrige cambiando algo; repetir el mismo pedido solo sirve si M2 no contestó o falló por su cuenta.
  const sePuedeReintentar = error !== undefined && (error.sinRespuesta || error.estado >= 500);

  if (estado.fase === 'hecha') return <Enviada calificacion={estado.resultado} estado={estado} />;

  return (
    <>
      <Titulo>{TITULOS.calificar}</Titulo>
      <div className={estilos.calificar}>
        <p className={estilos.viaje}>
          Viaje <span className={estilos.dato}>{viajeId}</span>
        </p>
        <Formulario
          titulo="Tu calificación"
          alEnviar={alEnviar}
          error={dependencia ? undefined : error}
          mensajeDelError={error === undefined ? undefined : mensajeDeCalificacion(error)}
          alReintentar={sePuedeReintentar ? reintentar : undefined}
          acciones={
            <BotonAccion tipo="submit" esperando={esperando} textoEsperando="Enviando…">
              Enviar calificación
            </BotonAccion>
          }
        >
          <GrupoDeOpciones
            id={`${id}-puntaje`}
            numero={1}
            etiqueta="Puntaje"
            ayuda="De 1 (la peor) a 5 (la mejor)."
            opciones={PUNTAJES}
            seleccionados={campos.puntaje === '' ? [] : [campos.puntaje]}
            alCambiar={(valor, marcado) => marcado && setCampos((previos) => ({ ...previos, puntaje: valor }))}
            unica
            error={errores.puntaje}
          />
          <Campo
            id={`${id}-comentario`}
            numero={2}
            etiqueta="Comentario (opcional)"
            valor={campos.comentario}
            alCambiar={(comentario) => setCampos((previos) => ({ ...previos, comentario }))}
            error={errores.comentario}
            ayuda={`${campos.comentario.trim().length} de ${LARGO_MAXIMO_COMENTARIO} caracteres.`}
            multilinea
            autoComplete="off"
          />
        </Formulario>
        {dependencia && error !== undefined && <DependenciaNoDisponible error={error} que="Calificar" alReintentar={reintentar} />}
        <Aviso estado={estado} />
      </div>
    </>
  );
}

// La calificación que guardó M2: se muestra lo que devolvió y se ofrece seguir. El formulario ya no está, así que no hay cómo enviar
// otra vez la misma.
function Enviada({ calificacion, estado }: { calificacion: Calificacion; estado: EstadoAccion<unknown> }) {
  return (
    <>
      <Titulo>{TITULOS.calificar}</Titulo>
      <div className={estilos.calificar}>
        <Aviso estado={estado} />
        <section className={estilos.hoja} aria-label="Calificación enviada">
          <dl className={estilos.filas}>
            <div className={estilos.fila}>
              <dt>Puntaje</dt>
              <dd>{calificacion.puntaje} de 5</dd>
            </div>
            {calificacion.comentario !== undefined && (
              <div className={estilos.fila}>
                <dt>Comentario</dt>
                <dd>{calificacion.comentario}</dd>
              </div>
            )}
            <div className={estilos.fila}>
              <dt>Viaje</dt>
              <dd className={estilos.dato}>{calificacion.viajeId}</dd>
            </div>
            <div className={estilos.fila}>
              <dt>Enviada</dt>
              <dd className={estilos.dato}>{instante(calificacion.creadoEn)}</dd>
            </div>
          </dl>
        </section>
        <div className={estilos.siguientes}>
          <a className={estilos.enlace} href={enlace('historial')}>
            Volver al historial
          </a>
          <a className={estilos.enlace} href={enlace('calificaciones', calificacion.calificacionId)}>
            Ver mi calificación
          </a>
        </div>
      </div>
    </>
  );
}
