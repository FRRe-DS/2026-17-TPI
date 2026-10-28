import type { ApiPanel, PedidoDelPanel } from '../api/panel.js';
import { Aviso } from '../componentes/aviso.js';
import { BotonAccion } from '../componentes/boton-accion.js';
import { ErrorDeM2 } from '../componentes/error-de-m2.js';
import { EstadoPantalla } from '../componentes/estado-pantalla.js';
import { Titulo } from '../componentes/titulo.js';
import { usarAccion } from '../hooks/usar-accion.js';
import { usarCarga } from '../hooks/usar-carga.js';
import { CAPACIDAD_DE_PEDIDOS, copiarAlPortapapeles, esFalla, horaDelPedido, textoDelCuerpo } from '../logica/pedidos.js';
import { TITULOS } from '../rutas.js';
import estilos from './detalle-tecnico.module.css';

// El detalle técnico (RNF-14.9): los últimos pedidos que el panel le hizo a M2, con lo que hace falta para seguirlos y repetirlos:
// método, ruta, código, duración, el folio que se busca en `docker compose logs m2` y el `curl` equivalente, con `$TOKEN` en lugar
// del token y el `Authorization` enmascarado. Pedirlos al panel no es un pedido a M2, así que esta pantalla no se agrega a la lista.
export function DetalleTecnico({ apiPanel }: { apiPanel: ApiPanel }) {
  const { estado, reintentar } = usarCarga((senal) => apiPanel.listarPedidos(senal), [apiPanel], (datos) => datos.pedidos.length === 0);
  const copia = usarAccion({ ejecutar: (_, texto: string) => copiarAlPortapapeles(texto), aviso: 'curl copiado.' });
  const errorAlCopiar = copia.estado.fase === 'fallida' ? copia.estado.error : undefined;

  return (
    <>
      <Titulo>{TITULOS['detalle-tecnico']}</Titulo>
      <div className={estilos.detalle}>
        <p className={estilos.nota}>
          Los últimos {CAPACIDAD_DE_PEDIDOS} pedidos a M2 hechos desde este panel, el más nuevo primero. Se pierden al reiniciar el panel. El folio se busca con{' '}
          <code>docker compose logs m2</code>.
        </p>
        <div>
          <BotonAccion esperando={false} variante="contorno" onClick={reintentar}>
            Actualizar
          </BotonAccion>
        </div>
        <Aviso estado={copia.estado} />
        {errorAlCopiar !== undefined && (
          <div role="alert">
            <ErrorDeM2 error={errorAlCopiar} />
          </div>
        )}
        <EstadoPantalla estado={estado} vacio="Todavía no hay pedidos a M2. Usá otra pantalla y volvé." alReintentar={reintentar}>
          {(datos) => (
            <section className={estilos.hoja} aria-label="Pedidos a M2">
              <ul className={estilos.lista}>
                {datos.pedidos.map((pedido) => (
                  <FilaDePedido key={`${pedido.requestId}-${pedido.hora}`} pedido={pedido} alCopiar={() => void copia.enviar(pedido.curl)} esperando={copia.esperando} />
                ))}
              </ul>
            </section>
          )}
        </EstadoPantalla>
      </div>
    </>
  );
}

function FilaDePedido({ pedido, alCopiar, esperando }: { pedido: PedidoDelPanel; alCopiar: () => void; esperando: boolean }) {
  return (
    <li className={estilos.pedido}>
      <details>
        <summary className={estilos.resumen}>
          <span className={estilos.hora}>{horaDelPedido(pedido.hora)}</span>
          <span className={estilos.metodo}>{pedido.metodo}</span>
          <span className={estilos.ruta}>{pedido.ruta}</span>
          <span className={esFalla(pedido.estado) ? estilos.mal : estilos.ok}>{pedido.estado}</span>
          <span className={estilos.dato}>{pedido.duracionMs} ms</span>
          <span className={estilos.dato}>
            folio <b>{pedido.requestId}</b>
          </span>
        </summary>
        <div className={estilos.cuerpo}>
          <h2 className={estilos.subtitulo}>Encabezados</h2>
          <dl className={estilos.encabezados}>
            {Object.entries(pedido.encabezados).map(([nombre, valor]) => (
              <div key={nombre} className={estilos.encabezado}>
                <dt>{nombre}</dt>
                <dd>{valor}</dd>
              </div>
            ))}
          </dl>
          <h2 className={estilos.subtitulo}>Cuerpo</h2>
          <pre className={estilos.pre}>{textoDelCuerpo(pedido)}</pre>
          <h2 className={estilos.subtitulo}>curl equivalente</h2>
          <pre className={estilos.pre}>{pedido.curl}</pre>
          <BotonAccion esperando={esperando} variante="contorno" onClick={alCopiar}>
            Copiar curl<span className={estilos.oculto}> del pedido {pedido.metodo} {pedido.ruta}</span>
          </BotonAccion>
        </div>
      </details>
    </li>
  );
}
