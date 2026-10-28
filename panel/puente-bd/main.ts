import { crearPuente, leerConfigPuente } from './puente.js';

// El punto de entrada del puente: `node panel/dist/puente-bd/main.js`, el CMD de la imagen `puente-bd` (spec 072, RNF-04.8).
// Una línea JSON por evento, con el formato del resto del panel (nivel de pino, hora en milisegundos), sin direcciones ni valores.
const registrar = (level: number, msg: string, extra: Record<string, unknown> = {}) =>
  process.stdout.write(`${JSON.stringify({ level, time: Date.now(), servicio: 'puente-bd', ...extra, msg })}\n`);

const { config, errores } = leerConfigPuente(process.env);
if (errores) {
  for (const { variable, motivo } of errores) registrar(50, 'Configuración inválida', { variable, motivo });
  process.exit(1);
}

const puente = crearPuente({ ...config, alError: (codigo) => registrar(40, 'No se pudo unir una conexión con el destino', { codigo }) });
puente.on('error', (error: NodeJS.ErrnoException) => {
  registrar(50, 'El puente no pudo arrancar', { codigo: error.code ?? error.name });
  process.exit(1);
});

// SIGTERM es la de `docker compose stop`; SIGINT, la de Ctrl+C. Una sola parada, en orden (RNF-04.5).
for (const senal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(senal, () => {
    registrar(30, 'Deteniendo el puente');
    puente.close(() => process.exit(0));
  });
}

puente.listen(config.puerto, config.escucha, () => registrar(30, 'Puente escuchando', { puerto: config.puerto }));
