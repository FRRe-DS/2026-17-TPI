# Plan — Spec 081 Integración distribuida de M2 con el M6 real del Grupo 12

No cambia `contrato/openapi.yml`, `contrato/dependencias/m6.yml`, `src/` ni `migraciones/`, y no agrega dependencias: levantar el M6 real es compose, y la prueba usa Vitest y `fetch`, que ya están. Si la prueba encuentra algo que obligue a tocar M2, ese cambio va por `sdd-change` de la 007 o la 008 (ver Decisiones y tarea T10).

## Estructura
```
docker-compose.yml                  perfil `m6-real`: servicios `m6-real` y `m6-real-bd`
ejemplo.env                         variables nuevas, comentadas
vitest.config.ts                    un proyecto más, `distribuida`, fuera de `npm test`
package.json                        script `integracion:m6`
pruebas/distribuida/
  global.ts                         levanta y baja el entorno
  ayudas/                           pedidos a M2 y a M6, preparación de viajes, contador de pedidos
  historial.test.ts  calificacion.test.ts  rechazos.test.ts  token-servicio.test.ts  resiliencia.test.ts
.github/workflows/integracion-m6.yml   job aparte
docs/probar-m2.md                   sección nueva
specs/081-integracion-m6-real/guia.md  diferencias y guía de tareas
```

## Contrato
M2 no implementa operaciones nuevas. La prueba ejerce estas, contra el M6 real:

| operationId | Para qué | Requisitos |
|---|---|---|
| `listarHistorialViajes` | historial del cliente, paginación, cliente sin viajes, M6 caído | RNF-07.8, RNF-13.8 |
| `calificarConductor` | calificación feliz, duplicado, viaje ajeno o inexistente, no completado, M6 caído | RNF-07.9, RNF-07.10, RNF-13.8 |
| `listarCalificaciones`, `obtenerCalificacion` | comprobar que solo quedó la primera calificación | RNF-07.9 |
| `obtenerCliente`, `listarDirecciones` | comprobar que lo propio de M2 sigue en `200` con M6 caído | RNF-13.8 |

De M6 (`m6.yml` es lo que M2 supone; la implementación del Grupo 12 es lo que se prueba): `listTrips` y `getTrip` las consume M2. `createTrip`, `registerArrival`, `startTrip` y `completeTrip` las usa solo la preparación de la prueba, con los atajos de demo de M6 (`ENABLE_DEMO_AUTH`), nunca M2.

## Datos
Sin tablas ni migraciones de M2. El M6 real trae su propia base (PostgreSQL), con su volumen, que se crea y se borra con el perfil. No se comparte con la base de M2 (RNF-05).

**Compose** (RNF-04.9). Dos servicios del perfil `m6-real`, que no tocan al servicio `m6` simulado (el del perfil `panel`):
| Servicio | Qué es |
|---|---|
| `m6-real-bd` | PostgreSQL 16 (la versión de su compose), con la imagen fijada a un tag de parche existente, su volumen y un chequeo por TCP como el de `bd`. Credenciales de desarrollo en `ejemplo.env`; no se publica ningún puerto. |
| `m6-real` | `build.context` = `https://github.com/FRRe-DS/2026-12-TPI.git#<commit>` y `dockerfile: backend/Dockerfile`. Variables: `DATABASE_URL` hacia `m6-real-bd`, `PORT=3006`, `ENABLE_DEMO_AUTH=true` (solo para preparar viajes). Publica `127.0.0.1:${M6_REAL_PUERTO:-3016}:3006`: la prueba lo usa desde la máquina; M2 lo ve por la red de compose como `m6-real:3006`. Depende de `m6-real-bd` sano. Su `HEALTHCHECK` ya viene en su imagen, y `--wait` lo respeta. |

El commit va escrito una sola vez, en `docker-compose.yml`, como valor por defecto de `${M6_REAL_COMMIT:-7d3d5af…}` (el hash completo, que T1 vuelve a comprobar contra la rama `m6/base-de-datos` del Grupo 12). Con la variable se prueba otro commit sin editar nada; para cambiar el fijo, se edita ese valor y la línea de `docs/probar-m2.md`.

M2 apunta a M6 solo por `M2_URL_M6` (RNF-06.6): `M2_URL_M6=http://m6-real:3006 docker compose --profile m6-real up -d --build --wait`. `m2` no depende de `m6-real` en `depends_on`: M2 tiene que arrancar y responder aunque M6 no esté (RNF-13).

## Lógica
No hay lógica de M2 nueva. La prueba:

**Entorno** (`global.ts`, RNF-07.7). Antes de todo: `docker compose -p m2-distribuida --profile m6-real up -d --build --wait` con `M2_URL_M6`, `M2_PUERTO=18082` y `M6_REAL_PUERTO=13006` en el entorno, para no chocar con un M2 que la persona ya tenga levantado ni compartir su base. Al terminar: `down -v`, salvo con `M2_DEJAR_LEVANTADO=1`. Si Docker no está o el build falla, la prueba termina con un mensaje que dice qué falló y no se salta en silencio.

**Preparación de un viaje** (`ayudas/viajes.ts`). Para un `clienteId` nuevo (UUID por escenario, como la demo y la 072):
```
crearViaje(clienteId)            → POST /trips   (createTrip)
si estado final = COMPLETED:     registerArrival → startTrip (con el QR simulado de M6) → completeTrip
si estado final = CANCELLED:     cancelar (si M6 lo permite desde PENDING_ARRIVAL; si no, se anota la diferencia)
si estado final = en curso:      registerArrival → startTrip
devuelve { viajeId, conductorId, estado }
```
Los nombres exactos de rutas, cuerpos y roles salen de `openapi.yaml` del Grupo 12 en el commit fijado; T3 los lee ahí y no del supuesto de `m6.yml`.

