import type { components } from '../generado/contrato.js';
import { estaBloqueado, textoDeEstado, textoDeVigencia } from '../logica/cuenta.js';
import { instante } from '../logica/historial.js';
import estilos from './ficha-de-cuenta.module.css';

type EstadoCuenta = components['schemas']['EstadoCuenta'];

// El estado de cuenta de un cliente (RF-2.6.5 a RF-2.6.7): si está activo o bloqueado, dicho con palabras, y los bloqueos que
// siguen vigentes. Lo dibujan la vista del cliente, la del operador y la de otro módulo.
export function FichaDeCuenta({ cuenta }: { cuenta: EstadoCuenta }) {
  const bloqueado = estaBloqueado(cuenta);
  return (
    <section className={estilos.hoja} aria-label="Estado de cuenta">
      <div className={estilos.estado}>
        <span className={bloqueado ? estilos.bloqueado : estilos.activo}>{cuenta.estado}</span>
        <p>{textoDeEstado(cuenta.estado)}</p>
      </div>
      <p className={estilos.cliente}>
        Cliente <span className={estilos.dato}>{cuenta.clienteId}</span>
      </p>
      <h2 className={estilos.subtitulo}>Bloqueos vigentes</h2>
      {cuenta.bloqueosVigentes.length === 0 ? (
        <p className={estilos.ninguno}>No hay bloqueos vigentes.</p>
      ) : (
        <ul className={estilos.lista}>
          {cuenta.bloqueosVigentes.map((bloqueo) => (
            <li key={bloqueo.bloqueoId} className={estilos.bloqueo}>
              <p className={estilos.motivo}>{bloqueo.motivo}</p>
              <p className={estilos.dato}>{textoDeVigencia(bloqueo)}</p>
              <p className={estilos.dato}>
                Desde {instante(bloqueo.desde ?? bloqueo.creadoEn)} · registrado por {bloqueo.creadoPor}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
