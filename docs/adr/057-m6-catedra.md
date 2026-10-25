# ADR 057 — Dependencia M6 desde el contrato de la cátedra

Fecha: 2026-10-25 · Estado: aceptada
Issue: #57 · Reemplaza a: ADR 002

## Contexto
El ADR 002 dejó `contrato/dependencias/m6.yml` como borrador desde el consumidor, extraído del OpenAPI público del Grupo 12 (commit `4cc05b0`). En esa versión, `GET /trips` devolvía un arreglo de `Trip` sin paginar, M6 solo reconocía el claim `role` (`CLIENT`, `DRIVER`, `OPERATOR`, `SYSTEM`) y quedaban ocho preguntas abiertas en `m6-propuesta.md`.

El 2026-10-25 el Grupo 12 subió el contrato de M6 a la cátedra: [FRRe-DS/2026-TPI#9](https://github.com/FRRe-DS/2026-TPI/pull/9), archivo `contratos/m6_viajes/openapi.yml`, OpenAPI 3.1.0, commit `9e720a0d074ef8e9cc20ba189baf340b071779f3`. El grupo decidió que ese es el contrato que se va a usar, sin esperar al merge.

Lo que cambia para M2 respecto del borrador:
- `GET /trips` acepta `clientId`, `driverId`, `state`, `page` (desde 1, por defecto 1) y `pageSize` (de 1 a 100, por defecto 20), y responde `TripSummaryPage { items, page, pageSize, total }`, ordenado por `createdAt` descendente. `TripSummary` no trae coordenadas.
- El token puede traer `roles` como lista (`CLIENTE`, `CONDUCTOR`, `OPERADOR`, `SERVICIO`), como en el ADR 009. Un token de servicio (`SYSTEM` o `SERVICIO`) tiene que mandar al menos un filtro; sin filtro, `400` con `code: "FILTER_REQUIRED"`.
- `GET /trips/{id}` admite explícitamente a M2 como servicio, para verificar que el viaje esté `COMPLETED`, que sea del cliente y obtener el `driverId` (RF-2.5).
- Los errores de M6 son `application/json` con `ErrorResponse { code, message, timestamp, correlationId }`, no problem+json.
- Ningún campo de `Trip` ni de `TripSummary` es obligatorio. No declara encabezado de correlación ni qué `iss` y `aud` valida.

## Decisión
Reemplazar `contrato/dependencias/m6.yml` por la extracción de `GET /trips`, `GET /trips/{id}` y los componentes que referencian (por `$ref`, transitivamente) del contrato del PR #9, sin modificarlos. Se cambian solo `info.title` y `info.description`, que dicen de dónde sale el archivo. Se quita la propuesta del ADR 002 de exigir `clientId` en `GET /trips`: el contrato publicado lo exige en la práctica para un token de servicio, y M2 siempre lo manda.

El contrato de M2 (`contrato/openapi.yml`) y `contrato/ORIGEN` no cambian.

## Alternativas descartadas
- Esperar al merge del PR #9: el grupo confirmó que ese es el contrato del consorcio, y la spec 007 se implementa ahora.
- Copiar el contrato entero de M6: creación, transiciones, eventos y auditoría no son consumo de M2.
- Mantener el borrador del ADR 002: describe una respuesta (arreglo sin paginar) que M6 ya no da.

## Consecuencias
- La spec 007 (historial) ya sigue esta forma de `GET /trips` desde su T4. Su cambio del #58 actualiza los supuestos y la credencial de M2 ante M6, que pasa a ser un token de servicio según el ADR 009.
- La spec 008 (calificación) puede apoyarse en `GET /trips/{id}` con rol `SERVICIO`.
- Queda una pregunta para el Grupo 12: qué `iss` y `aud` valida M6 en el token de servicio (ADR 009). Hasta que respondan, M2 usa `iss: m1-identidad` y una audiencia configurable.
- Redocly valida el archivo con cuatro avisos que vienen de la fuente (sin `license`, servidor `localhost` y sin `operationId`): no se inventan.
- Si el PR #9 cambia antes del merge, se repite la extracción en otra rama `contrato/` con el commit nuevo.
