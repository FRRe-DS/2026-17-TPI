import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.js';
import './estilos/variables.css';
import './estilos/base.css';

const raiz = document.getElementById('raiz');
if (raiz === null) throw new Error('Falta el elemento #raiz en index.html');
createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
