import { enlace } from '../rutas.js';
import estilos from './franja-tecnica.module.css';

// El último pedido a M2, siempre a la vista y sin molestar: método, ruta, código, duración y folio (`X-Request-Id`), el puente con
// los logs de M2. Lo llena el registro de pedidos de la pantalla de detalle técnico (T31).
export type UltimoPedido = { metodo: string; ruta: string; estado: number; ms: number; requestId: string };

// La barra dibuja la duración a escala: el ancho completo es un segundo; lo que tarda más la llena.
const ESCALA_MS = 1000;
const ANCHO = 120;
const anchoDe = (ms: number) => Math.max(1, Math.round((Math.min(ms, ESCALA_MS) / ESCALA_MS) * ANCHO));

type Props = { ultimo: UltimoPedido | undefined; conSesion: boolean };

export function FranjaTecnica({ ultimo, conSesion }: Props) {
  return (
    <footer className={estilos.franja} aria-label="Último pedido a M2">
      {ultimo === undefined ? (
        <span className={estilos.vacia}>Sin pedidos a M2 todavía</span>
      ) : (
        <>
          <span className={estilos.metodo}>{ultimo.metodo}</span>
          <span className={estilos.ruta}>{ultimo.ruta}</span>
          <span className={ultimo.estado < 400 ? estilos.ok : estilos.mal}>{ultimo.estado}</span>
          <span className={estilos.duracion}>
            <svg className={estilos.barra} viewBox={`0 0 ${ANCHO} 6`} aria-hidden="true">
              <rect className={estilos.pista} width={ANCHO} height="6" rx="3" />
              <rect className={estilos.valor} width={anchoDe(ultimo.ms)} height="6" rx="3" />
            </svg>
            {ultimo.ms} ms
          </span>
          <span className={estilos.folio}>
            folio <b>{ultimo.requestId}</b>
          </span>
        </>
      )}
      {conSesion && (
        <a className={estilos.ver} href={enlace('detalle-tecnico')}>
          <span>
            Ver pedidos<span className={estilos.extra}> y respuestas</span>
          </span>
        </a>
      )}
    </footer>
  );
}
