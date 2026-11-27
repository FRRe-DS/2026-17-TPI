# Plan — Spec 133 Telemetría OpenTelemetry hacia Grafana Cloud

## Contrato
Sin cambios en `contrato/openapi.yml`. Se instrumentan los flujos existentes de `crearBloqueo`, `obtenerEstadoCuenta` y `calificarConductor` sin alterar sus firmas HTTP, códigos de respuesta ni esquemas.

## Datos
Sin cambios en PostgreSQL ni Redis. No hay migraciones.

## Lógica
1. **Configuración y secretos (`src/config.ts`, `src/logs.ts` — RNF-06, RNF-19):**
   - `Config` incorpora `otelEndpoint?: string`, `otelHeaders?: string` y `otelServicio: string` (default `m2-clientes`).
   - `OTEL_EXPORTER_OTLP_ENDPOINT` es opcional; si viene con texto no vacío se valida con `urlHttp`.
   - `secretosDeConfig` agrega `otelHeaders` (y el token extraído si tiene esquema `Basic`/`Bearer`) para ocultarlo en cualquier log.
2. **Inicialización y apagado (`src/telemetria.ts`, `src/servidor.ts` — RNF-16.1, RNF-16.2, RNF-16.3, RNF-14):**
   - `inicializarTelemetria(env)` lee `OTEL_EXPORTER_OTLP_ENDPOINT`. Si falta o está vacío, devuelve `undefined` sin iniciar el SDK (RNF-16.2).
   - Si existe, crea `NodeSDK` con `serviceName`, `OTLPMetricExporter` (dentro de `PeriodicExportingMetricReader`), `OTLPTraceExporter` y `getNodeAutoInstrumentations()` (RNF-16.1, RNF-16.3).
   - `src/servidor.ts` conserva intactos todos sus comentarios originales sobre señales, inicializa telemetría antes de `arrancar` y usa formato JSON Pino ante fallos críticos (RNF-14). Al recibir parada, invoca `sdk.shutdown()` antes de salir.
3. **Métricas de dominio (`src/telemetria.ts`, `src/clientes/servicio.ts`, `src/calificaciones/servicio.ts` — RNF-16.4):**
   - `obtenerMetricasModulo()` obtiene los contadores del meter `modulo-clientes` (no-op seguro si no hay SDK):
     - `m2_bloqueos_creados_total`: en `crearBloqueo`, suma 1 con `{ resultado: 'creado' }` al confirmar en `conIdempotencia`, o `{ resultado: 'rechazado' }` si lanza error de dominio/validación.
     - `m2_estado_cuenta_consultas_total`: en `obtenerEstadoCuenta`, suma 1 con `{ resultado: 'exitosa' }` al resolver o `{ resultado: 'rechazada' }` si falla.
     - `m2_calificaciones_registradas_total`: en `calificarConductor`, suma 1 con `{ resultado: 'creada' }` al confirmar o `{ resultado: 'rechazada' }` si falla.
4. **Dependencias y entorno (`package.json`, `docker-compose.yml` — RNF-01.1, RNF-06, RNF-20):**
   - Paquetes `@opentelemetry/*` instalados con `--save-exact` (sin `^`).
   - `docker-compose.yml` solo expone las variables opcionales `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` y `OTEL_SERVICE_NAME` en el servicio `m2`, manteniendo `panel` con `condition: service_healthy` y sin servicios locales de Prometheus ni Grafana.

## Integraciones
- **Grafana Cloud (OTLP/HTTP):** envío directo asíncrono en segundo plano. Si no responde, las respuestas de M2 no se bloquean ni devuelven error.

## Decisiones
- **OTLP/HTTP directo en lugar de `otel-collector` o Prometheus local:** evita contenedores adicionales en `docker-compose.yml` y cumple YAGNI. Alternativa descartada: levantar `prom/prometheus` + `grafana/grafana` o `grafana/otel-lgtm` en el repo.
- **Métricas vía API global `@opentelemetry/api`:** permite que los servicios funcionen idénticamente en tests unitarios sin inicializar `NodeSDK`.

## Pruebas
- Unitarias en `test/` (o junto al módulo de pruebas existente) para:
  - Validación de `OTEL_EXPORTER_OTLP_ENDPOINT` válido/inválido/ausente y ocultamiento de `OTEL_EXPORTER_OTLP_HEADERS` en `secretosDeConfig` (RNF-06, RNF-19).
  - Inicialización no-op cuando no hay endpoint y registro sin errores de las tres métricas en los servicios (RNF-16.2, RNF-16.4).
- Suite completa existente (`npm test`, `npm run lint`, `npm run build`, `node scripts/spec-check.mjs`).
