import { useEffect, useRef, useState } from 'react';
import { ErrorDeApi, m2NoResponde, type DatosDeError } from '../api/errores.js';
import type { ApiPanel } from '../api/panel.js';
import type { Cerrojo } from '../logica/cerrojo.js';
import { N_MAXIMO, N_MINIMO, N_POR_DEFECTO, validarN } from '../logica/integridad.js';
import { Campo } from './formulario.js';
import { PruebaIntegridad, type ResultadoDePrueba } from './prueba-integridad.js';
import estilos from './seccion-demostracion.module.css';

type Props = { apiPanel: ApiPanel; cerrojo: Cerrojo; activa: string | undefined };

type Lanzamiento = { resultado?: ResultadoDePrueba; error?: DatosDeError };
type Llamar = (n: number, senal: AbortSignal) => Promise<ResultadoDePrueba>;

const ID_DEL_CAMPO = 'demo-n';

// Las cuatro pruebas de la sección: las tres simultáneas comparten el campo N; la restricción no lo usa.
const PRUEBAS: readonly { id: string; titulo: string; explicacion: string; etiquetaBoton: string; usaN: boolean; llamar: (api: ApiPanel) => Llamar }[] = [
  {
    id: 'altas-misma-clave',
    titulo: 'Altas simultáneas con la misma clave',
    explicacion:
      'N pedidos a la vez para crear el mismo cliente, con la misma Idempotency-Key y el mismo cuerpo. Se espera N respuestas 201 con el mismo cuerpo (la primera crea, las demás repiten la guardada) y una sola fila en clientes.',
    etiquetaBoton: 'Lanzar las altas',
    usaN: true,
    llamar: (api) => async (n, senal) => ({ tipo: 'simultaneo', datos: await api.lanzarAltasSimultaneas(n, 'misma-clave', senal) }),
  },
  {
    id: 'altas-claves-distintas',
    titulo: 'Altas simultáneas con claves distintas',
    explicacion:
      'N pedidos a la vez para crear el mismo cliente, cada uno con su clave. Se espera un 201 y N−1 respuestas 409 (el perfil ya existe) y una sola fila en clientes: lo garantiza la restricción única de la base.',
    etiquetaBoton: 'Lanzar las altas',
    usaN: true,
    llamar: (api) => async (n, senal) => ({ tipo: 'simultaneo', datos: await api.lanzarAltasSimultaneas(n, 'claves-distintas', senal) }),
  },
  {
    id: 'calificaciones',
    titulo: 'Calificaciones simultáneas del mismo viaje',
    explicacion:
      'N calificaciones a la vez del mismo viaje completado, cada una con su clave. Se espera un 201 y N−1 respuestas 409 (calificación duplicada) y una sola fila en calificaciones.',
    etiquetaBoton: 'Lanzar las calificaciones',
    usaN: true,
    llamar: (api) => async (n, senal) => ({ tipo: 'simultaneo', datos: await api.lanzarCalificacionesSimultaneas(n, senal) }),
  },
  {
    id: 'restriccion',
    titulo: 'Restricción del puntaje en la base',
    explicacion:
      'Intenta guardar una calificación con puntaje 9 directo en la base, dentro de una transacción que siempre se deshace. Se espera que PostgreSQL la rechace con su restricción calificaciones_puntaje_valido, aunque M2 ya valide el puntaje antes.',
    etiquetaBoton: 'Probar la restricción',
    usaN: false,
    llamar: (api) => async (_n, senal) => ({ tipo: 'restriccion', datos: await api.probarRestriccionDelPuntaje(senal) }),
  },
];

// La sección «Integridad» de la vista «Demostración» (spec 072, T15, RNF-08.2 a RNF-08.4, RNF-05.5). Las pruebas simultáneas salen del
// servidor del panel y no del navegador, que pone en fila los pedidos (límite de conexiones por servidor): así sí son simultáneas.
export function SeccionIntegridad({ apiPanel, cerrojo, activa }: Props) {
  const [texto, setTexto] = useState(String(N_POR_DEFECTO));
  const [lanzamientos, setLanzamientos] = useState<Record<string, Lanzamiento>>({});
  const validacion = validarN(texto);

  const control = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => control.current?.abort(), []);

  const lanzar = (prueba: (typeof PRUEBAS)[number]) => {
    // Con un N inválido no se lanza nada: el error ya está junto al campo y el foco va a él.
    if (prueba.usaN && !validacion.valido) {
      document.getElementById(ID_DEL_CAMPO)?.focus();
      return;
    }
    const n = validacion.valido ? validacion.n : N_POR_DEFECTO;
    return cerrojo.ejecutar(`integridad:${prueba.id}`, async () => {
      control.current = new AbortController();
      const { signal } = control.current;
      setLanzamientos((anteriores) => ({ ...anteriores, [prueba.id]: {} }));
      try {
        const resultado = await prueba.llamar(apiPanel)(n, signal);
        setLanzamientos((anteriores) => ({ ...anteriores, [prueba.id]: { resultado } }));
      } catch (error) {
        // La persona salió de la vista: no hay a quién mostrarle nada.
        if (signal.aborted) return;
        setLanzamientos((anteriores) => ({ ...anteriores, [prueba.id]: { error: error instanceof ErrorDeApi ? error : m2NoResponde() } }));
      }
    });
  };

  return (
    <section className={estilos.seccion} aria-labelledby="demo-integridad">
      <h2 id="demo-integridad" className={estilos.subtitulo}>
        Integridad
      </h2>
      <p className={estilos.nota}>
        Estas pruebas salen del servidor del panel y no del navegador, que pone en fila los pedidos y no serían simultáneos. Cada una crea un cliente nuevo y cuenta en la
        base de M2 lo que quedó.
      </p>
      <div className={estilos.campoN}>
        <Campo
          id={ID_DEL_CAMPO}
          etiqueta="Cantidad de pedidos simultáneos (N)"
          ayuda={`De ${N_MINIMO} a ${N_MAXIMO}. Por defecto ${N_POR_DEFECTO}.`}
          error={validacion.valido ? undefined : validacion.motivo}
          valor={texto}
          alCambiar={setTexto}
          teclado="decimal"
          autoComplete="off"
        />
      </div>
      <div className={estilos.pruebas}>
        {PRUEBAS.map((prueba) => (
          <PruebaIntegridad
            key={prueba.id}
            id={`demo-${prueba.id}`}
            titulo={prueba.titulo}
            explicacion={prueba.explicacion}
            etiquetaBoton={prueba.etiquetaBoton}
            esperando={activa === `integridad:${prueba.id}`}
            deshabilitado={activa !== undefined}
            alLanzar={() => void lanzar(prueba)}
            resultado={lanzamientos[prueba.id]?.resultado}
            error={lanzamientos[prueba.id]?.error}
          />
        ))}
      </div>
    </section>
  );
}
