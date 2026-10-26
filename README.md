# M2 Clientes · Grupo 17 · TPI Desarrollo de Software 2026

Servicio de clientes de la plataforma de movilidad urbana: perfil, preferencias, direcciones frecuentes, historial resumido de viajes (que obtiene de M6), calificación del conductor y estado de cuenta con bloqueos, que consultan otros módulos. Es uno de los nueve módulos del TPI; los demás los construyen otros grupos.

## Qué hace hoy

Están implementadas las 20 operaciones del contrato (`contrato/openapi.yml`, v1). Las rutas cuelgan de `/api/v1`, salvo `GET /health`, que no pide token. Cada grupo sale de una spec en `specs/`:

| Grupo | Operaciones | Spec |
|---|---|---|
| Salud y base del servicio | `verificarSalud` | 003 |
| Perfil y estado de cuenta | `crearCliente`, `obtenerCliente`, `actualizarCliente`, `obtenerEstadoCuenta`, `listarBloqueos`, `crearBloqueo`, `obtenerBloqueo`, `levantarBloqueo` | 004 |
| Direcciones frecuentes | `listarDirecciones`, `crearDireccion`, `obtenerDireccion`, `actualizarDireccion`, `eliminarDireccion` | 005 |
| Preferencias | `obtenerPreferencias`, `guardarPreferencias` | 006 |
| Historial de viajes (lo arma M6) | `listarHistorialViajes` | 007 |
| Calificación del conductor | `listarCalificaciones`, `calificarConductor`, `obtenerCalificacion` | 008 |

Detrás hay la base del servicio: configuración por variables de entorno, base PostgreSQL propia con migraciones, errores `application/problem+json`, autenticación por token, identificador de correlación en los logs, cliente HTTP para llamar a otros módulos con timeout y reintento, imágenes de contenedor y CI. Cada spec tiene una `guia.md` que explica lo hecho, tarea por tarea.

Para ver todo funcionando: `docker compose up -d --build --wait` y `node scripts/demo.mjs`, que recorre las funcionalidades y comprueba cada respuesta. La guía [`docs/probar-m2.md`](docs/probar-m2.md) explica el recorrido, cómo probar a mano, las pruebas automáticas y dónde está cada cosa en el repositorio.

Las calificaciones y el historial dependen de M6 (Viajes): M2 le pregunta por el viaje (`GET /trips/{id}`) y por la lista de viajes del cliente (`GET /trips`), con el token de servicio de la spec 007. Si M6 no responde, esas operaciones dan `503` con `Retry-After`; las demás no se enteran.

## Stack

TypeScript 6 sobre Node.js 24, Fastify 5, PostgreSQL 18 (con `pg` y SQL explícito, sin ORM), migraciones con node-pg-migrate, pruebas con Vitest y Testcontainers, y contrato OpenAPI 3.1 probado con Schemathesis. Versiones exactas y motivos: [`docs/adr/003-stack.md`](docs/adr/003-stack.md) y `package.json`.

## Diagrama

Línea llena: M2 llama a otro módulo o a su base. Línea punteada: otro módulo llama a M2 o emite el token con el que lo hace.

```mermaid
flowchart LR
    M1["M1<br/>emite los tokens"]
    M5["M5"]
    M9["M9"]
    M6["M6<br/>viajes"]

    subgraph M2["M2 Clientes (este servicio)"]
        API["API Fastify<br/>puerto 8082"]
        BD[("PostgreSQL 18<br/>base propia")]
        API -->|"SQL"| BD
    end

    M1 -.->|"token JWT"| API
    M5 -.->|"consulta el estado de cuenta<br/>(rol SERVICIO)"| API
    M9 -.->|"consulta el estado de cuenta<br/>(rol SERVICIO)"| API
    API -->|"historial y viaje a calificar<br/>(timeout y un reintento)"| M6
```

