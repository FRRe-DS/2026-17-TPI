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

Observadas contra el commit `7d3d5af`. «Se consulta a» dice a quién le toca resolverla. Los textos de issue para el Grupo 12 son de la T10.

| # | Comportamiento observado | Lo que dice `m6.yml` | Resolución | Se consulta a |
|---|---|---|---|---|
| 1 | M6 sirve en `/trips`, sin `/api/v1` (con `/api/v1` M2 recibe un error). | `servers`: `http://localhost:3006/api/v1`. | El real se usa con `M2_URL_M6=http://m6-real:3006`. Falta quitar `/api/v1` de `servers` y alinear el M6 simulado: rama `contrato/079-…`. | Nosotros. El Grupo 12 coincide con el contrato de la cátedra. |
| 2 | M6 no verifica la firma del JWT: decodifica el payload y mira `role`/`roles` y `exp`. Tampoco revisa `aud` ni `iss`. | `[NECESITA ACLARACIÓN]` qué `aud` e `iss` valida. | Sin cambio en M2: el token de servicio pasa. Cuando M6 verifique, M2 tendrá que firmar con lo que M6 acuerde. | Grupo 12 |
| 3 | M6 acepta `SERVICIO` como alias de `SYSTEM` (y `CLIENTE`, `CONDUCTOR`, `OPERADOR`). | Coincide: nombra `SYSTEM` / `SERVICIO`. Su `openapi.yaml` solo nombra los roles en inglés. | Ninguna para M2. Pedir que su `openapi.yaml` documente los alias. | Grupo 12 |
| 4 | `GET /trips` con token `SYSTEM` exige `clientId` o `driverId`; sin ninguno, `400` con `code` `VALIDATION`. (Leído en su `openapi.yaml` y su código; M2 siempre manda `clientId`, no se ejerció.) | `SYSTEM` exige al menos un filtro entre `clientId`, `driverId` y `state`; el error es `FILTER_REQUIRED`. | Ninguna para M2. Alinear el contrato con lo que hace M6. | Grupo 12 |
| 5 | `GET /trips/{id}` con token `SYSTEM` devuelve el viaje de cualquier cliente. | El contrato no dice qué ve cada rol. | M2 compara el `clientId` del viaje con el del pedido y responde `404` (comprobado en T6). | Nadie: es una regla nuestra. |
| 6 | Un `404` de M6 al listar el historial da `500` en M2, no `503`. | — | Es el diseño de M2 (RF-2.4.7: un `4xx` de otro módulo es un problema de acuerdo entre módulos, no del cliente). | Nadie. |
| 7 | M6 limita los pedidos por minuto y responde `429` con `Retry-After`. M2 lo trata como `4xx` y responde `500`. | No declara `429`. | Propuesta de `sdd-change` de las specs 007 y 008: M2 responde `503` con `Retry-After` ante un `429`. | Nosotros (y el Grupo 12 declara el `429`). |
| 8 | M6 propaga `X-Correlation-Id`; M2 manda el encabezado de `M2_ENCABEZADO_CORRELACION` (por defecto `X-Request-Id`), así que M6 genera su propio id y las trazas de los dos no se unen. | No declara encabezado de correlación. | Propuesta de `sdd-change` de las specs 007 y 008: enviar `X-Correlation-Id` a M6. | Nosotros (y el Grupo 12 lo declara en el contrato). |
| 9 | El M8 de M6 es simulado: acepta cualquier `verificationToken` salvo unos pocos, y cada uno sirve una vez. | — | Solo afecta la preparación de viajes de la prueba. | Nadie. |
| 10 | Con M6 detenido, M2 ve `ENOTFOUND` y responde `503` en ~300 ms; con M6 congelado, `TimeoutError` y `503` en ~4,2 s. | M2 promete 2 s por intento y un reintento. | Coincide. | Nadie. |

## Tareas

