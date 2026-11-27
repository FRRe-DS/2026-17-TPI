import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './estilos/variables.css';
import './estilos/base.css';

const raiz = document.getElementById('raiz');
if (raiz === null) throw new Error('Falta el elemento #raiz en index.html');
const contenedor = createRoot(raiz);
async function iniciar() {
  const respuesta = await fetch('/panel/config', { cache: 'no-store' });
  if (!respuesta.ok) throw new Error('No se pudo cargar la configuración');
  const config = await respuesta.json() as { modoAuth: string; m6Simulado: boolean };
  if (config.modoAuth === 'oidc') {
    const { AppReal } = await import('./app-real.js');
    contenedor.render(<StrictMode><AppReal m6Simulado={config.m6Simulado} /></StrictMode>);
  } else if (config.modoAuth === 'desarrollo') {
    const { App } = await import('./app.js');
    contenedor.render(<StrictMode><App /></StrictMode>);
  } else throw new Error('Modo desconocido');
}
void iniciar().catch(() => contenedor.render(<main><h1>No se pudo abrir la aplicación</h1><button onClick={() => window.location.reload()}>Reintentar</button></main>));
