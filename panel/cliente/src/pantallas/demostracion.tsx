import { useEffect, useMemo, useRef, useState } from 'react';
import { BotonAccion } from '../componentes/boton-accion.js';
import { ResultadoCaso } from '../componentes/resultado-caso.js';
import { Titulo } from '../componentes/titulo.js';
import { casosPorArea, textoDeAvance, textoDelResumen } from '../logica/demostracion.js';
import { CASOS, type Caso } from '../logica/casos.js';
import { ejecutarCaso, ejecutarTodo, type EntornoDeCasos, type ResultadoDeCaso } from '../logica/ejecutar-caso.js';
import { TITULOS } from '../rutas.js';
import estilos from './demostracion.module.css';

type Props = { entorno: EntornoDeCasos; casos?: readonly Caso[] };

// Qué se está ejecutando: un caso, o todos. Mientras algo corre no se lanza otra cosa: los casos comparten M2 y el M6 simulado, y los
// de resiliencia lo cambian de modo (spec 072, RNF-07.6).
type Ocupado = { tipo: 'caso'; id: string } | { tipo: 'todo'; hechos: number; total: number };

// La vista «Demostración» (spec 072, T14, RNF-07.3, RNF-07.4, RNF-07.6): los casos de la API de M2 por área, cada uno con «Ejecutar»
// y su resultado, y «Ejecutar todo» con el avance y el resumen. Cada caso prepara lo suyo con un cliente nuevo y usa sus propias
// identidades de prueba, así que no toca la sesión de quien mira. Las secciones «Integridad» y «Base de datos» van más abajo
// (T15 y T16).
export function Demostracion({ entorno, casos = CASOS }: Props) {
  const grupos = useMemo(() => casosPorArea(casos), [casos]);
  const [resultados, setResultados] = useState<Record<string, ResultadoDeCaso>>({});
  const [ocupado, setOcupado] = useState<Ocupado | undefined>();
  const [resumen, setResumen] = useState<{ correcto: boolean; texto: string } | undefined>();

  // Un doble clic llega con la ejecución ya en curso: la referencia lo ve antes de que React vuelva a dibujar.
  const enCurso = useRef(false);
  const control = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => control.current?.abort(), []);

  const guardar = (resultado: ResultadoDeCaso) => setResultados((anteriores) => ({ ...anteriores, [resultado.casoId]: resultado }));

  async function ejecutarUno(caso: Caso): Promise<void> {
    if (enCurso.current) return;
    enCurso.current = true;
    setResumen(undefined);
    setOcupado({ tipo: 'caso', id: caso.id });
    try {
      guardar(await ejecutarCaso(caso, entorno));
    } finally {
      enCurso.current = false;
      setOcupado(undefined);
    }
  }

  async function ejecutarTodos(): Promise<void> {
    if (enCurso.current) return;
    enCurso.current = true;
    control.current = new AbortController();
    setResumen(undefined);
    setResultados({});
    setOcupado({ tipo: 'todo', hechos: 0, total: casos.length });
    try {
      const final = await ejecutarTodo(
        casos,
        entorno,
        ({ hechos, total, ultimo }) => {
          setOcupado({ tipo: 'todo', hechos, total });
          if (ultimo !== undefined) guardar(ultimo);
        },
        control.current.signal,
      );
      setResumen(textoDelResumen(final, casos.length));
    } finally {
      enCurso.current = false;
      setOcupado(undefined);
    }
  }

  const corriendo = ocupado !== undefined;

  return (
    <>
      <Titulo>{TITULOS.demostracion}</Titulo>
      <div className={estilos.demostracion}>
        <p className={estilos.introduccion}>
          Recorre la API de M2 caso por caso y compara lo que contesta con lo que dice el contrato. Cada caso prepara lo suyo con un cliente nuevo y usa sus propias
          identidades de prueba: no cambia tu sesión.
        </p>

        <section className={estilos.seccion} aria-labelledby="demo-casos">
          <div className={estilos.cabecera}>
            <h2 id="demo-casos" className={estilos.subtitulo}>
              Casos
            </h2>
            <BotonAccion
              esperando={ocupado?.tipo === 'todo'}
              textoEsperando="Ejecutando…"
              deshabilitado={ocupado?.tipo === 'caso'}
              onClick={() => void ejecutarTodos()}
            >
              Ejecutar todo
            </BotonAccion>
          </div>

          <div role="status" aria-live="polite" className={estilos.estado}>
            {ocupado?.tipo === 'todo' && (
              <>
                <progress className={estilos.progreso} max={ocupado.total} value={ocupado.hechos} aria-label="Avance de los casos" />
                <span>Casos hechos: {textoDeAvance(ocupado.hechos, ocupado.total)}</span>
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
                          esperando={ocupado?.tipo === 'caso' && ocupado.id === caso.id}
                          textoEsperando="Ejecutando…"
                          deshabilitado={corriendo}
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
      </div>
    </>
  );
}
