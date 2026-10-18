# Plan 003 — Base del servicio

Spec: [spec.md](spec.md) · Issue: #3 · ADR: el del stack (`docs/adr/003-stack.md`, aceptado) y el de la base (`docs/adr/003-base-servicio.md`: salud fuera del contrato y operaciones desde el contrato).

## Resumen
Se arma el proyecto TypeScript + Fastify con su base PostgreSQL, las migraciones, la configuración por entorno, los errores problem+json, la autenticación simulada, la correlación y los logs, el cliente para otros módulos, los contenedores y el CI. No hay operaciones de negocio: el contrato en `main` solo tiene `info`, así que lo único expuesto es `GET /health`.

Orden de construcción (tasks.md lo divide en tareas y bloques): proyecto → configuración → errores → contrato y registro de operaciones → errores HTTP y 405 → correlación y logs → autenticación → base, migraciones, salud, arranque y parada → cliente de módulos → contenedores, prueba de contrato, CI y README.

## Estructura

| Archivo | Qué hace | Requisitos |
|---|---|---|
| `src/servidor.ts` | Punto de entrada: llama a `arrancar` y atiende SIGTERM y SIGINT | RNF-04.5 |
| `src/arranque.ts` | `arrancar(env, salir)` y `detener()`: orden de arranque y de parada | RNF-04.5, RNF-05.2, RNF-05.3, RNF-06.2 |
| `src/app.ts` | `construirApp({ config, pool, contrato, manejadores, flujoLog })`: Fastify con hooks, errores, salud y operaciones | RNF-03.1 a RNF-03.5, RNF-12.1, RNF-14.3 a RNF-14.6 |
| `src/config.ts` | `cargarConfig(env)`: lee y valida las variables | RNF-06.1, RNF-06.2 |
| `src/errores.ts` | Clase `Problema`, `aProblema(error, ruta)` y respuestas 404 y 405 | RNF-03.1, RNF-03.2, RNF-03.3, RNF-08.1 |
| `src/correlacion.ts` | `idCorrelacion(valor)` | RNF-14.3, RNF-14.4 |
| `src/logs.ts` | Opciones del logger, línea por solicitud, `limpiarSecretos` | RNF-14.5, RNF-14.6, RNF-19.1, RNF-19.2 |
| `src/auth/tokens.ts` | `verificarToken` y `generarToken` | RNF-12.2, RNF-12.4, RNF-12.5 |
| `src/auth/permisos.ts` | Hook que exige token y rol según la operación; `autorizar` | RNF-12.1, RNF-12.3 |
| `src/contrato/cargar.ts` | Lee `contrato/openapi.yml` | RNF-03.4 |
| `src/contrato/validacion.ts` | Ajv 2020 con el contrato y sus formatos, como compilador de Fastify | RNF-03.2 |
| `src/contrato/operaciones.ts` | `listarOperaciones`, `registrarOperaciones` y rutas 405 | RNF-03.2, RNF-03.4, RNF-07.2 |
| `src/operaciones/index.ts` | Manejadores por `operationId` (en esta spec, solo `verificarSalud`) | RNF-03.4 |
| `src/salud.ts` | Manejador de `GET /health` | RNF-14.1, RNF-14.2 |
| `src/bd/pool.ts` | Pool, `consultar()` con tiempo máximo y clasificación de errores | RNF-08.1, RNF-14.2 |
| `src/bd/migraciones.ts` | `migrar()` con node-pg-migrate | RNF-05.1, RNF-05.2, RNF-05.3 |
| `src/modulos/cliente.ts` | `crearClienteModulo()` para llamar a otros módulos | RNF-13.1, RNF-13.2, RNF-13.3, RNF-14.7 |
| `src/herramientas/token.ts` | Comando de desarrollo que genera tokens | RNF-12.5 |
| `src/generado/contrato.ts` | Tipos generados del contrato, fuera de git | RNF-01.1 |
| `migraciones/<marca>_inicial.sql` | Primera migración, sin tablas de negocio | RNF-05.1 |
| `scripts/contrato-test.mjs` | Prueba de contrato de lo implementado | RNF-07.2 |
| `pruebas/` | Unitarias, HTTP e integración (ver Pruebas) | RNF-07.1 |
| `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `ejemplo.env` | Imagen, servicio con su base y configuración de ejemplo | RNF-04.1 a RNF-04.4, RNF-06.3 |
| `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.build.json`, `eslint.config.mjs`, `vitest.config.ts` | Proyecto, versiones exactas, compilación, lint y pruebas | RNF-01.1, RNF-04.2, RNF-07.1 |
| `.github/workflows/ci.yml` | CI sin pasos omitidos | RNF-17.1, RNF-17.2 |
| `README.md` | Cómo levantar, probar, generar un token y configurar, con diagrama | RNF-20.1 |
| `.gitignore` | Suma `node_modules/`, `dist/` y `src/generado/` | — |

Ningún módulo se conecta a nada al importarse: así las pruebas y el script de contrato pueden importar el código sin levantar el servicio.

## Contrato
- **Operaciones que implementa: ninguna.** `contrato/openapi.yml` en `main` solo tiene `info`.
- **`GET /health`, excepción temporal** (ADR de la base). El borrador del contrato v1 (PR #16) ya la incluye como `verificarSalud`. `src/operaciones/index.ts` la anota con ese `operationId`. Si el contrato la tiene, se registra desde el contrato; si no, se registra a mano como excepción. Al mergear el v1, la excepción termina sola, sin tocar código (RNF-03.4). No hace falta un cambio de contrato: ya está propuesto en el PR #16.
- **Cómo se exponen las operaciones**, para esta spec y para las de negocio (#4 a #8):
  - Al arrancar, `cargarContrato()` lee el YAML con la librería `yaml`.
  - `registrarOperaciones(app, contrato, manejadores)` recorre `paths`. Por cada operación cuyo `operationId` tiene manejador, registra la ruta de Fastify:
    - ruta: `{param}` del contrato pasa a `:param`;
    - esquemas: `params`, `querystring`, `headers` (nombres en minúscula, sin prohibir otros encabezados) y `body` (`application/json`), cada uno como `$ref` al contrato (`contrato#/…`), que compila Ajv 2020 (ver Lógica 7). El encabezado de correlación queda fuera de esa validación: un valor inválido no da 400, lo reemplaza `idCorrelacion` (RNF-14.3);
    - permisos en `config.permisos`: los roles de `security` de la operación, o los globales si no tiene. `security: []` es pública (RNF-12.1).
  - Una operación sin manejador no se registra: responde 404 o 405 y queda pendiente (RNF-03.4, RNF-07.2).
  - Devuelve las listas de implementadas y pendientes, y el servicio las escribe en el log al arrancar.
  - Al final agrega las rutas 405 (Lógica 8).
