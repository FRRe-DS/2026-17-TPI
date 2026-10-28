# Plan — Spec 072 Front de M2: vista de demostración e integridad de datos

Se construye sobre el panel de la spec 071 (`panel/`, plan y ADR 071). Las decisiones nuevas de alcance (el panel consulta la base de M2 y controla Docker en la máquina) están en el ADR 072 (`docs/adr/072-panel-base-y-docker.md`). No cambia `contrato/openapi.yml`, `src/` ni `migraciones/`, y no agrega dependencias: `pg` ya está en `dependencies` y la imagen del panel ya la instala.

## Estructura
Lo nuevo, dentro de lo que ya existe:

```
panel/
  servidor/
    demo/          base, docker, m2-directo, concurrencia, restriccion, rutas     ← acciones de la vista (lista fija)
    m6-control.ts  se separa `pedirControlM6` (el pedido) de las rutas que ya tiene, para usarlo también desde demo/
    config.ts      variables nuevas (Datos)
  puente-bd/       main: reenvío TCP de 127.0.0.1 a bd:5432 (RNF-04.8)
  Dockerfile       un destino más, `puente-bd`, de la misma imagen
  cliente/src/
    pantallas/     demostracion.tsx (+ .module.css)
    componentes/   resultado-caso, prueba-integridad, control-base (cada uno con su CSS Module)
    logica/        casos, ejecutar-caso, resultado, integridad, salud-en-vivo
    hooks/         usar-sondeo
    api/panel.ts   funciones para las rutas /panel/demo/…
    rutas.ts, logica/menu.ts   la ruta `#/demostracion` y su entrada del menú
