# Probar M2 Clientes y entender el repositorio

Guía para quien evalúa el módulo y para el grupo. Dice cómo ver cada funcionalidad funcionando, cómo correr las pruebas y dónde está cada cosa. Lo que se afirma acá se comprobó con el servicio levantado: el recorrido de la sección 1 es el script `scripts/demo.mjs`.

## 1. Prueba rápida: tres comandos

Hace falta Node.js 24 (desde la 24.2) y Docker con compose v2, usable sin `sudo`.

```bash
docker compose up -d --build --wait     # servicio M2 y su base PostgreSQL propia
node scripts/demo.mjs                   # recorre todas las funcionalidades y comprueba cada respuesta
docker compose down                     # al terminar (agrega -v para borrar también los datos)
```

La demo crea un cliente nuevo en cada corrida, así que se puede repetir sin limpiar la base. Levanta por su cuenta un M6 simulado (un contenedor llamado `m6-simulado`), lo usa para calificaciones e historial y lo borra al terminar. Imprime una línea por paso con ✔ o ✘ y termina con código distinto de cero si alguna respuesta no es la que dice el contrato. Con `--detalle` muestra además el `curl` equivalente y la respuesta completa de cada paso; con `--dejar-m6` no borra el M6 simulado.

Lo que recorre, por requisito de la cátedra:

| Requisito | Qué se comprueba | Secciones de la demo |
|---|---|---|
| RF-2.1 Perfil | Crear (201 con `Location`), repetir la solicitud sin duplicar, un segundo perfil (409), validar el cuerpo (400), consultar, actualizar parcialmente | 2 |
| RF-2.2 Direcciones frecuentes | Alta, listado, consulta, cambio, baja y 404 posterior, tipo inválido | 3 |
| RF-2.3 Preferencias | Vacías al principio, guardar, volver a leer, valor inválido | 4 |
| RF-2.4 Historial de viajes | La lista que arma M6, con `calificado` en cada viaje | 6 |
| RF-2.5 Calificación del conductor | Calificar un viaje completado, repetición idempotente, duplicado (409), clave reutilizada con otro cuerpo (422), viaje en curso (422), ajeno o inexistente (404), puntaje inválido (400) | 7 |
| RF-2.6 Estado de cuenta | Bloquear (OPERADOR), consultar el estado como otro módulo (SERVICIO), levantar el bloqueo | 5 |
| Seguridad y errores (RNF-03) | Sin token (401), token de otro cliente o con el rol equivocado (403), errores `application/problem+json` | 1 |
| Resiliencia (RNF-13) | Con M6 caído, calificar y el historial dan 503 con `Retry-After`; lo que no depende de M6 sigue respondiendo | 8 |

## 2. Probar a mano

Mientras no exista M1, el propio servicio firma los tokens. El comando va dentro del contenedor y escribe solo el token:

```bash
TOKEN=$(docker compose exec -T m2 node dist/herramientas/token.js --sub 00000000-0000-4000-8000-000000000001 --roles CLIENTE)
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8082/api/v1/clientes/00000000-0000-4000-8000-000000000001
```

El `sub` de un CLIENTE es su `clienteId`. Roles reconocidos: `CLIENTE`, `CONDUCTOR`, `OPERADOR` y `SERVICIO`. Las altas piden además un encabezado `Idempotency-Key`: repetir la misma clave con el mismo cuerpo devuelve la misma respuesta sin duplicar nada.

Quién puede qué (lo dice el `security` de cada operación en `contrato/openapi.yml`; un CLIENTE solo opera sobre su propio perfil):

| Operaciones | Roles |
|---|---|
| Crear, actualizar el perfil; crear, actualizar y eliminar direcciones; guardar preferencias; calificar | CLIENTE |
| Consultar el perfil, direcciones, preferencias, historial, calificaciones | CLIENTE, OPERADOR |
| Consultar el estado de cuenta | CLIENTE, OPERADOR, SERVICIO (otros módulos) |
| Crear, listar, consultar y levantar bloqueos | OPERADOR |
| `GET /health` | sin token |

Lo que no se ve en el recorrido pero conviene mirar:

- **Correlación (RNF-14):** cada respuesta devuelve `X-Request-Id`, que es el que mandó quien llamó o uno generado. `docker compose logs m2` muestra una línea JSON por solicitud con ese mismo `idCorrelacion`, y el servicio lo reenvía a M6.
- **Datos sensibles (RNF-19):** los logs no llevan tokens ni cuerpos, y la ruta se registra como plantilla (`/api/v1/clientes/:clienteId/…`) y no con los ids.
- **El contrato:** `contrato/openapi.yml` se puede abrir en cualquier visor OpenAPI. No hay una interfaz tipo Swagger dentro del servicio.

