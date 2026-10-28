import type { Caso } from '../logica/casos.js';
import type { ResultadoDeCaso } from '../logica/ejecutar-caso.js';
import { lineaDelPedido, mostrarCuerpo, textoDeEsperado, textoDeIdentidad } from '../logica/demostracion.js';
import { Veredicto } from './veredicto.js';
import estilos from './resultado-caso.module.css';

type Props = { caso: Pick<Caso, 'id' | 'titulo'>; resultado: ResultadoDeCaso };

// El resultado de un caso de la vista «Demostración» (spec 072, T14, RNF-07.4): ✔ «Correcto» o ✘ «No coincide» con el motivo, y
// debajo lo que se mandó, lo que llegó y lo que se esperaba. El veredicto lleva texto además del color (RNF-15.3 de la 071) y todo
// lo que viene de M2 se pone como texto: un mensaje de error con etiquetas se ve como etiquetas.
export function ResultadoCaso({ caso, resultado }: Props) {
  const { pedido, respuesta, esperado, veredicto } = resultado;
  const cuerpoDelPedido = mostrarCuerpo(pedido?.cuerpo);
  const cuerpoDeLaRespuesta = mostrarCuerpo(respuesta?.cuerpo);
  const encabezados = Object.entries(respuesta?.encabezados ?? {});

  return (
    <section className={estilos.resultado} aria-label={`Resultado: ${caso.titulo}`}>
      <Veredicto correcto={veredicto.correcto} motivos={veredicto.correcto ? [] : [veredicto.motivo]} />

      <div className={estilos.bloques}>
        {pedido !== undefined && (
          <div className={estilos.bloque}>
            <h4 className={estilos.titulo}>Pedido</h4>
            <p className={estilos.linea}>{lineaDelPedido(pedido)}</p>
            <dl className={estilos.datos}>
              <div>
                <dt>Quién</dt>
                <dd>{textoDeIdentidad(pedido)}</dd>
              </div>
              {pedido.clave !== undefined && (
                <div>
                  <dt>Idempotency-Key</dt>
                  <dd>{pedido.clave}</dd>
                </div>
              )}
            </dl>
            {cuerpoDelPedido !== undefined && <pre className={estilos.cuerpo} tabIndex={0}>{cuerpoDelPedido}</pre>}
          </div>
        )}

        <div className={estilos.bloque}>
          <h4 className={estilos.titulo}>Respuesta</h4>
          {respuesta === undefined ? (
            <p className={estilos.linea}>Sin respuesta</p>
          ) : (
            <>
              <p className={estilos.linea}>{respuesta.estado}</p>
              <dl className={estilos.datos}>
                {respuesta.type !== undefined && (
                  <div>
                    <dt>type</dt>
                    <dd>{respuesta.type}</dd>
                  </div>
                )}
                {encabezados.map(([nombre, valor]) => (
                  <div key={nombre}>
                    <dt>{nombre}</dt>
                    <dd>{valor}</dd>
                  </div>
                ))}
              </dl>
              {cuerpoDeLaRespuesta !== undefined && <pre className={estilos.cuerpo} tabIndex={0}>{cuerpoDeLaRespuesta}</pre>}
            </>
          )}
        </div>

        <div className={estilos.bloque}>
          <h4 className={estilos.titulo}>Esperado</h4>
          <p className={estilos.linea}>{textoDeEsperado(esperado, true)}</p>
        </div>
      </div>
    </section>
  );
}