pruebas/panel/  unitarias/  http/  integracion/  navegador/   (archivos nuevos en cada una)
```
Fuera de `panel/`: un servicio en `docker-compose.yml` (perfil `panel`), variables en `ejemplo.env`, las pruebas de consistencia que ya los enumeran, `scripts/panel-humo.mjs`, `README.md`, `docs/probar-m2.md` y el ADR 072.

## Contrato
El panel no implementa operaciones de M2. Los casos de la vista consumen las mismas operaciones que la 071, por el reenvío que ya existe (`servidor/proxy.ts`, con `X-Panel-Rol` y `X-Panel-Sub`), así que cada pedido de un caso aparece en el detalle técnico. Las pruebas simultáneas no pasan por el reenvío (ver Lógica, «Concurrencia»).

| operationId | Dónde lo usa la vista | Requisitos |
|---|---|---|
| `verificarSalud` | `GET /panel/demo/salud` (sondeo en vivo) | RNF-13.4 |
| `crearCliente` | preparación de cada caso; altas simultáneas | RNF-07.3, RNF-08.2, RNF-08.3 |
| `obtenerCliente`, `actualizarCliente` | casos de perfil | RNF-07.3 |
| `crearDireccion`, `listarDirecciones`, `obtenerDireccion`, `actualizarDireccion`, `eliminarDireccion` | casos de direcciones | RNF-07.3 |
| `obtenerPreferencias`, `guardarPreferencias` | casos de preferencias | RNF-07.3 |
| `listarHistorialViajes` | casos de historial y resiliencia | RNF-07.3 |
| `calificarConductor` | casos de calificación y resiliencia; calificaciones simultáneas | RNF-07.3, RNF-08.4 |
| `listarCalificaciones`, `obtenerCalificacion` | casos de calificación | RNF-07.3 |
| `obtenerEstadoCuenta`, `crearBloqueo`, `levantarBloqueo` | casos de estado de cuenta | RNF-07.3 |

Rutas propias del servidor del panel (no son de M2). Todas pasan por el hook de seguridad de la 071, que rechaza `Host` y `Origin` ajenos antes de cualquier ruta (RNF-12.10). Los cuerpos se validan con un esquema JSON de Fastify, con `additionalProperties: false`; uno inválido recibe `400` `problem+json` `/panel/errores/pedido-invalido` (el manejador de errores que ya existe).

| Ruta | Cuerpo | Respuesta | Requisitos |
|---|---|---|---|
| `GET /panel/demo/estado` | — | `{ base: Disponibilidad, docker: Disponibilidad }`, con `Disponibilidad = { disponible: boolean, motivo?: string, comoActivar?: string }` | RNF-13.6, RNF-05.4 |
| `POST /panel/demo/altas-simultaneas` | `{ n: 2..50, modo: "misma-clave" \| "claves-distintas" }` | `ResultadoSimultaneo` | RNF-08.2, RNF-08.3 |
| `POST /panel/demo/calificaciones-simultaneas` | `{ n: 2..50 }` | `ResultadoSimultaneo` | RNF-08.4 |
| `POST /panel/demo/restriccion-puntaje` | `{}` | `ResultadoRestriccion` | RNF-05.5 |
| `POST /panel/demo/base/apagar`, `POST /panel/demo/base/encender` | `{}` | `{ ejecutado: true }`, o `409` `/panel/errores/docker-no-disponible` con el motivo | RNF-13.4, RNF-13.6 |
| `GET /panel/demo/salud` | — | `{ estado: number \| null, duracionMs }` (`null` si M2 no contestó en 3 s) | RNF-13.4 |

`ResultadoSimultaneo = { clienteId, n, porCodigo: { [código]: cantidad }, cuerposIguales?: boolean, filas: number | null, motivoFilas?: string, esperado: { porCodigo, filas }, cumple: boolean, prefijoRequestId }` y `ResultadoRestriccion = { clienteId, filasAntes, filasDespues, restriccion?: string, mensaje?: string, codigo?: string, cumple: boolean }`. Ninguna respuesta lleva la URL de la base ni su contraseña (RNF-19.4).

## Datos
No hay tablas ni migraciones nuevas. El panel no guarda nada en la base de M2: solo lee y hace un intento de inserción que siempre se deshace.

**Acciones de base** (RNF-05.4), todas con parámetros y nunca con texto que venga del navegador:
| Acción | SQL |
|---|---|
| contar clientes | `SELECT count(*)::int AS filas FROM clientes WHERE cliente_id = $1` |
| contar calificaciones | `SELECT count(*)::int AS filas FROM calificaciones WHERE cliente_id = $1` |
| probar la restricción | `BEGIN`; `INSERT INTO calificaciones (calificacion_id, cliente_id, viaje_id, conductor_id, puntaje) VALUES ($1, $2, $3, $4, 9)`; `ROLLBACK` siempre |

El pool del panel (`servidor/demo/base.ts`) es chico y con cortes, como el de M2: `max: 2`, `connectionTimeoutMillis: 2000`, `statement_timeout: 2000`, `query_timeout: 2500`. Usa el mismo usuario que M2 (decisión de la spec).

**Configuración** (RNF-06.5). Variables nuevas en `ejemplo.env`, todas con valor por defecto:

| Variable | Defecto | Quién la lee |
|---|---|---|
| `PANEL_URL_BD` | `postgres://m2:m2-contrasena-de-desarrollo@127.0.0.1:5433/m2` (en el contenedor, compose la arma con `bd:5432` y las `POSTGRES_*`) | panel. Vacía: las acciones de base se deshabilitan con su motivo |
| `PANEL_PUERTO_BD` | `5433` | compose, que publica el puente en `127.0.0.1` (5433 para no chocar con un PostgreSQL local en 5432) |
| `PANEL_DOCKER` | `si` (en el contenedor, `no`) | panel: `no` deshabilita apagar y encender con el motivo «el panel corre en un contenedor» |
| `PANEL_SERVICIO_BD` | `bd` | panel: el servicio de compose que se apaga y enciende; solo `^[a-z0-9][a-z0-9_-]{0,62}$` |

`config.ts` las lee con el mismo lector de la 071: un error por variable que nombra la variable y nunca repite el valor (así una URL mal escrita no deja la contraseña en el error, RNF-19.4). `entorno-ejemplo.ts` suma `PANEL_URL_BD`, `PANEL_DOCKER` y `PANEL_SERVICIO_BD` a lo que toma de `ejemplo.env`. `pruebas/unitarias/ejemplo-env.test.ts` y `pruebas/panel/unitarias/config.test.ts` suman las cuatro.

## Lógica
Lo que decide algo es una función pura, en `panel/cliente/src/logica/` o en `panel/servidor/demo/`, con sus dependencias (pedir a M2, consultar la base, ejecutar un comando) inyectadas para probarla sin red.

