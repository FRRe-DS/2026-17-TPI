# Plan — Spec 080 M2 valida tokens de Keycloak (JWKS y scope) y compose con Keycloak

La decisión de fondo está en el ADR 080 (`docs/adr/080-keycloak.md`), que reemplaza al ADR 009. No agrega dependencias: `jose` ya está en `dependencies` y trae lo necesario para leer un JWKS. No cambia `contrato/` ni `migraciones/`. El panel, `scripts/demo.mjs` y el comando de tokens no se tocan.

Lo que este plan afirma sobre Keycloak se comprobó el 2026-11-07 con un realm mínimo, sobre la imagen 26.8.2, en modo `start` y con PostgreSQL 18.6. El JSON de la cátedra, sin cambios y solo renombrado, también se importó en esa imagen (con `start-dev`) y emitió un token de `grupo-17`. Lo de `jose` sale de sus tipos en `node_modules` (6.2.12).

## Estructura
```
src/
  config.ts              M2_MODO_TOKENS, M2_URL_JWKS
  auth/tokens.ts         el verificador según el modo; `verificarToken` (HS256) no cambia
  auth/claves-jwks.ts    nuevo: pedir y guardar las claves, con tiempo máximo y reintentos
  auth/permisos.ts       usa el verificador; suma `exigirScope`
  contrato/operaciones.ts  `permisosDe` separa roles de scopes
  app.ts, arranque.ts    crear el verificador; pedir las claves al arrancar
keycloak/ds-2026-realm-realm.json   el realm de desarrollo
docker-compose.yml       perfil `keycloak`: servicios `keycloak` y `keycloak-bd`
ejemplo.env              dos variables nuevas, cada una con su comentario arriba
ejemplo-keycloak.env     lo que cambia para levantar M2 en modo jwks
pruebas/
  unitarias/, http/      modo jwks con claves y JWKS propios de la prueba
  keycloak/              prueba con Keycloak real (proyecto aparte, fuera de `npm test`)
.github/workflows/ci.yml  un job más, `keycloak`
docs/probar-m2.md        sección nueva
```

## Contrato
No se implementan operaciones nuevas. Cambia cómo se autorizan las 19 protegidas (RNF-12.11 a RNF-12.16). `verificarSalud` sigue pública (RNF-12.15). Los códigos ya están declarados en las 19: `401`, `403` y `503`.

El `503` de RNF-13.10 usa `type: about:blank`, que entra tanto en `ServicioNoDisponible` (`ProblemaGenerico`) como en `DependenciaNoDisponible` (`Problema`, cuyo `type` es cualquier `uri-reference`). Tres textos del contrato no lo dicen y se ajustan en #79, sin cambiar el esquema: la descripción de `ServicioNoDisponible`, que habla solo de la base; la frase de que el `503` de dependencia tiene `type` propio; y la descripción de `SinPermiso`, que no menciona el scope. `about:blank` es lo correcto: 17 de las 19 operaciones declaran `ProblemaGenerico`, con ese `type` fijo.

**Scopes y #79.** `contrato/openapi.yml` todavía no declara scopes. M2 los lee del contrato con el mismo mecanismo que los roles (Lógica 4): antes de #79 ninguna operación real exige scope; después, todas, sin tocar `src/`. Lo único que espera a #79 es T18. Lo que #79 tiene que escribir, para que el contrato pida los dos:
```yaml
security:
  - bearerAuth: [CLIENTE]
    keycloak: [clientes:read]
```

## Datos
Sin tablas ni migraciones en M2. El `sub` sigue siendo el `clienteId` (spec 004): Keycloak usa UUID, que es lo que M2 ya exige. Keycloak guarda lo suyo en `keycloak-bd`, con su volumen `datos-keycloak-bd`, sin compartir nada con `bd` (RNF-05.6).

