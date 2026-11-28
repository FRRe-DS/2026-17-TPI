# Plan — Spec 133 Telemetría OpenTelemetry hacia Grafana Cloud

## Contrato
Sin cambios en `contrato/openapi.yml`. Se instrumentan `crearBloqueo`, `obtenerEstadoCuenta` y `calificarConductor` sin cambiar firmas, códigos ni esquemas.

## Datos
Sin cambios en PostgreSQL ni Redis. Los contadores no reemplazan las restricciones ni la idempotencia de la base y no son persistentes: se reinician al reiniciar el proceso.

## Lógica
1. **Configuración y privacidad (RNF-06.133.1, RNF-19.133.1):** `config.ts` valida el endpoint opcional y los encabezados y nombre de servicio salen del entorno. `logs.ts` oculta los secretos OTLP. Las dependencias se fijan según RNF-01.1 de la 003.
2. **Arranque ESM y cierre (RNF-14.133.1, RNF-14.133.2, RNF-14.133.5):** cargar el SDK mediante `node --import ./dist/telemetria.js dist/servidor.js`, con el hook ESM de OpenTelemetry registrado antes de importar las librerías instrumentadas; actualizar el CMD de `Dockerfile`. El preload debe iniciar el SDK solo con endpoint configurado y compartir su cierre con `servidor.ts`, sin cambiar el manejo de señales ni comentarios. Probar en Node 24 y con la imagen real: `--import` por sí solo no demuestra que el hook ESM esté activo.
3. **Instrumentación mínima (RNF-14.133.3):** seleccionar explícitamente HTTP, Undici para `fetch`, PostgreSQL, runtime Node para la memoria heap y, si se demuestra compatible, Redis; instrumentar Fastify con una alternativa compatible o cobertura HTTP equivalente, sin habilitar el paquete completo por defecto. La dependencia antigua `@opentelemetry/instrumentation-fastify` fue retirada; evaluar `@fastify/otel` sin asumir que un cambio de dependencia ya está aprobado. Confirmar con prueba real si la instrumentación elegida intercepta `redis@6.3.1`; si no lo hace, documentar la ausencia de trazas Redis, sin sustituir la dependencia Redis ni prometer cobertura.
4. **Atributos de trazas (RNF-19.133.1):** usar lista permitida o sanitización antes de exportar para conservar solo servicio, operación o plantilla de ruta, método, estado y duración. Excluir encabezados, query strings, rutas con valores identificatorios, cuerpos, valores SQL y argumentos Redis; cubrir también excepciones, eventos, atributos de recurso y propagación para que no filtren datos sensibles. No asumir que los valores por defecto del SDK los eliminan.
5. **Contadores (RNF-14.133.4):** incrementar éxitos de creación solo cuando se confirma una creación nueva, no al recuperar respuesta idempotente; comprobar claves concurrentes iguales. Contar rechazos 4xx de negocio lanzados por el servicio; 5xx y rechazos HTTP anteriores al servicio no incrementan rechazo. La consulta de estado exitosa cuenta cada lectura servida, incluso desde caché. Las decisiones de transacción, respuestas y errores no cambian.
6. **Compose y documentación (RNF-06.133.1, RNF-20.133.1):** pasar las tres variables OTLP solo a M2, sin credenciales en el repositorio; conservar los healthchecks existentes y documentar credenciales, comandos y verificación.

## Integraciones
- Grafana Cloud: OTLP/HTTP asíncrono y opcional; una caída no modifica las respuestas de M2. Sin endpoint no hay exportación ni dependencia de red externa.
- M6 y Keycloak mantienen sus clientes, límites de tiempo y reintentos actuales; la telemetría no altera sus contratos.

## Decisiones
- Envío directo a Grafana Cloud y alternativas descartadas: [ADR 133](../../docs/adr/133-telemetria.md).
- Instrumentación por lista explícita y filtrado antes de exportar: evita recoger atributos o librerías fuera del alcance y facilita verificar privacidad.
- Rechazos 4xx de dominio separados de errores 5xx; reintentos idempotentes no representan nuevas creaciones.

## Pruebas
- `pruebas/unitarias/`: configuración válida, inválida y ausente; secretos ocultos; inicio y cierre del SDK; contadores, 4xx de dominio, 5xx, repetición y concurrencia idempotente.
- Prueba con exportador en memoria y tráfico real del proceso ESM y la imagen: span HTTP entrante, PostgreSQL, `fetch` saliente y Redis cuando corresponda. Inspeccionar atributos, eventos y excepciones con valores centinela para probar ausencia de secretos y datos personales, sin enviar datos reales a Grafana.
- Verificar sin endpoint y con endpoint inaccesible que M2 mantiene sus respuestas y se detiene ordenadamente; validar el primer contador tras el arranque real, no solo un mock del orden de imports.
- `npm test`, `npm run lint`, `npm run build` y `node scripts/spec-check.mjs`; documentar la verificación en Grafana en la guía.
