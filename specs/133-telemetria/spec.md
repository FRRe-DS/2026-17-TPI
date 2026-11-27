# Spec 133 — Telemetría OpenTelemetry hacia Grafana Cloud

Estado: aprobada
Issue: #133
Etapa: TP3
Responsable: @chrgomez

## Contexto y objetivo
El Trabajo Práctico Integrador de DevOps requiere instrumentar el módulo M2 (Clientes) con OpenTelemetry para enviar métricas técnicas, trazas distribuidas y tres métricas propias del dominio a una plataforma APM con plan gratuito (Grafana Cloud).

El objetivo es incorporar la instrumentación mínima indispensable enviando directamente por OTLP/HTTP hacia Grafana Cloud mediante variables de entorno, sin levantar contenedores locales de Prometheus ni Grafana en el módulo y sin afectar las pruebas ni el flujo de trabajo cuando la telemetría no está configurada.

## Usuarios
- Quien opera M2 (DevOps / Integración): configura las variables OTLP de Grafana Cloud y analiza el comportamiento del servicio bajo carga (k6) y ante errores.
- Equipo de Desarrollo (Grupo 1): mantiene el servicio sin dependencias obligatorias de red externa durante desarrollo y pruebas automáticas.

## Historias de usuario
- HU-1. Como operador de DevOps, quiero que M2 envíe métricas técnicas, trazas y métricas de negocio directamente a Grafana Cloud por OTLP, para observar el módulo sin mantener servidores locales de monitoreo.
- HU-2. Como desarrollador del módulo, quiero que M2 arranque y ejecute sus pruebas normalmente cuando las variables OTLP no están configuradas, para no depender de Grafana Cloud en desarrollo ni en CI.
- HU-3. Como operador de DevOps, quiero que las credenciales de Grafana Cloud se configuren por variables de entorno y nunca aparezcan en logs ni en el repositorio, para cumplir con las reglas de seguridad del proyecto.

## Requisitos funcionales