## 3. Pruebas automáticas

```bash
npm ci
npm test                                  # unitarias, de módulos, HTTP e integración (PostgreSQL real con Testcontainers)
npm run lint && npm run build
docker compose up -d --build --wait
npm run contrato:test                     # Schemathesis prueba las 20 operaciones contra el contrato
npx --yes @redocly/cli@2.62.1 lint contrato/openapi.yml
node scripts/spec-check.mjs               # estructura de las specs; lo mismo que corre CI
```

Qué prueba cada carpeta de `pruebas/`:

| Carpeta | Qué prueba |
|---|---|
| `unitarias/` | Funciones puras: validaciones, modelos, configuración, tokens, permisos |
| `modulos/` | El cliente HTTP hacia otros módulos y la lectura de lo que responde M6 (con un servidor simulado) |
| `http/` | La capa HTTP sin base: autenticación, roles, errores, correlación y logs |
| `integracion/` | Servicio, repositorio y HTTP con PostgreSQL real, incluida la concurrencia (diez altas a la vez) y M6 simulado |
| `ayudas/` | Piezas compartidas: base de prueba, servidor de módulo simulado, M6 simulado (`m6-simulado.ts`), tokens |

CI corre cuatro verificaciones en cada PR: `specs`, `contrato`, `build-test` y `contract-test`.

## 4. Mapa del repositorio

| Qué buscás | Dónde |
|---|---|
| Qué promete el módulo (rutas, códigos, errores) | `contrato/openapi.yml`. Lo que M2 consume de M1 y M6, en `contrato/dependencias/` |
| Qué se construyó y por qué | `specs/NNN-…/`: `spec.md` (qué), `plan.md` (cómo), `tasks.md` (pasos) y `guia.md` (lo hecho, tarea por tarea) |
| Decisiones y principios | `docs/adr/` y `docs/constitution.md` |
| El código | `src/` |
| La base de datos | `migraciones/` (una por spec con tablas nuevas) |
| Las pruebas | `pruebas/` y `scripts/contrato-test.mjs` |
| Cómo se levanta | `docker-compose.yml`, `Dockerfile`, `ejemplo.env` (variables `M2_*`) |
| Cómo trabaja el grupo | `AGENTS.md`, `MANUAL.md`, `.github/` (CI y plantillas de issue y PR) |

Cada funcionalidad sale de una spec y vive en una carpeta de `src/`:

| Funcionalidad | Spec | Código | Tablas |
|---|---|---|---|
| Base del servicio, salud | 003 | `src/app.ts`, `servidor.ts`, `arranque.ts`, `config.ts`, `salud.ts` | `idempotencias` |
| Perfil, estado de cuenta y bloqueos | 004 | `src/clientes/` | `clientes`, `bloqueos_cliente` |
| Direcciones frecuentes | 005 | `src/direcciones/` | `direcciones_cliente` |
| Preferencias | 006 | `src/preferencias/` | `preferencias_cliente` |
| Historial de viajes | 007 | `src/historial/` (lee de M6, no de la base) | ninguna |
| Calificaciones | 008 | `src/calificaciones/` | `calificaciones` |

Dentro de cada carpeta el recorrido es siempre el mismo: `operaciones.ts` recibe la solicitud HTTP, `servicio.ts` aplica las reglas, `repositorio.ts` hace el SQL y `modelo.ts` define los tipos. El historial reemplaza el repositorio por `m6.ts`, que llama a M6. `src/operaciones/index.ts` une cada ruta con su manejador por el `operationId` del contrato.

Lo que usan todas las funcionalidades:

| Pieza | Dónde |
|---|---|
| Autenticación y roles | `src/auth/tokens.ts` (verifica el JWT), `src/auth/permisos.ts` |
| Contrato como fuente de las rutas y de la validación | `src/contrato/` (carga el OpenAPI, lista las operaciones, compila la validación con Ajv). Los tipos salen de él al compilar |
| Base de datos | `src/bd/`: pool con tiempo límite, migraciones al arrancar, transacciones e idempotencia |
| Errores `application/problem+json` | `src/errores.ts`, `src/errores-fastify.ts` |
| Logs y correlación | `src/logs.ts`, `src/correlacion.ts` |
| Llamadas a otros módulos (timeout, un reintento, `503` si no contestan) | `src/modulos/cliente.ts` |

