# ADR 001 — Contrato M2 v1 con el Grupo 1

Fecha: 2026-10-16 · Estado: propuesta
Issue: #1

## Contexto
El contrato de M2 en el repositorio de la cátedra (`contratos/m2_clientes/openapi.yml`, commit `d67d914`) solo tiene `info`. Ninguna spec puede exponer algo que el contrato no tenga (constitución, punto 1), así que hace falta una v1 acordada con el Grupo 1 que cubra RF-2.1 a RF-2.6 y cumpla RNF-03 (OpenAPI y errores consistentes). Es la primera versión: no hay consumidores que romper.

Restricciones que la condicionan:
- RNF-05 y RF-2.4: el historial de viajes sale de la API de M6, nunca de su base. RF-2.2: las direcciones no dependen de datos internos de M4.
- RF-2.5 y RNF-08: una sola calificación por viaje, aun con pedidos concurrentes.
- RNF-13: si M6 no contesta, respuesta explícita, sin espera indefinida.
- Filmina DS-04 (Servicios Web y REST): rutas `/api/v1/...` con sustantivos en plural, `201` + `Location` al crear, `Authorization: Bearer`.

## Decisión
Proponer al Grupo 1 el borrador de `contrato/openapi.yml` con:
- **Recursos**, todos bajo `/api/v1/clientes/{clienteId}`: perfil (`POST /clientes`, `GET`/`PATCH`), `direcciones` (CRUD), `preferencias` (`GET`/`PUT`), `viajes` (historial, solo lectura), `calificaciones` (`POST`/`GET`), `estado-cuenta` (`GET`) y `bloqueos` (`POST`/`GET`/`PATCH` para levantar).
- **Identidad**: `clienteId` es el `sub` del JWT de M1. Un CLIENTE solo opera sobre su `clienteId` (`403` si no). Roles por operación en la extensión `x-roles`.
- **Errores**: `application/problem+json` (RFC 9457), esquema `Problema` con `errores[]` por campo en los `400`. `409` para duplicados o estado inválido, `422` para reglas de negocio, `503` con `Retry-After` cuando M6 no responde.
- **Paginación**: `page` desde 0, `size` 20 por defecto y 100 como máximo; respuesta con `items`, `page`, `size`, `totalElementos`, `totalPaginas`.
- **Idempotencia**: `Idempotency-Key` obligatoria en los POST (perfil, dirección, calificación, bloqueo). Misma clave y mismo cuerpo → respuesta original; otro cuerpo → `422`.
- **Calificación**: el cuerpo trae `viajeId`, `puntaje` (1-5) y `comentario`; M2 obtiene de M6 si el viaje está completado, si el cliente fue pasajero y quién fue el conductor. La unicidad (cliente, viaje) va en la base; un segundo intento → `409`.
- **Historial**: M2 consulta M6 en cada pedido y no copia sus viajes; solo agrega `calificado`, que es dato propio.
- **Bloqueos**: no se borran; levantarlos registra quién, cuándo y por qué. El estado del cliente (`ACTIVO`/`BLOQUEADO`) se deriva de los bloqueos vigentes.
- **Servidor**: URL relativa `/`; el puerto 8082 queda como propuesta de ADR 003.

Queda abierto, para acordar con el Grupo 1 y el consorcio antes de publicar:
1. Datos mínimos del perfil: ¿el email vive en M1 o también en M2?
2. Formato de `clienteId` (`uuid` en el borrador): depende de lo que emita M1 (#9).
3. Valores de `TipoVehiculo`, `CanalComunicacion` y `NecesidadAccesibilidad`: compartidos con M3, M5, M8 y M9.
4. Cómo se autentican los módulos que consultan `estado-cuenta` (M5, M9): rol de servicio o token del cliente propagado.
5. Si M3 necesita un promedio de calificaciones por conductor (`GET` por `conductorId`): RF-2.5 no lo pide.
6. Qué expone M6 para el historial y para validar el viaje (#2): `ViajeResumen` y los `estado` dependen de ese contrato.
7. Licencia en `info` (único aviso del lint): la define la cátedra.

## Alternativas descartadas
- **Copiar los viajes de M6 en la base de M2** para el historial: más rápido, pero duplica datos de otro módulo y se desincroniza; RF-2.4 pide obtenerlo por API.
- **Recibir `conductorId` en el cuerpo de la calificación**: el cliente podría calificar a cualquiera; se toma de M6.
- **`DELETE` de bloqueos**: pierde la trazabilidad que piden el escenario y RNF-19.
- **Recursos de primer nivel** (`/api/v1/direcciones?clienteId=`): el dueño queda fuera de la ruta y la autorización por `sub` es menos evidente.
- **Paginación por cursor**: más robusta, pero el issue fija `page`/`size`.

## Consecuencias
- Los tipos TypeScript se generan del contrato con openapi-typescript (ADR 003) en la spec base (#3); no se escriben a mano.
- Las specs de RF-2.4 y RF-2.5 dependen del contrato de M6 (#2) y de su mock en `contrato/dependencias/`.
- `x-roles` es una extensión propia: la spec base tiene que leerla o repetir los roles en el código, con test.
- La idempotencia exige guardar clave, hash del cuerpo y respuesta (cambio de esquema de base en la spec que la implemente).
- Si el Grupo 1 cambia algo, se actualiza este ADR antes del PR a la cátedra. Publicado, se actualiza `contrato/ORIGEN`.