- **Tipos del contrato**: `npm run contrato:tipos` genera `src/generado/contrato.ts` con openapi-typescript. Corre solo antes de `build`, `lint` y `test` (scripts `prebuild`, `prelint` y `pretest`).
- **Prueba de contrato** (RNF-07.2): `npm run contrato:test` corre `npm run build && node scripts/contrato-test.mjs`. El script:
  1. lee el contrato (`contrato/openapi.yml`, u otro con `--contrato <ruta>` para probar el script) y los manejadores compilados (`dist/operaciones/index.js`) con `listarOperaciones` (`dist/contrato/operaciones.js`);
  2. imprime como «pendiente» cada operación del contrato sin manejador; ninguna hace fallar la prueba;
  3. si no queda ninguna implementada, imprime «No hay operaciones implementadas del contrato: nada para probar» y termina con 0;
  4. si hay, comprueba que el servicio responde en `/health` y pide un token al contenedor:
     `docker compose exec -T m2 node dist/herramientas/token.js --sub 00000000-0000-4000-8000-000000000001 --roles CLIENTE,CONDUCTOR,OPERADOR,SERVICIO`;
  5. corre Schemathesis con todos sus chequeos por defecto, solo sobre las implementadas:
     `docker run --rm --network host -v <ruta absoluta de contrato/>:/contrato:ro schemathesis/schemathesis:4.31.1 run /contrato/openapi.yml --url http://localhost:<puerto> --include-operation-id <id> … --header "Authorization: Bearer <token>"`;
  6. termina con el código de Schemathesis.

## Datos
- **Base propia**: PostgreSQL 18.6, servicio `bd` de docker compose, con volumen `datos-bd` y sin puerto publicado en el host (RNF-05.1, RNF-02.1).
- **Tablas de negocio**: ninguna.
- **Migraciones** (RNF-05.1, RNF-05.2, RNF-05.3):
  - Están en `migraciones/`: archivos `.sql` de node-pg-migrate con `-- Up Migration` y `-- Down Migration`. Se crean con `npx node-pg-migrate create <nombre> --migration-file-language sql`, que les pone la marca de tiempo.
  - La primera, `<marca>_inicial.sql`, solo hace `COMMENT ON SCHEMA public IS 'M2 Clientes: el esquema cambia solo con migraciones'`. Prueba el mecanismo y crea la tabla de control.
  - Tabla de control: `migraciones_aplicadas`, que crea node-pg-migrate.
  - `migrar()` llama a `runner()` con estas opciones:
    - `databaseUrl`: un objeto con `connectionString` y `connectionTimeoutMillis` igual al tiempo de base, porque sin eso pg espera para siempre a una base colgada;
    - `dir: 'migraciones'`, `migrationsTable: 'migraciones_aplicadas'`, `direction: 'up'` y `checkOrder: true`;
    - `advisoryLockMode: 'wait'`, porque en la versión 9 el valor por defecto es `fail` y el segundo proceso fallaría en vez de esperar;
    - `singleTransaction` sin activar, así cada migración corre en su propia transacción y la que falla no deja nada a medias;
    - `log` hacia el logger.
- **Pool** (`src/bd/pool.ts`):
  - `pg.Pool` con `connectionTimeoutMillis` y `query_timeout` iguales al tiempo de base (2000 ms por defecto) y `max: 10`.
  - `pool.on('error')` registra el error y sigue. Sin ese manejador, si se corta la base se cae todo el proceso.
- **`consultar(sql, parámetros)`**: todo acceso a la base de esta spec y de las siguientes pasa por acá.
  - Envuelve la consulta en `conTiempoMaximo(…, tiempoBd)`, para que la espera total no pase de 2 s aunque se sumen la conexión y la consulta (RNF-14.2).
  - Clasifica los errores:
    - `23505` (unique_violation) → 409 genérico, sin nombre de restricción ni consulta (RNF-08.1);
    - falta de base → 503. Cuenta como falta: `ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT`, `ECONNRESET`, SQLSTATE `08xxx`, `57P01` o `57P03`, los mensajes de pg «timeout exceeded when trying to connect», «Query read timeout» y «Connection terminated», o el corte de `conTiempoMaximo`;
    - el resto → error interno (500).
- **RNF-08 en esta spec**: solo el mapeo genérico. Las restricciones únicas reales llegan con #4 a #8.

## Lógica
Funciones puras (sin red ni base), con pruebas unitarias.

**1. `cargarConfig(env)`** (RNF-06.1, RNF-06.2) devuelve `{ config }` o `{ errores }`:

| Variable | Obligatoria | Por defecto | Es inválida si |
|---|---|---|---|
| `M2_URL_BD` | sí | — | no es una URL `postgres://` o `postgresql://` |
| `M2_PUERTO` | no | 8082 | no es un entero entre 1 y 65535 |
| `M2_CLAVE_TOKENS` | sí | — | tiene menos de 32 caracteres |
| `M2_EMISOR_TOKENS` | sí | — | — |
| `M2_AUDIENCIA_TOKENS` | sí | — | — |
| `M2_CAMPO_ROLES` | no | `roles` | — |
| `M2_TIEMPO_BD_MS` | no | 2000 | no es un entero mayor que 0 |
| `M2_TIEMPO_MODULOS_MS` | no | 2000 | no es un entero mayor que 0 |
| `M2_REINTENTOS_MODULOS` | no | 1 | no es un entero entre 0 y 5 |
| `M2_ENCABEZADO_CORRELACION` | no | `X-Request-Id` | no es un nombre de encabezado HTTP válido |

