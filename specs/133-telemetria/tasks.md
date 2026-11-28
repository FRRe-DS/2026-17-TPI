# Tareas — Spec 133 Telemetría OpenTelemetry hacia Grafana Cloud

- [ ] **T1. Configurar OTLP y proteger credenciales.** RNF-06.133.1, RNF-19.133.1
  - Hecho cuando: dependencias con versiones exactas, variables opcionales y endpoint validado sin exponer valores; pruebas en `pruebas/unitarias/` comprueban errores y ocultamiento.

- [ ] **T2. Iniciar y detener el SDK antes de cargar la aplicación ESM.** RNF-14.133.1, RNF-14.133.2, RNF-14.133.5
  - Hecho cuando: el preload y el hook ESM funcionan con Node 24 y en la imagen; sin endpoint no hay exportación; el cierre vacía los lotes y conserva señales y logs estructurados.

- [ ] **T3. Instrumentar HTTP, Fastify, PostgreSQL, llamadas salientes y runtime.** RNF-14.133.3, RNF-19.133.1
  - Hecho cuando: tráfico y consultas reales generan spans y la memoria heap de Node genera métricas observables en un exportador de pruebas, sin exportar cabeceras, query strings, cuerpos, identificadores ni valores SQL; solo se habilitan instrumentaciones necesarias.

- [ ] **T4. Comprobar Redis y proteger sus atributos.** RNF-14.133.3, RNF-19.133.1
  - Hecho cuando: una prueba con `redis@6.3.1` demuestra spans sin argumentos sensibles; si la instrumentación no es compatible, se documenta explícitamente la ausencia de trazas Redis sin cambiar la dependencia.

- [ ] **T5. Registrar contadores de dominio sin duplicar creaciones.** RNF-14.133.4
  - Hecho cuando: las pruebas comprueban éxitos, rechazos 4xx del servicio, 5xx sin rechazo, respuestas idempotentes y concurrencia con una sola creación contada; las respuestas y errores originales se conservan.

- [ ] **T6. Integrar Compose, documentar y validar.** RNF-06.133.1, RNF-20.133.1
  - Hecho cuando: las variables llegan a M2 sin secretos en el repositorio, se conservan los healthchecks, la guía explica configuración y verificación, y `npm test`, lint, build y `spec-check` pasan.
