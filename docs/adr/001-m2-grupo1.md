# ADR 001 — Contrato M2 v1 con el Grupo 1

Fecha: 2026-10-16 · Estado: aceptada
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
- **Identidad**: `clienteId` es el `sub` de un token de M1 con rol CLIENTE. Un CLIENTE solo opera sobre su `clienteId` (`403` si no). Los roles de cada operación se declaran como roles de OpenAPI 3.1 en `security` (`bearerAuth: [CLIENTE, OPERADOR]`), sin extensiones propias.
- **Rol SERVICIO**: los módulos que consultan si el cliente está habilitado (M5, M9) usan un token de M1 con rol SERVICIO, cuyo `sub` nombra al módulo que consulta (no es un `clienteId`). Solo `obtenerEstadoCuenta` lo admite; en cualquier otra operación, `403`.
- **Salud**: `GET /health` sin token (`security: []`): `200` con `{"estado": "ok"}` si el servicio y su base responden; si no, `503` en `application/problem+json`.
- **Errores**: `application/problem+json` (RFC 9457), esquema `Problema` (`type`, `title`, `status`, `detail`, `instance`), sin extensiones. Los genéricos se declaran en `components.responses` con `type: about:blank` (esquema `ProblemaGenerico`) y `title` en español: `400`, `401`, `403`, `404`, `405` (con `Allow`, para cualquier ruta que no admite el método), `413`, `415`, `500` y `503` de la base. Los de dominio conservan su `type` propio: `409` para duplicados o estado inválido, `422` para reglas de negocio y `503` con `Retry-After` cuando M6 no responde.
- **Errores por operación**: `400` en toda operación con identificador en la ruta (un id que no es UUID); `413` (cuerpo de más de 1 MiB) y `415` (`Content-Type` que no es JSON) en toda operación con cuerpo; `500` en todas; `503` en todas las que usan la base, que son todas. En historial y calificación, el mismo `503` cubre la caída de M6 (`type` de dominio) y la de la base (`about:blank`).
- **Correlación**: `X-Request-Id` opcional en toda solicitud (1 a 128 caracteres: letras, números, `.`, `_`, `-`). Vuelve en toda respuesta, también en las de error; si no llega o es inválido, M2 genera uno nuevo, sin responder `400`. Por eso el parámetro no declara `minLength`, `maxLength` ni `pattern`, y `/health` no tiene `400`. Es el identificador de los logs (RNF-14).
- **Llamadas a otros módulos** (RNF-13): M2 espera hasta 2 s por intento y reintenta una vez los `GET`; si no hay respuesta, contesta `503`. Su espera máxima a otro módulo queda en 4,2 s; no es el tiempo total de la respuesta, que suma el procesamiento propio de M2. Se publica en `info.description` para que los consumidores fijen sus timeouts por encima.
- **Direcciones recientes**: las registra el cliente (`tipo: RECIENTE`) como cualquier otra dirección; M2 no las deriva de los viajes ni guarda la fecha de último uso.
- **Paginación**: `page` desde 0, `size` 20 por defecto y 100 como máximo; respuesta con `items`, `page`, `size`, `totalElementos`, `totalPaginas`.
- **Idempotencia**: `Idempotency-Key` obligatoria en los POST (perfil, dirección, calificación, bloqueo). Misma clave y mismo cuerpo → respuesta original; otro cuerpo → `422`.
- **Calificación**: el cuerpo trae `viajeId`, `puntaje` (1-5) y `comentario`; M2 obtiene de M6 si el viaje está completado, si el cliente fue pasajero y quién fue el conductor. La unicidad (cliente, viaje) va en la base; un segundo intento → `409`.
- **Historial**: M2 consulta M6 en cada pedido y no copia sus viajes; solo agrega `calificado`, que es dato propio.
- **Bloqueos**: no se borran; levantarlos registra quién, cuándo y por qué. El estado del cliente (`ACTIVO`/`BLOQUEADO`) se deriva de los bloqueos vigentes.
- **Servidor**: URL relativa `/`; el puerto 8082 queda como propuesta de ADR 003.

