# M6 — consumo de M2 y preguntas pendientes

Estado: contrato de M6 (Grupos 5 y 12) publicado en la cátedra, `contratos/m6_viajes/openapi.yml`, commit `35b3c4d` (2026-11-01, «Contrato confirmado por ambos grupos»). `m6.yml` es su extracción desde el 2026-11-10. ADR: [096](../../docs/adr/096-m6-35b3c4d.md), que actualiza al [057](../../docs/adr/057-m6-catedra.md); el 057 reemplazó al [002](../../docs/adr/002-dependencia-m6.md). Issue: #96.
Alcance: RF-2.4, RF-2.5 y RNF-05.

## Qué consume M2

| Consumo | Contrato (`m6.yml`) |
|---|---|
| Historial (RF-2.4, spec 007) | `GET /trips?clientId=…&page=…&pageSize=…` (`listTrips`). `page` desde 1, `pageSize` de 1 a 100. Responde `TripSummaryPage { items, page, pageSize, total }`, del más reciente al más antiguo. M2 traduce su `page` (desde 0) sumando 1. |
| Verificar viaje (RF-2.5, spec 008) | `GET /trips/{tripId}` (`getTrip`): `Trip` con `state`, `clientId` y `driverId`, los tres obligatorios. M2 califica solo un viaje `COMPLETED`. |
| Autorización | Bearer JWT con `exp`. El contrato nombra el rol `SYSTEM` para llamadas entre módulos. Un token `SYSTEM` tiene que mandar `clientId` o `driverId` (`400 VALIDATION` sin ninguno); M2 siempre manda `clientId`. M2 se presenta con `roles: ["SERVICIO"]`: el M6 del Grupo 12 lo acepta como alias de `SYSTEM` y lo documenta en su repositorio, todavía no en la cátedra. |
| Errores | `application/problem+json` con `Problem { type, title, status, code, message, timestamp }` y un `code` de lista cerrada. M2 no lee el cuerpo de un error de M6. |
| Correlación | `X-Correlation-Id`. M2 manda hoy `X-Request-Id` (`M2_ENCABEZADO_CORRELACION`); enviarlo va en el cambio de las specs 007 y 008. |
| Límite de pedidos | 1200 por minuto para un servicio; `429` con `Retry-After` al superarlo. Qué responde M2 ante ese `429` va en el mismo cambio de specs. |

## Estado de las preguntas del ADR 002

1. Contrato compartido, versión y URL: respondida. Es el de la cátedra, versión 1.0.0. Las URL de desarrollo son `http://localhost:3006` (Grupo 12) y `http://localhost:3000` (Grupo 5), sin `/api/v1`; M2 la configura con `M2_URL_M6`.
2. El filtro `clientId` devuelve solo viajes de ese cliente: respondida para el rol de servicio. M2 igual descarta un viaje de otro cliente (spec 007, RF-2.4.9).
3. `COMPLETED` habilita calificar: respondida. Es el estado final de un viaje terminado; la versión actual ya no nombra la calificación en `getTrip`, la regla es de M2 (RF-2.5).
4. Paginación y orden: respondida. Sigue sin decir qué responde ante una página fuera del total; M2 lo trata como página vacía.
5. Campos obligatorios: respondida. `TripSummary` exige `id`, `state`, `vehicleType`, `clientId`, `driverId` y `createdAt`; `Trip` exige además `requestId`, `reservationId`, `vehicleId`, las coordenadas y `version`. M2 sigue exigiendo solo `id` y `state` en texto; si faltan, responde `503` (spec 007, RF-2.4.10).
6. Autorización entre módulos: respondida en parte (rol `SYSTEM`; `SERVICIO` como alias en el M6 del Grupo 12). **Abierta**: qué `iss` y `aud` valida M6, preguntado en [FRRe-DS/2026-12-TPI#9](https://github.com/FRRe-DS/2026-12-TPI/issues/9).
7. Errores y correlación: respondida. `Problem` en `application/problem+json`; `400`, `401`, `403` y `429` en `listTrips`; `304`, `401`, `404` y `429` en `getTrip`; encabezado `X-Correlation-Id`.
8. Ejemplos acordados para pruebas: respondida en parte. `Trip` trae un ejemplo en el contrato, y la spec 081 prueba contra el M6 real del Grupo 12.

## Mensajes al Grupo 12

El mensaje que estaba preparado acá no se envió y ya no hace falta: el encabezado de correlación y los campos obligatorios los responde el contrato, y la pregunta de `iss` y `aud` se hizo en su issue #9. Los alias de rol se pidieron en su issue #10, cerrado el 2026-11-08.