**Pedidos**. `pedirM2(token, método, ruta, cuerpo?)` y `pedirM6(...)`, con `fetch`, `AbortSignal.timeout(10 s)` y un contador de pedidos. El token de M2 sale del mismo comando que usa la demo (`docker compose exec m2 node dist/herramientas/token.js`), no de uno armado con claves de prueba: así M2 se presenta ante M6 con el token que firma de verdad. El token de servicio de la comprobación RNF-07.11 usa `sub` `m2-clientes` y `roles` `["SERVICIO"]`, como M2 (ADR 009).

**Límite de M6** (1200 por minuto). Un contador suma los pedidos de la prueba a M6 y, por cada pedido a M2 que consulta a M6, hasta `1 + M2_REINTENTOS_MODULOS`. Una prueba final comprueba que el total de la corrida no pasa de 600, la mitad del límite.

**Resiliencia** (`resiliencia.test.ts`), en este orden y al final, porque deja a M6 apagado un rato:
```
1. M6 sano: historial 200 y calificación 201 (línea base).
2. docker compose stop m6-real  → historial y calificación: 503 + Retry-After; perfil y direcciones: 200.
3. docker compose start m6-real → esperar la salud de M6 (hasta 60 s) → historial y calificación: 200/201, sin reiniciar m2.
4. docker compose pause m6-real → "no responde": historial y calificación: 503 + Retry-After antes de 10 s;
   perfil y direcciones: 200.  unpause → vuelven a responder.
```
Un `finally` hace `unpause` y `start`, para no dejar el entorno a medias si un paso falla.

## Integraciones
M2 → M6 no cambia: su cliente (`src/modulos/cliente.ts`) ya tiene el timeout (`M2_TIEMPO_MODULOS_MS`, 2 s), el reintento limitado (`M2_REINTENTOS_MODULOS`, 1) y el `503` con `Retry-After` (RNF-13). Esta spec comprueba ese comportamiento contra un servicio real, que es lo que el M6 simulado no podía demostrar. Lo que M2 no hace y M6 sí espera (el `429` como `503`, el `X-Correlation-Id`) queda como propuesta de `sdd-change`.

## Pruebas
- **Distribuida** (esta spec): `npm run integracion:m6` = `vitest run --project distribuida`. Proyecto aparte, sin `globalSetup` compartido con `integracion` (no usa Testcontainers: el entorno es el de compose) y con `testTimeout` y `hookTimeout` largos (el primer build baja y compila a M6). Queda fuera de `npm test`.
- **Existentes**: `npm test`, `npm run lint`, `npm run build`, `npm run contrato:test` siguen igual. Una prueba de consistencia comprueba que los servicios nuevos del compose y las variables de `ejemplo.env` estén de acuerdo (como las que ya existen para el perfil `panel`).
- **CI** (`integracion-m6.yml`): `on: push` a `main` y `workflow_dispatch`; instala dependencias, corre `npm run integracion:m6` y, si falla, imprime `docker compose logs`. No es uno de los checks de la protección de `main` (RNF-17.2 no lo pide).

## Decisiones
- **Fijar el commit en `docker-compose.yml` y no en un submódulo ni en un clon.** El submódulo agrega código ajeno al repositorio y un paso de `git submodule update` que la persona olvida; el clon manual depende de su máquina. El contexto de build por git baja solo lo necesario y compose lo hace con el mismo comando de siempre. Alternativa descartada: copiar `backend/` de M6.
- **Proyecto de compose aparte (`-p m2-distribuida`) y puertos propios.** La prueba no puede pisar el M2 ni la base que la persona tenga levantados para trabajar. Alternativa descartada: usar el proyecto por defecto, que obliga a bajar todo antes de probar y pierde datos con `down -v`.
- **Un proyecto de Vitest y no un script `.mjs`.** Las comprobaciones son muchas y con detalle (cuerpos, encabezados, conteos); Vitest da el mismo formato de salida que el resto y filtra por archivo. `scripts/contrato-test.mjs` se justifica porque lanza Schemathesis, que no es de Vitest.
- **`docker compose` por `child_process`, no la API de Testcontainers.** No agrega dependencias (hay que preguntar antes) y es el mismo comando que documenta `probar-m2.md`, así que quien lo corre a mano ve lo mismo que la prueba.
- **`pause` además de `stop`.** Detener el contenedor da «conexión rechazada» al instante; «no responde dentro del tiempo máximo» (RNF-13.8) solo se ve con un servicio que acepta la conexión y no contesta.
- **Sin ADR.** Nada de esto cambia el contrato ni la arquitectura de M2: es entorno de prueba. El ADR 057 ya registra que M6 sale del contrato de la cátedra.

## Cobertura de requisitos
| Requisito | Qué parte lo cubre |
|---|---|
| RNF-04.9 | Perfil `m6-real` de compose: `m6-real`, `m6-real-bd`, commit fijo (T1) |
| RNF-06.6 | `M2_URL_M6` como única diferencia, y `git diff origin/main -- src` vacío al validar (T1, T2) |
| RNF-07.7 | Proyecto `distribuida`, `global.ts` y job de CI (T2, T8) |
| RNF-07.8 | `historial.test.ts` (T4) |
| RNF-07.9 | `calificacion.test.ts` (T5) |
| RNF-07.10 | `rechazos.test.ts` (T6) |
| RNF-07.11 | `token-servicio.test.ts` (T3) |
| RNF-13.8 | `resiliencia.test.ts` (T7) |
| RNF-20.4 | `docs/probar-m2.md`, `guia.md` con las diferencias y los issues para el Grupo 12 (T9, T10) |
