# Tareas — Spec 133 Telemetría OpenTelemetry hacia Grafana Cloud

- [ ] **T1. Instalar dependencias exactas de OpenTelemetry y agregar configuración/privacidad OTLP en `config.ts` y `logs.ts` con tests.** RNF-01.1, RNF-06, RNF-19
  - Hecho cuando: `package.json` tiene versiones exactas sin `^`, `cargarConfig` valida `OTEL_EXPORTER_OTLP_ENDPOINT`, `secretosDeConfig` oculta `OTEL_EXPORTER_OTLP_HEADERS` y los tests unitarios pasan.

- [ ] **T2. Implementar `src/telemetria.ts` (OTLP/HTTP + auto-instrumentación + shutdown) e integrarlo en `src/servidor.ts` respetando logs Pino y comentarios.** RNF-16.1, RNF-16.2, RNF-16.3, RNF-14
  - Hecho cuando: sin endpoint no inicializa SDK remoto, con endpoint inicia `NodeSDK`, no hay `console.log`/`console.error`, los comentarios originales de `servidor.ts` siguen presentes y los tests unitarios pasan.

- [ ] **T3. Instrumentar las tres métricas de dominio de M2 (`m2_bloqueos_creados_total`, `m2_estado_cuenta_consultas_total`, `m2_calificaciones_registradas_total`) con tests.** RNF-16.4
  - Hecho cuando: `crearBloqueo`, `obtenerEstadoCuenta` y `calificarConductor` registran sus contadores sin alterar respuestas ni errores, cubierto por tests.

- [ ] **T4. Actualizar `docker-compose.yml` con variables OTLP opcionales, completar `guia.md` y ejecutar validación completa.** RNF-06, RNF-20
  - Hecho cuando: `docker-compose.yml` pasa variables OTLP sin secretos ni servicios de monitoreo locales, `guia.md` documenta la configuración de Grafana Cloud y `npm test`, `npm run lint`, `npm run build` y `node scripts/spec-check.mjs` pasan en verde.