## Requisitos no funcionales
- RNF-16.1: CUANDO la variable `OTEL_EXPORTER_OTLP_ENDPOINT` está configurada con una URL `http` o `https` válida, EL SISTEMA inicializa el SDK de OpenTelemetry antes de arrancar el servidor HTTP y exporta métricas y trazas por OTLP/HTTP hacia ese destino.
- RNF-16.2: MIENTRAS `OTEL_EXPORTER_OTLP_ENDPOINT` no está configurada, EL SISTEMA arranca normalmente sin inicializar exportadores remotos ni fallar, manteniendo las métricas de aplicación en modo no-op.
- RNF-16.3: CUANDO el SDK de OpenTelemetry está activo, EL SISTEMA captura automáticamente métricas técnicas y trazas de Fastify/HTTP, PostgreSQL, Redis y llamadas salientes a M6 mediante auto-instrumentación de Node.js.
- RNF-16.4: EL SISTEMA registra tres métricas propias del dominio de M2 bajo el meter `modulo-clientes`: `m2_bloqueos_creados_total` (contador con atributo `resultado`: `creado` | `rechazado`), `m2_estado_cuenta_consultas_total` (contador con atributo `resultado`: `exitosa` | `rechazada`) y `m2_calificaciones_registradas_total` (contador con atributo `resultado`: `creada` | `rechazada`).
- RNF-01.1: EL SISTEMA declara todas las dependencias de OpenTelemetry en `package.json` con versiones exactas, sin prefijos `^` ni `~`.
- RNF-06: EL SISTEMA lee la configuración OTLP desde variables de entorno (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` y `OTEL_SERVICE_NAME` con valor por defecto `m2-clientes`); SI `OTEL_EXPORTER_OTLP_ENDPOINT` tiene un valor que no es una URL `http` o `https` válida, ENTONCES EL SISTEMA rechaza el arranque indicando la variable inválida sin mostrar su contenido.
- RNF-14: EL SISTEMA registra el inicio, apagado y errores críticos de telemetría en formato JSON estructurado compatible con Pino, sin usar `console.log` ni `console.error`.
- RNF-19: EL SISTEMA oculta el contenido de `OTEL_EXPORTER_OTLP_HEADERS` mediante la lista de secretos del logger y nunca escribe tokens ni credenciales OTLP en logs, respuestas HTTP ni archivos del repositorio.
- RNF-20: EL SISTEMA documenta en la guía de esta spec las variables de entorno requeridas, el origen de las credenciales en Grafana Cloud y cómo verificar localmente el envío de telemetría.

## Contrato y dependencias
- Operaciones del contrato que cubre: ninguna ruta nueva ni cambios en `contrato/openapi.yml`. Las métricas de negocio instrumentan `crearBloqueo`, `obtenerEstadoCuenta` y `calificarConductor`.
- Operaciones de otros módulos que consume: ninguna. El envío OTLP apunta al endpoint externo configurado (Grafana Cloud). Si el endpoint OTLP no responde o falla, la exportación asíncrona descarta o reintenta en segundo plano sin bloquear ni fallar las respuestas HTTP de M2.

## Casos límite
- `OTEL_EXPORTER_OTLP_ENDPOINT` vacío o ausente: se considera no configurado; el servicio arranca sin exportadores remotos (RNF-16.2).
- `OTEL_EXPORTER_OTLP_ENDPOINT` con formato inválido (ej. `ftp://...` o texto suelto): `cargarConfig` rechaza el arranque con error sobre esa variable (RNF-06).
- `OTEL_EXPORTER_OTLP_ENDPOINT` presente sin `OTEL_EXPORTER_OTLP_HEADERS`: el SDK inicializa igual (útil si se apunta a un collector local sin autenticación).
- Caída o latencia alta de Grafana Cloud: las operaciones de M2 responden al cliente sin esperar la exportación OTLP.
- Señal `SIGTERM` o `SIGINT` durante ejecución: `detener` apaga el SDK de telemetría para vaciar los lotes pendientes antes de finalizar el proceso.

## Fuera de alcance
- Levantar Prometheus o Grafana locales en `docker-compose.yml` o mantener archivos `prometheus.yml`.
- Implementar un `otel-collector` local mientras el envío directo a Grafana Cloud sea suficiente.
- Cambiar rutas, esquemas o respuestas del contrato OpenAPI.
- Pruebas de carga k6 (corresponden a una etapa posterior de rendimiento).

## Criterios de finalización
- `OTEL_EXPORTER_OTLP_ENDPOINT` validado en `config.ts` y `OTEL_EXPORTER_OTLP_HEADERS` protegido en `logs.ts`.
- `src/telemetria.ts` inicializa `NodeSDK` con exportadores OTLP/HTTP y auto-instrumentación solo cuando corresponde, y se apaga ordenadamente en `SIGTERM`/`SIGINT`.
- Las tres métricas de dominio (`m2_bloqueos_creados_total`, `m2_estado_cuenta_consultas_total`, `m2_calificaciones_registradas_total`) se registran en `clientes/servicio.ts` y `calificaciones/servicio.ts`.
- Todas las dependencias nuevas en `package.json` tienen versión exacta sin `^`.
- `npm test`, `npm run lint`, `npm run build` y `node scripts/spec-check.mjs` pasan en verde.

## Decisiones
- Envío OTLP/HTTP directo a Grafana Cloud en lugar de levantar Prometheus y Grafana locales: evita mantener infraestructura duplicada en el repo de M2 y cumple el requisito de plataforma APM externa del TP. Si bajo carga extrema (500-1000 VUs) se necesitara desacoplar TLS/batching, puede intercalarse un `otel-collector` cambiando solo `OTEL_EXPORTER_OTLP_ENDPOINT`.
- Tres métricas específicas de dominio (`m2_bloqueos_creados_total`, `m2_estado_cuenta_consultas_total`, `m2_calificaciones_registradas_total`) en reemplazo de `solicitudes_aceptadas` y `tiempo_asignacion_ms`: representan operaciones centrales de M2 Clientes y se complementan con las métricas HTTP/DB/Redis que aporta la auto-instrumentación.

## Dudas abiertas