Para entender una funcionalidad, el orden recomendado es: su `spec.md` (qué pide y por qué), su `guia.md` (el recorrido de una solicitud paso a paso y qué tiene para mirar con atención) y recién después el código y sus pruebas.

## 5. Qué está simulado y qué no

- **M1 (Identidad) no existe todavía.** Los tokens los firma el servicio con la clave, el emisor y la audiencia de `ejemplo.env`. Cuando exista M1, cambia quién firma, no el código que valida (ADR 009).
- **M6 (Viajes) tiene dos formas de probarse.** Por defecto, M2 se prueba contra un M6 simulado que cumple `contrato/dependencias/m6.yml` (lo verifica `pruebas/unitarias/m6-simulado.test.ts`). Contra el M6 real del Grupo 12, M2 se probó con la prueba distribuida de la spec 081: sección 8. Lo que difiere entre el contrato supuesto y el M6 real está en `specs/081-integracion-m6-real/guia.md`. El servicio le pide a M6 con un token de servicio firmado en cada intento.
- **M5 y M9** consultan el estado de cuenta con el rol `SERVICIO`. M2 no los llama, y en la demo ese rol lo hace un token propio.
- **Los datos de ejemplo:** el servicio arranca con la base vacía. No hay datos cargados de antemano.

## 6. Si algo no anda

- `permission denied` con Docker: tu usuario tiene que estar en el grupo `docker` (hay que cerrar sesión y volver a entrar). Sin eso tampoco corren las pruebas de integración.
- `node scripts/demo.mjs` dice que el servicio no responde: levántalo con `docker compose up -d --build --wait`. Si usás otro puerto, la demo lee `M2_PUERTO` como el compose.
- Node 20 no sirve: `nvm use 24`.
- Puerto 8082 ocupado: `M2_PUERTO=8090 docker compose up -d --build --wait` y `M2_PUERTO=8090 node scripts/demo.mjs`.
- Una corrida de la demo cortada a la mitad puede dejar el contenedor `m6-simulado`: `docker rm -f m6-simulado`.
- En Windows, después de clonar, ver la «Trampa de Windows» de `AGENTS.md` (finales de línea).

## 7. El panel (interfaz web)

Es la forma de probar todo desde el navegador (spec 071). Dos maneras de levantarlo:

```bash
docker compose --profile panel up -d --build --wait     # todo en contenedores
# o, para desarrollar el panel: M2 y el M6 simulado en compose, el panel en la máquina
docker compose up -d --build --wait && docker compose --profile panel up -d --build --wait m6 bd-puente
npm run panel
```

Se abre <http://localhost:8083>. Sin sesión solo está «Ingresar»: se entra como cliente nuevo (el panel lo crea en M2 con un `Idempotency-Key`), como un cliente recordado de este navegador o con otro rol (CLIENTE, OPERADOR, SERVICIO, CONDUCTOR). Qué hace cada vista:

| Vista | Para qué |
|---|---|
| Mi perfil | Ver y editar el perfil (solo se manda lo que cambió) y «Cargar ejemplo»: direcciones, preferencias y dos viajes en el M6 simulado |
| Direcciones frecuentes, Preferencias | Alta, edición y baja (con confirmación) de direcciones; preferencias de viaje |
| Historial de viajes, Calificar, Mis calificaciones | El historial que arma M6, calificar un viaje completado (doble clic = un solo envío) y ver lo calificado |
| Estado de cuenta | El estado y los bloqueos vigentes del cliente |
| Bloqueos de clientes (OPERADOR) | Buscar un cliente, bloquear y levantar bloqueos |
| Consultar estado de cuenta (SERVICIO) | Lo que consultan M5 y M9 |
| Detalle técnico | Cada pedido a M2: método, ruta, encabezados, cuerpo, respuesta y el `curl` equivalente |
| M6 simulado | Cambiar el modo (normal, lento, caído) y ver qué contesta M2 en cada escenario |
| Demostración | Recorrer la API de M2 caso por caso, probar la integridad de los datos y apagar y encender la base (spec 072, más abajo) |

Si M2 no responde en 10 segundos, la vista dice «M2 no responde» con «Reintentar». Las pruebas: `npm test` cubre la lógica y cada vista contra M2 real; `npm run panel:navegador` abre Chrome a 360 y a 1280 px (claro y oscuro) y comprueba tamaños, teclado, accesibilidad, estados y valores máximos.

### La vista «Demostración» (spec 072)