**Catálogo de casos** (RNF-07.3, RNF-07.4) — `logica/casos.ts`, una lista de datos, sin código por caso:
```
Caso = { id, area, titulo, operacion (operationId), preparar: Paso[], prueba: Paso, esperado: { estado, type? } }
Paso = { metodo, ruta (plantilla con {clienteId}, {direccionId}, {bloqueoId}, {calificacionId}, {viaje.completado}…),
         identidad: { rol, sub: "cliente" | "otro-cliente" | "m5-despacho" | "operador" } | null (sin token),
         clave?: "nueva" | "la-anterior", cuerpo?, guardar?: { variable: campo de la respuesta } }
áreas, en el orden de docs/probar-m2.md:
  perfil:         crear 201 · repetir con la misma clave 201 · segundo perfil con otra clave 409 /errores/perfil-ya-existe ·
                  cuerpo inválido 400 · consultar 200 · actualizar en parte 200
  direcciones:    crear 201 · listar 200 · consultar 200 · actualizar 200 · eliminar 204 · consultar la eliminada 404 ·
                  tipo inválido 400
  preferencias:   vacías 200 · guardar 200 · volver a leer 200 · valor inválido 400
  historial:      con los viajes del M6 simulado 200 (y `calificado` en cada viaje)
  calificación:   completado 201 · repetir con la misma clave 201 · otra clave 409 /errores/calificacion-duplicada ·
                  misma clave, otro cuerpo 422 /errores/idempotencia-reutilizada · en curso 422 /errores/viaje-no-completado ·
                  ajeno 404 · inexistente 404 · puntaje 9 400
  estado de cuenta: bloquear (OPERADOR) 201 · consultar como SERVICIO 200 · levantar 200 · consultar de nuevo 200
  seguridad y errores: sin token 401 · CLIENTE sobre otro cliente 403 · rol CONDUCTOR 403 · todo error es application/problem+json
  resiliencia:    con el M6 simulado caído: calificar 503 con Retry-After · historial 503 con Retry-After · perfil 200
```
Cada caso prepara lo suyo (crea su cliente con un UUID nuevo y, si hace falta, carga sus viajes en el M6 simulado con `POST /panel/m6/clientes/{id}/ejemplo`), así que se ejecuta solo y no depende del orden (decisión de la spec). Una prueba unitaria recorre el catálogo y comprueba que cada `esperado.estado` esté declarado en `contrato/openapi.yml` para esa operación y método, y que cada `type` exista en los errores de M2 (como `api.test.ts` hace con las rutas en la 071).

**Ejecutar un caso** — `logica/ejecutar-caso.ts`, con `pedir` inyectado (en el navegador, `api/m2.ts`):
```
ejecutar(caso, pedir, viajes):
  variables = { clienteId: uuid(), otroCliente: uuid() }
  para cada paso de caso.preparar: respuesta = pedir(armar(paso, variables)); si no es 2xx: ✘ «no se pudo preparar: …»; guardar variables
  si el área es resiliencia: modoAnterior = viajes.estado().modo; viajes.modo("caido")
  respuesta = pedir(armar(caso.prueba, variables))
  finalmente, si cambió el modo: viajes.modo(modoAnterior)
  devolver { pedido: { metodo, ruta, cuerpo }, respuesta: { estado, type, encabezados relevantes }, esperado, veredicto: comparar(...) }
```
**Comparar** — `logica/resultado.ts`: ✔ si el código coincide y, cuando el caso lo pide, el `type`, la presencia de `Retry-After` o de `Location`, y el `Content-Type` `application/problem+json` de los errores. Si no, ✘ con el motivo en una línea («se esperaba 409, llegó 201»). Encabezados relevantes que se muestran: `Content-Type`, `Location`, `Retry-After`, `X-Request-Id`.

**Ejecutar todo** (RNF-07.6) — `logica/ejecutar-caso.ts`, `ejecutarTodo(casos, …, alAvanzar)`: uno tras otro, nunca en paralelo (el M6 simulado tiene un solo modo y los casos de resiliencia lo cambian); un ✘ o una excepción de un caso se anota y se sigue; al final `{ correctos, incorrectos }`. No incluye apagar la base.

