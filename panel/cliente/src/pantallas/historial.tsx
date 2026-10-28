import { useState } from 'react';
import type { ApiM2 } from '../api/m2.js';
import { DependenciaNoDisponible } from '../componentes/dependencia-no-disponible.js';
import { EstadoPantalla } from '../componentes/estado-pantalla.js';
import { Paginacion } from '../componentes/paginacion.js';
import { Titulo } from '../componentes/titulo.js';
import type { Sesion } from '../fuentes/fuente-de-sesion.js';
import { usarCarga } from '../hooks/usar-carga.js';
import type { components } from '../generado/contrato.js';
import { instante, nombreDelEstado, sePuedeCalificar, textoDeCalificado } from '../logica/historial.js';
import { TAMANO_DE_PAGINA } from '../logica/paginacion.js';
import { enlace, TITULOS } from '../rutas.js';
import estilos from './historial.module.css';

type Viaje = components['schemas']['ViajeResumen'];
type Props = { api: ApiM2; sesion: Sesion };

// El historial resumido del cliente (RF-2.4.12): M2 lo arma pidiéndoselo a M6 en cada pedido. Si M6 no contesta, M2 responde `503`
// y la pantalla lo explica con la cuenta regresiva (RF-2.4.13).
export function Historial({ api, sesion }: Props) {
  const [pagina, setPagina] = useState(0);
  const { estado, reintentar } = usarCarga(
    (senal) => api.listarHistorialViajes(sesion.sub, { page: pagina, size: TAMANO_DE_PAGINA }, { senal }),
    [api, sesion.sub, pagina],
    (datos) => datos.totalElementos === 0,
  );

  return (
    <>
      <Titulo>{TITULOS.historial}</Titulo>
      <EstadoPantalla
        estado={estado}
        vacio="Todavía no hay viajes en el historial. Cargá el ejemplo desde el perfil para tener un viaje completado y uno en curso."
        alReintentar={reintentar}
        errorPropio={(error, alReintentar) =>
          error.estado === 503 ? <DependenciaNoDisponible error={error} que="El historial" alReintentar={alReintentar} /> : undefined
        }
      >
        {(datos) => (
          <section className={estilos.hoja} aria-label="Viajes">
            {datos.items.length === 0 ? (
              <div className={estilos.vacia}>
                <p>Esta página quedó vacía.</p>
                <button type="button" className={estilos.volver} onClick={() => setPagina(0)}>
                  Ir a la primera página
                </button>
              </div>
            ) : (
              <ul className={estilos.lista}>
                {datos.items.map((viaje) => (
                  <FilaDeViaje key={viaje.viajeId} viaje={viaje} />
                ))}
              </ul>
            )}
            <Paginacion pagina={datos} alCambiar={setPagina} nombre="viajes" />
          </section>
        )}
      </EstadoPantalla>
    </>
  );
}

export function FilaDeViaje({ viaje }: { viaje: Viaje }) {
  const trayecto = [viaje.origen, viaje.destino].filter((lugar) => lugar !== undefined && lugar !== '').join(' → ');
  return (
    <li className={estilos.viaje}>
      <div className={estilos.contenido}>
        <p className={estilos.nombre}>
          <span className={viaje.estado === 'COMPLETED' ? estilos.completado : estilos.otro} title={viaje.estado}>
            {nombreDelEstado(viaje.estado)}
          </span>
          <span className={viaje.calificado === true ? estilos.calificado : estilos.sinCalificar}>{textoDeCalificado(viaje.calificado)}</span>
        </p>
        {trayecto !== '' && <p className={estilos.trayecto}>{trayecto}</p>}
        <p className={estilos.dato}>
          {viaje.tipoVehiculo !== undefined && <span>{viaje.tipoVehiculo}</span>}
          {viaje.iniciadoEn !== undefined && <span>Inicio {instante(viaje.iniciadoEn)}</span>}
          {viaje.finalizadoEn !== undefined && <span>Fin {instante(viaje.finalizadoEn)}</span>}
        </p>
        <p className={estilos.dato}>
          <span>{viaje.viajeId}</span>
        </p>
      </div>
      {sePuedeCalificar(viaje) && (
        <a className={estilos.calificar} href={enlace('calificar', viaje.viajeId)}>
          Calificar<span className={estilos.oculto}> el viaje {viaje.destino ?? viaje.viajeId}</span>
        </a>
      )}
    </li>
  );
}