Está en el menú de todos los roles (Herramientas). Sirve para que quien evalúa recorra lo que hace M2 sin armar nada: cada caso y cada prueba crea sus propios datos (un cliente con UUID nuevo, sus propios tokens), así que no cambia tu sesión y se puede repetir sin limpiar la base. Tiene tres secciones y comparten un cerrojo: mientras algo corre, los demás botones quedan deshabilitados (comparten M2 y el M6 simulado).

**Casos.** Los 37 casos de la API, en ocho áreas (perfil, direcciones, preferencias, historial, calificación, estado de cuenta, seguridad y errores, resiliencia con el M6 caído). Cada uno tiene «Ejecutar» y muestra el pedido, la respuesta, lo esperado y ✔ «Correcto» o ✘ «No coincide». «Ejecutar todo» los corre uno tras otro (nunca en paralelo, porque los de resiliencia ponen el M6 simulado en «caído»), sigue aunque uno falle y termina con el resumen («Los 37 casos dieron lo esperado»). No apaga la base. Tarda unos 10 s.

**Integridad.** Qué comprueba cada una (N es el campo de arriba, de 2 a 50, por defecto 10):

| Prueba | Qué hace | Qué se espera |
|---|---|---|
| Altas simultáneas con la misma clave | N altas del mismo cliente a la vez, con la misma `Idempotency-Key` y el mismo cuerpo | N respuestas `201` con el mismo cuerpo y 1 fila en `clientes` (RNF-08.2) |
| Altas simultáneas con claves distintas | N altas del mismo cliente a la vez, cada una con su clave | un `201`, N−1 `409` y 1 fila: lo garantiza la restricción única de la base (RNF-08.3) |
| Calificaciones simultáneas del mismo viaje | N calificaciones del mismo viaje completado, cada una con su clave | un `201`, N−1 `409` y 1 fila en `calificaciones` (RNF-08.4) |
| Restricción del puntaje | Intenta guardar puntaje 9 directo en la base, en una transacción que siempre se deshace | PostgreSQL la rechaza con `calificaciones_puntaje_valido` (`23514`) y las filas no cambian (RNF-05.5) |

Las simultáneas salen del servidor del panel y no del navegador, que pone en fila los pedidos y no serían simultáneas. Cada una muestra la tabla de respuestas por código (llegaron y se esperaban), las filas que quedaron en la base de M2 y un folio de corrida para buscar los pedidos con `docker compose logs m2`.

**Base de datos.** «Apagar la base» (pide confirmación, porque deja a M2 sin base para cualquiera que lo use) ejecuta `docker compose stop bd` y la vista consulta la salud de M2 cada 2 s: se espera `503`. «Encender la base» ejecuta `docker compose start bd` y espera hasta 60 s a que la salud vuelva a `200`, o dice que no volvió. Con la base apagada, los casos que la usan dan ✘ con el `503` de M2; volver a apagar o a encender no es un error.

**Cómo activar apagar y encender.** Solo andan con el panel en la máquina, porque el contenedor del panel no tiene Docker (a propósito: darle el socket de Docker sería darle control de toda la máquina):

1. Levantá M2, el M6 simulado y el puente a la base: `docker compose up -d --build --wait && docker compose --profile panel up -d --build --wait m6 bd-puente`.
2. Si levantaste todo el perfil, parar el panel del contenedor: `docker compose stop panel`.
3. Corré el panel en la máquina: `npm run panel`, y abrí <http://localhost:8083/#/demostracion>.
4. Tu usuario tiene que estar en el grupo `docker` (sin `sudo`).

Si falta algo, los dos botones quedan deshabilitados con el motivo («el panel corre en un contenedor», «Docker no está instalado», «el usuario no puede usar Docker sin sudo») y cómo activarlos; el resto de la vista sigue funcionando. Las consultas de filas y la prueba de la restricción no necesitan Docker.

**El puente a la base.** El panel cuenta filas y prueba la restricción conectándose a la base de M2 con una lista fija de acciones (nunca SQL libre), con el mismo usuario que usa M2. Con el panel en la máquina llega por el servicio `bd-puente` del perfil `panel`, que publica la base solo en `127.0.0.1:5433` (cambiable con `PANEL_PUERTO_BD`); sin ese perfil no se publica ningún puerto nuevo, y el servicio `bd` no cambia. Dentro de compose, el contenedor del panel llega por la red a `bd:5432`.