- Una variable definida pero vacía cuenta como no definida.
- Cada error nombra la variable, nunca su valor.
- `cargarConfigTokens(env)` valida solo lo que necesita el comando de tokens (clave, emisor, audiencia y campo de roles).

**2. `idCorrelacion(valor)`** (RNF-14.3):
- Devuelve `valor` si es un texto que cumple `^[A-Za-z0-9._-]{1,128}$`.
- Si no, devuelve `crypto.randomUUID()`: cubre el valor ausente, vacío, largo, con otros caracteres o repetido (Node une los repetidos con «, », que no cumple el patrón).

**3. `verificarToken(encabezado, config)`** (RNF-12.2, RNF-12.4) usa jose:
`jwtVerify(token, clave, { algorithms: ['HS256'], issuer, audience, clockTolerance: 30, requiredClaims: ['exp', 'sub'] })`.
- Sin `Authorization`, o sin la forma `Bearer <token>`: 401 «Falta el token».
- Cada código de error de jose da un motivo:
  - `ERR_JWS_INVALID` o `ERR_JWT_INVALID`: mal formado;
  - `ERR_JOSE_ALG_NOT_ALLOWED` o `ERR_JWS_SIGNATURE_VERIFICATION_FAILED`: la firma no es HS256 con la clave;
  - `ERR_JWT_EXPIRED`: vencido;
  - `ERR_JWT_CLAIM_VALIDATION_FAILED`: el motivo depende del `claim` (`exp`, `sub`, `nbf`, `iss` o `aud`).
- Si el campo de roles existe y no es una lista de textos: 401.
- Devuelve `{ sub, roles }`, solo con los roles conocidos: CLIENTE, CONDUCTOR, OPERADOR y SERVICIO.
- El `detail` dice el motivo y nunca incluye el token.

**4. `autorizar(rolesDelToken, rolesDeLaOperacion)`** (RNF-12.3):
- Sin roles conocidos en el token: 403.
- Si la operación no lista roles, alcanza con cualquier rol conocido.
- Si los lista, alcanza con uno en común; si no hay ninguno, 403.

**5. `generarToken({ sub, roles, venceEnSegundos = 3600 }, config)`** (RNF-12.5) usa `SignJWT` con `alg: HS256`, `iss`, `aud`, `sub`, `iat`, `exp` y los roles en el campo configurado. El comando `src/herramientas/token.ts` lee `--sub`, `--roles` (separados por comas) y `--vence` con `util.parseArgs` de Node, e imprime solo el token.

**6. `aProblema(error, ruta)`** (RNF-03.1, RNF-03.2, RNF-03.3, RNF-08.1, RNF-13.3, RNF-14.2) devuelve código, cuerpo y encabezados.
- Cuerpo: `type`, `title`, `status`, `detail` e `instance` (la ruta sin query string), con `title` y `detail` en español.
- `Content-Type: application/problem+json`.

| Origen | Código | `type` | `title` | `detail` |
|---|---|---|---|---|
| `Problema` propio (error de negocio con `type` del contrato) | el suyo | el suyo | el suyo | el suyo |
| Validación de Ajv (`error.validation`) | 400 | about:blank | Solicitud inválida | Nombra el campo, por ejemplo «Falta el campo nombre en el cuerpo» |
| JSON mal formado, o cuerpo JSON vacío | 400 | about:blank | Solicitud inválida | El cuerpo no es JSON válido |
| Token inválido (`verificarToken`), con `WWW-Authenticate: Bearer` | 401 | about:blank | No autenticado | El motivo |
| Rol no permitido | 403 | about:blank | Sin permiso | El rol del token no permite esta operación |
| Ruta inexistente | 404 | about:blank | No encontrado | No existe la ruta pedida |
| Método que la ruta no tiene, con `Allow` | 405 | about:blank | Método no permitido | La ruta solo admite los métodos de `Allow` |
| unique_violation | 409 | about:blank | Conflicto | Ya existe un registro con esos datos |
| `FST_ERR_CTP_BODY_TOO_LARGE` | 413 | about:blank | Cuerpo demasiado grande | El cuerpo supera 1 MiB |
| `FST_ERR_CTP_INVALID_MEDIA_TYPE` | 415 | about:blank | Tipo de contenido no soportado | El cuerpo tiene que ser application/json |
| `ModuloNoDisponible` | 503 | about:blank | Servicio no disponible | Nombra el módulo, por ejemplo «M6 no está disponible» |
| Falta de base, o servicio deteniéndose | 503 | about:blank | Servicio no disponible | La base de datos no está disponible, o el servicio se está deteniendo |
| Cualquier otro | 500 | about:blank | Error interno | Ocurrió un error interno (sin mensaje original, traza ni consulta) |

**7. Validación con el contrato** (RNF-03.2, código 400):
- Dos instancias de Ajv 2020 (`ajv/dist/2020`) con `ajv-formats`: una convierte tipos (`params`, `querystring` y `headers` llegan como texto) y la otra no (`body`). Las dos usan `useDefaults: true` y `allErrors: false`.
- Cada instancia carga el contrato completo con `addSchema(contrato, 'contrato')`. Así los `$ref` internos (`#/components/…`) se resuelven sin otra librería.
- Agrega como vocabulario las palabras de OpenAPI que no son JSON Schema (`example`, `discriminator`, `xml` y `externalDocs`), para que el modo estricto no las rechace.
- El borrador del v1 usa los formatos `uuid`, `date`, `date-time` y `uri-reference`, que trae ajv-formats. Un formato que no conoce (por ejemplo `int32`) hace fallar el arranque; se registra cuando un contrato lo use.
- `app.setValidatorCompiler` elige la instancia según `httpPart`.

**8. Rutas 405** (RNF-03.2):
- Un hook `onRoute` junta los métodos de cada ruta.
- Al terminar de registrar, cada ruta recibe una ruta comodín con los métodos que le faltan, tomados de `app.supportedMethods`. Si falta QUERY, se agrega antes con `addHttpMethod('QUERY', { hasBody: true })`.
- El `onRequest` de esa ruta responde 405 con `Allow` antes de leer el cuerpo.
- HEAD también da 405, porque `exposeHeadRoutes: false`.

