import { useEffect, useMemo, useRef, useState } from 'react';
import { CASOS, type Caso } from '../logica/casos.js';
import type { Cerrojo } from '../logica/cerrojo.js';
import { casosPorArea, textoDeAvance, textoDelResumen } from '../logica/demostracion.js';
import { ejecutarCaso, ejecutarTodo, type EntornoDeCasos, type ResultadoDeCaso } from '../logica/ejecutar-caso.js';
import { BotonAccion } from './boton-accion.js';
import { ResultadoCaso } from './resultado-caso.js';
import estilos from './seccion-demostracion.module.css';

type Props = { entorno: EntornoDeCasos; casos?: readonly Caso[]; cerrojo: Cerrojo; activa: string | undefined };

// La sección «Casos» de la vista «Demostración» (spec 072, T14, RNF-07.3, RNF-07.4, RNF-07.6): los casos de la API de M2 por área,
// cada uno con «Ejecutar» y su resultado, y «Ejecutar todo» con el avance y el resumen. Cada caso prepara lo suyo con un cliente nuevo
// y usa sus propias identidades de prueba, así que no toca la sesión de quien mira. Mientras algo corre (acá o en otra sección), todos
// los botones quedan deshabilitados: los casos comparten M2 y el M6 simulado.
export function SeccionCasos({ entorno, casos = CASOS, cerrojo, activa }: Props) {
  const grupos = useMemo(() => casosPorArea(casos), [casos]);
  const [resultados, setResultados] = useState<Record<string, ResultadoDeCaso>>({});
  const [avance, setAvance] = useState<{ hechos: number; total: number } | undefined>();
  const [resumen, setResumen] = useState<{ correcto: boolean; texto: string } | undefined>();

  const control = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => control.current?.abort(), []);

  const guardar = (resultado: ResultadoDeCaso) => setResultados((anteriores) => ({ ...anteriores, [resultado.casoId]: resultado }));

  const ejecutarUno = (caso: Caso) =>
    cerrojo.ejecutar(`caso:${caso.id}`, async () => {
      setResumen(undefined);
      guardar(await ejecutarCaso(caso, entorno));
    });

  const ejecutarTodos = () =>
    cerrojo.ejecutar('todo', async () => {
      control.current = new AbortController();
      setResumen(undefined);
      setResultados({});
      setAvance({ hechos: 0, total: casos.length });
      try {
        const final = await ejecutarTodo(
          casos,
          entorno,
          ({ hechos, total, ultimo }) => {
            setAvance({ hechos, total });
            if (ultimo !== undefined) guardar(ultimo);
          },
          control.current.signal,
        );
        setResumen(textoDelResumen(final, casos.length));
      } finally {
        setAvance(undefined);
      }
    });

  return (
    <section className={estilos.seccion} aria-labelledby="demo-casos">
      <div className={estilos.cabecera}>
        <h2 id="demo-casos" className={estilos.subtitulo}>
          Casos
        </h2>
        <BotonAccion esperando={activa === 'todo'} textoEsperando="Ejecutando…" deshabilitado={activa !== undefined} onClick={() => void ejecutarTodos()}>
          Ejecutar todo
        </BotonAccion>
      </div>

      <div role="status" aria-live="polite" className={estilos.estado}>
        {avance !== undefined && (
          <>
            <progress className={estilos.progreso} max={avance.total} value={avance.hechos} aria-label="Avance de los casos" />
            <span>Casos hechos: {textoDeAvance(avance.hechos, avance.total)}</span>
          </>
        )}
        {resumen !== undefined && <span className={resumen.correcto ? estilos.resumenBueno : estilos.resumenMalo}>{resumen.texto}</span>}
      </div>

      {grupos.map(({ area, casos: delArea }) => (
        <section key={area.id} className={estilos.area} aria-labelledby={`area-${area.id}`}>
          <h3 id={`area-${area.id}`} className={estilos.areaTitulo}>
            {area.titulo}
          </h3>
          <ul className={estilos.lista}>
            {delArea.map((caso) => {
              const resultado = resultados[caso.id];
              return (
                <li key={caso.id} className={estilos.caso}>
                  <div className={estilos.casoCabecera}>
                    <div className={estilos.casoTexto}>
                      <p className={estilos.casoTitulo}>{caso.titulo}</p>
                      <p className={estilos.casoRuta}>
                        {caso.prueba.metodo} {caso.prueba.ruta}
                      </p>
                    </div>
                    <BotonAccion
                      variante="contorno"
                      esperando={activa === `caso:${caso.id}`}
                      textoEsperando="Ejecutando…"
                      deshabilitado={activa !== undefined}
                      onClick={() => void ejecutarUno(caso)}
                    >
                      Ejecutar<span className={estilos.oculto}>: {caso.titulo}</span>
                    </BotonAccion>
                  </div>
                  {resultado !== undefined && <ResultadoCaso caso={caso} resultado={resultado} />}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </section>
  );
}