Acordado con el Grupo 1 (2026-10-20):
- El email vive solo en M1; el perfil de M2 no lo guarda.
- El promedio de calificaciones por conductor (`GET` por `conductorId`) queda afuera: RF-2.5 no lo pide.
- De acuerdo con los valores de `TipoVehiculo`, `CanalComunicacion` y `NecesidadAccesibilidad`, con la paginación y con el alta y el levantamiento de bloqueos.
- La licencia en `info` (aviso del lint) la define la cátedra.

Queda abierto, porque depende de otros módulos:
1. Formato de `clienteId` (`uuid` en el borrador): depende de lo que emita M1 (#9).
2. Valores de `TipoVehiculo`, `CanalComunicacion` y `NecesidadAccesibilidad`, si M3, M5, M8 o M9 piden otros.
3. Qué expone M6 para el historial y para validar el viaje (#2): `ViajeResumen` y los `estado` dependen de ese contrato.
4. Confirmación de M5 de que consulta `estado-cuenta` con un token de rol SERVICIO.

## Alternativas descartadas
- **Copiar los viajes de M6 en la base de M2** para el historial: más rápido, pero duplica datos de otro módulo y se desincroniza; RF-2.4 pide obtenerlo por API.
- **Recibir `conductorId` en el cuerpo de la calificación**: el cliente podría calificar a cualquiera; se toma de M6.
- **`DELETE` de bloqueos**: pierde la trazabilidad que piden el escenario y RNF-19.
- **Recursos de primer nivel** (`/api/v1/direcciones?clienteId=`): el dueño queda fuera de la ruta y la autorización por `sub` es menos evidente.
- **Paginación por cursor**: más robusta, pero el issue fija `page`/`size`.
- **Roles en la extensión `x-roles`**: las herramientas no la entienden y había que repetirla en el código; OpenAPI 3.1 ya admite roles en `security` para esquemas que no son OAuth2.
- **Propagar el token del cliente a M5 y M9** para consultar `estado-cuenta`: ata la consulta a que haya un cliente en la solicitud y le da a otro módulo un token con todos los permisos del cliente. El rol SERVICIO, limitado a una operación, expone menos.
- **`type` propio para todos los errores**: en los genéricos no agrega nada al código HTTP; `about:blank` es lo que indica RFC 9457 y deja los `type` propios para lo que el consumidor tiene que distinguir.
- **`/health` bajo `/api/v1` o con token**: la sondea el orquestador de contenedores, que no tiene token ni depende de la versión de la API.

## Consecuencias
- Los tipos TypeScript se generan del contrato con openapi-typescript (ADR 003) en la spec base (#3); no se escriben a mano.
- Las specs de RF-2.4 y RF-2.5 dependen del contrato de M6 (#2) y de su mock en `contrato/dependencias/`.
- La spec base tiene que leer los roles de `security` del contrato (o repetirlos en el código, con test), aceptar SERVICIO solo en `obtenerEstadoCuenta` y dejar `/health` sin autenticación.
- La spec base fija el límite de cuerpo en 1 MiB, rechaza otros `Content-Type` con `415`, propaga o genera `X-Request-Id` en toda respuesta (uno inválido se reemplaza, no da `400`), responde `405` con `Allow` y arma los errores genéricos con `type: about:blank`.
- El cliente HTTP hacia M6 usa timeout de 2 s, un reintento solo en `GET` y `503` al agotarse. Cambiar esos valores cambia el contrato: los 4,2 s de espera máxima a otro módulo están publicados.
- M1 tiene que poder emitir tokens con rol SERVICIO para M5 y M9; se acuerda con el Grupo 1 y en el contrato de M1 (#9).
- La idempotencia exige guardar clave, hash del cuerpo y respuesta (cambio de esquema de base en la spec que la implemente).
- Si el Grupo 1 cambia algo, se actualiza este ADR antes del PR a la cátedra. Publicado, se actualiza `contrato/ORIGEN`.