Ciclo de una solicitud, en el orden de RNF-03.5:
```
al recibir:
  id = idCorrelacion(encabezado configurado)        # genReqId; requestIdHeader: false
  onRequest global, en este orden:
    si el servicio se está deteniendo → 503
    si no hay ruta (request.is404) → 404, antes de leer el cuerpo
    si la ruta exige token → verificarToken (401) y autorizar (403)
  onRequest de la ruta comodín → 405
  lectura del cuerpo: más de 1 MiB → 413; Content-Type que no es JSON → 415; JSON roto → 400
  validación con el contrato → 400
  manejador
al enviar (onSend): encabezado de correlación = id, también en los errores
al terminar (onResponse): una línea de log
```

**9. `limpiarSecretos(texto, secretos)`** (RNF-19.1):
- Reemplaza por `[oculto]` cada secreto conocido: la clave de tokens, la contraseña de la base (sacada de la URL) y el token de la solicitud.
- El serializador de errores del logger guarda `tipo`, `codigo`, `mensaje` y `traza` y, si el error viene de pg, `tabla`, `columna` y `restriccion`, todo ya limpio. No guarda `detail` ni `where` de pg, que pueden traer datos de la fila (decisión «Logs sin datos personales» de la spec).

**10. Logs** (RNF-14.5, RNF-14.6, RNF-19.2):
- Logger de Fastify (pino): JSON, una línea por evento, en la salida estándar.
- Opciones: `requestIdLogLabel: 'idCorrelacion'` y `disableRequestLogging: true`.
- En `onResponse`, una línea con `idCorrelacion`, `metodo`, `ruta` (sin query string), `estado` y `duracionMs` (`reply.elapsedTime`).
- Nunca se registran encabezados (salvo el id), cuerpos ni query strings.

**11. Arranque, `arrancar(env, salir)`** (RNF-05.2, RNF-05.3, RNF-06.2):
```
config = cargarConfig(env); si hay errores → registra cada nombre y salir(1)
migrar(config); si falla → registra el motivo, ya limpio, y salir(1)
pool = crearPool(config)
app = construirApp({ config, pool, contrato: cargarContrato(), manejadores })
app.listen({ host: '0.0.0.0', port })        # recién acá acepta solicitudes
```

**12. Parada, `detener()` ante SIGTERM o SIGINT** (RNF-04.5):
```
cerrando = true                # una solicitud nueva en una conexión abierta → 503 problem+json
app.close()                    # deja de aceptar conexiones y espera las solicitudes en curso
pool.end()
salir(0)
corte de seguridad: si a los 8 s no terminó, cierra las conexiones y sale con 1
```
Se usa `return503OnClosing: false`, porque el 503 de cierre de Fastify no es problema+json; lo responde el hook propio.

## Integraciones
- **M1 (identidad)**: no se llama. Se simula validando el token con la clave compartida (Lógica 3). En desarrollo, el comando de tokens hace de emisor.
- **Cliente para otros módulos**: `crearClienteModulo({ nombre, urlBase, tiempoMs, reintentos, encabezadoCorrelacion })` en `src/modulos/cliente.ts` (RNF-13.1, RNF-13.2, RNF-13.3, RNF-14.7).
  - Tiene `obtener(ruta, idCorrelacion)` para GET y `enviar(metodo, ruta, cuerpo, idCorrelacion)` para los demás métodos.
  - Cada intento usa el `fetch` de Node con `signal: AbortSignal.timeout(tiempoMs)`. El cuerpo se lee con la misma señal, así el corte cuenta hasta la respuesta completa.
  - Envía `Accept: application/json` y el encabezado de correlación con el id de la solicitud en curso.
  - Falta de disponibilidad: corte por tiempo, conexión rechazada o cortada, un 5xx, o un cuerpo que no es JSON.
  - Un 4xx vuelve a quien llamó con su código y su cuerpo, sin reintento.
  - Agotados los intentos, lanza `ModuloNoDisponible(nombre)`, que da un 503 que nombra el módulo. Con los valores por defecto, la espera total es de 2 s + 200 ms + 2 s = 4,2 s como máximo.
  ```
  intentos = 1 + reintentos si es GET; si no, 1
  para cada intento:
    respuesta = fetch + lectura del cuerpo, con corte a tiempoMs
    si se cortó, falló la red, es 5xx o el cuerpo no es JSON → falta de disponibilidad
    si no → devolver { estado, cuerpo }
    si quedan intentos → esperar 200 ms
  lanzar ModuloNoDisponible(nombre)
  ```
  - La URL de cada módulo se suma con la spec que lo use por primera vez (RNF-06.1). En esta spec, el cliente se prueba contra un servidor de prueba (RNF-02.1).
- **Mocks de M1 y M6 en docker compose**: fuera de alcance hasta que #2 publique esos contratos.

## Configuración, contenedores y CI
- **`ejemplo.env`**, en la raíz (RNF-06.3):
  - Tiene todas las variables de Lógica 1, más `POSTGRES_USER`, `POSTGRES_PASSWORD` y `POSTGRES_DB` para el servicio `bd`, con valores que solo sirven en desarrollo y un comentario por variable.
  - Cada línea usa la forma `VARIABLE=${VARIABLE:-valor}`. Docker compose interpola los archivos `env_file` con el entorno de quien corre el comando, así que una variable definida en el entorno manda sobre el ejemplo.
- **`Dockerfile`** (RNF-04.1, RNF-04.2, RNF-04.3), dos etapas sobre `node:24.22.0-trixie-slim`:
  - construcción: `npm ci` y `npm run build`, que genera los tipos y compila a `dist/`;
  - ejecución: `npm ci --omit=dev` (exactamente según el lockfile), `dist/`, `contrato/` y `migraciones/`, con el usuario `node` y `CMD ["node", "dist/servidor.js"]` en forma exec, para que la señal de parada llegue a Node;
  - `.dockerignore` deja afuera `node_modules`, `dist`, `.git`, `specs`, `docs`, `pruebas`, `ejemplo.env` y los archivos locales.
