# Guía — Spec 081 Integración distribuida de M2 con el M6 real del Grupo 12

## Visión general

**Qué se construyó.** Una prueba que levanta M2, su base y el M6 real del Grupo 12 (con la suya) y comprueba, de punta a punta, lo que hasta ahora solo se había probado contra un M6 simulado: el historial de viajes, calificar al conductor y qué hace M2 cuando M6 se cae. No cambia M2: agrega un perfil de compose, un proyecto de pruebas y un job de CI. Lo que encontró (las diferencias entre el contrato que M2 suponía y el M6 real) está en la tabla de abajo.

**Recorrido de una corrida** (`npm run integracion:m6`):
1. `vitest.config.ts` (proyecto `distribuida`) corre `pruebas/distribuida/global.ts:levantarEntorno`, que ejecuta `docker compose -p m2-distribuida --profile m6-real up -d --build --wait` (`ayudas/entorno.ts:compose`) con `M2_URL_M6=http://m6-real:3006`, y espera el `/health` de los dos.
2. Cada archivo de prueba crea lo suyo: `ayudas/clientes.ts:crearClienteEnM2` (un cliente y su token, firmado por el propio M2 con `docker compose exec`) y `ayudas/viajes.ts:crearViaje` (un viaje en el estado pedido, por las rutas de M6 con sus atajos de demo).
3. El pedido va a M2 (`ayudas/pedir.ts:pedirM2`); M2 consulta a M6 por `src/modulos/cliente.ts` con su token de servicio, y la prueba compara con lo que M6 dice directo (`pedirM6`) y con el contrato (`ayudas/contrato.ts:validarContraContrato`).
4. `resiliencia.test.ts` corre al final (`ayudas/orden.ts`), detiene y congela a M6 con `ayudas/averias.ts:conAveria`, que lo deja sano pase lo que pase.
5. El teardown de `global.ts` baja todo con `down -v`.

**Mapa.**
| Archivo (`pruebas/distribuida/`) | Responsabilidad | Requisito |
|---|---|---|
| `global.ts`, `ayudas/entorno.ts` | levantar, esperar y bajar el entorno; comandos de compose | RNF-07.7, RNF-06.6 |
| `ayudas/pedir.ts`, `contador.ts` | pedidos con corte de 10 s y cuenta de los que llegan a M6 (tope de 600) | RNF-07.7 |
| `ayudas/viajes.ts`, `token-servicio.test.ts` | viajes en cada estado y el token de servicio de M2 ante M6 | RNF-07.11 |
| `historial.test.ts` | los viajes del cliente, `calificado`, la paginación | RNF-07.8 |
| `calificacion.test.ts` | calificar, conductor tomado de M6, duplicado | RNF-07.9 |
| `rechazos.test.ts` | inexistente, ajeno, cancelado y en curso | RNF-07.10 |
| `resiliencia.test.ts`, `ayudas/averias.ts`, `orden.ts` | M6 detenido y congelado, y la recuperación | RNF-13.8 |
| `docker-compose.yml` (`m6-real`, `m6-real-bd`), `.github/workflows/integracion-m6.yml` | el M6 real con su base, y el job de CI | RNF-04.9, RNF-07.7 |

**Decisiones clave** (el porqué está en `plan.md`): el commit de M6 va fijo en `docker-compose.yml` y no en un submódulo ni copiado; proyecto de compose aparte y puertos propios para no pisar el M2 de quien trabaja; `docker compose` por `child_process` y no Testcontainers, para no sumar dependencias; `pause` además de `stop`, porque «no responde» solo se ve con un servicio que acepta la conexión y no contesta.

**Conceptos que conviene entender.** *Prueba distribuida*: dos módulos de grupos distintos, cada uno en su contenedor, hablándose por HTTP de verdad. *Token de servicio*: con lo que M2 se presenta ante M6 (`sub` `m2-clientes`, rol `SERVICIO`). *Atajos de demo de M6*: tokens como `SYSTEM` o `DRIVER:<id>` que M6 acepta con `ENABLE_DEMO_AUTH`, usados solo para preparar viajes. *`stop` y `pause`*: dos caídas distintas, una inmediata y otra que solo corta el tiempo máximo de M2. *`Retry-After`*: lo que M2 sugiere al cliente tras un `503`.

**Cómo probarlo.** Los comandos, la salida esperada y el recorrido a mano con `curl` están en `docs/probar-m2.md`, sección 8.

**Para comprobar que se entendió.**
1. ¿Por qué la URL de M6 real no lleva `/api/v1` y la del M6 simulado sí?
2. ¿Por qué `resiliencia.test.ts` corre al final, y qué en el repositorio avisa si alguien lo renombra?
3. Con M6 detenido el `503` tarda unos 300 ms y con M6 congelado, unos 4 s. ¿Por qué?
4. M6 le muestra cualquier viaje a un token `SYSTEM`. ¿Qué parte del código de M2 hace que calificar el viaje de otro cliente dé `404`?
5. ¿Por qué el job de CI deja el entorno levantado y lo baja en un paso aparte?

