import { useState } from "react";
import type { EjemploDeViajes, EstadoM6, ModoM6 } from "../api/panel.js";
import { Aviso } from "../componentes/aviso.js";
import { BotonAccion } from "../componentes/boton-accion.js";
import { ErrorDeM2 } from "../componentes/error-de-m2.js";
import { EstadoPantalla } from "../componentes/estado-pantalla.js";
import { GrupoDeOpciones } from "../componentes/formulario.js";
import { Titulo } from "../componentes/titulo.js";
import type { Sesion } from "../fuentes/fuente-de-sesion.js";
import type { FuenteDeViajes } from "../fuentes/viajes-simulados.js";
import { usarAccion } from "../hooks/usar-accion.js";
import { usarCarga } from "../hooks/usar-carga.js";
import {
  MODOS,
  nombreDelModo,
  NOMBRE_DEL_ESCENARIO,
  respuestaEsperada,
} from "../logica/m6-simulado.js";
import { enlace, TITULOS } from "../rutas.js";
import estilos from "./m6-simulado.module.css";

type Props = { viajes: FuenteDeViajes; sesion: Sesion };

// El M6 simulado (RNF-13.5, RNF-12.7): el modo en que responde y los cuatro viajes con los que se prueba calificar, cada uno con lo
// que M2 va a contestar. Mientras no exista el M6 de verdad, esto es lo que hay detrás del historial y de calificar.
export function M6Simulado({ viajes, sesion }: Props) {
  const { estado, reintentar } = usarCarga(
    (senal) => viajes.estado(senal),
    [viajes],
  );
  const [escenarios, setEscenarios] = useState<EjemploDeViajes | undefined>();
  // Lo que el canal dijo después del último cambio, y el modo recién elegido mientras espera su respuesta: el selector sigue a la
  // persona al instante y vuelve a lo que el canal confirma (o a lo anterior si rechazó). No se vuelve a cargar la pantalla entera,
  // así el foco no se pierde.
  const [confirmado, setConfirmado] = useState<EstadoM6 | undefined>();
  const [elegido, setElegido] = useState<ModoM6 | undefined>();

  const cambiar = usarAccion({
    ejecutar: async ({ senal }, modo: ModoM6) => {
      setElegido(modo);
      try {
        const nuevo = await viajes.ponerModo(modo, senal);
        setConfirmado(nuevo);
        return nuevo;
      } finally {
        setElegido(undefined);
      }
    },
    aviso: (nuevo) =>
      `M6 simulado en modo ${nombreDelModo(nuevo.modo).toLowerCase()}.`,
  });
  const cargar = usarAccion({
    ejecutar: async ({ senal }) => {
      const cargado = await viajes.cargarEjemplo(sesion.sub, senal);
      setEscenarios(cargado);
      return cargado;
    },
    aviso: "Viajes de ejemplo cargados.",
  });

  return (
    <>
      <Titulo>{TITULOS["m6-simulado"]}</Titulo>
      <div className={estilos.m6}>
        <p className={estilos.etiqueta}>M6: {viajes.etiqueta}</p>
        <EstadoPantalla
          estado={estado}
          vacio="No hay estado del M6 simulado para mostrar."
          alReintentar={reintentar}
        >
          {(cargado) => {
            const m6 = confirmado ?? cargado;
            const mostrado = elegido ?? m6.modo;
            return (
              <>
                <section
                  className={estilos.hoja}
                  aria-label="Modo del M6 simulado"
                >
                  <GrupoDeOpciones
                    id="m6-modo"
                    etiqueta="Modo"
                    ayuda={`${MODOS.find((m) => m.valor === mostrado)?.explicacion ?? ""} El modo lento espera ${m6.retardoLentoMs} ms.`}
                    opciones={MODOS.map(({ valor, etiqueta }) => ({
                      valor,
                      etiqueta,
                    }))}
                    seleccionados={[mostrado]}
                    alCambiar={(valor, marcado) =>
                      marcado && void cambiar.enviar(valor as ModoM6)
                    }
                    unica
                  />
                </section>
                <Aviso estado={cambiar.estado} />
                {cambiar.estado.fase === "fallida" && (
                  <div role="alert">
                    <ErrorDeM2
                      error={cambiar.estado.error}
                      alReintentar={() => void cambiar.reintentar()}
                      esperando={cambiar.esperando}
                    />
                  </div>
                )}
                <h2 className={estilos.subtitulo}>
                  Viajes para probar calificar
                </h2>
                {sesion.rol !== "CLIENTE" ? (
                  <p className={estilos.nota}>
                    Los viajes de prueba son de un cliente: entrá como CLIENTE
                    para cargarlos.
                  </p>
                ) : (
                  <>
                    <div>
                      <BotonAccion
                        variante="contorno"
                        esperando={cargar.esperando}
                        textoEsperando="Cargando…"
                        onClick={() => void cargar.enviar()}
                      >
                        Cargar los viajes de ejemplo
                      </BotonAccion>
                    </div>
                    <Aviso estado={cargar.estado} />
                    {cargar.estado.fase === "fallida" && (
                      <div role="alert">
                        <ErrorDeM2
                          error={cargar.estado.error}
                          alReintentar={() => void cargar.reintentar()}
                          esperando={cargar.esperando}
                        />
                      </div>
                    )}
                    {escenarios === undefined ? (
                      <p className={estilos.nota}>
                        Cargá los viajes para ver su identificador y lo que M2
                        va a responder.
                      </p>
                    ) : (
                      <section className={estilos.hoja} aria-label="Escenarios">
                        <ul className={estilos.lista}>
                          {escenarios.escenarios.map((escenario) => (
                            <li
                              key={escenario.nombre}
                              className={estilos.escenario}
                            >
                              <div className={estilos.contenido}>
                                <p className={estilos.nombre}>
                                  {NOMBRE_DEL_ESCENARIO[escenario.nombre]}
                                </p>
                                <p className={estilos.dato}>
                                  {escenario.viajeId}
                                </p>
                                <p className={estilos.esperada}>
                                  {respuestaEsperada(escenario, m6.modo)}
                                </p>
                              </div>
                              <a
                                className={estilos.enlace}
                                href={enlace("calificar", escenario.viajeId)}
                              >
                                Calificar este viaje
                                <span className={estilos.oculto}>
                                  {" "}
                                  ({NOMBRE_DEL_ESCENARIO[escenario.nombre]})
                                </span>
                              </a>
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}
                  </>
                )}
              </>
            );
          }}
        </EstadoPantalla>
      </div>
    </>
  );
}
