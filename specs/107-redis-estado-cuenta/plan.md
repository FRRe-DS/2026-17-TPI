# Plan 107 — Caché del estado de cuenta con Redis

Spec: [spec.md](spec.md) · Issue: #107 · ADR: [107-redis-cache](../../docs/adr/107-redis-cache.md) · Contrato: `contrato/openapi.yml` (sin cambios)

## Resumen
Un módulo nuevo, `src/cache/`, guarda en Redis la respuesta `EstadoCuenta` de cada cliente. `obtenerEstadoCuenta` lo consulta después de comprobar permisos; `crearBloqueo` y `levantarBloqueo` lo invalidan cuando la base confirma. Todo fallo de Redis se traduce en «no hay copia» y el servicio sigue por la base. Sin `M2_URL_REDIS` el módulo es un no-op.

## Contrato
- Operaciones: `obtenerEstadoCuenta`, `crearBloqueo`, `levantarBloqueo` (ya implementadas en `src/clientes/operaciones.ts`). No cambia ningún esquema ni código de respuesta.
- `verificarSalud` no cambia: no consulta a Redis (RNF-14).

## Estructura

| Archivo | Responsabilidad | Requisitos |
|---|---|---|
| `src/config.ts` | `M2_URL_REDIS` (opcional), `M2_CACHE_TTL_S`, `M2_TIEMPO_REDIS_MS` | RNF-06 |
| `ejemplo.env`, `docker-compose.yml` | Variables de ejemplo y servicio `redis` fijado, con healthcheck | RNF-06, RNF-11 |
| `src/cache/redis.ts` | Cliente Redis con tiempo máximo por operación y sin reintentos que bloqueen | RNF-13 |
| `src/cache/estado-cuenta.ts` | `leer`, `guardar`, `invalidar` y el aviso de invalidación pendiente | RF-2.6.5 a RF-2.6.8.1, RNF-11 |
| `src/app.ts`, `src/arranque.ts` | `app.decorate('cacheEstado', …)` y cierre del cliente al detener | RNF-11, RNF-13 |
| `src/clientes/servicio.ts`, `operaciones.ts` | Usan la caché en `obtenerEstadoCuenta` y la invalidan en `crearBloqueo` y `levantarBloqueo` | RF-2.6.5 a RF-2.6.6.2 |
| `pruebas/unitarias/cache-estado-cuenta.test.ts` | Clave, versión, TTL, fallos, sin datos en logs | RF-2.6.5.1, RF-2.6.7, RF-2.6.8, RNF-19 |
| `pruebas/http/estado-cuenta-cache.test.ts` | Orden permisos → caché → base, `404` sin guardar | RF-2.6.5.2 a RF-2.6.5.4 |
| `pruebas/integracion/estado-cuenta-cache.test.ts` | Redis y PostgreSQL reales | RF-2.6.5 a RF-2.6.8.1, RNF-07 |
| `docs/adr/107-redis-cache.md` | Redis, cliente y esquema de clave | RNF-11 |
| `specs/107-redis-estado-cuenta/guia.md` | Mapa y forma de probarlo | RNF-20 |

## Datos
Ninguna tabla ni migración nueva. En Redis, dos claves por cliente (RNF-19: solo el `clienteId`, nunca nombre, motivo ni token):
- `m2:estado-cuenta:v:<clienteId>`: contador entero de versión; ausente vale 0. Sin vencimiento (ver Invalidar con versión). No es un dato de la base sino una marca para descartar copias: si Redis se reinicia o se vacía, se pierde junto con las copias y todo vuelve a empezar en 0, que sigue siendo consistente (RNF-05).
- `m2:estado-cuenta:c:<clienteId>:<versión>`: el JSON de `EstadoCuenta`, con vencimiento.

## Lógica

### Leer (RF-2.6.5, RF-2.6.5.1)
```
leerEstadoCuenta(clienteId):
  si hay invalidación pendiente de clienteId:
    intentar invalidar; si no se pudo -> ir a la base sin guardar
  v = GET versión            (error o tiempo agotado -> ir a la base sin guardar)
  copia = GET copia(v)
  si copia -> devolverla
  estado = leer de la base            (consulta actual del repositorio)
  guardar(clienteId, v, estado)       (best effort: un error se registra y se ignora)
  devolver estado
```
Los permisos y el `404` salen antes y después de la caché: `exigirPropietario` corre primero (RF-2.6.5.3) y un perfil inexistente lanza `NoEncontrado` desde la base, antes de guardar nada (RF-2.6.5.4).

### Vencimiento de la copia (RF-2.6.7, RNF-11)
```
ttl = M2_CACHE_TTL_S * 1000
para cada bloqueo vigente con hasta:  ttl = min(ttl, hasta - ahora)
si ttl <= 0: no guardar
SET copia(v) PX ttl
```
Así una copia nunca sobrevive al primer vencimiento entre los bloqueos vigentes. `ahora` es el reloj del proceso; en el compose comparten máquina con la base. Si algún día corren en máquinas distintas, el desfase de relojes pasa a ser un margen de error de la copia y habrá que descontarlo.