- **`docker-compose.yml`** (RNF-04.1, RNF-04.3, RNF-04.4):
  - servicio `m2`:
    - `build: .`, `image: m2-clientes:0.1.0`, `env_file: ejemplo.env` e `init: true`;
    - `ports: "${M2_PUERTO:-8082}:${M2_PUERTO:-8082}"`;
    - `depends_on: bd` con `condition: service_healthy`;
    - healthcheck con Node, que hace un GET con `fetch` a `/health` en el puerto configurado. No se usa `wget --spider`, que manda HEAD y da 405. Valores: `interval: 5s`, `timeout: 3s`, `retries: 6` y `start_period: 30s`, para dar tiempo a las migraciones.
  - servicio `bd`: `image: postgres:18.6`, `env_file: ejemplo.env` y volumen en `/var/lib/postgresql` (consecuencia del ADR del stack). Su healthcheck corre `pg_isready -h 127.0.0.1 -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"` con `interval: 2s`, `timeout: 2s` y `retries: 20`:
    - por TCP, porque mientras se inicializa, la imagen levanta un servidor temporal que solo escucha por socket (verificado en su `docker-entrypoint.sh`), y un chequeo por socket la daría por sana antes de tiempo;
    - con `$$`, para que las variables las lea el contenedor: compose no usa el `env_file` para interpolar el YAML.
  - `docker compose up -d --build --wait` termina cuando los dos están sanos. Si la base no se pone sana o `m2` sale con error, termina con error en menos de 2 minutos (caso límite de la spec).
- **CI** (`.github/workflows/ci.yml`; RNF-17.1, RNF-17.2):
  - `build-test` y `contract-test` pierden el paso «¿ya existe el proyecto?». Si falta `package.json` o `docker-compose.yml`, el job falla en vez de omitirse.
  - `contract-test` suma tres pasos después de levantar el servicio:
    1. `curl -fsS http://localhost:8082/health`;
    2. `npm run contrato:test`;
    3. la parada: `docker compose stop m2` tiene que tardar menos de 10 s y terminar con código 0, comprobado con `docker inspect`.
  - Los nombres de los jobs no cambian, porque la regla «Protección de main» los exige (RNF-17.2).
- **README** (RNF-20.1):
  - qué hace el servicio, con qué stack (el del ADR del stack), cómo levantarlo y cómo probarlo;
  - cómo generar un token: `docker compose exec m2 node dist/herramientas/token.js --sub <uuid> --roles CLIENTE`;
  - la tabla de variables;
  - un diagrama Mermaid del servicio, su base y los módulos M1, M6, M5 y M9.

## Decisiones
Las que afectan al grupo están en `docs/adr/003-base-servicio.md`: la excepción de `GET /health` y el registro de operaciones desde el contrato. Las demás son de esta spec:

- **Ajv 2020 propio, con el contrato completo cargado.**
  - Por qué: el contrato es OpenAPI 3.1 (JSON Schema 2020-12) y Fastify trae Ajv en draft-07 (consecuencia del ADR del stack). Cargar el contrato entero resuelve sus `$ref` sin otra librería.
  - Descartado: desreferenciar el contrato con otra librería, o generar un JSON en el build. Son más piezas, y el JSON generado puede quedar desactualizado.
- **`ejemplo.env` con `${VARIABLE:-valor}`.**
  - Por qué: un clon limpio levanta sin crear archivos, y el entorno manda sobre el ejemplo (RNF-06.3).
  - Descartados:
    - `.env.example`: `.claude/settings.json` les prohíbe a los agentes leer `.env.*`, y este archivo tienen que poder leerlo;
    - `env_file` sin interpolación: el entorno de la máquina no llegaría al contenedor;
    - dos archivos compose unidos con `include`: es más difícil de seguir.
- **openapi-typescript con `overrides`.**
  - Por qué: su última versión (7.13.0) declara TypeScript 5, y npm no la instala junto a TypeScript 6.0.3 (error ERESOLVE, probado). Con `"overrides": { "openapi-typescript": { "typescript": "$typescript" } }` se instala y genera tipos que TypeScript 6 compila (probado con el borrador del contrato v1).
  - Descartado: TypeScript 5.9, que contradice el ADR del stack; o no generar tipos, que ese mismo ADR incluye.
- **Correlación con `genReqId` propio y `requestIdHeader: false`.**
  - Descartado: `requestIdHeader`, que acepta cualquier valor sin validarlo; la documentación de Fastify lo advierte.
- **405 con rutas comodín que responden en `onRequest`.**
  - Por qué: responden antes de leer el cuerpo, como pide el orden de RNF-03.5.
  - Descartado: resolverlo en el manejador de 404 con un segundo enrutador, que duplica el de Fastify.
- **Una línea de log propia por solicitud.**
  - Descartado: el log por defecto de Fastify, que registra la URL con query string.
- **Tiempo máximo de base con `conTiempoMaximo`, además de los límites de pg.**
  - Descartado: solo los límites de pg, porque la conexión y la consulta se pueden sumar y pasar los 2 s.
- **Migraciones en SQL.**
  - Descartado: migraciones en TypeScript, que habría que compilar o correr con tsx dentro de la imagen.
- **Pruebas de integración con un solo contenedor por corrida** (globalSetup de Vitest con `provide` e `inject`), y la caída de la base simulada con un proxy TCP de prueba.
  - Descartados: un contenedor por archivo, que es más lento; y parar y reiniciar el contenedor, que cambia el puerto mapeado.
- **Comando de tokens dentro del contenedor** (`docker compose exec`).
  - Por qué: firma con la misma configuración con la que valida el servicio.
  - Descartado: correrlo en la máquina con las variables cargadas a mano.
- **503 propio al detenerse y corte de seguridad a los 8 s.**
  - Descartado: el 503 de Fastify, que no es problem+json.
- **Respuestas sin esquema de serialización.**
  - Por qué: Fastify no las serializa con el contrato; las valida la prueba de contrato.
  - Descartado: pasarle los esquemas de respuesta a fast-json-stringify, que no garantiza JSON Schema 2020-12.
- **CI sin pasos condicionales.**
  - Por qué: el proyecto ya existe, y si falta un archivo, es mejor que CI falle a que omita en silencio (RNF-17.1).