**Concurrencia** (RNF-08.2 a RNF-08.4) — `servidor/demo/concurrencia.ts`. Los pedidos simultáneos salen del servidor del panel y no del navegador, porque el navegador abre como mucho seis conexiones por servidor y los pondría en fila: no serían simultáneos. Usa `servidor/demo/m2-directo.ts`, que firma el token con `tokens.ts` y hace el `fetch` a `PANEL_URL_M2` con 10 s de corte, sin pasar por el registro del detalle técnico (50 pedidos lo vaciarían); cada uno lleva `X-Request-Id` `panel-demo-{corrida}-{i}` para encontrarlo en `docker compose logs m2`.
```
altasSimultaneas(n, modo):
  clienteId = uuid(); cuerpo = cliente de ejemplo; corrida = uuid corto
  claves = modo == "misma-clave" ? n veces la misma uuid : n uuids distintas
  respuestas = await Promise.all(claves.map(k → m2Directo(POST /api/v1/clientes, CLIENTE clienteId, k, cuerpo)))
  porCodigo = contar por estado; cuerposIguales = (modo misma-clave) todos los 201 con el mismo JSON
  filas = base.contarClientes(clienteId)            (null + motivo si la base no está disponible)
  esperado = misma-clave ? { 201: n } y 1 fila : { 201: 1, 409: n−1 } y 1 fila
  cumple = porCodigo == esperado.porCodigo y filas == 1 y (cuerposIguales si misma-clave)
calificacionesSimultaneas(n):
  clienteId = uuid(); crear el cliente; modoAnterior = control M6 estado; poner "normal"; cargar ejemplo del cliente
  viaje = el completado de los escenarios
  respuestas = await Promise.all(n uuids → m2Directo(POST calificaciones de clienteId, viaje, puntaje 5, clave))
  finalmente: volver al modoAnterior
  filas = base.contarCalificaciones(clienteId); esperado { 201: 1, 409: n−1 } y 1 fila
```
Un pedido sin respuesta en 10 s cuenta como código `0` («sin respuesta») y hace `cumple = false`. La validación de `n` está en el esquema de la ruta y, antes, en el formulario (`logica/integridad.ts`: entero de 2 a 50, si no, el motivo junto al campo).

**Restricción del puntaje** (RNF-05.5) — `servidor/demo/restriccion.ts`:
```
clienteId = crear un cliente por M2 (la calificación necesita un cliente existente)
filasAntes = contarCalificaciones(clienteId)
conexión = pool.connect()
try: BEGIN; INSERT … puntaje 9
     si no falló: cumple = false, mensaje «la base aceptó el puntaje 9» (la restricción falta)
     si falló con código 23514: restriccion = error.constraint, mensaje = error.message, codigo = "23514"
     si falló con otro código: cumple = false, con ese código y mensaje
finally: ROLLBACK; liberar la conexión
filasDespues = contarCalificaciones(clienteId)
cumple = restriccion == "calificaciones_puntaje_valido" y filasDespues == filasAntes
```
La transacción nunca se confirma: si el proceso cae a mitad, PostgreSQL la descarta al cerrarse la conexión.

**Docker** (RNF-13.4, RNF-13.6, RNF-12.10) — `servidor/demo/docker.ts`, con `ejecutar` inyectado (en producción, `execFile` de `node:child_process`, sin shell):
```
comandos fijos: estado  → docker compose ps --format json <servicio>   (5 s)
                apagar  → docker compose stop <servicio>                (30 s)
                encender→ docker compose start <servicio>               (60 s)
cwd = raíz del repositorio (desde la ubicación del archivo, como scripts/demo.mjs); <servicio> = PANEL_SERVICIO_BD
disponibilidad (se calcula al pedir el estado, guardada 10 s):
  PANEL_DOCKER = no              → no, «el panel corre en un contenedor y no tiene acceso a Docker»
  ENOENT al ejecutar             → no, «Docker no está instalado en esta máquina»
  stderr con «permission denied» → no, «el usuario no puede usar Docker sin sudo (grupo docker)»
  otro error o servicio ausente  → no, con el primer renglón del error, sin rutas ni variables
  si no                          → sí
comoActivar: «Levantá el panel en la máquina con npm run panel» (y, si falta el permiso, cómo sumarse al grupo docker)
apagar/encender con Docker no disponible: 409 /panel/errores/docker-no-disponible, sin ejecutar nada
```
Una pulsación ejecuta el comando una vez. `stop` sobre una base apagada y `start` sobre una encendida terminan bien en compose, así que no son un error.