**Compose** (RNF-04.10). Dos servicios del perfil `keycloak`. `m2` no depende de ellos (RNF-13.9).
| Servicio | Qué es |
|---|---|
| `keycloak-bd` | `postgres:18.6`, la misma imagen de `bd`. Sus `POSTGRES_*` van en `environment`: con `env_file: ejemplo.env` tomaría los de M2. No publica puertos. Chequeo por TCP, como `bd`. |
| `keycloak` | `quay.io/keycloak/keycloak:26.8.2`, `command: start --import-realm`, y `./keycloak` montado en `/opt/keycloak/data/import` solo lectura. Publica `127.0.0.1:${KEYCLOAK_PUERTO:-8080}:8080`, porque quien prueba pide el token desde la máquina. Depende de `keycloak-bd` sano. Variables: `KC_DB`, `KC_DB_URL`, `KC_DB_USERNAME`, `KC_DB_PASSWORD`, `KC_BOOTSTRAP_ADMIN_USERNAME`, `KC_BOOTSTRAP_ADMIN_PASSWORD`, `KC_HOSTNAME=http://localhost:${KEYCLOAK_PUERTO:-8080}`, `KC_HOSTNAME_BACKCHANNEL_DYNAMIC=true`, `KC_HTTP_ENABLED=true` y `KC_HEALTH_ENABLED=true`. |

Las credenciales salen de variables de compose, con un valor de desarrollo por defecto (RNF-06.8): `KEYCLOAK_BD_USUARIO` (`keycloak`), `KEYCLOAK_BD_CLAVE` (`keycloak-contrasena-de-desarrollo`), `KEYCLOAK_ADMIN_USUARIO` (`admin`) y `KEYCLOAK_ADMIN_CLAVE` (`admin-contrasena-de-desarrollo`). Se escriben `${VARIABLE:-valor}`, porque `${VARIABLE:?}` haría fallar a compose también sin el perfil.

Tres detalles que se comprobaron y no son obvios:
- **El archivo tiene que llamarse `<realm>-realm.json`:** Keycloak 26 no arranca con `ds-2026-realm.json`, el nombre que usa la cátedra, porque el realm se llama `ds-2026-realm`. Por eso `ds-2026-realm-realm.json`.
- **El chequeo de salud mira el código HTTP, no el texto.** La imagen no trae curl: se usa `/dev/tcp` de bash contra `/health/ready`, en el puerto 9000. Buscar `"status": "UP"` da falsos positivos, porque esa cadena aparece en una comprobación interna mientras el estado general es `DOWN`, y el primer token recibe `503`. Hay que buscar `HTTP/1.1 200`.
- **El realm se importa una sola vez.** Con la base ya creada, Keycloak dice «already exists» y lo salta: cambiar el JSON exige `down -v`. La clave de firma vive en la base, así que un reinicio conserva el `kid`, y `down -v` lo cambia (RNF-12.16 lo cubre).

**`ejemplo-keycloak.env`** (RNF-06.7, RNF-06.8). Con él alcanza un comando: `docker compose --env-file ejemplo-keycloak.env up -d --build --wait`. Se comprobó que `--env-file` activa el perfil (`COMPOSE_PROFILES=keycloak`) y que sus valores llegan a `ejemplo.env`, que se interpola con el entorno de compose. Trae `COMPOSE_PROFILES=keycloak`, `M2_MODO_TOKENS=jwks` y `M2_EMISOR_TOKENS=http://localhost:${KEYCLOAK_PUERTO:-8080}/realms/ds-2026-realm`. `M2_AUDIENCIA_TOKENS` ya es `m2-clientes`.

**`ejemplo.env`.** Suma `M2_MODO_TOKENS=${M2_MODO_TOKENS:-hs256}` y `M2_URL_JWKS=${M2_URL_JWKS:-http://keycloak:8080/realms/ds-2026-realm/protocol/openid-connect/certs}`. La URL no puede quedar vacía, porque `pruebas/unitarias/ejemplo-env.test.ts` rechaza un valor por defecto vacío, y en modo `hs256` no se usa. `ejemplo-keycloak.env` y `keycloak` se suman a `.dockerignore` y a `panel/Dockerfile.dockerignore`.