**Dependencias nuevas respecto del ADR del stack**, aprobadas por el integrador el 2026-10-18 (AGENTS.md pide aprobarlas):
- `ajv`, como dependencia directa para usar Ajv 2020; ya viene con Fastify;
- `ajv-formats`, para los formatos `uuid`, `date`, `date-time` y `uri-reference`;
- `yaml`, para leer el contrato;
- `vite`, que Vitest 5 pide como dependencia par obligatoria.

## Pruebas
`npm test` corre todo con Vitest (RNF-07.1). Un globalSetup levanta un único `postgres:18.6` con Testcontainers por corrida y lo pasa a las pruebas con `provide` e `inject`. Las pruebas HTTP usan `app.inject()`, con el contrato de prueba de `pruebas/ayudas/contrato-prueba.yml` y un pool falso cuando no hace falta la base.

| Archivo en `pruebas/` | Tipo | Qué comprueba | Requisitos |
|---|---|---|---|
| `unitarias/config.test.ts` | unitaria | Valores por defecto, cada valor inválido y cada obligatoria faltante; nombres sin valores | RNF-06.1, RNF-06.2 |
| `unitarias/ejemplo-env.test.ts` | unitaria | `ejemplo.env` trae todas las variables con la forma `${VARIABLE:-valor}`, y `M2_URL_BD` usa el usuario, la contraseña y la base de `POSTGRES_*` | RNF-06.3 |
| `unitarias/correlacion.test.ts` | unitaria | Id válido respetado; ausente, vacío, largo, repetido o con otros caracteres → UUID nuevo | RNF-14.3 |
| `unitarias/tokens.test.ts` | unitaria | Cada motivo de 401, con tokens armados por la prueba: otra clave, otro algoritmo, `alg: none`, sin `exp`, vencido, `nbf` futuro, dentro y fuera de los 30 s, sin `sub`, otro `iss` u `aud`, roles que no son lista; filtro de roles conocidos; `generarToken` ida y vuelta; el comando de tokens | RNF-12.2, RNF-12.4, RNF-12.5 |
| `unitarias/permisos.test.ts` | unitaria | `autorizar`: uno o varios roles, roles desconocidos o en minúsculas, sin roles, lista vacía | RNF-12.3 |
| `unitarias/problemas.test.ts` | unitaria | Cada fila de la tabla de `aProblema` | RNF-03.1, RNF-03.2, RNF-03.3, RNF-08.1, RNF-13.3 |
| `unitarias/secretos.test.ts` | unitaria | `limpiarSecretos` con clave, contraseña de la base y token | RNF-19.1 |
| `unitarias/consistencia.test.ts` | unitaria | Dependencias de `package.json` sin rangos; imágenes de `Dockerfile` y `docker-compose.yml` con versión exacta y nunca `latest`; la de `bd` es la misma que la de Testcontainers; la etiqueta de `m2` es la versión de `package.json`; el `Dockerfile` usa `npm ci` | RNF-01.1, RNF-04.1, RNF-04.2, RNF-04.3 |
| `unitarias/contrato-test.test.ts` | unitaria | `listarOperaciones`: contrato sin operaciones, con pendientes y con implementadas | RNF-07.2 |
| `unitarias/validacion.test.ts` | unitaria | Ajv 2020 con el contrato de prueba: `$ref` al contrato, formatos, conversión de tipos solo fuera del cuerpo y palabras de OpenAPI; el contrato de `main` carga sin error | RNF-03.2 |
| `http/errores.test.ts` | HTTP | 404; 405 con `Allow` en POST, HEAD, OPTIONS, TRACE y QUERY a `/health`; 413; 415; 400 por JSON roto y por campo faltante (el `detail` lo nombra); 500 sin detalles internos, con el error en el log; forma problem+json e `instance` sin query string | RNF-03.1, RNF-03.2, RNF-03.3 |
| `http/precedencia.test.ts` | HTTP | Ruta inexistente sin token → 404; método equivocado sin token → 405; sin token y cuerpo inválido → 401; rol equivocado y cuerpo inválido → 403; luego 413 o 415 y 400 | RNF-03.5 |
| `http/autenticacion.test.ts` | HTTP | Operación protegida del contrato de prueba: cada 401 con `WWW-Authenticate: Bearer`; 403; acceso con uno y con varios roles, y el manejador recibe `sub` y roles; `/health` ignora el token; operación con `security: []` | RNF-12.1, RNF-12.2, RNF-12.3, RNF-12.4 |
| `http/operaciones.test.ts` | HTTP | Solo se exponen las operaciones con manejador; las otras dan 404 o 405; los esquemas del contrato validan | RNF-03.4 |
| `http/correlacion-logs.test.ts` | HTTP | Id respetado o reemplazado en respuestas buenas y de error; una línea por solicitud con sus campos; los logs nunca tienen el token, `Authorization`, la clave, la contraseña, cuerpos ni query strings; el id inválido no aparece | RNF-14.3, RNF-14.4, RNF-14.5, RNF-14.6, RNF-19.1, RNF-19.2 |
| `integracion/migraciones.test.ts` | integración | Aplica las pendientes en orden y una sola vez; una segunda corrida no aplica nada; con dos corridas a la vez, cada migración se aplica una sola vez; una migración que falla no deja cambios; base inaccesible → error dentro del tiempo | RNF-05.1, RNF-05.2, RNF-05.3 |
| `integracion/salud.test.ts` | integración | 200 con `{"estado": "ok"}`; con el proxy colgado → 503 en 2 s más un margen, también en una operación de prueba que consulta la base; conexión rechazada → 503; la base vuelve → 200 sin reiniciar | RNF-14.1, RNF-14.2 |
| `integracion/duplicados.test.ts` | integración | Tabla de prueba con restricción única: el segundo alta da 409 sin el nombre de la restricción; una consulta más lenta que el tiempo de base (`pg_sleep`) da 503 en ese tiempo más un margen | RNF-08.1, RNF-14.2 |
| `integracion/arranque.test.ts` | integración | Falta una variable → `salir(1)` y el log nombra la variable sin su valor; base caída → `salir(1)` sin credenciales en el log; arranque normal → escucha recién después de migrar | RNF-05.2, RNF-05.3, RNF-06.2, RNF-19.1 |
| `integracion/parada.test.ts` | integración | Una solicitud en curso termina; una conexión nueva se rechaza; el pool se cierra; `salir(0)` antes de 10 s; una solicitud que llega durante el cierre → 503 problem+json | RNF-04.5 |
| `modulos/cliente.test.ts` | integración, con un servidor HTTP de prueba | Corta a tiempo aunque los encabezados lleguen antes; reintenta un GET una vez a los 200 ms ante 5xx, rechazo, corte o respuesta que no es JSON; no reintenta ante 4xx ni en POST; 503 que nombra el módulo; con los valores por defecto, 4,2 s como máximo; envía el encabezado de correlación | RNF-02.1, RNF-13.1, RNF-13.2, RNF-13.3, RNF-14.7 |
| CI, job `contract-test` | contenedores | `docker compose up -d --build --wait` desde un clon limpio; `curl` a `/health`; `npm run contrato:test`; parada en menos de 10 s con código 0 | RNF-04.4, RNF-04.5, RNF-07.2, RNF-17.1 |