**Salud en vivo** (RNF-13.4) — `GET /panel/demo/salud` pide `GET /health` a M2 con 3 s de corte, sin registrarlo en el detalle técnico (un sondeo cada 2 s lo llenaría). En el navegador, `logica/salud-en-vivo.ts` es un reductor y `hooks/usar-sondeo.ts` el temporizador (se detiene al salir de la vista):
```
estados: quieto → apagando → observando(último estado) → encendiendo(desde) → recuperada | no-volvio
apagar: POST apagar; al terminar, sondear cada 2 s y mostrar el último código (se espera 503)
encender: POST encender; sondear cada 2 s hasta 200 (recuperada) o hasta 60 s desde que se pulsó (no-volvio)
el sondeo sigue mientras el estado sea observando, para que se vea la base apagada en vivo
```

**Disponibilidad de la base del panel** — `servidor/demo/base.ts`: sin `PANEL_URL_BD`, «no configurada (PANEL_URL_BD)»; con ella, el estado prueba `SELECT 1`. Un error de conexión se informa como «la base no responde» más el código de error de Node (`ECONNREFUSED`, `ETIMEDOUT`), nunca con la dirección. En los resultados, `filas: null` con ese motivo.

**Vista** — `pantallas/demostracion.tsx`, en la ruta `#/demostracion`, en el menú de los cuatro roles (decisión de la spec). Tres secciones: «Casos» (por área, cada uno con «Ejecutar» y su `resultado-caso`: pedido, respuesta, esperado y ✔/✘; arriba «Ejecutar todo» con el avance «7 de 32» y el resumen), «Integridad» (las tres pruebas simultáneas con el campo N, por defecto 10, y «Probar la restricción del puntaje», cada una con `prueba-integridad`: conteo por código en una tabla, filas, esperado y ✔/✘) y «Base de datos» (`control-base`: «Apagar la base», «Encender la base» y la salud en vivo, o el motivo y cómo activarlas). Usa `usar-accion` y `boton-accion` de la 071: el botón se deshabilita mientras espera, así un doble toque lanza una sola ejecución; «Apagar la base» pide confirmación con `dialogo-confirmar` porque deja a M2 sin base (RNF-15.6). Sin `dangerouslySetInnerHTML`: el mensaje de PostgreSQL se muestra como texto.

## Integraciones
| Hacia | Cómo | Si falla |
|---|---|---|
| M2, casos de la vista | el reenvío de la 071, 10 s | el caso da ✘ con el error de M2 a la vista (RNF-03.6) o «M2 no responde» |
| M2, pedidos simultáneos | `demo/m2-directo`, 10 s por pedido, sin reintento | ese pedido cuenta como «sin respuesta» (código 0) y la prueba da ✘ |
| M2, salud en vivo | `GET /health`, 3 s, sin reintento | `estado: null`, que la vista muestra como «M2 no responde» |
| Base de M2 | `pg`, pool de 2, cortes de 2 s | `filas: null` con el motivo; la restricción da ✘ «la base no responde» |
| Canal de control del M6 simulado | `pedirControlM6`, 3 s, sin reintento (el de la 071) | la preparación del caso falla con ✘ «no se pudo preparar»; el modo anterior se intenta reponer igual |
| Docker | `execFile`, sin shell, cortes de 5, 30 y 60 s | `409` `docker-no-disponible` o el error del comando, en la vista junto al botón |

## Empaquetado y arranque (RNF-04.8)
- `panel/puente-bd/main.ts`: un servidor `net` que escucha en `0.0.0.0:5433` dentro del contenedor y une cada conexión con `bd:5432` (`PUENTE_DESTINO`, por defecto `bd:5432`); al cerrarse una punta cierra la otra. Unas 30 líneas, sin dependencias.
- `panel/Dockerfile`: un destino más, `puente-bd`, que parte de la etapa de producción del panel (misma imagen base fijada) y arranca `panel/dist/puente-bd/main.js` como `node`.
- `docker-compose.yml`: servicio `bd-puente` con `profiles: [panel]`, `ports: "127.0.0.1:${PANEL_PUERTO_BD:-5433}:5433"`, `depends_on: bd` sano y chequeo de salud que abre una conexión a su propio puerto. El servicio `panel` suma `PANEL_URL_BD` (con `bd:5432` y las `POSTGRES_*`) y `PANEL_DOCKER: "no"`. Los servicios `m2` y `bd` no cambian, y sin el perfil no se publica nada nuevo; `pruebas/unitarias/consistencia.test.ts` lo comprueba.
- Como proceso en la máquina: lo mismo que la 071 (`npm run panel` con el perfil levantado) y ahora el panel llega a la base por `127.0.0.1:5433` y puede usar Docker.
- `scripts/panel-humo.mjs` suma `GET /panel/demo/estado`: base disponible y Docker no disponible, con su motivo, contra el perfil `panel`.

