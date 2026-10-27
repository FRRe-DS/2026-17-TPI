import { useState, useSyncExternalStore } from 'react';
import { crearApiM2, type Identidad } from './api/m2.js';
import { crearApiPanel } from './api/panel.js';
import { Marco } from './componentes/marco.js';
import { PantallaPendiente } from './componentes/pantalla-pendiente.js';
import type { Sesion } from './fuentes/fuente-de-sesion.js';
import { almacenamientoDelNavegador, crearSesionSimulada } from './fuentes/sesion-simulada.js';
import { fuenteDeViajes } from './fuentes/viajes-simulados.js';
import { usarRuta } from './hooks/usar-ruta.js';
import { crearRecordadosGuardados, type Ingreso } from './logica/ingresar.js';
import { crearUltimoPedido } from './logica/ultimo-pedido.js';
import { Calificaciones } from './pantallas/calificaciones.js';
import { Calificar } from './pantallas/calificar.js';
import { DetalleTecnico } from './pantallas/detalle-tecnico.js';
import { Direcciones } from './pantallas/direcciones.js';
import { EstadoDeCuenta } from './pantallas/estado-cuenta.js';
import { Historial } from './pantallas/historial.js';
import { Ingresar } from './pantallas/ingresar.js';
import { M6Simulado } from './pantallas/m6-simulado.js';
import { Operador } from './pantallas/operador.js';
import { OtroModulo } from './pantallas/otro-modulo.js';
import { Perfil } from './pantallas/perfil.js';
import { PantallaPreferencias } from './pantallas/preferencias.js';
import { enlace, inicioDe, TITULOS, type Ruta } from './rutas.js';

const fuenteDeSesion = crearSesionSimulada(almacenamientoDelNavegador());

// El último pedido a M2, de cualquier pantalla: lo muestra la franja del pie (RNF-14.9).
const ultimoPedido = crearUltimoPedido();

// Lo que usa la pantalla `ingresar`: la sesión, los clientes recordados (almacenamiento local, duran entre visitas) y un cliente
// de M2 por identidad, para pedir como el cliente antes de abrir su sesión.
const ingreso: Ingreso = {
  sesion: fuenteDeSesion,
  recordados: crearRecordadosGuardados(almacenamientoDelNavegador('localStorage')),
  apiPara: (identidad: Identidad) => crearApiM2({ identidad: () => identidad, alTerminar: ultimoPedido.publicar }),
};

// El cliente de M2 de las demás pantallas: pide con la sesión que haya en cada momento (RNF-12.9).
const api = crearApiM2({ identidad: () => fuenteDeSesion.actual(), alTerminar: ultimoPedido.publicar });

// Lo que el panel sabe de sus propios pedidos a M2 (el detalle técnico).
const apiPanel = crearApiPanel();

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
  const ultimo = useSyncExternalStore(ultimoPedido.suscribir, ultimoPedido.actual);
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
  const pantalla = (destino: Ruta, tituloPendiente: string) => {
    const nombre = destino.pantalla;
    if (nombre === 'ingresar') return <Ingresar ingreso={ingreso} alEntrar={entrar} />;
    if (nombre === 'perfil' && sesion !== undefined) return <Perfil api={api} viajes={fuenteDeViajes} sesion={sesion} />;
    if (nombre === 'direcciones' && sesion !== undefined) return <Direcciones api={api} sesion={sesion} idDireccion={'id' in destino ? destino.id : undefined} />;
    if (nombre === 'preferencias' && sesion !== undefined) return <PantallaPreferencias api={api} sesion={sesion} />;
    if (nombre === 'calificar' && sesion !== undefined && 'id' in destino && destino.id !== undefined) return <Calificar key={destino.id} api={api} sesion={sesion} viajeId={destino.id} />;
    if (nombre === 'calificaciones' && sesion !== undefined) return <Calificaciones api={api} sesion={sesion} idCalificacion={'id' in destino ? destino.id : undefined} />;
    if (nombre === 'estado-cuenta' && sesion !== undefined) return <EstadoDeCuenta api={api} sesion={sesion} />;
    if (nombre === 'operador' && sesion !== undefined) return <Operador api={api} />;
    if (nombre === 'otro-modulo' && sesion !== undefined) return <OtroModulo api={api} />;
    if (nombre === 'detalle-tecnico' && sesion !== undefined) return <DetalleTecnico apiPanel={apiPanel} />;
    if (nombre === 'm6-simulado' && sesion !== undefined) return <M6Simulado viajes={fuenteDeViajes} sesion={sesion} />;
    if (nombre === 'historial' && sesion !== undefined) return <Historial api={api} sesion={sesion} />;
    return <PantallaPendiente titulo={tituloPendiente} />;
  };

  return (
    <Marco sesion={sesion} ruta={ruta} etiquetas={ETIQUETAS} ultimo={ultimo} alCerrarSesion={cerrarSesion}>
      {pantalla(ruta, titulo)}
    </Marco>
  );
}