Variables del panel para esta vista (valores por defecto en `ejemplo.env`): `PANEL_URL_BD` (la base de M2; vacía, las acciones de base quedan deshabilitadas), `PANEL_PUERTO_BD`, `PANEL_DOCKER` (`si`, o `no` en el contenedor) y `PANEL_SERVICIO_BD` (el servicio a apagar y encender, `bd`). Como el resto de las acciones del panel, rechazan pedidos con `Host` u `Origin` ajenos (RNF-12.10).

Las pruebas de esta vista: `npm test` las recorre contra M2 real y la base de Testcontainers, con un Docker de mentira para apagar y encender (la base de M2 detrás de un proxy TCP que se corta y se reabre); `npm run panel:navegador` abre Chrome y comprueba la vista a 360 y 1280 px, la confirmación, el doble clic, «Ejecutar todo» hasta el resumen y la salud en vivo. Apagar y encender la base de verdad no se prueba en CI: se comprobó a mano con el panel en la máquina (evidencia en la guía de la spec).

Simulado en el panel: la sesión (pendiente de M1, el panel firma tokens de desarrollo en su servidor y la clave nunca llega al navegador) y los viajes (M6 simulado en contenedor propio). Cuando existan M1 y M6 se cambian en `panel/cliente/src/fuentes/`.

## 8. M2 contra el M6 real del Grupo 12

Spec 081. Levanta el M6 que construyó el Grupo 12 (con su propia base) junto a M2 y comprueba historial, calificación y qué pasa cuando M6 se cae. Hace falta lo mismo que antes (Node 24, Docker con compose v2 sin `sudo`) y acceso a internet la primera vez: compose construye M6 desde su repositorio, `github.com/FRRe-DS/2026-12-TPI`.

**Qué versión de M6 se usa.** El commit `7d3d5af9138d9b220f109798e9f615ca853d2bda` de la rama `m6/base-de-datos` (6 de noviembre de 2026). Compose lo toma de `docker-compose.yml`, donde es el valor por defecto de `M6_REAL_COMMIT`; acá se repite solo como texto. Para probar otro sin editar nada:

```bash
M6_REAL_COMMIT=<hash completo> M2_URL_M6=http://m6-real:3006 docker compose --profile m6-real up -d --build --wait
```

Para cambiar el commit fijo: editá ese valor en `docker-compose.yml` y el hash de esta sección, corré la prueba (más abajo), y anotá en la guía de la spec qué diferencias nuevas aparecen.

### Levantarlo

```bash
M2_URL_M6=http://m6-real:3006 docker compose --profile m6-real up -d --build --wait
```

Crea cuatro servicios sanos: `m2`, `bd`, `m6-real` y `m6-real-bd`. Lo único que le dice a M2 dónde está M6 es `M2_URL_M6`; sin el perfil `m6-real` no se crea nada de M6, y `m2` no depende de `m6-real`: arranca aunque M6 no esté. La URL no lleva `/api/v1` porque M6 sirve en `/trips`.

| Qué | Dónde |
|---|---|
| M2 | <http://localhost:8082> (o `M2_PUERTO`) |
| M6 real | <http://127.0.0.1:3016> (o `M6_REAL_PUERTO`), solo desde tu máquina: trae atajos de demo |
| Base de M6 | sin puerto publicado |
| Credenciales de la base de M6 | `M6_REAL_BD_USUARIO`, `M6_REAL_BD_CLAVE`, `M6_REAL_BD_NOMBRE` (valores de desarrollo en `ejemplo.env`) |

Se corta con `docker compose --profile m6-real down`. Con `-v` también borra los datos: los de M6 y la base de trabajo de M2.

### Recorrerlo a mano

M6 acepta tokens de atajo (`SYSTEM`, `DRIVER:<id>`, `CLIENT:<id>`) mientras corra con `ENABLE_DEMO_AUTH`, que es el caso de este perfil. Con ellos se arma un viaje completado para un cliente de M2 y se ve en su historial:

```bash
uuid() { node -e 'console.log(crypto.randomUUID())'; }
CLIENTE=$(uuid); CONDUCTOR=$(uuid)
TOKEN=$(docker compose exec -T m2 node dist/herramientas/token.js --sub $CLIENTE --roles CLIENTE)

# 1. El perfil en M2 (201).
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: $(uuid)" -H 'Content-Type: application/json' \
  -d '{"nombre":"Ana","apellido":"Gomez","telefono":"+5493624987654","fechaNacimiento":"1990-05-17"}' http://localhost:8082/api/v1/clientes

# 2. Un viaje en M6, llevado hasta COMPLETED (200 en cada paso).
VIAJE=$(curl -s -X POST -H 'Authorization: Bearer SYSTEM' -H 'Content-Type: application/json' \
  -d "{\"requestId\":\"$(uuid)\",\"clientId\":\"$CLIENTE\",\"driverId\":\"$CONDUCTOR\",\"vehicleId\":\"$(uuid)\",\"vehicleType\":\"CAR\",\"originLatitude\":-27.45,\"originLongitude\":-58.98,\"destinationLatitude\":-27.47,\"destinationLongitude\":-58.83}" \
  http://127.0.0.1:3016/trips | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
curl -s -o /dev/null -w 'arrived %{http_code}\n' -X POST -H "Authorization: Bearer DRIVER:$CONDUCTOR" http://127.0.0.1:3016/trips/$VIAJE/arrived
curl -s -o /dev/null -w 'start %{http_code}\n' -X POST -H "Authorization: Bearer DRIVER:$CONDUCTOR" -H 'Content-Type: application/json' -d "{\"verificationToken\":\"qr-$(uuid)\"}" http://127.0.0.1:3016/trips/$VIAJE/start
curl -s -o /dev/null -w 'complete %{http_code}\n' -X POST -H "Authorization: Bearer DRIVER:$CONDUCTOR" -H 'Content-Type: application/json' -d '{"distanceKm":6.4}' http://127.0.0.1:3016/trips/$VIAJE/complete

# 3. El historial en M2: un viaje COMPLETED con "calificado":false.
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8082/api/v1/clientes/$CLIENTE/viajes

# 4. Calificarlo (201). El conductorId sale de M6.
curl -s -w ' [%{http_code}]\n' -X POST -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: $(uuid)" -H 'Content-Type: application/json' \
  -d "{\"viajeId\":\"$VIAJE\",\"puntaje\":5}" http://localhost:8082/api/v1/clientes/$CLIENTE/calificaciones

# 5. M6 caído: el historial da 503 con Retry-After.
docker compose --profile m6-real stop m6-real
curl -s -D - -o /dev/null -H "Authorization: Bearer $TOKEN" http://localhost:8082/api/v1/clientes/$CLIENTE/viajes | grep -iE '^HTTP|retry-after'
docker compose --profile m6-real start m6-real
```

Salida esperada: `201`; `arrived 200`, `start 200`, `complete 200`; el historial con `"estado":"COMPLETED"` y `"calificado":false`; la calificación con `[201]`; y `HTTP/1.1 503 Service Unavailable` con `retry-after: 5`. Después del último `start` (el de `docker compose`), M6 tarda unos segundos en volver a estar sano.

### Correr la prueba

```bash
npm ci
npm run integracion:m6
```

Levanta todo por su cuenta en un proyecto de compose aparte (`m2-distribuida`, con M2 en el puerto 18082 y M6 en el 13006, para no pisar lo que tengas levantado), corre los escenarios y lo baja con `down -v`. No forma parte de `npm test`. La primera vez construye M6 (unos minutos); con la imagen en caché tarda unos 30 s. Salida esperada: `Test Files  7 passed (7)` y `Tests  35 passed (35)`. Lo que prueba, por archivo (`pruebas/distribuida/`):

| Archivo | Qué comprueba | Requisito |
|---|---|---|
| `salud.test.ts` | M2 y M6 contestan `/health`; M2 guarda y devuelve un perfil | RNF-07.7 |
| `viajes.test.ts`, `token-servicio.test.ts` | La preparación de viajes en M6, y que el token de servicio de M2 no es rechazado | RNF-07.11 |
| `historial.test.ts` | Los viajes del cliente y solo esos, `calificado`, la paginación de M2 traducida a la de M6, página vacía | RNF-07.8 |
| `calificacion.test.ts` | Calificar (201), conductor tomado de M6, duplicado (409) | RNF-07.9 |
| `rechazos.test.ts` | Viaje inexistente o ajeno (404), cancelado o en curso (422) | RNF-07.10 |
| `resiliencia.test.ts` | M6 detenido y congelado: 503 con `Retry-After`, lo propio de M2 en 200, y recuperación sin reiniciar M2 | RNF-13.8 |

Con `M2_DEJAR_LEVANTADO=1 npm run integracion:m6` el entorno queda levantado al terminar, para mirar los logs (`docker compose -p m2-distribuida --profile m6-real logs`) o repetir un archivo (`M2_DEJAR_LEVANTADO=1 npx vitest run --project distribuida pruebas/distribuida/historial.test.ts`; sin la variable, el entorno se baja al terminar); se baja con `docker compose -p m2-distribuida --profile m6-real down -v`. Si algo falla al arrancar (Docker apagado, el build roto), la corrida termina en rojo con un mensaje que dice qué falló.

