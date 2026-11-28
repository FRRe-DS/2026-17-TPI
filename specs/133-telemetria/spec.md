# Spec 133 — Telemetría OpenTelemetry hacia Grafana Cloud

Estado: aprobada
Issue: #133
Etapa: TP3
Responsable: @chrgomez y @adrinikcevich

## Contexto y objetivo
El Trabajo Práctico Integrador de DevOps requiere instrumentar el módulo M2 (Clientes) con OpenTelemetry para enviar métricas técnicas, trazas distribuidas y tres métricas propias del dominio a una plataforma APM con plan gratuito (Grafana Cloud).

El objetivo es incorporar la instrumentación mínima indispensable enviando directamente por OTLP/HTTP hacia Grafana Cloud mediante variables de entorno, sin levantar contenedores locales de Prometheus ni Grafana en el módulo y sin afectar las pruebas ni el flujo de trabajo cuando la telemetría no está configurada.

## Usuarios
- Quien opera M2 (DevOps / Integración): configura las variables OTLP de Grafana Cloud y analiza el comportamiento del servicio bajo carga (k6) y ante errores.
- Equipo de Desarrollo (Grupo 17): mantiene el servicio sin dependencias obligatorias de red externa durante desarrollo y pruebas automáticas.

## Historias de usuario
- HU-1. Como operador de DevOps, quiero que M2 envíe métricas técnicas, trazas y métricas de negocio directamente a Grafana Cloud por OTLP, para observar el módulo sin mantener servidores locales de monitoreo.
- HU-2. Como desarrollador del módulo, quiero que M2 arranque y ejecute sus pruebas normalmente cuando las variables OTLP no están configuradas, para no depender de Grafana Cloud en desarrollo ni en CI.
- HU-3. Como operador de DevOps, quiero que las credenciales de Grafana Cloud se configuren por variables de entorno y nunca aparezcan en logs ni en el repositorio, para cumplir con las reglas de seguridad del proyecto.

## Requisitos funcionales

Ninguno.

## Requisitos no funcionales
- RNF-14.133.1: CUANDO `OTEL_EXPORTER_OTLP_ENDPOINT` contiene una URL válida, EL SISTEMA inicia la telemetría antes de cargar el servicio y exporta métricas y trazas por OTLP/HTTP.
- RNF-14.133.2: MIENTRAS `OTEL_EXPORTER_OTLP_ENDPOINT` no está configurada, EL SISTEMA arranca sin exportadores remotos y mantiene las métricas de aplicación en modo no-op.
- RNF-14.133.3: CUANDO la telemetría está activa, EL SISTEMA captura trazas de HTTP/Fastify, PostgreSQL y llamadas salientes a M6 y Keycloak, y métricas técnicas de memoria heap de Node.js; captura trazas de Redis solo si se comprueba la compatibilidad con `redis@6.3.1`.
- RNF-14.133.4: EL SISTEMA registra bajo el meter `modulo-clientes` los contadores `m2_bloqueos_creados_total` (`resultado`: `creado` | `rechazado`), `m2_estado_cuenta_consultas_total` (`exitosa` | `rechazada`) y `m2_calificaciones_registradas_total` (`creada` | `rechazada`); una repetición idempotente exitosa no vuelve a contar la creación. Los resultados de rechazo cuentan solo errores de negocio 4xx surgidos en el servicio; los errores 5xx, incluidos fallos de M6, no incrementan esos resultados.
- RNF-14.133.5: EL SISTEMA registra el inicio, apagado y errores críticos de telemetría en JSON estructurado compatible con Pino, sin `console.log` ni `console.error`.
- RNF-06.133.1: EL SISTEMA lee `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` y `OTEL_SERVICE_NAME` (por defecto `m2-clientes`); SI el endpoint no es una URL HTTP o HTTPS válida sin credenciales, ENTONCES EL SISTEMA rechaza el arranque indicando la variable sin mostrar su valor.
- RNF-19.133.1: EL SISTEMA excluye de trazas, métricas y logs credenciales, encabezados de autorización, query strings, cuerpos, valores de parámetros SQL y argumentos de Redis; exporta solo atributos técnicos permitidos: nombre de servicio, operación o plantilla de ruta, método, estado y duración, sin identificadores personales.
- RNF-20.133.1: EL SISTEMA documenta en la guía las variables OTLP, el origen de credenciales y cómo verificar localmente el envío.

## Contrato y dependencias
- Operaciones del contrato que cubre: ninguna ruta nueva ni cambios en `contrato/openapi.yml`. Las métricas de negocio instrumentan `crearBloqueo`, `obtenerEstadoCuenta` y `calificarConductor`.
- Operaciones de otros módulos que consume: ninguna. El envío OTLP apunta al endpoint externo configurado (Grafana Cloud). Si el endpoint OTLP no responde o falla, la exportación asíncrona descarta o reintenta en segundo plano sin bloquear ni fallar las respuestas HTTP de M2.

## Casos límite
- `OTEL_EXPORTER_OTLP_ENDPOINT` vacío o ausente: se considera no configurado; el servicio arranca sin exportadores remotos (RNF-14.133.2).
- `OTEL_EXPORTER_OTLP_ENDPOINT` con formato inválido (ej. `ftp://...` o texto suelto): `cargarConfig` rechaza el arranque con error sobre esa variable (RNF-06.133.1).
- `OTEL_EXPORTER_OTLP_ENDPOINT` presente sin `OTEL_EXPORTER_OTLP_HEADERS`: el SDK inicializa igual (útil si se apunta a un collector local sin autenticación).
- Caída o latencia alta de Grafana Cloud: las operaciones de M2 responden al cliente sin esperar la exportación OTLP.
- Señal `SIGTERM` o `SIGINT` durante ejecución: `detener` apaga el SDK de telemetría para vaciar los lotes pendientes antes de finalizar el proceso.
- Una repetición exitosa de `crearBloqueo` o `calificarConductor` con la misma clave y cuerpo devuelve la respuesta guardada sin incrementar otra vez `creado` o `creada`.
- Los rechazos HTTP previos al servicio (autenticación, permisos o validación de contrato) no se cuentan como rechazos de dominio; un 5xx se observa en las trazas y métricas técnicas, no como rechazo de negocio.

## Fuera de alcance
- Métricas de CPU y memoria de infraestructura: su recopilación e integración con Grafana dependen de la plataforma de despliegue.
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
- Tres métricas específicas de dominio representan operaciones centrales de M2 Clientes y se complementan con las trazas técnicas.
- Los resultados de rechazo cuentan solo errores 4xx de negocio en el servicio: así no se confunden rechazos de negocio con fallas de infraestructura, observables mediante telemetría técnica.

## Dudas abiertas
Ninguna.
