import { useState } from 'react';
import type { ApiM2 } from '../api/m2.js';
import { ErrorDeM2 } from '../componentes/error-de-m2.js';
import { EstadoPantalla } from '../componentes/estado-pantalla.js';
import { Paginacion } from '../componentes/paginacion.js';
import { Titulo } from '../componentes/titulo.js';
import type { Sesion } from '../fuentes/fuente-de-sesion.js';
import { usarCarga } from '../hooks/usar-carga.js';
import type { components } from '../generado/contrato.js';
import { mensajeDeDetalle, textoDePuntaje } from '../logica/calificaciones.js';
import { instante } from '../logica/historial.js';
import { TAMANO_DE_PAGINA } from '../logica/paginacion.js';
import { enlace, TITULOS } from '../rutas.js';
import estilos from './calificaciones.module.css';

type Calificacion = components['schemas']['Calificacion'];
type Props = { api: ApiM2; sesion: Sesion; idCalificacion?: string | undefined };

// Las calificaciones que hizo el cliente (RF-2.5.17): `#/calificaciones` las lista paginadas y `#/calificaciones/{id}` muestra una.
export function Calificaciones({ api, sesion, idCalificacion }: Props) {
  return idCalificacion === undefined ? <Lista api={api} sesion={sesion} /> : <Detalle api={api} sesion={sesion} idCalificacion={idCalificacion} />;
}

function Lista({ api, sesion }: { api: ApiM2; sesion: Sesion }) {
  const [pagina, setPagina] = useState(0);
  const { estado, reintentar } = usarCarga(
    (senal) => api.listarCalificaciones(sesion.sub, { page: pagina, size: TAMANO_DE_PAGINA }, { senal }),
    [api, sesion.sub, pagina],
    (datos) => datos.totalElementos === 0,
  );

  return (
    <>
      <Titulo>{TITULOS.calificaciones}</Titulo>
      <EstadoPantalla
        estado={estado}
        vacio="Todavía no calificaste ningún viaje. Elegí uno completado desde el historial."
        alReintentar={reintentar}
      >
        {(datos) => (
          <section className={estilos.hoja} aria-label="Calificaciones">
            {datos.items.length === 0 ? (
              <div className={estilos.vacia}>
                <p>Esta página quedó vacía.</p>
                <button type="button" className={estilos.volver} onClick={() => setPagina(0)}>
                  Ir a la primera página
                </button>
              </div>
            ) : (
              <ul className={estilos.lista}>
                {datos.items.map((calificacion) => (
                  <li key={calificacion.calificacionId} className={estilos.fila}>
                    <div className={estilos.contenido}>
                      <p className={estilos.nombre}>
                        <span className={estilos.puntaje}>{textoDePuntaje(calificacion.puntaje)}</span>
                        <span className={estilos.dato}>{instante(calificacion.creadoEn)}</span>
                      </p>
                      {calificacion.comentario !== undefined && calificacion.comentario !== '' && <p className={estilos.comentario}>{calificacion.comentario}</p>}
                      <p className={estilos.dato}>Viaje {calificacion.viajeId}</p>
                    </div>
                    <a className={estilos.enlace} href={enlace('calificaciones', calificacion.calificacionId)}>
                      Ver detalle<span className={estilos.oculto}> de la calificación del {instante(calificacion.creadoEn)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <Paginacion pagina={datos} alCambiar={setPagina} nombre="calificaciones" />
          </section>
        )}
      </EstadoPantalla>
    </>
  );
}

function Detalle({ api, sesion, idCalificacion }: { api: ApiM2; sesion: Sesion; idCalificacion: string }) {
  const { estado, reintentar } = usarCarga((senal) => api.obtenerCalificacion(sesion.sub, idCalificacion, { senal }), [api, sesion.sub, idCalificacion]);

  return (
    <>
      <Titulo>{TITULOS.calificaciones}</Titulo>
      <div className={estilos.detalle}>
        <a className={estilos.enlace} href={enlace('calificaciones')}>
          Volver a mis calificaciones
        </a>
        <EstadoPantalla
          estado={estado}
          vacio="No hay calificación para mostrar."
          alReintentar={reintentar}
          errorPropio={(error) => {
            const mensaje = mensajeDeDetalle(error);
            // Un 404 no se arregla repitiendo el pedido: sin «Reintentar».
            return mensaje === undefined ? undefined : (
              <div role="alert">
                <ErrorDeM2 error={error} mensaje={mensaje} />
              </div>
            );
          }}
        >
          {(calificacion) => <FichaDeCalificacion calificacion={calificacion} />}
        </EstadoPantalla>
      </div>
    </>
  );
}

function FichaDeCalificacion({ calificacion }: { calificacion: Calificacion }) {
  const filas: [string, string, boolean][] = [
    ['Puntaje', textoDePuntaje(calificacion.puntaje), false],
    ['Comentario', calificacion.comentario ?? 'Sin comentario', false],
    ['Viaje', calificacion.viajeId, true],
    ['Conductor', calificacion.conductorId, true],
    ['Calificación', calificacion.calificacionId, true],
    ['Enviada', instante(calificacion.creadoEn), true],
  ];
  return (
    <section className={estilos.hoja} aria-label="Detalle de la calificación">
      <dl className={estilos.filas}>
        {filas.map(([nombre, valor, esDato]) => (
          <div key={nombre} className={estilos.ficha}>
            <dt>{nombre}</dt>
            <dd className={esDato ? estilos.dato : undefined}>{valor}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
