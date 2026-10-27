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
import { Perfil } from './pantallas/perfil.js';
import { enlace, inicioDe, TITULOS, type Ruta } from './rutas.js';

const fuenteDeSesion = crearSesionSimulada(almacenamientoDelNavegador());

// Lo que usa la pantalla `ingresar`: la sesión, los clientes recordados (almacenamiento local, duran entre visitas) y un cliente
// de M2 por identidad, para pedir como el cliente antes de abrir su sesión.
const ingreso: Ingreso = {
  sesion: fuenteDeSesion,
  recordados: crearRecordadosGuardados(almacenamientoDelNavegador('localStorage')),
  apiPara: (identidad: Identidad) => crearApiM2({ identidad: () => identidad }),
};

// El cliente de M2 de las demás pantallas: pide con la sesión que haya en cada momento (RNF-12.9).
const api = crearApiM2({ identidad: () => fuenteDeSesion.actual() });

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

  // Las pantallas construidas; las demás siguen mostrando su título (tramo D). Las que piden a M2 solo se dibujan con sesión.
  const pantalla = (nombre: Ruta['pantalla'], tituloPendiente: string) => {
    if (nombre === 'ingresar') return <Ingresar ingreso={ingreso} alEntrar={entrar} />;
    if (nombre === 'perfil' && sesion !== undefined) return <Perfil api={api} sesion={sesion} />;
    return <PantallaPendiente titulo={tituloPendiente} />;
  };

  return (
    <Marco sesion={sesion} ruta={ruta} etiquetas={ETIQUETAS} ultimo={undefined} alCerrarSesion={cerrarSesion}>
      {pantalla(ruta.pantalla, titulo)}
    </Marco>
  );
}