## Diseño visual
Sigue `panel/DESIGN.md` («Verde ciudad»): las mismas variables, botones y avisos. ✔ y ✘ llevan texto además del color («Correcto», «No coincide»), para no depender solo del color (RNF-15.3 de la 071). «Apagar la base» usa el botón de peligro de la 071. La tabla de conteos por código se desplaza dentro de su contenedor si no entra a 360 px, nunca la página (RNF-15.6). Los colores nuevos, si hacen falta, pasan por `contraste.test.ts`.

## Decisiones
- Conexión directa del servidor del panel a la base de M2, lista fija de acciones, mismo usuario que M2: ver la spec y el ADR 072.
- Los pedidos simultáneos los lanza el servidor del panel y no el navegador: el navegador limita a seis las conexiones por servidor y los pondría en fila. Alternativa descartada: `Promise.all` en el navegador, que con N mayor que 6 no prueba concurrencia real.
- Los casos se ejecutan en el navegador por el reenvío de la 071, no en el servidor: reusan `api/m2.ts`, quedan en el detalle técnico con su `curl` y la vista muestra exactamente lo que vería un cliente. Alternativa descartada: un ejecutor de casos en el servidor, que duplica el reenvío.
- Catálogo de casos como datos y no como funciones: se puede comprobar entero contra el contrato en una prueba unitaria y agregar un caso es agregar un objeto. Alternativa descartada: una función por caso, como `scripts/demo.mjs`, que no se puede verificar sin ejecutarla.
- La base se publica para el panel en la máquina con un puente TCP propio, de la imagen del panel, en el perfil `panel`. Alternativas descartadas: publicar el puerto en `bd` (cambia el arranque de todos, lo descarta la spec) y una imagen de terceros como `socat` (otra imagen que fijar y auditar, RNF-04).
- Puerto 5433 por defecto para el puente: quien tenga un PostgreSQL propio en 5432 no choca.
- El sondeo de salud y los pedidos simultáneos no se registran en el detalle técnico: lo vaciarían en segundos. Los simultáneos llevan un `X-Request-Id` con prefijo de corrida para buscarlos en los logs de M2.
- «Apagar la base» pide confirmación: deja a M2 sin base para cualquiera que lo esté usando.
- Docker se usa solo con `execFile` y argumentos fijos, sin shell, y el nombre del servicio sale de la configuración validada, no del navegador (RNF-12.10).

## Pruebas
| Nivel | Dónde | Qué comprueba | Requisitos |
|---|---|---|---|
| Unitarias | `pruebas/panel/unitarias/` | el catálogo contra `contrato/openapi.yml` (operación, método, código y `type`), `ejecutar-caso` y `ejecutarTodo` con un `pedir` de mentira (preparación fallida, sigue tras un ✘, repone el modo del M6), `resultado` (código, `type`, `Retry-After`, problem+json), `integridad` (N de 2 a 50), `salud-en-vivo` (de apagando a observando, recuperada a los 200, no-volvio a los 60 s), `docker` con un `ejecutar` de mentira (argumentos exactos, cada motivo de no disponible, nada se ejecuta si no está disponible), configuración nueva, menú y ruta de la vista | RNF-07.3, RNF-07.4, RNF-07.6, RNF-13.4, RNF-13.6, RNF-06.5, RNF-12.10 |
| HTTP del panel | `pruebas/panel/http/` | las rutas `/panel/demo/…` con base, Docker y M2 de mentira: esquema del cuerpo (`400`), `403` con `Host` u `Origin` ajenos en cada una, `409` sin Docker, ninguna respuesta ni línea de log con la URL o la contraseña de la base | RNF-12.10, RNF-19.4, RNF-13.6 |
| Integración | `pruebas/panel/integracion/` | M2 real con PostgreSQL de Testcontainers, M6 simulado y panel: altas simultáneas con la misma clave (N×201, cuerpos iguales, 1 fila) y con claves distintas (1×201, N−1×409, 1 fila), calificaciones simultáneas (1×201, N−1×409, 1 fila) con N = 10 y N = 50, restricción del puntaje (`calificaciones_puntaje_valido`, filas iguales, ninguna fila nueva después), base no disponible (`filas: null`), y todo el catálogo de casos ejecutado contra M2 real con ✔ | RNF-08.2, RNF-08.3, RNF-08.4, RNF-05.4, RNF-05.5, RNF-07.3, RNF-07.4 |
| Navegador | `pruebas/panel/navegador/` | la vista a 360 y 1280 px en claro y oscuro: sin desplazamiento horizontal, controles de 44×44, teclado, `axe-core`; «Ejecutar todo» llega al resumen; una prueba simultánea muestra la tabla; doble clic lanza una sola ejecución; con `PANEL_DOCKER=no`, apagar y encender deshabilitados con su motivo y el resto utilizable | RNF-15.6, RNF-07.6, RNF-13.6 |
| Empaquetado | `scripts/panel-humo.mjs` en CI, `consistencia.test.ts` | el perfil levanta `bd-puente` y el panel informa base disponible y Docker no disponible; sin el perfil, ningún puerto nuevo | RNF-04.8 |
| Contrato | `npm run contrato:test` | sigue en verde: no cambia | — |