Mientras no exista M1, los tokens los firma el comando de [Generar un token](#generar-un-token). M2 guarda solo sus datos: los de otros módulos los pide por su API.

## Requisitos

- Node.js 24, desde la 24.2 (con `nvm`: `nvm use 24`). Node 20 está fuera de soporte.
- Docker con compose v2, usable sin `sudo` (la persona tiene que estar en el grupo `docker`). Lo necesitan el servicio y las pruebas de integración.

## Levantar el servicio

Una vez por clon, para que el hook bloquee el push a `main`:

```bash
git config core.hooksPath .githooks
```

Servicio y base, desde un clon limpio y sin crear ningún archivo:

```bash
docker compose up -d --build --wait
```

Termina cuando los dos contenedores están sanos. Comprobar que responde:

```bash
curl -fsS http://localhost:8082/health
```

Responde `{"estado":"ok"}`. Con la base caída responde `503`.

Ver los logs, que son una línea JSON por solicitud con su identificador de correlación:

```bash
docker compose logs m2
```

Parar el servicio y bajar todo:

```bash
docker compose stop m2
docker compose down
```

`docker compose down -v` borra además el volumen `datos-bd`, es decir, **los datos locales de la base**.

## Correr las pruebas

```bash
npm ci
npm test
```

`npm test` corre las pruebas unitarias y las de integración. Las de integración levantan un PostgreSQL real con Testcontainers, así que necesitan Docker. Otros comandos:

```bash
npm run build
npm run lint
```

La prueba de contrato corre Schemathesis (una imagen de Docker) sobre las operaciones implementadas, hoy las 20. Necesita el servicio levantado como en la sección anterior; no hay un M6, así que `listarHistorialViajes` y `calificarConductor` responden el `503` que el contrato declara y `schemathesis.toml` lo acepta solo en esas dos:

```bash
npm run contrato:test
```

Opcionalmente, con `--contrato <ruta>` prueba otro archivo: `npm run contrato:test -- --contrato pruebas/ayudas/contrato-salud.yml`. Si el servicio no responde, lo dice y termina con error.

Verificaciones del contrato y de las specs, las mismas que corre CI:

```bash
npx --yes @redocly/cli@2.62.1 lint contrato/openapi.yml
node scripts/spec-check.mjs
```

## Probar las calificaciones con un M6 simulado

El compose no trae un M6, y las calificaciones y el historial le preguntan por los viajes. Para probarlas a mano alcanza con un contenedor que haga de M6: el servicio apunta por defecto a `http://m6:3006/api/v1`, así que basta darle a un contenedor de la red del compose el nombre de red `m6`. Con el servicio levantado (`docker compose up -d --build --wait`):

```bash
CLIENTE=$(cat /proc/sys/kernel/random/uuid)   # el cliente de la prueba
VIAJE=11111111-1111-4111-8111-111111111111
BASE=http://localhost:8082/api/v1
token() { docker compose exec -T m2 node dist/herramientas/token.js --sub "$1" --roles "$2"; }

# Un M6 que dice que todo viaje está COMPLETED, es de $CLIENTE y lo manejó un conductor fijo. Se detiene con:
#   docker rm -f m6-simulado
docker run --rm -d --name m6-simulado --network "$(docker compose ps -q m2 | xargs docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}')" \
  --network-alias m6 -e CLIENTE="$CLIENTE" m2-clientes:0.1.0 node -e "
const viaje = (id) => ({ id, state: 'COMPLETED', clientId: process.env.CLIENTE, driverId: '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e', createdAt: '2026-10-01T10:00:00Z' });
require('http').createServer((req, res) => {
  const ruta = req.url.split('?')[0];
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(ruta.endsWith('/trips')
    ? { items: [viaje('$VIAJE')], page: 1, pageSize: 20, total: 1 }
    : viaje(ruta.split('/').pop())));
}).listen(3006);"

TOKEN=$(token "$CLIENTE" CLIENTE)
# 1. El perfil: el cliente tiene que existir en M2 (201).
curl -s -X POST $BASE/clientes -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: perfil-1" \
  -H 'Content-Type: application/json' -d '{"nombre":"Ana","apellido":"Gómez","telefono":"+5493624000000"}'
# 2. Calificar el viaje: 201 con la calificación y su Location. El conductor sale de M6.
curl -si -X POST $BASE/clientes/$CLIENTE/calificaciones -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: calificacion-1" \
  -H 'Content-Type: application/json' -d "{\"viajeId\":\"$VIAJE\",\"puntaje\":5,\"comentario\":\"Muy amable\"}"
# 3. Repetir lo mismo (misma clave y cuerpo): el mismo 201, sin volver a preguntarle a M6.
# 4. Calificar el mismo viaje con otra clave: 409 con type /errores/calificacion-duplicada.
curl -s -X POST $BASE/clientes/$CLIENTE/calificaciones -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: calificacion-2" \
  -H 'Content-Type: application/json' -d "{\"viajeId\":\"$VIAJE\",\"puntaje\":1}"
# 5. Listarlas (un OPERADOR también puede, de cualquier cliente) y ver el historial, donde el viaje ya sale con "calificado": true.
curl -s "$BASE/clientes/$CLIENTE/calificaciones?page=0&size=10" -H "Authorization: Bearer $TOKEN"
curl -s $BASE/clientes/$CLIENTE/viajes -H "Authorization: Bearer $TOKEN"
```

Los casos que dependen de M6 se ven cambiando lo que responde: con un viaje `IN_PROGRESS` da `422` (`/errores/viaje-no-completado`), con uno de otro cliente o inexistente da `404`, y con el contenedor detenido (`docker rm -f m6-simulado`) da `503` con `Retry-After`. Los casos a mano de cada spec están en su `guia.md`.

## Generar un token

Mientras no esté M1, el comando de tokens firma uno con la clave, el emisor y la audiencia que usa el servicio. Se corre dentro del contenedor y escribe solo el token:

```bash
docker compose exec -T m2 node dist/herramientas/token.js --sub 00000000-0000-4000-8000-000000000001 --roles CLIENTE
```

- `--sub`: el identificador de quien llama. Para un CLIENTE es su `clienteId`.
- `--roles`: uno o varios, separados por comas. Los reconocidos: `CLIENTE`, `CONDUCTOR`, `OPERADOR` y `SERVICIO`, en mayúsculas.
- `--vence`: segundos de vida del token (por defecto, 3600).

Para usarlo en una solicitud a una operación protegida:

```bash
TOKEN=$(docker compose exec -T m2 node dist/herramientas/token.js --sub 00000000-0000-4000-8000-000000000001 --roles CLIENTE)
curl -H "Authorization: Bearer $TOKEN" http://localhost:8082/api/v1/<ruta de la operación>
```

Todas las operaciones salvo `/health` piden token, y cada una admite ciertos roles (los dice su `security` en el contrato). Un CLIENTE solo opera sobre su propio perfil: su `sub` tiene que ser el `clienteId` de la ruta. Un OPERADOR lee el de cualquiera.

## Crear una migración

Las migraciones son archivos SQL en `migraciones/` y el servicio las aplica al arrancar. Para crear una:

```bash
npx node-pg-migrate create <nombre> --migration-file-language sql --migrations-dir migraciones
```

Con `--migrations-dir migraciones` es imprescindible: sin esa opción el archivo queda en `migrations/` y el servicio no lo ve. El archivo trae las secciones `-- Up Migration` y `-- Down Migration`. Un cambio de esquema de la base va siempre en una migración, nunca a mano.

## Variables de entorno

`docker compose` las carga de [`ejemplo.env`](ejemplo.env), que sirve **solo para desarrollo**. Cada línea de ese archivo es de la forma `VARIABLE=${VARIABLE:-valor}`: una variable definida en el entorno de quien corre el comando manda sobre el ejemplo. Por ejemplo, para publicar el servicio en otro puerto:

```bash
M2_PUERTO=9090 docker compose up -d --build --wait
```

| Variable | Obligatoria | Por defecto | Qué es |
|---|---|---|---|
| `M2_URL_BD` | sí | — | URL de la base, `postgres://` o `postgresql://` |
| `M2_PUERTO` | no | `8082` | Puerto de escucha, también el que se publica en la máquina |
| `M2_CLAVE_TOKENS` | sí | — | Clave con la que se firman y validan los tokens, de 32 caracteres o más |
| `M2_EMISOR_TOKENS` | sí | — | Emisor esperado de los tokens (`iss`) |
| `M2_AUDIENCIA_TOKENS` | sí | — | Audiencia esperada de los tokens (`aud`) |
| `M2_CAMPO_ROLES` | no | `roles` | Campo del token que trae los roles |
| `M2_TIEMPO_BD_MS` | no | `2000` | Espera máxima a la base, en milisegundos (de 1 a 2147483647) |
| `M2_TIEMPO_MODULOS_MS` | no | `2000` | Espera máxima por intento a otro módulo, en milisegundos (de 1 a 2147483647) |
| `M2_REINTENTOS_MODULOS` | no | `1` | Reintentos de una lectura a otro módulo, de 0 a 5 |
| `M2_ENCABEZADO_CORRELACION` | no | `X-Request-Id` | Nombre del encabezado de correlación |
| `M2_URL_M6` | sí | — | URL base de M6 (Viajes), `http://` o `https://`, con su ruta `/api/v1` y sin usuario ni contraseña; el servicio no arranca sin ella |
| `M2_AUDIENCIA_M6` | no | `m6-viajes` | Audiencia (`aud`) del token de servicio con el que M2 se presenta ante M6; no puede estar en blanco ni tener espacios al principio o al final |
| `M2_REINTENTAR_DESPUES_S` | no | `5` | Segundos que sugiere `Retry-After` cuando M6 no está disponible, de 1 a 3600 |
| `POSTGRES_USER` | solo para la base | el de `ejemplo.env` | Usuario que crea la imagen de PostgreSQL |
| `POSTGRES_PASSWORD` | solo para la base | el de `ejemplo.env` | Contraseña de ese usuario |
| `POSTGRES_DB` | solo para la base | el de `ejemplo.env` | Base que se crea al inicializar |

Dos cuidados con la base:

- `M2_URL_BD` **repite** el usuario, la contraseña y la base de `POSTGRES_*`: se cambian juntos.
- El volumen `datos-bd` guarda los datos. Con el volumen ya creado, cambiar `POSTGRES_PASSWORD` **no tiene efecto** hasta borrarlo con `docker compose down -v`, que pierde los datos locales.

Las claves y contraseñas de `ejemplo.env` no sirven fuera de una máquina de desarrollo. Un servicio con una variable obligatoria faltante o inválida no arranca: sale con error y el motivo en una línea JSON, que nombra la variable y nunca su valor.

## Cómo está ordenado el repositorio

- `contrato/openapi.yml`: el contrato del módulo, acordado con el Grupo 1. No se edita fuera de una rama `contrato/`.
- `specs/NNN-slug/`: qué se construye (spec), cómo (plan) y en qué pasos (tareas), con la guía de lo implementado.
- `docs/`: principios (`constitution.md`) y decisiones (`adr/`).
- `src/`, `pruebas/`, `migraciones/`, `scripts/`: el código, sus pruebas, las migraciones de la base, la prueba de contrato y la demostración (`scripts/demo.mjs`).
- Las reglas de trabajo del grupo, para personas y agentes, están en [`AGENTS.md`](AGENTS.md) y [`MANUAL.md`](MANUAL.md).