En CI corre aparte de los PR: `.github/workflows/integracion-m6.yml`, en cada push a `main` y a mano desde Actions.

## 9. M2 con Keycloak real (tokens RS256)

Spec 080. M2 puede validar los tokens con las claves públicas de Keycloak (modo `jwks`) en lugar de la clave compartida de desarrollo (modo `hs256`, el de las secciones anteriores). Sirve para ver la autenticación como será en TP2: firma asimétrica, audiencia `m2-clientes`, rol y scope. Hace falta lo mismo que antes (Node 24, Docker con compose v2 sin `sudo`) y acceso a internet la primera vez, para bajar la imagen de Keycloak (unos 470 MB).

### Levantarlo

```bash
docker compose --env-file ejemplo-keycloak.env up -d --build --wait
```

Crea cuatro servicios sanos: `m2`, `bd`, `keycloak` y `keycloak-bd` (la base de Keycloak, aparte de la de M2). `ejemplo-keycloak.env` activa el perfil `keycloak` y deja a M2 en modo `jwks`; el primer arranque tarda un par de minutos porque Keycloak crea sus tablas e importa el realm `ds-2026-realm` (`keycloak/`).

| Qué | Dónde |
|---|---|
| M2 | <http://localhost:8082> (o `M2_PUERTO`) |
| Keycloak | <http://localhost:8080> (o `KEYCLOAK_PUERTO`), solo desde tu máquina |
| Realm | `ds-2026-realm`; token en `http://localhost:8080/realms/ds-2026-realm/protocol/openid-connect/token` |

Se corta con `docker compose --env-file ejemplo-keycloak.env down`. Para aplicar un cambio de `keycloak/` hace falta `down -v`: el realm se importa una sola vez, al crear la base de Keycloak, y con la base ya creada se ignora el archivo. `down -v` también borra los datos de M2.

### Un token de persona

El realm trae cuatro usuarios de desarrollo: `cliente1` y `cliente2` (rol `CLIENTE`), `operador1` (`OPERADOR`) y `conductor1` (`CONDUCTOR`). Su contraseña es `<usuario>-contrasena-de-desarrollo`, y sus `id` son fijos (el de `cliente1` es `c1e00000-0000-4000-8000-000000000001`). Se piden al cliente `m2-desarrollo`, que es solo para pruebas:

```bash
KC=http://localhost:8080/realms/ds-2026-realm/protocol/openid-connect/token
campo() { node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token'; }
TOKEN=$(curl -s $KC -d grant_type=password -d client_id=m2-desarrollo -d username=cliente1 \
  -d password=cliente1-contrasena-de-desarrollo -d 'scope=clientes:read clientes:write' | campo)
```

El token dura 300 s (5 minutos); pasado ese tiempo, M2 contesta `401` y se pide otro. En Keycloak los scopes son opcionales: se piden en `scope` los que se necesitan (`clientes:read`, `clientes:write` y, para el estado de cuenta, `clientes.estado:read`). M2 exige en cada operación el que declara el contrato, en el mismo renglón que el rol (ADR 079): un token sin ese scope recibe `403`.

### Un token de servicio

Los módulos que consultan el estado de cuenta (M5 y M9, y también los que la cátedra cargó con rol `SERVICIO`) entran con `client_credentials`. Los secretos están en el realm de desarrollo; acá se leen del archivo para no repetirlos. Por ejemplo, con `grupo-04`, que tiene el rol `SERVICIO` y el scope `clientes.estado:read`:

```bash
SECRETO=$(node -pe 'JSON.parse(require("fs").readFileSync("keycloak/ds-2026-realm-realm.json","utf8")).clients.find(c=>c.clientId==="grupo-04").secret')
TS=$(curl -s $KC -d grant_type=client_credentials -d client_id=grupo-04 -d client_secret=$SECRETO | campo)
```

### Probar una operación