### Invalidar con versión (RF-2.6.6, RF-2.6.6.1, RF-2.6.6.2)
```
tras confirmar el alta o el levantamiento en la base:
  INCR versión(clienteId)            (sin vencimiento)
```
El lector captura la versión **antes** de leer la base. Si un bloqueo se confirma entre esa lectura y su `SET`, el lector escribe en la clave de la versión vieja, que ya nadie lee. Eso evita que una copia vieja sobreviva a la invalidación sin usar scripts ni transacciones de Redis. La versión no vence. *Corregido el 2026-11-15, durante la T6 (aprobado por Lautaro):* la primera versión de este plan la hacía vencer al doble del TTL, y eso no alcanza: las consultas siguen guardando copias con la versión vigente mucho después del último cambio, así que al vencer la versión todavía hay copias vivas con ese número, y el siguiente `INCR`, que parte de 0, lo vuelve a dar. Con TTL 60 s: copia de la versión 1 guardada a los 70 s (vive hasta los 130 s), versión vencida a los 120 s, bloqueo a los 125 s que vuelve a dar 1, y la consulta siguiente serviría el estado ACTIVO de los 70 s. Sin vencimiento, un número no se repite. El costo es una clave chica por cliente que alguna vez tuvo un alta o un levantamiento; con `noeviction` Redis no la borra por memoria. Si la base no confirma, no se invalida (RF-2.6.6.2).

### Invalidación que falla (RF-2.6.8.1)
Si `INCR` falla, el cliente queda en un conjunto en memoria. Mientras esté ahí, `leerEstadoCuenta` reintenta el `INCR` y, si no puede, responde desde la base sin guardar ni usar copias. La respuesta al operador no cambia. Si el proceso se reinicia con la marca pendiente, una copia vieja dura como máximo el TTL: es el límite que acepta la spec.

## Integraciones
- Redis: tiempo máximo por operación `M2_TIEMPO_REDIS_MS` (200 ms por defecto), sin reintento dentro de la solicitud (RNF-13). El cliente se reconecta en segundo plano; mientras no esté conectado, las operaciones fallan de inmediato en vez de encolarse. Cada fallo deja un solo aviso por ventana de unos segundos, con el nombre de la operación y el código del error, sin `clienteId` ni valores.
- Sin `M2_URL_REDIS`: `leer` devuelve «sin copia» y `guardar` e `invalidar` no hacen nada.

## Decisiones
- **Versión en la clave en vez de borrar la copia.** Alternativa descartada: `DEL` de la copia. Un lector lento podría volver a guardar una copia vieja después del `DEL`. Alternativa descartada también: una transacción `WATCH`/`MULTI`, más pasos y más fallos posibles para el mismo resultado.
- **Cliente `redis` (node-redis).** Es el cliente oficial. Alternativa descartada: `ioredis`, que también sirve pero suma otro estilo de manejo de reconexión. La versión exacta se fija en `package.json` al agregarla (dependencia nueva: se confirma con el integrador antes de instalarla). Va en el ADR.
- **La caché vive en `servicio.ts`, no en el repositorio.** El repositorio sigue siendo solo SQL; la política de permisos, copia e invalidación queda en un solo lugar.
- **No se consulta Redis en `/health`.** El contrato dice que `/health` depende del servicio y de su base; Redis es una optimización.
- **Un solo proceso.** La marca de invalidación pendiente está en memoria. Con varias réplicas habría que moverla a Redis; queda anotado como deuda.

## Pruebas
- Unitarias, con un Redis falso en memoria: la versión, el TTL mínimo por `hasta`, las claves sin datos personales, los fallos que se vuelven «sin copia».
- HTTP sin base: un rol sin permiso no recibe una copia aunque exista; `404` no guarda.
- Integración con Redis y PostgreSQL reales en contenedor: dos consultas seguidas hacen una sola lectura de estado en la base; un alta y un levantamiento se ven en la consulta siguiente; un bloqueo con `hasta` cercano deja de informarse al vencer; con Redis detenido responde `200` y `/health` responde `200`; con un servidor que no contesta, la consulta cuesta como máximo el tiempo configurado más lo que ya cuesta la base.
- Contrato: `npm run contrato:test` corre contra el servicio con Redis del compose.

## Cobertura de requisitos

| Requisito | Parte del plan |
|---|---|
| RF-2.6.5, RF-2.6.5.1 | Leer · `src/cache/estado-cuenta.ts`, `servicio.ts` |
| RF-2.6.5.2 | La copia es el JSON de `EstadoCuenta` tal cual; prueba HTTP y de contrato |
| RF-2.6.5.3, RF-2.6.5.4 | Leer: permisos antes de la caché y `404` antes de guardar |
| RF-2.6.6, RF-2.6.6.1, RF-2.6.6.2 | Invalidar con versión, después de confirmar en la base |
| RF-2.6.7 | Vencimiento de la copia |
| RF-2.6.8, RF-2.6.8.1 | Integraciones e Invalidación que falla |
| RNF-05 | Datos: Redis solo guarda copias reconstruibles |
| RNF-06 | `src/config.ts`, `ejemplo.env` |
| RNF-07 | Pruebas |
| RNF-11 | Versión, vencimiento y compose |
| RNF-13 | Integraciones: tiempo máximo y sin bloqueo |
| RNF-14 | `/health` no consulta a Redis; los avisos van al log |
| RNF-19 | Claves y avisos sin datos personales |
| RNF-20 | `guia.md` |
