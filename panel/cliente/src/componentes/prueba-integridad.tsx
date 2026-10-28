import type { DatosDeError } from '../api/errores.js';
import type { ResultadoRestriccion, ResultadoSimultaneo } from '../api/panel.js';
import { armarConteo, RESTRICCION_ESPERADA, veredictoDeRestriccion, veredictoSimultaneo } from '../logica/integridad.js';
import { BotonAccion } from './boton-accion.js';
import { ErrorDeM2 } from './error-de-m2.js';
import { Veredicto } from './veredicto.js';
import estilos from './prueba-integridad.module.css';

export type ResultadoDePrueba = { tipo: 'simultaneo'; datos: ResultadoSimultaneo } | { tipo: 'restriccion'; datos: ResultadoRestriccion };

type Props = {
  id: string;
  titulo: string;
  // Qué se hace y qué se espera, en una o dos frases.
  explicacion: string;
  etiquetaBoton: string;
  esperando: boolean;
  // Otra ejecución de la vista está en curso: el botón se apaga hasta que termine.
  deshabilitado: boolean;
  alLanzar: () => void;
  resultado?: ResultadoDePrueba | undefined;
  // El panel no pudo lanzar la prueba (no se pudo preparar, M2 no responde…): el error, completo y con «Reintentar».
  error?: DatosDeError | undefined;
};

// Una prueba de integridad de la vista «Demostración» (spec 072, T15, RNF-08.2 a RNF-08.4, RNF-05.5): el botón que la lanza y, al
// terminar, lo que quedó: la tabla de respuestas por código, las filas en la base y ✔ «Correcto» o ✘ «No coincide». Todo lo que
// viene de la base o de M2 se pone como texto, nunca como HTML.
export function PruebaIntegridad({ id, titulo, explicacion, etiquetaBoton, esperando, deshabilitado, alLanzar, resultado, error }: Props) {
  return (
    <section className={estilos.prueba} aria-labelledby={`${id}-titulo`}>
      <div className={estilos.cabecera}>
        <div className={estilos.texto}>
          <h3 id={`${id}-titulo`} className={estilos.titulo}>
            {titulo}
          </h3>
          <p className={estilos.explicacion}>{explicacion}</p>
        </div>
        <BotonAccion variante="contorno" esperando={esperando} textoEsperando="Lanzando…" deshabilitado={deshabilitado} onClick={alLanzar}>
          {etiquetaBoton}
        </BotonAccion>
      </div>
      {error !== undefined && (
        <div role="alert">
          <ErrorDeM2 error={error} alReintentar={alLanzar} esperando={esperando} mensaje="No se pudo lanzar la prueba." />
        </div>
      )}
      {resultado?.tipo === 'simultaneo' && <ResultadoSimultaneoVista titulo={titulo} datos={resultado.datos} />}
      {resultado?.tipo === 'restriccion' && <ResultadoRestriccionVista datos={resultado.datos} />}
    </section>
  );
}

function ResultadoSimultaneoVista({ titulo, datos }: { titulo: string; datos: ResultadoSimultaneo }) {
  const { filas, filasEnBase } = armarConteo(datos);
  const veredicto = veredictoSimultaneo(datos);

  return (
    <div className={estilos.resultado}>
      <Veredicto correcto={veredicto.correcto} motivos={veredicto.motivos} />
      <div className={estilos.tabla} role="region" aria-label={`Respuestas por código: ${titulo}`} tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th scope="col">Código</th>
              <th scope="col">Llegaron</th>
              <th scope="col">Se esperaban</th>
              <th scope="col">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((fila) => (
              <tr key={fila.codigo} className={fila.coincide ? undefined : estilos.filaMala}>
                <th scope="row">{fila.etiqueta}</th>
                <td>{fila.obtenidas}</td>
                <td>{fila.esperadas}</td>
                <td>{fila.coincide ? 'Coincide' : 'No coincide'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className={estilos.datos}>
        <div>
          <dt>Filas en la base</dt>
          <dd>
            {filasEnBase.obtenidas ?? 'sin contar'} (se esperaba {filasEnBase.esperadas})
            {filasEnBase.motivo !== undefined && <span className={estilos.motivo}> · {filasEnBase.motivo}</span>}
          </dd>
        </div>
        {datos.cuerposIguales !== undefined && (
          <div>
            <dt>Los 201 trajeron el mismo cuerpo</dt>
            <dd>{datos.cuerposIguales ? 'Sí' : 'No'}</dd>
          </div>
        )}
        <div>
          <dt>Cliente de la prueba</dt>
          <dd>{datos.clienteId}</dd>
        </div>
        <div>
          <dt>Folio de la corrida</dt>
          <dd>
            {datos.prefijoRequestId} <span className={estilos.ayuda}>Buscá los pedidos con <code>docker compose logs m2</code> y ese folio.</span>
          </dd>
        </div>
      </dl>
    </div>
  );
}

function ResultadoRestriccionVista({ datos }: { datos: ResultadoRestriccion }) {
  const veredicto = veredictoDeRestriccion(datos);
  const cuenta = (valor: number | null) => (valor === null ? 'sin contar' : String(valor));

  return (
    <div className={estilos.resultado}>
      <Veredicto correcto={veredicto.correcto} motivos={veredicto.motivos} />
      <dl className={estilos.datos}>
        <div>
          <dt>Restricción que la rechazó</dt>
          <dd>{datos.restriccion ?? 'ninguna'}</dd>
        </div>
        <div>
          <dt>Esperada</dt>
          <dd>{RESTRICCION_ESPERADA}</dd>
        </div>
        {datos.codigo !== undefined && (
          <div>
            <dt>Código de PostgreSQL</dt>
            <dd>{datos.codigo}</dd>
          </div>
        )}
        {datos.mensaje !== undefined && (
          <div>
            <dt>Mensaje de PostgreSQL</dt>
            <dd>{datos.mensaje}</dd>
          </div>
        )}
        <div>
          <dt>Antes</dt>
          <dd>{cuenta(datos.filasAntes)}</dd>
        </div>
        <div>
          <dt>Después</dt>
          <dd>{cuenta(datos.filasDespues)}</dd>
        </div>
      </dl>
    </div>
  );
}