**Realm** (RNF-12.17, RNF-06.8). Copia del `ds-2026-realm` de la cátedra (commit `6dfdd40`), con el mismo nombre, los mismos clientes `grupo-NN` y sus mismos secretos. Ya son públicos en el repositorio de la cátedra, así que este repositorio no expone nada nuevo; si aparece un Keycloak compartido que los use, se cambian en nuestro realm. Le suma:
- Roles de realm `CLIENTE`, `OPERADOR`, `SERVICIO` y `CONDUCTOR`, además de los `*-be`.
- Client scope `m2-token`, sin aparecer en el `scope` del token, con dos mappers: roles de realm en el campo `roles` y audiencia `m2-clientes`, esta solo en el token de acceso (`access.token.claim: true`, `id.token.claim: false`). Así un ID token, firmado con la misma clave, no pasa en M2.
- Client scopes `clientes:read` y `clientes:write`, que sí aparecen en el `scope` del token.
- Los clientes de M5 y M9 de los dos consorcios (`grupo-04`, `grupo-13`, `grupo-08`, `grupo-09`) con rol `SERVICIO` y `clientes:read` por defecto. Se comprobó que pedir otro scope da `invalid_scope`.
- Un cliente público `m2-desarrollo`, solo para pedir tokens de persona con usuario y contraseña, con `clientes:read` y `clientes:write` como opcionales. Se comprobó que, sin pedirlos, el token trae `scope: ""`: sirve para probar el `403` de scope.
- Usuarios `cliente1`, `cliente2`, `operador1` y `conductor1`, con `id` fijo y contraseña de desarrollo.

El `sub` hay que mirarlo. Desde Keycloak 25 sale del scope `basic`: con el realm mínimo faltó hasta nombrarlo, pero el JSON de la cátedra, que no lo declara, emitió un token con `sub`. `basic` se agrega solo si T12 o T13 muestran que hace falta, y las dos comprueban el `sub` con un token real.

## Lógica

**1. Configuración** (`src/config.ts`, RNF-06.7). `Config` suma `modoTokens: 'hs256' | 'jwks'` y `urlJwks: string | undefined`. `ConfigTokens`, que usa el comando de tokens, no cambia.
| Variable | Regla |
|---|---|
| `M2_MODO_TOKENS` | Opcional, `hs256` por defecto. Otro valor: error con el nombre de la variable y sin el valor. |
| `M2_URL_JWKS` | Obligatoria si el modo es `jwks`; opcional si no. Usa la regla `urlHttp` que ya existe: http o https, sin usuario ni contraseña. |

`M2_CLAVE_TOKENS` sigue obligatoria en los dos modos, por el token hacia M6 (ADR 080).

**2. Claves** (`src/auth/claves-jwks.ts`, RNF-12.16, RNF-12.19, RNF-13.9 a RNF-13.13). Envuelve `createRemoteJWKSet` de `jose` con estas opciones:
| Opción | Valor | Por qué |
|---|---|---|
| `timeoutDuration` | `tiempoModulosMs` | RNF-13.10 |
| `cooldownDuration` | 30000 | RNF-12.16 |
| `cacheMaxAge` | `Infinity` | Con el valor por defecto, 10 minutos, las claves se vencerían y M2 dejaría de atender con Keycloak caído: rompería RNF-13.11. El costo está anotado en Casos límite de la spec. |

```
clave(encabezado, token):
  para intento en 1..(1 + reintentosModulos):
    intentar devolver jwks(encabezado, token)
    si falla con JWKSNoMatchingKey o JWKSMultipleMatchingKeys: relanzar (es culpa del token)
    si falla con otra cosa (red, tiempo, 5xx, documento inválido): si quedan intentos, esperar 200 ms y seguir
  lanzar ModuloNoDisponible('El servicio de identidad', { cause, reintentarDespuesS })

precargar():  // al arrancar
  intentar jwks.reload(), con los mismos intentos
  si falla: devolver el motivo, sin lanzar
```
La espera total queda igual que con M6: hasta 4,2 s con los valores por defecto. `jose` junta en un solo pedido las solicitudes que llegan mientras otro está en curso; se comprueba en T4. Un pedido fallido no activa los 30 s, así que M2 se recupera en cuanto Keycloak vuelve. Eso tiene un costo durante un corte, anotado en Casos límite de la spec y comprobado en T5.

