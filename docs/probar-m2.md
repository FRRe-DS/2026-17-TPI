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
- **M6 (Viajes) no existe todavía.** Historial y calificaciones se probaron contra un M6 simulado que cumple `contrato/dependencias/m6.yml` (lo verifica `pruebas/unitarias/m6-simulado.test.ts`). Falta contrastarlas con el M6 real; es el supuesto principal de las specs 007 y 008. El servicio le pide a M6 con un token de servicio firmado en cada intento.
- **M5 y M9** consultan el estado de cuenta con el rol `SERVICIO`. M2 no los llama, y en la demo ese rol lo hace un token propio.
- **Los datos de ejemplo:** el servicio arranca con la base vacía. No hay datos cargados de antemano.

## 6. Si algo no anda

- `permission denied` con Docker: tu usuario tiene que estar en el grupo `docker` (hay que cerrar sesión y volver a entrar). Sin eso tampoco corren las pruebas de integración.
- `node scripts/demo.mjs` dice que el servicio no responde: levántalo con `docker compose up -d --build --wait`. Si usás otro puerto, la demo lee `M2_PUERTO` como el compose.
- Node 20 no sirve: `nvm use 24`.
- Puerto 8082 ocupado: `M2_PUERTO=8090 docker compose up -d --build --wait` y `M2_PUERTO=8090 node scripts/demo.mjs`.
- Una corrida de la demo cortada a la mitad puede dejar el contenedor `m6-simulado`: `docker rm -f m6-simulado`.
- En Windows, después de clonar, ver la «Trampa de Windows» de `AGENTS.md` (finales de línea).
