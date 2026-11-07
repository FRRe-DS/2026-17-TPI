# Guía — Spec 081 Integración distribuida de M2 con el M6 real del Grupo 12

## Visión general

_Se escribe al validar la spec (`081/V`)._

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
- Para mirar con atención: el contador vive en memoria de cada archivo de prueba (Vitest aísla los archivos), así que la cuenta de «todo lo de la corrida» no se suma sola entre archivos; si hace falta comprobar el total de 600 hay que persistirlo (un archivo temporal que `global.ts` cree y borre). Primera corrida con la imagen de M6 en caché: ~60 s.

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