**3. Verificador** (`src/auth/tokens.ts`, RNF-12.11, RNF-12.12, RNF-12.15). Se suma `crearVerificador(config)`, que devuelve `{ verificar, precargar }`:
- `hs256`: `verificar` llama a `verificarToken`, sin cambios, y `precargar` no hace nada. La identidad sigue siendo `{ sub, roles }`.
- `jwks`: mismo `ESQUEMA_BEARER`, mismas opciones de `jwtVerify` (emisor, audiencia, tolerancia de 30 s, `requiredClaims`), pero con `algorithms: ['RS256']` y la función `clave` de Lógica 2. `jose` revisa el algoritmo antes de pedir la clave, así que un token HS256 o `none` da `401` sin llamar a Keycloak, también con Keycloak caído. Devuelve además `scopes`, del campo `scope` partido por espacios: vacío o ausente es una lista vacía, y si no es un texto, `401`. `Identidad` suma `scopes?`, presente solo en este modo.

`motivoDe` suma el motivo de la clave desconocida y separa el de la firma según el modo. `ModuloNoDisponible` no es un `JOSEError`, así que sale tal cual y da `503`, y la causa la registra el manejador de errores (RNF-14.8).

**4. Permisos** (`src/contrato/operaciones.ts`, `src/auth/permisos.ts`, RNF-12.13, RNF-12.14). `Permisos` suma `scopes?`, presente solo si la operación declara alguno, para que `{ publica, roles }` siga siendo igual en las operaciones sin scope. `permisosDe` hoy junta en `roles` las listas de todos los esquemas de `security`, así que trataría un scope como un rol, y pasa a separarlas según `components.securitySchemes[esquema].type`:
- `oauth2` y `openIdConnect` dan scopes, como dice OpenAPI 3.1.
- Los demás tipos dan roles, y también un esquema que no está declarado: `contratoCon` no trae `components`, y un scope que quede como rol da `403`, no abre de más.
- La regla «una lista vacía admite cualquier rol conocido» se aplica solo a las listas de roles: `[{ bearerAuth: [OPERADOR] }, { keycloak: [] }]` sigue pidiendo OPERADOR.
- Si `security` trae dos renglones, se juntan los roles y los scopes de los dos y M2 pide ambos: no abre de más, pero contradice al contrato, y T18 no se cierra así (ver Scopes y #79).

```
registrarPermisos(app, config, verificador = HS256 con config):
  onRequest:
    si la operación es pública: seguir
    identidad = verificador.verificar(encabezado)     // 401 o 503
    autorizar(identidad.roles, permisos?.roles ?? [])  // 403
    si identidad.scopes existe: exigirScope(identidad.scopes, permisos?.scopes ?? [])  // 403
```
El verificador es un tercer argumento opcional porque `pruebas/http/autenticacion.test.ts` llama a `registrarPermisos(app, CONFIG_TOKENS)` sobre un Fastify sin nada más. `ConfigTokens` no cambia. `exigirScope` no mira el modo: en `hs256` la identidad no trae `scopes`. Pide todos los scopes de la operación, con comparación exacta, y lanza `SinPermiso` con un `detail` que habla del scope. La propiedad (`sub` = `clienteId`) la siguen comprobando los manejadores, después (RNF-12.14).

**5. Arranque** (`src/arranque.ts`, `src/app.ts`, RNF-13.9, RNF-13.12). `construirApp` crea el verificador, se lo pasa a `registrarPermisos` y lo guarda en la app, como hace con `m6`. `arrancar` llama a `precargar()` después de `app.listen`, sin esperarla: con un Keycloak colgado y `M2_REINTENTOS_MODULOS=5` tardaría 13 s, y sin atender la parada superaría el límite de 10 s de RNF-04.5. Si falla, deja una línea `warn`. Keycloak suele tardar más que M2 en arrancar (34 s en la prueba), así que este camino va a ser el común en compose: es un aviso y no un error, y las claves llegan con el primer token.

## Integraciones
| Módulo | Qué se consume | Tiempo máximo y reintentos | Si falla |
|---|---|---|---|
| Keycloak | `GET {M2_URL_JWKS}` | `M2_TIEMPO_MODULOS_MS` por intento, `M2_REINTENTOS_MODULOS` reintentos y 200 ms de pausa (RNF-13) | `503` genérico con `Retry-After` (`M2_REINTENTAR_DESPUES_S`) si hace falta una clave que no se tiene (RNF-13.10). Con la clave en memoria no se llama (RNF-13.11). |

El token hacia M6 no cambia (`tokenDeServicio`, ADR 080).

## Decisiones
- **Keycloak 26.8.2 y no el 23.0.6 de la cátedra.** El 23 es de principios de 2024; una spec de seguridad no debería arrancar con una versión vieja. Las diferencias son tres (nombre del archivo, `KC_HOSTNAME` con URL, administrador con `KC_BOOTSTRAP_ADMIN_*`) y ya están resueltas arriba.
- **Un solo modo por vez, por una variable explícita.** Alternativa descartada: aceptar HS256 y RS256 a la vez, que mantendría abierta la clave compartida, justo lo que se quiere cerrar, y abre la puerta a confusiones de algoritmo.
- **`cacheMaxAge: Infinity`.** Ver Lógica 2. Alternativa descartada: renovar en segundo plano y conservar lo viejo si falla, que agrega un temporizador y estado propios para un caso que el `kid` desconocido ya resuelve.
- **Copiar el realm de la cátedra y sumarle, sin armar uno desde cero.** La diferencia queda a la vista, y es fácil de rehacer si la cátedra corrige el suyo. Alternativa descartada: un realm mínimo solo con lo de M2, que perdería los clientes `grupo-NN` y no se podría comparar.
- **`ejemplo-keycloak.env` y no tres variables en la línea de comandos.** Se escribe mal menos veces, y evita el error más probable: un `M2_EMISOR_TOKENS` distinto del `KC_HOSTNAME`, que daría `401` en todos los tokens.
- **La prueba real corre en un job de CI en cada PR, sin ser un check obligatorio**, como el job `panel`. Solo baja imágenes públicas, y la autenticación merece verse en cada cambio. Alternativa descartada: solo al mergear, como la spec 081, que lo hace así porque construye otro repositorio.
- **Un `kid` inventado durante un corte puede llegar a Keycloak.** Se acepta para TP2 (Casos límite de la spec). Alternativa descartada: recordar el último fallo y no reintentar por un tiempo, que suma estado propio y demoraría la recuperación cuando Keycloak vuelve.
- **La implementación se puede cerrar en dos PR.** T18 depende de #79, y #79 de una respuesta del Grupo 1. Si no llegó al terminar T17, el PR «Impl 080» lleva T1 a T17 con `Estado: aprobada`, y T18 va después en `impl/080-escenario-scope`; recién ahí la spec pasa a `implementada`. Alternativa descartada: frenar todo hasta #79, que dejaría la entrega de TP2 esperando a otro grupo.

## Pruebas
- **Sin Keycloak, dentro de `npm test`** (RNF-07.12). Claves RSA generadas por la prueba con `generateKeyPair` de `jose`, y un JWKS servido por `pruebas/ayudas/servidor-modulo.ts`, que ya sabe colgarse, cortar y dar errores:
  - `pruebas/unitarias/config.test.ts`: las dos variables nuevas.
  - `pruebas/unitarias/tokens-jwks.test.ts`: cada motivo de `401`, alg `none`, HS256 con la clave real, `kid` desconocido y los 30 s, JWKS con una clave `enc`, rol repetido, formas del campo `scope`.
  - `pruebas/unitarias/claves-jwks.test.ts`: tiempo máximo, reintentos, un solo pedido con solicitudes juntas, seguir con la clave guardada, `kid` inventado durante un corte.
  - `pruebas/http/autenticacion-jwks.test.ts`: `401`, `403` y `503` de punta a punta, con el contrato de prueba y `contratoCon` para los scopes.
  - `pruebas/integracion/arranque.test.ts`: arrancar con el JWKS caído o colgado, y detener sin esperar a la precarga.
- **Modo `hs256` sin cambios** (RNF-12.15). Las pruebas que ya existen tienen que pasar como están, incluidas `pruebas/http/operaciones.test.ts`, que compara los permisos con `toEqual`, y `pruebas/http/autenticacion.test.ts`. Solo cambian las que enumeran variables, servicios y proyectos: `pruebas/unitarias/ejemplo-env.test.ts`, `pruebas/unitarias/consistencia.test.ts` (también el proyecto `keycloak`, como `navegador`, y los dos `.dockerignore`) y `CONFIG` en `pruebas/ayudas/app.ts`.
- **Realm** (RNF-12.17). `pruebas/unitarias/realm.test.ts` lee el JSON y comprueba roles, scopes, clientes y usuarios, que la audiencia de `m2-token` no vaya al ID token, y que todo scope que declare el contrato exista en el realm: antes de #79 no hay ninguno, y después, un tipeo como `cleintes` da rojo.
- **Con Keycloak real** (RNF-07.13). `npm run keycloak:test` = `vitest run --project keycloak`, fuera de `npm test`. Su `globalSetup` corre compose con el proyecto `m2-keycloak` y puertos propios (`M2_PUERTO=18083`, `KEYCLOAK_PUERTO=18080`), para no pisar lo que la persona tenga levantado, y al terminar `down -v`. Los tokens se piden a Keycloak por HTTP, los de persona con `clientes:read clientes:write`, para que los escenarios sigan valiendo después de #79. Como duran 300 s, el de Keycloak caído se pide justo antes de detenerlo. Si Docker no está, termina en rojo con el motivo, sin saltarse.
- **Contrato.** `npm run contrato:test` no cambia: corre en modo `hs256`.

**Roce con la spec 081:** las dos tocan `docker-compose.yml`, `ejemplo.env`, `vitest.config.ts`, `package.json` y las enumeraciones de `consistencia.test.ts`. Son agregados que no se pisan: la que se mergee segunda hace merge de `main` y suma su parte, sin rebasar una rama ya publicada. Sus ID no se repiten: la 081 reservó RNF-04.9, 06.6, 07.7 a 07.11, 13.8 y 20.4.

## Cobertura de requisitos
| Requisito | Qué parte lo cubre |
|---|---|
| RNF-06.7 | Lógica 1, `ejemplo-keycloak.env` (T1, T11) |
| RNF-06.9 | Lógica 1 (T1) |
| RNF-12.11 | Lógica 3 (T2, T6) |
| RNF-12.12 | Lógica 3 (T2) |
| RNF-12.13 | Lógica 4 (T8, T9, T18) |
| RNF-12.14 | Lógica 4 (T9, T14) |
| RNF-12.15 | Lógica 3 y 4, Pruebas (T6, T9) |
| RNF-12.16 | Lógica 2 (T3) |
| RNF-12.18 | Lógica 4 (T6) |
| RNF-12.19 | Lógica 2 y 3 (T3) |
| RNF-13.9 | Lógica 5 (T7, T15) |
| RNF-13.10 | Lógica 2 (T4, T5, T15) |
| RNF-13.11 | Lógica 2 (T5, T15) |
| RNF-13.12 | Lógica 5 (T7, T15) |
| RNF-13.13 | Lógica 2 (T5, T15) |
| RNF-04.10 | Compose (T10) |
| RNF-05.6 | Datos, `keycloak-bd` (T10) |
| RNF-06.8 | Compose y Realm (T10, T11, T12, T13) |
| RNF-12.17 | Realm (T12, T13) |
| RNF-07.12 | Pruebas sin Keycloak (T2 a T9) |
| RNF-07.13 | Pruebas con Keycloak real (T14, T15, T16, T18) |
| RNF-20.5 | `docs/probar-m2.md` y ADR 080 (T17) |
