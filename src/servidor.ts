import { inicializarTelemetria } from './telemetria.js';
import { arrancar, type Servicio } from './arranque.js';

// Las señales de parada: SIGTERM es la de `docker stop` y `docker compose stop`; SIGINT, la de Ctrl+C en una terminal.
const SENALES_DE_PARADA = ['SIGTERM', 'SIGINT'] as const;

// El punto de entrada del servicio: `node dist/servidor.js`
const parada = new AbortController();
let servicio: Servicio | undefined = undefined;

for (const senal of SENALES_DE_PARADA) {
  process.on(senal, () => {
    if (servicio) void servicio.detener();
    else parada.abort();
  });
}

// Función principal para asegurar que todo arranque en orden
async function iniciarServicio() {
  try {
    // 1. Inicializamos la telemetría y esperamos a que esté lista
    await inicializarTelemetria();
    
    // 2. Arrancamos el servicio
    servicio = await arrancar(process.env, (codigo) => process.exit(codigo), { 
      parada: parada.signal 
    });
  } catch (error) {
    console.error("Error crítico durante el arranque:", error);
    process.exit(1);
  }
}

// Ejecutamos el arranque
void iniciarServicio();