import { useState } from 'react';
import { crearApiM2, type Identidad } from './api/m2.js';
import { Marco } from './componentes/marco.js';
import { PantallaPendiente } from './componentes/pantalla-pendiente.js';
import type { Sesion } from './fuentes/fuente-de-sesion.js';
import { almacenamientoDelNavegador, crearSesionSimulada } from './fuentes/sesion-simulada.js';
import { fuenteDeViajes } from './fuentes/viajes-simulados.js';
import { usarRuta } from './hooks/usar-ruta.js';
import { crearRecordadosGuardados, type Ingreso } from './logica/ingresar.js';
import { Ingresar } from './pantallas/ingresar.js';
import { enlace, inicioDe, TITULOS } from './rutas.js';

const fuenteDeSesion = crearSesionSimulada(almacenamientoDelNavegador());

// Lo que usa la pantalla `ingresar`: la sesión, los clientes recordados (almacenamiento local, duran entre visitas) y un cliente
// de M2 por identidad, para pedir como el cliente antes de abrir su sesión.
const ingreso: Ingreso = {
  sesion: fuenteDeSesion,
  recordados: crearRecordadosGuardados(almacenamientoDelNavegador('localStorage')),
  apiPara: (identidad: Identidad) => crearApiM2({ identidad: () => identidad }),
};

// Las dos fuentes simuladas, nombradas en el encabezado de toda vista (RNF-12.7).
const ETIQUETAS = [
  { de: 'Sesión', texto: fuenteDeSesion.etiqueta },
  { de: 'Viajes', texto: fuenteDeViajes.etiqueta },
];

// El esqueleto del panel: la sesión simulada, la pantalla según el hash y el marco común. Las pantallas que todavía no están
// construidas muestran su título.
export function App() {
  const [sesion, setSesion] = useState(() => fuenteDeSesion.actual());
  const { ruta } = usarRuta(sesion);
  const titulo = ruta.pantalla === 'raiz' ? TITULOS.ingresar : TITULOS[ruta.pantalla];

  // Al entrar, las pantallas del rol: el cliente va a su perfil, el operador a los bloqueos (RF-2.1.5, RNF-12.9).
  const entrar = (nueva: Sesion) => {
    setSesion(nueva);
    window.location.hash = enlace(inicioDe(nueva.rol));
  };

  const cerrarSesion = () => {
    fuenteDeSesion.cerrar();
    setSesion(undefined);
  };

  return (
    <Marco sesion={sesion} ruta={ruta} etiquetas={ETIQUETAS} ultimo={undefined} alCerrarSesion={cerrarSesion}>
      {ruta.pantalla === 'ingresar' ? <Ingresar ingreso={ingreso} alEntrar={entrar} /> : <PantallaPendiente titulo={titulo} />}
    </Marco>
  );
}
