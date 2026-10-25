# M6 — consumo de M2 y preguntas pendientes

Estado: contrato del Grupo 12 subido a la cátedra ([FRRe-DS/2026-TPI#9](https://github.com/FRRe-DS/2026-TPI/pull/9), commit `9e720a0`), adoptado por el grupo aunque el PR no está mergeado. ADR: [057](../../docs/adr/057-m6-catedra.md), que reemplaza al [002](../../docs/adr/002-dependencia-m6.md). Issue: #57.
Alcance: RF-2.4, RF-2.5 y RNF-05.

## Qué consume M2

| Consumo | Contrato (`m6.yml`) |
|---|---|
| Historial (RF-2.4, spec 007) | `GET /trips?clientId=…&page=…&pageSize=…`. `page` desde 1, `pageSize` de 1 a 100. Responde `TripSummaryPage { items, page, pageSize, total }`, ordenado por `createdAt` descendente. M2 traduce su `page` (desde 0) sumando 1. |
| Verificar viaje (RF-2.5, spec 008) | `GET /trips/{id}`: `Trip` con `state`, `clientId` y `driverId`. `COMPLETED` es el estado que habilita calificar. |
| Autorización | Bearer JWT. M6 acepta `roles` como lista, incluido `SERVICIO` (ADR 009). Un token de servicio tiene que mandar al menos un filtro (`400 FILTER_REQUIRED` sin filtro); M2 siempre manda `clientId`. |
| Errores | `application/json` con `ErrorResponse { code, message, timestamp, correlationId }`. M2 no lee el cuerpo de un error de M6. |

## Estado de las preguntas del ADR 002

1. Contrato compartido, versión y URL: respondida. Es el de la cátedra, versión 1.0.0. La URL de desarrollo es `http://localhost:3006/api/v1`; M2 la configura con `M2_URL_M6`.
2. El filtro `clientId` devuelve solo viajes de ese cliente: respondida para el rol de servicio. M2 igual descarta un viaje de otro cliente (spec 007, RF-2.4.9).
3. `COMPLETED` habilita calificar: respondida (descripción de `GET /trips/{id}`).
4. Paginación y orden: respondida. Sigue sin decir qué responde ante una página fuera del total; M2 lo trata como página vacía.
5. Campos obligatorios: **abierta**. Ni `Trip` ni `TripSummary` declaran `required`. M2 exige `id` y `state` en texto; si faltan, responde `503` (spec 007, RF-2.4.10).
6. Autorización entre módulos: respondida en parte (`roles: ["SERVICIO"]`). **Abierta**: qué `iss` y `aud` valida M6.
7. Errores y correlación: respondida en parte (`ErrorResponse`, `400`, `401`, `403` y `404` en `GET /trips/{id}`). **Abierta**: qué encabezado de correlación lee M6; M2 manda `X-Request-Id`.
8. Ejemplos acordados para pruebas: **abierta**.

## Mensaje preparado — no enviado

Para el Grupo 12 (copia al Grupo 5):

> Desde el Grupo 17 (M2), gracias por subir el contrato de M6 a la cátedra (PR #9): ya lo adoptamos para el historial de viajes y la calificación. Nos quedan tres dudas. (1) Para el token de servicio de M2, ¿qué `iss` y qué `aud` valida M6? Según el acuerdo de M1 (ADR 009) proponemos `iss: m1-identidad`, `aud: m6-viajes`, `sub: m2-clientes` y `roles: ["SERVICIO"]`, firmado con HS256 y la clave compartida de desarrollo. (2) ¿Qué encabezado de correlación leen? Nosotros mandamos `X-Request-Id`. (3) ¿`id` y `state` vienen siempre en `TripSummary` y en `Trip`? Si nos pueden pasar un ejemplo real de `GET /trips?clientId=…` con y sin viajes, lo usamos en nuestras pruebas.
