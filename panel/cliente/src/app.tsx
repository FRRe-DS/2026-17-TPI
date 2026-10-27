import { useState } from 'react';
import { Marco } from './componentes/marco.js';
import { PantallaPendiente } from './componentes/pantalla-pendiente.js';
import { almacenamientoDelNavegador, crearSesionSimulada } from './fuentes/sesion-simulada.js';
import { fuenteDeViajes } from './fuentes/viajes-simulados.js';
import { usarRuta } from './hooks/usar-ruta.js';
import { TITULOS } from './rutas.js';

const fuenteDeSesion = crearSesionSimulada(almacenamientoDelNavegador());

// Las dos fuentes simuladas, nombradas en el encabezado de toda vista (RNF-12.7).
const ETIQUETAS = [
  { de: 'Sesión', texto: fuenteDeSesion.etiqueta },
  { de: 'Viajes', texto: fuenteDeViajes.etiqueta },
];

// El esqueleto del panel: la sesión simulada, la pantalla según el hash y el marco común. Las pantallas llegan en el tramo D;
// hasta entonces cada una muestra su título.
export function App() {
  const [sesion, setSesion] = useState(() => fuenteDeSesion.actual());
  const { ruta } = usarRuta(sesion);
  const titulo = ruta.pantalla === 'raiz' ? TITULOS.ingresar : TITULOS[ruta.pantalla];

  const cerrarSesion = () => {
    fuenteDeSesion.cerrar();
    setSesion(undefined);
  };

  return (
    <Marco sesion={sesion} ruta={ruta} etiquetas={ETIQUETAS} ultimo={undefined} alCerrarSesion={cerrarSesion}>
      <PantallaPendiente titulo={titulo} />
    </Marco>
  );
}