Apagar y encender la base de verdad no se prueban en CI (detendría la base de la prueba en curso y en el contenedor está deshabilitado a propósito): se cubren con el `ejecutar` de mentira y se comprueban a mano, con el panel en la máquina, al validar la spec (`sdd-validate`), con la evidencia en la guía.

## Para mirar con atención
- M2 abre como mucho 10 conexiones y espera 2 s por una libre. Con N = 50 algún pedido podría responder `503`; la prueba de integración con N = 50 lo dirá. Si pasa, no es un fallo de integridad (la base sigue con 1 fila) sino de capacidad de M2, y se anota como hallazgo para M2, fuera de esta spec; la vista lo muestra tal cual en el conteo por código.
- El puente publica la base en `127.0.0.1` con la contraseña de desarrollo de `ejemplo.env`: es el mismo riesgo que ya tiene M2 publicado en `0.0.0.0:8082`, acotado a la máquina.

## Cobertura de requisitos
| Requisito | Qué parte lo cubre |
|---|---|
| RNF-04.8 | `panel/puente-bd/`, destino `puente-bd` del Dockerfile, servicio `bd-puente` del perfil `panel` |
| RNF-05.4 | `servidor/demo/base.ts` (dos conteos fijos y la prueba de la restricción, con parámetros) |
| RNF-05.5 | `servidor/demo/restriccion.ts`, `componentes/prueba-integridad` |
| RNF-06.5 | `servidor/config.ts`, `servidor/entorno-ejemplo.ts`, `ejemplo.env`, `docker-compose.yml` |
| RNF-07.3, RNF-07.4 | `logica/casos.ts`, `logica/ejecutar-caso.ts`, `logica/resultado.ts`, `componentes/resultado-caso`, `pantallas/demostracion` |
| RNF-07.6 | `ejecutarTodo` en `logica/ejecutar-caso.ts`, botón «Ejecutar todo» con avance y resumen |
| RNF-08.2, RNF-08.3, RNF-08.4 | `servidor/demo/concurrencia.ts`, `servidor/demo/m2-directo.ts`, `logica/integridad.ts`, `componentes/prueba-integridad` |
| RNF-12.10 | hook de seguridad de la 071 sobre las rutas nuevas; esquemas cerrados; `docker.ts` con `execFile` y argumentos fijos; SQL fijo con parámetros |
| RNF-13.4 | `servidor/demo/docker.ts`, `GET /panel/demo/salud`, `logica/salud-en-vivo.ts`, `hooks/usar-sondeo.ts`, `componentes/control-base` |
| RNF-13.6 | disponibilidad en `docker.ts`, `GET /panel/demo/estado`, `PANEL_DOCKER=no` en el contenedor, `componentes/control-base` |
| RNF-15.6 | `usar-accion`, `boton-accion` y `dialogo-confirmar` de la 071; estilos de la vista; prueba en navegador |
| RNF-19.4 | `config.ts` (errores sin valor), `base.ts` (errores sin dirección), respuestas y logs sin la URL; `Authorization` enmascarado del reenvío de la 071 |
| RNF-20.3 | `README.md`, `docs/probar-m2.md` sección 7, `guia.md`, ADR 072 |
