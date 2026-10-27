import { usarRuta } from './hooks/usar-ruta.js';
import { TITULOS } from './rutas.js';

// El esqueleto del panel: elige la pantalla según el hash. La sesión (T15) y las pantallas (tramo D) se suman después; hasta
// entonces no hay sesión y toda ruta lleva a `#/ingresar`.
export function App() {
  const { ruta } = usarRuta(undefined);
  const titulo = ruta.pantalla === 'raiz' ? TITULOS.ingresar : TITULOS[ruta.pantalla];

  return (
    <main>
      <h1>{titulo}</h1>
    </main>
  );
}