```bash
uuid() { node -e 'console.log(crypto.randomUUID())'; }
CLIENTE=c1e00000-0000-4000-8000-000000000001

# 1. cliente1 crea su perfil (201): el clienteId es el sub del token.
curl -s -w ' [%{http_code}]\n' -X POST -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: $(uuid)" -H 'Content-Type: application/json' \
  -d '{"nombre":"Ana","apellido":"Gomez","telefono":"+5493624987654","fechaNacimiento":"1990-05-17"}' http://localhost:8082/api/v1/clientes

# 2. Lo lee (200) y no puede leer el de cliente2 (403).
curl -s -w ' [%{http_code}]\n' -H "Authorization: Bearer $TOKEN" http://localhost:8082/api/v1/clientes/$CLIENTE
curl -s -o /dev/null -w '[%{http_code}]\n' -H "Authorization: Bearer $TOKEN" http://localhost:8082/api/v1/clientes/c1e00000-0000-4000-8000-000000000002

# 3. El servicio lee el estado de cuenta (200) y no el perfil (403).
curl -s -w ' [%{http_code}]\n' -H "Authorization: Bearer $TS" http://localhost:8082/api/v1/clientes/$CLIENTE/estado-cuenta
curl -s -o /dev/null -w '[%{http_code}]\n' -H "Authorization: Bearer $TS" http://localhost:8082/api/v1/clientes/$CLIENTE

# 4. Sin token (401).
curl -s -o /dev/null -w '[%{http_code}]\n' http://localhost:8082/api/v1/clientes/$CLIENTE
```

Salida esperada: `[201]`, `[200]`, `[403]`, `{"clienteId":"c1e0…0001","estado":"ACTIVO","bloqueosVigentes":[]} [200]`, `[403]` y `[401]`.

### Lo que conviene saber

- **El panel solo funciona en modo `hs256`.** El panel firma sus propios tokens con la clave de desarrollo, y en modo `jwks` M2 los rechaza con `401`. El inicio de sesión del panel contra Keycloak es la spec del #83.
- **`m2-front` no sirve para pedir tokens con usuario y contraseña.** Es el cliente público que usará esa spec: solo admite el flujo de código de autorización con PKCE `S256`, y con `grant_type=password` Keycloak contesta `unauthorized_client`. Para probar a mano se usa `m2-desarrollo`.
- **El emisor tiene que coincidir.** M2 compara el `iss` del token con `M2_EMISOR_TOKENS`, que en `ejemplo-keycloak.env` es el `KC_HOSTNAME` de Keycloak (`http://localhost:8080/...`) más el realm. Si es distinto (por ejemplo, `127.0.0.1` en lugar de `localhost`, o un `KEYCLOAK_PUERTO` que no coincide), todo token da `401` con «El emisor del token no es el esperado». Por eso hay que pedir el token por el mismo nombre que figura ahí.
- **Con Keycloak detenido**, M2 atiende con las claves que ya guardó y contesta `503` con `Retry-After` si nunca llegó a bajar una (RNF-13.10 a RNF-13.13).

### Correr la prueba

```bash
npm ci
npm run keycloak:test
```

Levanta todo por su cuenta en un proyecto de compose aparte (`m2-keycloak`, con M2 en el puerto 18083 y Keycloak en el 18080, para no pisar lo que tengas levantado), corre los escenarios y lo baja con `down -v`. No forma parte de `npm test`. Salida esperada: `Test Files  3 passed (3)` y `Tests  23 passed (23)`, en unos 90 s con las imágenes ya bajadas; la primera vez tarda más. Lo que prueba, por archivo (`pruebas/keycloak/`):

| Archivo | Qué comprueba | Requisito |
|---|---|---|
| `operaciones.test.ts` | Un CLIENTE crea y lee su perfil y no el de otro (403); un OPERADOR registra un bloqueo; la cuenta de servicio de M5 lee el estado de cuenta y no el perfil; el scope de cada operación (sin scopes, solo `clientes:read`, solo `clientes:write`, estado de cuenta con y sin `clientes.estado:read`: 403 o 200); token alterado, HS256 o ID token (401) | RNF-07.13, RNF-12.13 |
| `pkce.test.ts` | El flujo de código con `S256` de `m2-front`, y los rechazos (sin `code_challenge`, `plain`, retorno ajeno, canje sin `code_verifier`, usuario y contraseña, `client_credentials`) | RNF-12.20 |
| `caido.test.ts` | Keycloak detenido: con la clave ya guardada M2 atiende (200); reiniciado, arranca y da 503 con `Retry-After`; y al volver Keycloak da 200 sin reiniciar M2 | RNF-13.9 a RNF-13.13 |

Con `M2_DEJAR_LEVANTADO=1 npm run keycloak:test` el entorno queda levantado al terminar, para mirar los logs (`docker compose -p m2-keycloak --env-file ejemplo-keycloak.env logs`); se baja con `docker compose -p m2-keycloak --env-file ejemplo-keycloak.env down -v`. En CI corre en cada PR: el job `keycloak` de `.github/workflows/ci.yml`.