Ayudas en `pruebas/ayudas/`:
- `global.ts`: el contenedor de la base;
- `contrato-prueba.yml`: operaciones protegida, pública, con cuerpo, de alta duplicada, que falla y que tarda;
- `proxy.ts`: proxy TCP que se puede colgar, cerrar y reabrir;
- `servidor-modulo.ts`: servidor que demora encabezados o cuerpo, o devuelve 5xx, 4xx o algo que no es JSON;
- `logs.ts`: captura las líneas de log;
- `contrato-salud.yml`: solo `GET /health`, para probar con Schemathesis el script de la prueba de contrato.

Los tiempos del cliente se acortan en la mayoría de las pruebas; solo una usa los valores por defecto para medir los 4,2 s.

## Versiones a fijar
Verificadas el 2026-10-18 con `npm view` y Docker Hub. Van exactas en `package.json`, `Dockerfile` y `docker-compose.yml`.

| Paquete o imagen | Versión | Nota |
|---|---|---|
| fastify | 5.12.7 | |
| pg / @types/pg | 8.23.1 / 8.23.1 | node-pg-migrate 9 pide pg menor que 9 |
| node-pg-migrate | 9.0.0 | |
| jose | 6.2.12 | |
| ajv / ajv-formats | 8.20.0 / 3.0.1 | nuevas |
| yaml | 2.9.1 | nueva |
| typescript | 6.0.3 | typescript-eslint 8 admite menos de 6.1 |
| @types/node | 24.19.2 | |
| vitest / vite | 5.0.5 / 8.3.4 | vite es par obligatorio de vitest 5 |
| @testcontainers/postgresql | 12.2.1 | pide Node 22.22 o más |
| openapi-typescript | 7.13.0 | con `overrides` |
| eslint / @eslint/js / typescript-eslint | 10.13.0 / 10.0.1 / 8.71.2 | |
| Imagen de Node | `node:24.22.0-trixie-slim` | `engines.node`: `^24` |
| Imagen de PostgreSQL | `postgres:18.6` | la misma en compose y en Testcontainers |
| Schemathesis | `schemathesis/schemathesis:4.31.1` | |
| Redocly CLI | 2.62.1 | solo en CI, con `npx` |

`tsconfig.json`: `module` y `moduleResolution` en `nodenext`, `target: es2024`, `strict: true`, `types: ["node"]`, `verbatimModuleSyntax: true` y `skipLibCheck: true`. `tsconfig.build.json` agrega `rootDir: src` y `outDir: dist`. `package.json` lleva `"type": "module"`.

## Trampas verificadas
- **openapi-typescript y TypeScript 6**: choque de dependencias par (probado). Se resuelve con `overrides`. Con el contrato de `main`, que solo tiene `info`, genera tipos vacíos sin error (probado).
- **node-pg-migrate 9** (Context7):
  - `advisoryLockMode` vale `fail` por defecto → `wait`;
  - en la API cada migración corre en su propia transacción (`singleTransaction: false`).
- **Fastify 5** (Context7):
  - `requestIdHeader` no valida el valor → `genReqId` propio;
  - `exposeHeadRoutes` vale `true` por defecto → `false`;
  - trae parsers para JSON y `text/plain` → se saca `text/plain`, para que dé 415;
  - `bodyLimit` es de 1 MiB por defecto y da `FST_ERR_CTP_BODY_TOO_LARGE`;
  - existen `addHttpMethod` y `supportedMethods`.
- **Schemathesis 4** (Context7): por defecto prueba datos válidos e inválidos y corre todos los chequeos.
  - `unsupported_method` espera 405 con `Allow` en GET, PUT, POST, DELETE, OPTIONS, PATCH, TRACE y QUERY;
  - `negative_data_rejection` falla si el servicio acepta datos que violan el contrato;
  - `positive_data_acceptance` acepta 2xx, 401, 403, 404, 409, 429 y 5xx.
- **Patrón de `X-Request-Id` en el borrador del v1**: si el contrato lo deja en la solicitud, `negative_data_rejection` espera un 4xx ante un valor inválido, pero RNF-14.3 lo reemplaza y responde normalmente. Es el punto 1 del segundo comentario al PR #16. Si el v1 se mergea con el patrón, contrato y spec se contradicen, y hay que resolverlo (cambio de contrato o /sdd-change) antes de que pase la prueba de contrato.
- **Imagen `postgres:18.6`**: mientras se inicializa, levanta un servidor temporal con `listen_addresses=''`, solo por socket (su `docker-entrypoint.sh`). Por eso el healthcheck usa TCP.
- **Node 24.15**: `http.METHODS` incluye QUERY y TRACE (probado).
- **TypeScript 6.0** (Context7): `types` vale `[]` por defecto, así que hace falta `types: ["node"]`; `strict` ya viene activado; `baseUrl` y `esModuleInterop` están deprecados.
- **Vitest 5**: `vite` es dependencia par obligatoria (`npm view`); el globalSetup recibe el proyecto y usa `provide` (Context7).
- **Testcontainers 12**: `PostgreSqlContainer` exige el nombre de la imagen (Context7).
- **pg**: sin `connectionTimeoutMillis` espera para siempre, y sin `pool.on('error')` un corte de la base mata el proceso.
- **`.claude/settings.json`** niega `Read(./.env.*)`. Por eso el ejemplo se llama `ejemplo.env`.

