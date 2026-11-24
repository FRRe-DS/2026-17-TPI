import { useEffect, useState, useSyncExternalStore } from 'react';
import { crearApiM2 } from './api/m2.js';
import { crearApiPanel } from './api/panel.js';
import { Marco } from './componentes/marco.js';
import { Titulo } from './componentes/titulo.js';
import { crearSesionReal } from './fuentes/sesion-real.js';
import { usarRuta } from './hooks/usar-ruta.js';
import { espaciosDe, permiteRutaReal, type Espacio } from './logica/permisos-reales.js';
import { crearUltimoPedido } from './logica/ultimo-pedido.js';
import { IngresarReal } from './pantallas/ingresar-real.js';
import { Perfil } from './pantallas/perfil.js';
import { Direcciones } from './pantallas/direcciones.js';
import { PantallaPreferencias } from './pantallas/preferencias.js';
import { Historial } from './pantallas/historial.js';
import { Calificar } from './pantallas/calificar.js';
import { Calificaciones } from './pantallas/calificaciones.js';
import { EstadoDeCuenta } from './pantallas/estado-cuenta.js';
import { Operador } from './pantallas/operador.js';
import { DetalleTecnico } from './pantallas/detalle-tecnico.js';
import { enlace, inicioDe } from './rutas.js';

const fuente = crearSesionReal();
const ultimoPedido = crearUltimoPedido();
const api = crearApiM2({ tiempoMaximoMs: 15_000, alTerminar: pedido => { ultimoPedido.publicar(pedido); if (pedido.estado === 401) fuente.vencer(); } });
const apiPanel = crearApiPanel();
const AVISOS: Record<string, string> = { invalido: 'No se pudo completar el ingreso. Volvé a intentarlo.', 'no-disponible': 'Identidad no disponible. Intentá más tarde.',
  completa: 'Cerraste la sesión.', 'no-confirmada': 'La sesión local está cerrada. No se confirmó el cierre en Keycloak.' };

export function AppReal({ m6Simulado = true }: { m6Simulado?: boolean }) {
  const estado = useSyncExternalStore(fuente.suscribir, fuente.actual);
  const [elegido, elegir] = useState<Espacio>('CLIENTE');
  const espacios = estado.sesion ? espaciosDe(estado.sesion) : [];
  const espacio = espacios.includes(elegido) ? elegido : espacios[0] ?? 'CLIENTE';
  const sesion = estado.sesion && { sub: estado.sesion.sub, rol: espacios.length ? espacio : 'CONDUCTOR' as const };
  const { ruta } = usarRuta(sesion);
  const ultimo = useSyncExternalStore(ultimoPedido.suscribir, ultimoPedido.actual);
  useEffect(() => { void fuente.actualizar(); const temporizador = setInterval(() => void fuente.actualizar(), 60_000); return () => clearInterval(temporizador); }, []);
  const cerrar = () => { const formulario = document.createElement('form'); formulario.method = 'post'; formulario.action = '/auth/cerrar'; document.body.append(formulario); formulario.submit(); };
  const parametros = new URLSearchParams(window.location.search);
  const aviso = AVISOS[parametros.get('acceso') ?? parametros.get('salida') ?? ''];
  const pantalla = () => {
    if (estado.estado === 'cargando') return <><Titulo>Ingresar</Titulo><p role="status">Consultando sesión…</p></>;
    if (!sesion) return estado.estado === 'no-disponible'
      ? <><Titulo>Identidad no disponible</Titulo><button onClick={() => void fuente.actualizar()}>Reintentar</button></>
      : <IngresarReal aviso={aviso} />;
    if (!estado.sesion || !permiteRutaReal(ruta.pantalla, estado.sesion, espacio)) return <><Titulo>Acceso no permitido</Titulo><p>Tu cuenta no tiene permisos para esta pantalla.</p></>;
    const nombre = ruta.pantalla;
    const id = 'id' in ruta ? ruta.id : undefined;
    if (nombre === 'perfil') return <Perfil api={api} sesion={sesion} />;
    if (nombre === 'direcciones') return <Direcciones api={api} sesion={sesion} idDireccion={id} />;
    if (nombre === 'preferencias') return <PantallaPreferencias api={api} sesion={sesion} />;
    if (nombre === 'historial') return <Historial api={api} sesion={sesion} />;
    if (nombre === 'calificar' && id) return <Calificar key={id} api={api} sesion={sesion} viajeId={id} />;
    if (nombre === 'calificaciones') return <Calificaciones api={api} sesion={sesion} idCalificacion={id} />;
    if (nombre === 'estado-cuenta') return <EstadoDeCuenta api={api} sesion={sesion} />;
    if (nombre === 'operador') return <Operador api={api} />;
    if (nombre === 'detalle-tecnico') return <DetalleTecnico apiPanel={apiPanel} />;
    return <Titulo>Pantalla no encontrada</Titulo>;
  };
  return <Marco modoReal sesion={sesion} ruta={ruta} etiquetas={m6Simulado ? [{ de: 'Viajes', texto: 'M6 simulado' }] : []} ultimo={ultimo} alCerrarSesion={cerrar}>
    {espacios.length > 1 && <label>Espacio <select value={espacio} onChange={evento => { const nuevo = evento.target.value as Espacio; elegir(nuevo); window.location.hash = enlace(inicioDe(nuevo)); }}>
      <option value="CLIENTE">Mi cuenta</option><option value="OPERADOR">Operación</option></select></label>}
    {pantalla()}
  </Marco>;
}
