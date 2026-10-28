import type { ApiPanel } from '../api/panel.js';
import { SeccionCasos } from '../componentes/seccion-casos.js';
import { SeccionIntegridad } from '../componentes/seccion-integridad.js';
import { Titulo } from '../componentes/titulo.js';
import { usarCerrojo } from '../hooks/usar-cerrojo.js';
import { CASOS, type Caso } from '../logica/casos.js';
import type { EntornoDeCasos } from '../logica/ejecutar-caso.js';
import { TITULOS } from '../rutas.js';
import estilos from './demostracion.module.css';

type Props = { entorno: EntornoDeCasos; apiPanel: ApiPanel; casos?: readonly Caso[] };

// La vista «Demostración» (spec 072, RNF-07.3, RNF-07.4, RNF-07.6, RNF-08.2 a RNF-08.4, RNF-05.5): los casos de la API de M2, las
// pruebas de integridad y, más abajo (T16), el control de la base de datos. Las secciones comparten un cerrojo: mientras una prueba
// corre, ninguna otra arranca, porque comparten M2 y el M6 simulado.
export function Demostracion({ entorno, apiPanel, casos = CASOS }: Props) {
  const { cerrojo, activa } = usarCerrojo();

  return (
    <>
      <Titulo>{TITULOS.demostracion}</Titulo>
      <div className={estilos.demostracion}>
        <p className={estilos.introduccion}>
          Recorre la API de M2 caso por caso y compara lo que contesta con lo que dice el contrato. Cada caso prepara lo suyo con un cliente nuevo y usa sus propias
          identidades de prueba: no cambia tu sesión.
        </p>
        <SeccionCasos entorno={entorno} casos={casos} cerrojo={cerrojo} activa={activa} />
        <SeccionIntegridad apiPanel={apiPanel} cerrojo={cerrojo} activa={activa} />
      </div>
    </>
  );
}