## Diferencias entre el contrato supuesto y el M6 real

Observadas contra el commit `7d3d5af`. «Se consulta a» dice a quién le toca resolverla. Los textos de los issues del Grupo 12 (A y B, publicados) y las propuestas de `sdd-change` (sin issue todavía) están al final, en la T10.

La columna «Lo que dice `m6.yml`» habla de nuestra extracción, hecha del contrato de la cátedra en `9e720a0`. El contrato actual (`contratos/m6_viajes/openapi.yml`, `35b3c4d`, 2026-11-01, «Contrato confirmado por ambos grupos») es idéntico byte a byte al `openapi.yaml` de M6 en `107d63c`, así que varias diferencias no son de M6: lo desactualizado es `m6.yml`. Se vuelve a extraer en la rama `contrato/079-…`.

| # | Comportamiento observado | Lo que dice `m6.yml` | Resolución | Se consulta a |
|---|---|---|---|---|
| 1 | M6 sirve en `/trips`, sin `/api/v1` (con `/api/v1` M2 recibe un error). | `servers`: `http://localhost:3006/api/v1`. | El real se usa con `M2_URL_M6=http://m6-real:3006`. Falta volver a extraer `m6.yml` del contrato actual y alinear el M6 simulado: rama `contrato/079-…`. | Nosotros. El Grupo 12 coincide con el contrato de la cátedra. |
| 2 | M6 no verifica la firma del JWT: decodifica el payload y mira `role`/`roles` y `exp`. Tampoco revisa `aud` ni `iss`. Su README lo anota como pendiente, a la espera de M1. | `[NECESITA ACLARACIÓN]` qué `aud` e `iss` valida. | Sin cambio en M2: el token de servicio pasa. Cuando M6 verifique, M2 tendrá que firmar con lo que M6 acuerde. | Grupo 12: [#9](https://github.com/FRRe-DS/2026-12-TPI/issues/9) |
| 3 | M6 acepta el claim `roles` y `SERVICIO` como alias de `SYSTEM` (y `CLIENTE`, `CONDUCTOR`, `OPERADOR`). | Coincide: nombra `SYSTEM` / `SERVICIO`. El contrato actual solo nombra los roles en inglés. | Ninguna para M2. **Resuelto el 2026-11-08:** el Grupo 12 documentó el claim `role`/`roles` y los alias (`CLIENTE`, `CONDUCTOR`, `OPERADOR`, `SERVICIO`/`SERVICE`) en el `openapi.yaml` de su rama `m6/base-de-datos` y cerró el issue. Falta que lo suban al contrato de la cátedra (dijeron que van a abrir el PR); se verá en la rama `contrato/079-…`, al volver a extraer `m6.yml`. | Grupo 12: [#10](https://github.com/FRRe-DS/2026-12-TPI/issues/10), cerrado |
| 4 | `GET /trips` con token `SYSTEM` exige `clientId` o `driverId`; sin ninguno, `400` con `code` `VALIDATION`. (Leído en su `openapi.yaml` y su código; M2 siempre manda `clientId`, no se ejerció.) | `SYSTEM` exige al menos un filtro entre `clientId`, `driverId` y `state`; el error es `FILTER_REQUIRED`. | Ninguna para M2. M6 coincide con el contrato actual; lo desactualizado es `m6.yml`: rama `contrato/079-…`. | Nosotros |
| 5 | `GET /trips/{id}` con token `SYSTEM` devuelve el viaje de cualquier cliente. | Coincide: lo permite a un módulo de servicio, y dice que M2 verifica que el viaje «pertenezca al `clientId`». | M2 compara el `clientId` del viaje con el del pedido y responde `404` (comprobado en T6). | Nadie: no es una diferencia. |
| 6 | Un `404` de M6 al listar el historial da `500` en M2, no `503`. | `GET /trips` no declara `404`. | Es el diseño de M2 (RF-2.4.7: un `4xx` de otro módulo es un problema de acuerdo entre módulos, no del cliente). | Nadie. |
| 7 | M6 limita los pedidos por minuto y responde `429` con `Retry-After`. M2 lo trata como `4xx` y responde `500`. | No declara `429` (el contrato actual sí). | Propuesta de `sdd-change` de las specs 007 y 008: M2 responde `503` con `Retry-After` ante un `429`. `m6.yml` se actualiza en la rama `contrato/079-…`. | Nosotros |
| 8 | M6 propaga `X-Correlation-Id`; M2 manda el encabezado de `M2_ENCABEZADO_CORRELACION` (por defecto `X-Request-Id`), así que M6 genera su propio id y las trazas de los dos no se unen. | No declara encabezado de correlación (el contrato actual declara `X-Correlation-Id`). | Propuesta de `sdd-change` de las specs 007 y 008: enviar también `X-Correlation-Id` a M6. `m6.yml` se actualiza en la rama `contrato/079-…`. | Nosotros |
| 9 | El M8 de M6 es simulado: acepta cualquier `verificationToken` salvo unos pocos, y cada uno sirve una vez. | — | Solo afecta la preparación de viajes de la prueba. | Nadie. |
| 10 | Con M6 detenido, M2 ve `ENOTFOUND` y responde `503` en ~300 ms; con M6 congelado, `TimeoutError` y `503` en ~4,2 s. | No trata este caso. | Coincide con lo que promete el contrato de M2: 2 s por intento y un reintento. | Nadie. |
| 11 | Un viaje cancelado queda en `state` `CANCELLED`. | `TripState` declara `CANCELLED_BY_CLIENT` y `CANCELLED_BY_DRIVER`, y no `CANCELLED` (el contrato actual declara `CANCELLED`). | Ninguna en el código de M2: devuelve el estado sin traducir (RF-2.4.1) y solo compara con `COMPLETED`. Falta alinear `m6.yml` y el M6 simulado (`panel/m6-simulado/cuerpos.ts`, que usa los nombres viejos): rama `contrato/079-…`. | Nosotros |
| 12 | Los errores de M6 son `application/problem+json` con `type`, `title`, `status`, `code`, `detail`, `message`, `timestamp`, `instance` y `correlationId` (visto en un `401`). | `ErrorResponse` exige solo `code`, `message` y `timestamp` (el contrato actual declara `Problem`, como M6). | Ninguna en el código de M2: de un error de M6 solo usa el código HTTP. Falta alinear `m6.yml`: rama `contrato/079-…`. | Nosotros |

## Tareas

### T1 — Perfil `m6-real` de compose · commit `081/T1`
- Qué cambió: `docker-compose.yml` suma `m6-real` (el M6 del Grupo 12, construido desde su repositorio al commit fijo) y `m6-real-bd` (su Postgres 16.15), los dos solo con `--profile m6-real`. `ejemplo.env` documenta `M6_REAL_PUERTO` y las credenciales de la base de M6; `M6_REAL_COMMIT` no está ahí: su valor por defecto vive en `docker-compose.yml` y se cambia por variable de entorno al levantar. `panel/servidor/entorno-ejemplo.ts` deja de tomar las variables `M6_REAL_*` como si fueran de M2.
- Por qué así: RNF-04.9 pide el entorno reproducible con un comando; RNF-06.6 pide que lo único que cambie en M2 sea `M2_URL_M6`. Por eso `m2` no tiene `depends_on` de `m6-real`: tiene que arrancar aunque M6 no esté (RNF-13). Puertos solo en `127.0.0.1`, porque M6 corre con sus atajos de demo.
- Cómo se conecta: M2 ve a M6 por la red de compose como `http://m6-real:3006`. El M6 simulado del perfil `panel` sigue siendo otro servicio (`m6`) y no se mezcla.
- Tests: `pruebas/unitarias/consistencia.test.ts` (servicios y variables nuevos aceptados, y que sin el perfil no se crea nada de M6), `pruebas/unitarias/ejemplo-env.test.ts` y `pruebas/panel/unitarias/config.test.ts` (el filtro de `M6_REAL_*`).
- Para mirar con atención:
  - **La URL no lleva `/api/v1`.** El plan se escribió con `http://m6-real:3006/api/v1`, pero el M6 real sirve en `/trips`, igual que el contrato de la cátedra. El prefijo que usa M2 sale de `servers` de nuestro `contrato/dependencias/m6.yml`. Comprobado con M2: `M2_URL_M6=http://m6-real:3006` da `200` y con `/api/v1` da `500`. Se corrigieron `plan.md`, `tasks.md`, `docker-compose.yml` y `ejemplo.env`; la spec no cambia (RNF-06.6 sigue igual). Falta volver a extraer `m6.yml` del contrato actual de la cátedra (`35b3c4d`) y alinear el M6 simulado, que hoy sí usa el prefijo (por eso el valor por defecto de `M2_URL_M6` lo conserva): va en la rama `contrato/079-…`.
  - **Commit fijo.** Se fijó `7d3d5af9138d9b220f109798e9f615ca853d2bda`, con el que se probó. El 2026-11-07 la punta de `m6/base-de-datos` del Grupo 12 es `107d63c7ed0e854334d0b0578a4f6124264d045c` (su PR #8, que solo toca el README y una prueba suya). Contra esa punta también pasan las 35 pruebas (`M6_REAL_COMMIT=107d63c… npm run integracion:m6`). El commit fijo no se subió, porque el cambio no toca el servicio.
  - **Si M6 responde 404 al listar el historial, M2 contesta `500`, no `503`.** Es el comportamiento actual de M2 ante un código inesperado de M6; queda anotado para las tareas de errores de la 081.

### T2 — Arranque y parada de la prueba distribuida · commit `081/T2`
- Qué cambió: nuevo proyecto `distribuida` en `vitest.config.ts` y script `npm run integracion:m6`. `pruebas/distribuida/global.ts:levantarEntorno` corre `docker compose -p m2-distribuida --profile m6-real up -d --build --wait`, espera `GET /health` de M2 y de M6 (hasta 60 s) y devuelve la función que hace `down -v` (o nada con `M2_DEJAR_LEVANTADO=1`). `ayudas/entorno.ts` tiene el proyecto, los puertos (18082 y 13006), `compose()` y el mensaje de falla; `ayudas/pedir.ts` tiene `pedirM2`, `pedirM6` y `tokenDeM2`; `ayudas/contador.ts` cuenta los pedidos a M6.
- Por qué así: RNF-07.7 y RNF-06.6. Proyecto de compose y puertos propios para no pisar el M2 que la persona tenga levantado; `docker compose` por `child_process` y no Testcontainers, para no sumar dependencias. Si algo falla durante el arranque, se baja lo que alcanzó a levantarse antes de relanzar el error, así que la corrida termina en rojo y sin contenedores colgados.
- Cómo se conecta: `fileParallelism: false`, porque todos los archivos comparten M2 y M6 (y `resiliencia` apaga M6). El token sale de `docker compose exec m2 node dist/herramientas/token.js`, el mismo comando de la demo.
- Tests: `pruebas/distribuida/salud.test.ts` (M2 y M6 dan 200 en `/health`; M2 guarda y devuelve un perfil) y `pruebas/unitarias/distribuida-contador.test.ts` (el contador y el mensaje de falla); `consistencia.test.ts` ahora exige los cuatro proyectos de Vitest y que `distribuida` quede fuera de `npm test`. Comprobado a mano: con `M6_REAL_COMMIT` inexistente y con `docker` fuera del PATH la corrida termina con código 1 y el mensaje dice qué falló; `docker compose ls -a` queda vacío después de cada corrida.
- Para mirar con atención: en esta tarea el contador vivía en la memoria de cada archivo de prueba; la T7 lo pasó a un archivo para sumar toda la corrida. Primera corrida con la imagen de M6 en caché: ~60 s.

### T3 — Preparar viajes y el token de servicio · commit `081/T3`
- Qué cambió: `pruebas/distribuida/ayudas/viajes.ts:crearViaje(clienteId, estado)` deja un viaje `COMPLETED`, `CANCELLED` o `IN_PROGRESS` en el M6 real. `ayudas/errores.ts:describirRespuesta` arma el texto «HTTP 401 — code=…: detalle» con el que las fallas cuentan qué contestó un módulo.
- Por qué así: RNF-07.11 y RNF-07.7. Rutas, cuerpos y roles salen de `openapi.yaml` de M6 en el commit fijado (`7d3d5af`), no de `m6.yml`. Cada llamada usa conductor, vehículo y solicitud nuevos, así que los escenarios no se pisan.
- Cómo se conecta: usa `pedirM6` (suma al contador) con los atajos de demo de M6: `SYSTEM` para `createTrip`, `DRIVER:<id>` para llegada, inicio y fin, `CLIENT:<id>` para cancelar. Los tres recorridos son: `COMPLETED` = `createTrip` → `arrived` → `start` → `complete`; `IN_PROGRESS` = lo mismo sin `complete`; `CANCELLED` = `createTrip` → `cancel` del cliente con `CHANGE_OF_PLANS`, que M6 permite desde `PENDING_ARRIVAL`.
- Tests: `pruebas/distribuida/viajes.test.ts` (cada estado llega a M6, con el cliente y el conductor correctos), `pruebas/distribuida/token-servicio.test.ts` (con el token que M2 firma para M6, `GET /trips?clientId=…` y `GET /trips/{id}` dan `200`; sin token M6 da `401` con `code` `UNAUTHENTICATED` y el mensaje lo muestra) y `pruebas/unitarias/distribuida-errores.test.ts`. El token lo firma `ayudas/pedir.ts:tokenDeServicioDeM2`, con la misma función y configuración que usa M2; ver «Revisión independiente» al final.
- Para mirar con atención (lo que se vio de M6 en esta tarea; a quién le toca cada cosa está en la tabla de diferencias):
  - M6 **no verifica la firma** del JWT: decodifica el payload y mira `role`/`roles` y `exp`. Tampoco revisa `aud` ni `iss`. Por eso el token de M2 pasa, pero también pasaría uno firmado por cualquiera. Esto responde parte del `[NECESITA ACLARACIÓN]` de `m6.yml` sobre `aud` e `iss`.
  - M6 acepta `SERVICIO` como alias de `SYSTEM` (también `CLIENTE`, `CONDUCTOR`, `OPERADOR`). Su `openapi.yaml` solo nombra los roles en inglés.
  - `listTrips` en M6 usa `page` desde 1 y `pageSize`, y devuelve `{ items, page, pageSize, total }`, como dice `m6.yml`. Un `SYSTEM` sin `clientId` ni `driverId` recibe `400`.
  - El M8 de M6 es simulado: acepta cualquier `verificationToken` salvo `invalid`, `expired`, `invalid_…`, `m8_timeout` y `simulate_503`, y cada código sirve una sola vez.

### T4 — Historial contra el M6 real · commit `081/T4`
- Qué cambió: `pruebas/distribuida/historial.test.ts`, más `ayudas/clientes.ts:crearClienteEnM2` (un cliente nuevo con su token) y `ayudas/contrato.ts:validarContraContrato` (valida un cuerpo contra un esquema de `contrato/openapi.yml` con Ajv, igual que el servicio).
- Por qué así: RNF-07.8 (RF-2.4). El cliente tiene tres viajes `COMPLETED`, otro cliente tiene uno, y uno de los tres está calificado desde M2. Se comprueba el resultado de punta a punta y, además, que la página de M2 coincide con la de M6 pedida directo con `pedirM6`: M2 cuenta desde 0 y M6 desde 1, y `size` en M2 es `pageSize` en M6.
- Cómo se conecta: M2 llama a `GET /trips?clientId=…&page=…&pageSize=…` con su token de servicio; la marca `calificado` la pone M2 con lo que tiene en su base.
- Tests: `historial.test.ts` (6 casos: los tres viajes y ninguno ajeno, `calificado` solo en uno, páginas 0 y 1 con `size=2`, coincidencia con M6, cliente sin viajes, cuerpos válidos contra el contrato) y `pruebas/unitarias/distribuida-contrato.test.ts` (la validación).
- Para mirar con atención: el historial usa el orden de M6 (más reciente primero); la prueba no depende de él porque compara conjuntos y, entre M2 y M6, las mismas páginas. Sin diferencias de contrato frente a lo supuesto en `m6.yml` en esta tarea.

### T5 — Calificación y duplicado contra el M6 real · commit `081/T5`
- Qué cambió: `pruebas/distribuida/calificacion.test.ts`.
- Por qué así: RNF-07.9 (RF-2.5). Un viaje `COMPLETED` en M6, calificado desde M2: `201`; el `conductorId` guardado es el `driverId` que M6 informa para ese viaje; un segundo intento con otra `Idempotency-Key` da `409` con `type` `/errores/calificacion-duplicada` (lo garantiza la restricción única de la base de M2, no el código); `listarCalificaciones` muestra una sola, la primera; `obtenerCalificacion` devuelve la misma por la `Location`.
- Cómo se conecta: M2 llama a `GET /trips/{id}` de M6 con su token de servicio antes de guardar. El contrato no admite `conductorId` en el cuerpo (`additionalProperties: false`), así que mandarlo da `400` en vez de usarlo.
- Tests: los seis casos del archivo; los cuerpos del `201`, del `409` (`Problema`), de la lista y de la lectura se validan con `validarContraContrato`.
- Para mirar con atención: sin diferencias de contrato frente a `m6.yml` en esta tarea. Cada corrida crea su cliente y su viaje, así que se puede repetir sin limpiar nada.

### T6 — Rechazos contra el M6 real · commit `081/T6`
- Qué cambió: `pruebas/distribuida/rechazos.test.ts`.
- Por qué así: RNF-07.10 (RF-2.5). Cuatro viajes que no se pueden calificar y, en los cuatro, M2 no guarda nada: inexistente en M6 → `404`; de otro cliente → `404`; `CANCELLED` y en curso (`IN_PROGRESS`) → `422` con `type` `/errores/viaje-no-completado`. Al final `listarCalificaciones` sigue vacía. Los cuerpos de error validan contra el esquema `Problema` del contrato.
- Cómo se conecta: usa los viajes de la preparación de la T3 (`crearViaje`).
- Tests: los cinco casos del archivo.
- Para mirar con atención: **sin diferencias de código ni de `type` frente a `m6.yml`**. Un detalle de cómo se llega al `404` del viaje ajeno: M6 le muestra cualquier viaje a un token `SYSTEM` (no filtra por cliente), así que es M2 quien compara el `clientId` del viaje con el del pedido y responde `404`; M6 no lo rechaza. Un viaje inexistente sí lo informa M6 con `404` y `code` `TRIP_NOT_FOUND`.

### T7 — Resiliencia contra el M6 real · commit `081/T7`
- Qué cambió: `pruebas/distribuida/resiliencia.test.ts` (M6 sano, detenido, de vuelta, congelado, de vuelta, y el total de pedidos). `ayudas/averias.ts:conAveria` provoca la avería, corre el cuerpo y restablece en un `finally`. `ayudas/orden.ts:OrdenDeArchivos` pone a `resiliencia` al final, y va en `sequence.sequencer` de `vitest.config.ts`. `ayudas/contador.ts` suma en un archivo que crea `global.ts` y recibe cada prueba con `inject('archivoPedidos')`. `ayudas/entorno.ts` suma `inicioDeM2` y recibe `esperarSalud`, que estaba en `global.ts`.
- Por qué así: RNF-13.8. Son dos averías que M2 vive distinto: `stop` falla enseguida y `pause` deja la conexión colgada hasta el tiempo máximo. La calificación se reintenta **con la misma `Idempotency-Key`** que dio `503`, porque eso hace quien obedece el `Retry-After`; así también se comprueba que el `503` no dejó la clave reservada.
- Cómo se conecta: M2 no cambió (`git diff origin/main -- src migraciones contrato` vacío). Se ejerce `src/modulos/cliente.ts`: 2 s por intento, un reintento en los GET y `ModuloNoDisponible` con `Retry-After`.
- Tests: `resiliencia.test.ts` (7 casos) y las unitarias `distribuida-averias.test.ts` (el `finally`, también si fallan el cuerpo, la avería o restablecer), `distribuida-orden.test.ts` y `distribuida-contador.test.ts` (dos contadores con un archivo ven la suma). `consistencia.test.ts` exige el orden y que el archivo exista: si se renombrara, el orden dejaría de aplicarle sin que nada falle. Comprobado a mano: con `M2_TIEMPO_MODULOS_MS=20000` cae solo la prueba del congelado, con `TimeoutError`, las siguientes pasan y M6 queda contestando `200`; con la configuración normal, los archivos no se solapan y `resiliencia` es el último (reporte JSON de Vitest).
- Para mirar con atención:
  - **El orden no se podía dar por hecho.** Vitest pone primero los archivos que fallaron y los más largos, y este es de los más largos: sin `OrdenDeArchivos` habría apagado a M6 antes que los demás. Vitest lee esa opción de la configuración raíz, no de cada proyecto; para los otros proyectos no cambia nada, salvo en una corrida sin `--project`, donde este archivo queda último de todos.
  - **Lo observado en el log de M2.** Detenido: `getaddrinfo ENOTFOUND m6-real`, en unos 300 ms; no es «conexión rechazada» como decía el plan (corregido), porque Docker quita el nombre del contenedor detenido. Congelado: `TimeoutError`, en 4,2 s (dos intentos de 2 s y 200 ms de pausa), lo mismo que promete el contrato.
  - **Calificar con M6 congelado también tarda ~4,2 s en total**, porque M2 consulta a M6 con un GET, que se reintenta. Con `M2_TIEMPO_MODULOS_MS` o `M2_REINTENTOS_MODULOS` más altos, la prueba de los 10 s cae a propósito.
  - **La salud se mira por HTTP, no por Docker.** Después de descongelar, `docker ps` mostró a M6 `unhealthy` mientras `GET /health` ya daba `200`; no investigué más, pero por eso `restablecerM6` espera el HTTP.
  - `esperarSalud` no suma al contador: M6 no le aplica su límite de pedidos a `/health`. La cuenta de 600 es conservadora en lo demás, porque suma todos los reintentos posibles aunque no ocurran.

### T8 — Job de CI aparte · commit `081/T8`
- Qué cambió: `.github/workflows/integracion-m6.yml` (job `integracion-m6`): `npm ci`, `npm run integracion:m6`, `docker compose logs` si falla y `down -v` siempre.
- Por qué así: RNF-07.7. Va aparte de `ci.yml` (que no cambió) porque construye el M6 del Grupo 12 desde su repositorio y tarda; corre solo en `push` a `main` y a mano (`workflow_dispatch`), así que no aparece en los checks de un PR ni en la protección de `main` (RNF-17.2). Mismas versiones de `checkout` y `setup-node` y Node 24 que `ci.yml`, permisos de solo lectura y 30 minutos como máximo.
- Cómo se conecta: el paso de la prueba lleva `M2_DEJAR_LEVANTADO=1` porque `global.ts` baja el entorno al terminar, también si falla; sin eso, el paso de logs no encontraría nada.
- Tests: `pruebas/unitarias/workflow-integracion-m6.test.ts` (disparadores, comando, orden de logs y `down`, versiones iguales a las de `ci.yml`). Los tres pasos de compose se corrieron tal como están escritos, sin variables de entorno: 333 líneas de logs y, después de `down -v`, ningún proyecto ni volumen.
- Para mirar con atención: **la ejecución manual en la rama no se pudo lanzar antes del merge.** GitHub solo deja disparar `workflow_dispatch` de un archivo que ya está en la rama por defecto. Falta lanzarlo en cuanto el PR esté en `main` (pestaña Actions o `gh workflow run integracion-m6.yml`); si da rojo por algo del runner (puertos, tiempos del primer build), se corrige con un `fix/`. El build sin caché de la imagen de M6 en el runner no se midió.
- Después del merge (2026-11-07): `gh workflow run integracion-m6.yml` sobre `main` (`2b8fb41`, merge del PR #85) dio **verde**: 7 archivos, 35 pruebas, sin cambios en el workflow. Corrida: https://github.com/FRRe-DS/2026-17-TPI/actions/runs/42421221167.

### T9 — Documentación · commit `081/T9`
- Qué cambió: `docs/probar-m2.md` tiene una sección 8 («M2 contra el M6 real del Grupo 12») con el comando para levantarlo, las variables y los puertos, el recorrido a mano con `curl`, `npm run integracion:m6` con su salida esperada, el commit de M6 usado y cómo cambiarlo. La sección 5 ya no dice que M6 no existe. `README.md` enlaza la sección. En esta guía: la visión general y la tabla de diferencias.
- Por qué así: RNF-20.4. Los comandos de la sección 8 se extrajeron del archivo y se corrieron tal como están escritos: levantar (cuatro servicios sanos), el recorrido a mano (`201`, `arrived/start/complete 200`, historial `COMPLETED` con `calificado:false`, calificación `201`, `503` con `retry-after: 5`, y M6 de vuelta con `200`) y `npm run integracion:m6` (7 archivos, 34 pruebas). El único que no se corrió literalmente es el de `M6_REAL_COMMIT=<hash completo>`, que lleva un marcador.
- Cómo se conecta: el hash de M6 está en `docker-compose.yml` (valor por defecto de `M6_REAL_COMMIT`) y se repite, solo como texto, en la sección 8; los dos se cambian juntos, como dice el comentario del compose.
- Tests: ninguno nuevo; `npm test`, lint, build y spec-check en verde.
- Para mirar con atención: la fila 4 de la tabla está leída en el `openapi.yaml` y el código de M6, no ejercitada. Las filas 7 y 8 son propuestas nuestras que todavía no tienen issue.

### T10 — Diferencias para el Grupo 12 y propuestas de cambio · commit `081/T10`
- Qué cambió: solo esta guía. @sandobaitt revisó los textos de abajo y, con su OK, el 2026-11-07 se publicaron en `FRRe-DS/2026-12-TPI` como [#9](https://github.com/FRRe-DS/2026-12-TPI/issues/9) (A) y [#10](https://github.com/FRRe-DS/2026-12-TPI/issues/10) (B); los enlaces están en la columna «Se consulta a» de la tabla. Los issues de las propuestas de `sdd-change` todavía no se abrieron.
- Por qué así: RNF-20.4. Un issue en el repositorio de otro grupo es un mensaje público y a nombre nuestro, y no se puede retirar del todo una vez publicado. Por eso la tarea queda con los textos listos, como permite su «Hecho cuando».
- Cómo se conecta: salen de las filas 2 y 3 de la tabla (Grupo 12) y de las 7 y 8 (propuestas nuestras). Las filas 1, 4, 5, 6, 9 y 10 no necesitan nada del Grupo 12.
- Tests: no aplica (documentación).
- Para mirar con atención: los textos no llevan claves, tokens ni datos de nadie. Citan commits de su repositorio y rutas de archivos, que son públicos. Hubo un tercer borrador sobre los filtros de `GET /trips` (fila 4) y se descartó el 2026-11-07, antes de publicarlo: comparaba a M6 con nuestra extracción vieja, y M6 coincide con el contrato actual de la cátedra.

#### Issues para el Grupo 12 (publicados)

**Issue A — ¿M6 va a verificar la firma, el emisor y la audiencia del JWT?** (fila 2)

> **Qué observamos.** Probamos M2 (Clientes, Grupo 17) contra M6 en `m6/base-de-datos` (`7d3d5af` y `107d63c`), y funciona. Vimos en su README que la verificación de la firma del JWT está pendiente y depende de M1. Hoy `backend/src/middlewares/auth.middleware.ts` tampoco mira `iss` ni `aud`.
>
> **Qué dice el contrato.** `bearerAuth` dice «Token emitido por M1 (Identidad y Acceso)», sin indicar qué `iss` y `aud` se esperan.
>
> **Qué pedimos.** Para cuando M6 empiece a verificar, que nos digan: (1) qué `iss` va a esperar; (2) qué `aud`; (3) con qué clave o JWKS va a verificar; y (4) en qué fecha aproximada. Hoy M2 se presenta con `iss` `m1-identidad`, `aud` `m6-viajes`, `sub` `m2-clientes` y `roles: ["SERVICIO"]`, firmado con su propia clave. Nos interesa adaptarlo antes de que deje de pasar. Si todavía no está definido, nos alcanza con que nos avisen en este issue cuando lo esté.

**Issue B — Documentar en el contrato el claim `roles` y los alias de rol** (fila 3)

*Estado: cerrado por el Grupo 12 el 2026-11-08, con la documentación en su `openapi.yaml`. El texto de abajo es el que se publicó.*

> **Qué observamos.** Nuestro token de servicio lleva `roles: ["SERVICIO"]`. M6 lo acepta: `auth.middleware.ts` lee `role` o `roles`, y toma `SERVICIO` (y `SERVICE`) como `SYSTEM`, `CLIENTE` como `CLIENT`, `CONDUCTOR` como `DRIVER` y `OPERADOR` como `OPERATOR`. Lo probamos de punta a punta con el historial y la calificación de M2.
>
> **Qué dice el contrato.** El contrato de M6 (`contratos/m6_viajes/openapi.yml`, igual a su `openapi.yaml`) habla de «su rol» y solo nombra `CLIENT`, `DRIVER`, `OPERATOR` y `SYSTEM`. No menciona el claim `roles` ni los nombres en español. La versión anterior (`9e720a0`) sí los documentaba; la confirmada (`35b3c4d`) ya no.
>
> **Qué pedimos.** Que el contrato documente que se aceptan `roles` y esos alias. Así M2 y cualquier otro módulo que se presente con `SERVICIO` se apoya en algo acordado y no en un detalle del código que podría cambiar. No hace falta cambiar el comportamiento: solo que quede escrito.

#### Propuestas de `sdd-change` (nuestras, sin issue todavía)

**Propuesta 1 — Un `429` de M6 debe ser `503` con `Retry-After`** (fila 7; specs `007-historial` y `008-calificacion-conductor`).
- Hoy: M6 limita los pedidos por minuto y responde `429` con `Retry-After`. `src/modulos/cliente.ts` devuelve cualquier `4xx` tal cual, sin reintento, y los servicios lo convierten en un `500` (RF-2.4.7: un `4xx` de otro módulo se trata como problema de acuerdo entre módulos). Para el cliente de M2 un límite de velocidad pasajero es indistinguible de un error de configuración.
- Cambio: un `429` de un módulo es una indisponibilidad temporal: M2 responde `503` con `Retry-After` (el que informó el módulo, o `M2_REINTENTAR_DESPUES_S`) y sin reintentar de inmediato. Afecta los requisitos de error de las dos specs; el contrato público no cambia porque ya declara `503`.
- Casos límite a escribir en la spec: `Retry-After` ausente o ilegible; `429` en el segundo intento; que no consuma el reintento.
- Cómo se probaría: pruebas de `pruebas/modulos/` con el M6 simulado respondiendo `429`, y un caso más en la prueba distribuida si el Grupo 12 permite bajar `RATE_LIMIT_SERVICE_PER_MIN`.

**Propuesta 2 — Enviar `X-Correlation-Id` a M6** (fila 8; las mismas dos specs).
- Hoy: M2 manda su id de correlación en el encabezado de `M2_ENCABEZADO_CORRELACION` (por defecto `X-Request-Id`). M6 usa `X-Correlation-Id` y, si no viene, genera uno propio, así que el id de una solicitud de M2 no aparece en los logs de M6 (RNF-14).
- Cambio: el cliente de módulos manda también `X-Correlation-Id`, con el mismo valor que `X-Request-Id` (decidido en `spec.md`, sección Decisiones).
- Cómo se probaría: prueba unitaria del cliente de módulos (el encabezado sale en cada intento) y, en la distribuida, que un pedido a M2 deje el mismo id en los logs de M6 (`docker compose logs m6-real`).

## Revisión independiente

El revisor (2026-11-07) pidió estos cambios, ya aplicados:
- **La prueba de RNF-07.11 no usaba el token real.** Tomaba el de `dist/herramientas/token.js`, el comando que hace de M1: `aud` `m2-clientes` y 1 hora de vida. M2 ante M6 usa `tokenDeServicio`: `aud` `m6-viajes` y 60 s (visto decodificando los dos en el contenedor). Hoy daría igual porque M6 no mira `aud`, pero el día que lo mire la prueba podía quedar en verde con el historial roto. Ahora `tokenDeServicioDeM2` corre esa función dentro del contenedor de M2, y una prueba nueva comprueba `sub`, `roles`, `aud` y vida. El defecto venía del plan (corregido).
- **Tabla de diferencias.** La fila 5 decía algo falso sobre `m6.yml`; se sumaron las filas 11 y 12.
- **`describirRespuesta`** leía solo `detail`, que el contrato de M6 deja como opcional: ahora también `message`.
- **Vigilancia.** `consistencia.test.ts` ahora sí exige el comando exacto de `npm test` (la guía de la T2 lo daba por hecho y no existía) y que `docs/probar-m2.md` cite el commit que usa compose.
- **Otros.** `resiliencia` pasa a 240 s por prueba, más que los 180 s que puede tardar `restablecerM6`. En `docs/probar-m2.md`, repetir un archivo lleva `M2_DEJAR_LEVANTADO=1`, y `down -v` avisa que borra la base de trabajo de M2.

RNF-13.8 decía que la calificación vuelve a `200`, y la prueba y el contrato dicen `201`. Manda el contrato; la spec se corrigió el 2026-11-08 con un `sdd-change` (rama `spec/081-integracion-m6-real-cambio`): solo cambió el texto, no el código ni el plan.