### T1 — Perfil `m6-real` de compose · commit `081/T1`
- Qué cambió: `docker-compose.yml` suma `m6-real` (el M6 del Grupo 12, construido desde su repositorio al commit fijo) y `m6-real-bd` (su Postgres 16.15), los dos solo con `--profile m6-real`. `ejemplo.env` documenta `M6_REAL_PUERTO`, `M6_REAL_COMMIT` y las credenciales de la base de M6. `panel/servidor/entorno-ejemplo.ts` deja de tomar las variables `M6_REAL_*` como si fueran de M2.
- Por qué así: RNF-04.9 pide el entorno reproducible con un comando; RNF-06.6 pide que lo único que cambie en M2 sea `M2_URL_M6`. Por eso `m2` no tiene `depends_on` de `m6-real`: tiene que arrancar aunque M6 no esté (RNF-13). Puertos solo en `127.0.0.1`, porque M6 corre con sus atajos de demo.
- Cómo se conecta: M2 ve a M6 por la red de compose como `http://m6-real:3006`. El M6 simulado del perfil `panel` sigue siendo otro servicio (`m6`) y no se mezcla.
- Tests: `pruebas/unitarias/consistencia.test.ts` (servicios y variables nuevos aceptados, y que sin el perfil no se crea nada de M6), `pruebas/unitarias/ejemplo-env.test.ts` y `pruebas/panel/unitarias/config.test.ts` (el filtro de `M6_REAL_*`).
- Para mirar con atención:
  - **La URL no lleva `/api/v1`.** El plan se escribió con `http://m6-real:3006/api/v1`, pero el M6 real sirve en `/trips`, igual que el contrato de la cátedra. El prefijo que usa M2 sale de `servers` de nuestro `contrato/dependencias/m6.yml`. Comprobado con M2: `M2_URL_M6=http://m6-real:3006` da `200` y con `/api/v1` da `500`. Se corrigieron `plan.md`, `tasks.md`, `docker-compose.yml` y `ejemplo.env`; la spec no cambia (RNF-06.6 sigue igual). Falta quitar `/api/v1` de `servers` en `m6.yml` y alinear el M6 simulado, que hoy sí lo usa (por eso el valor por defecto de `M2_URL_M6` conserva el prefijo): va en la rama `contrato/079-…`.
  - **Commit fijo.** Se fijó `7d3d5af9138d9b220f109798e9f615ca853d2bda`, con el que se probó. El 2026-11-07 la punta de `m6/base-de-datos` del Grupo 12 es `107d63c7ed0e854334d0b0578a4f6124264d045c`: no se adoptó sin probarla. Para probarla: `M6_REAL_COMMIT=107d63c… docker compose --profile m6-real up -d --build --wait`.
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
- Tests: `pruebas/distribuida/viajes.test.ts` (cada estado llega a M6, con el cliente y el conductor correctos), `pruebas/distribuida/token-servicio.test.ts` (con el token de M2, `sub` `m2-clientes` y `roles` `["SERVICIO"]`, `GET /trips?clientId=…` y `GET /trips/{id}` dan `200`; sin token M6 da `401` con `code` `UNAUTHENTICATED` y el mensaje lo muestra) y `pruebas/unitarias/distribuida-errores.test.ts`.
- Para mirar con atención (diferencias de M6 frente a lo que M2 supone, para el Grupo 12 en la T10):
  - M6 **no verifica la firma** del JWT: decodifica el payload y mira `role`/`roles` y `exp`. Tampoco revisa `aud` ni `iss`. Por eso el token de M2 pasa, pero también pasaría uno firmado por cualquiera. Esto responde parte del `[NECESITA ACLARACIÓN]` de `m6.yml` sobre `aud` e `iss`.
  - M6 acepta `SERVICIO` como alias de `SYSTEM` (también `CLIENTE`, `CONDUCTOR`, `OPERADOR`). Su `openapi.yaml` solo nombra los roles en inglés.
  - `listTrips` en M6 usa `page` desde 1 y `pageSize`, y devuelve `{ items, page, pageSize, total }`. Un `SYSTEM` sin `clientId` ni `driverId` recibe `400`.
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

### T9 — Documentación · commit `081/T9`
- Qué cambió: `docs/probar-m2.md` tiene una sección 8 («M2 contra el M6 real del Grupo 12») con el comando para levantarlo, las variables y los puertos, el recorrido a mano con `curl`, `npm run integracion:m6` con su salida esperada, el commit de M6 usado y cómo cambiarlo. La sección 5 ya no dice que M6 no existe. `README.md` enlaza la sección. En esta guía: la visión general y la tabla de diferencias.
- Por qué así: RNF-20.4. Los comandos de la sección 8 se extrajeron del archivo y se corrieron tal como están escritos: levantar (cuatro servicios sanos), el recorrido a mano (`201`, `arrived/start/complete 200`, historial `COMPLETED` con `calificado:false`, calificación `201`, `503` con `retry-after: 5`, y M6 de vuelta con `200`) y `npm run integracion:m6` (7 archivos, 34 pruebas). El único que no se corrió literalmente es el de `M6_REAL_COMMIT=<hash completo>`, que lleva un marcador.
- Cómo se conecta: el hash de M6 está en `docker-compose.yml` (valor por defecto de `M6_REAL_COMMIT`) y se repite, solo como texto, en la sección 8; los dos se cambian juntos, como dice el comentario del compose.
- Tests: ninguno nuevo; `npm test`, lint, build y spec-check en verde.
- Para mirar con atención: la fila 4 de la tabla está leída en el `openapi.yaml` y el código de M6, no ejercitada. Las filas 7 y 8 son propuestas nuestras que todavía no tienen issue.