Para confirmar al implementar (no se pudieron probar acá):
- `request.is404` en Fastify 5;
- si QUERY falta en `app.supportedMethods`;
- la interpolación de `ejemplo.env` con el entorno, con `docker compose config` (esta máquina todavía no tiene docker compose);
- que `docker compose up --wait` termine con error cuando `m2` sale con código 1.

## Notas para las tareas
- Si no entran en 10 tareas, lo que se puede separar en otro issue es el cliente para otros módulos (RNF-13.1, RNF-13.2, RNF-13.3 y RNF-14.7): nadie lo usa hasta #7 y #8.
- Antes de implementar: Docker sin sudo (grupo `docker`), docker compose v2 y buildx en la máquina, y Node 24 en la terminal del agente.

## Trazabilidad

| Requisito | Dónde se cumple | Cómo se prueba |
|---|---|---|
| RNF-01.1 | `package.json`, `Dockerfile` y `docker-compose.yml` con el stack del ADR del stack | `consistencia.test.ts` y revisión del PR |
| RNF-02.1 | Compose sin otros módulos; cliente de módulos probado con un servidor de prueba | `cliente.test.ts`; job `contract-test` |
| RNF-03.1 | `aProblema` y el manejador de errores de `app.ts` | `problemas.test.ts`, `errores.test.ts` |
| RNF-03.2 | Tabla de `aProblema`; validación de `contrato/validacion.ts`; rutas 405 de `contrato/operaciones.ts` | `problemas.test.ts`, `validacion.test.ts`, `errores.test.ts` |
| RNF-03.3 | `aProblema` (500) y log del error ya limpio | `errores.test.ts`, `correlacion-logs.test.ts` |
| RNF-03.4 | `registrarOperaciones` y la excepción de `/health` | `operaciones.test.ts` |
| RNF-03.5 | Orden de hooks de Lógica 8 | `precedencia.test.ts` |
| RNF-04.1 | `Dockerfile`, `docker-compose.yml` y `pruebas/ayudas/global.ts` | `consistencia.test.ts` |
| RNF-04.2 | `npm ci` en las dos etapas del `Dockerfile` | `consistencia.test.ts`; build de la imagen en CI |
| RNF-04.3 | `image: m2-clientes:0.1.0` y `version` de `package.json` | `consistencia.test.ts` |
| RNF-04.4 | `docker-compose.yml`: `env_file`, healthchecks y `depends_on` | job `contract-test` |
| RNF-04.5 | `detener()` en `arranque.ts`; forma exec del `CMD`; `init: true` | `parada.test.ts`; paso de parada del CI |
| RNF-05.1 | `migraciones/` y node-pg-migrate | `migraciones.test.ts` |
| RNF-05.2 | `migrar()` con `advisoryLockMode: 'wait'`; `listen` después de migrar | `migraciones.test.ts`, `arranque.test.ts` |
| RNF-05.3 | Una transacción por migración; `salir(1)` | `migraciones.test.ts`, `arranque.test.ts` |
| RNF-06.1 | `cargarConfig` | `config.test.ts` |
| RNF-06.2 | `cargarConfig` y `arrancar` | `config.test.ts`, `arranque.test.ts` |
| RNF-06.3 | `ejemplo.env` y `env_file` de compose | `ejemplo-env.test.ts`; job `contract-test` |
| RNF-07.1 | Vitest con Testcontainers | `npm test` en el job `build-test` |
| RNF-07.2 | `scripts/contrato-test.mjs` y `listarOperaciones` | `contrato-test.test.ts`; job `contract-test` |
| RNF-08.1 | `consultar()`: `23505` → 409 | `duplicados.test.ts` |
| RNF-12.1 | Hook de permisos; `security: []` en el contrato | `autenticacion.test.ts` |
| RNF-12.2 | `verificarToken` | `tokens.test.ts`, `autenticacion.test.ts` |
| RNF-12.3 | `autorizar` | `permisos.test.ts`, `autenticacion.test.ts` |
| RNF-12.4 | `sub` y roles en la solicitud | `autenticacion.test.ts` |
| RNF-12.5 | `src/herramientas/token.ts` y `generarToken` | `tokens.test.ts` |
| RNF-13.1 | `AbortSignal.timeout` en cada intento | `cliente.test.ts` |
| RNF-13.2 | Reintentos solo en GET, a los 200 ms | `cliente.test.ts` |
| RNF-13.3 | `ModuloNoDisponible` → 503 | `cliente.test.ts`, `problemas.test.ts` |
| RNF-14.1 | `src/salud.ts` | `salud.test.ts` |
| RNF-14.2 | `consultar()` con `conTiempoMaximo` | `duplicados.test.ts`, `salud.test.ts` |
| RNF-14.3 | `idCorrelacion` y `genReqId` | `correlacion.test.ts`, `correlacion-logs.test.ts` |
| RNF-14.4 | Hook `onSend` | `correlacion-logs.test.ts` |
| RNF-14.5 | Logger de Fastify en JSON a la salida estándar | `correlacion-logs.test.ts` |
| RNF-14.6 | Línea propia en `onResponse` | `correlacion-logs.test.ts` |
| RNF-14.7 | Encabezado de correlación en el cliente de módulos | `cliente.test.ts` |
| RNF-17.1 | `ci.yml` sin pasos condicionales | Checks del PR de implementación |
| RNF-17.2 | Regla «Protección de main», que ya exige los cuatro checks | Al validar, con `gh api` sobre la regla |
| RNF-19.1 | `limpiarSecretos` y el serializador de errores | `secretos.test.ts`, `correlacion-logs.test.ts`, `arranque.test.ts` |
| RNF-19.2 | Logs sin cuerpos, query strings ni otros encabezados | `correlacion-logs.test.ts` |
| RNF-20.1 | `README.md` | Revisión del PR |
