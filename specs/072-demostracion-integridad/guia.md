# Guía — Spec 072 Front de M2: vista de demostración e integridad de datos

## Visión general

(Se escribe al validar, en `072/V`.)

## Tareas

### T1 — Configuración nueva del panel · commit `072/T1`
- Qué cambió: `panel/servidor/config.ts:cargarConfigPanel` lee tres variables más: `PANEL_URL_BD` (la conexión a la base de M2; vacía, las acciones de base quedan sin configurar), `PANEL_DOCKER` (`si` o `no`, por defecto `si`) y `PANEL_SERVICIO_BD` (por defecto `bd`). `ejemplo.env` suma esas tres y `PANEL_PUERTO_BD`, cada una con su comentario; `panel/servidor/entorno-ejemplo.ts` las toma de ahí sin cambios de código, porque ya tomaba todo lo que empieza con `PANEL_`.
- Por qué así: `PANEL_URL_BD` es la única URL del panel que lleva usuario y contraseña (la de la base), así que tiene su regla propia (`urlPostgres`) y, como todas, un error que nombra la variable y nunca repite el valor (RNF-19.4). `PANEL_SERVICIO_BD` llega como argumento de `docker compose stop` y `start` (T7), por eso solo acepta `^[a-z0-9][a-z0-9_-]{0,62}$`: nada que parezca una opción o un comando (RNF-12.10). `PANEL_PUERTO_BD` no la lee el panel sino compose, que publica el puente en ese puerto (T9); por eso solo está en `ejemplo.env`.
- Cómo se conecta: T2 usa `urlBd` para armar el pool; T7 y T8, `docker` y `servicioBd`; T9 agrega `PANEL_DOCKER: "no"` y la URL con `bd:5432` al servicio `panel` de compose. Hasta T9 el contenedor del panel hereda de `ejemplo.env` `PANEL_DOCKER=si` y la URL de la máquina, pero nada las usa todavía.
- Tests: `pruebas/panel/unitarias/config.test.ts` — valores por defecto, valores válidos e inválidos de las tres, que ningún error repite la contraseña y que el `ejemplo.env` real las deja configuradas; `pruebas/unitarias/ejemplo-env.test.ts` — la lista de variables del ejemplo incluye las cuatro nuevas.
- Para mirar con atención: el valor por defecto de `PANEL_URL_BD` en `ejemplo.env` repite la contraseña de desarrollo de `POSTGRES_PASSWORD`; si se cambia una, hay que cambiar la otra (como ya pasa con `M2_URL_BD`).

### T2 — Acceso a la base: conteos y disponibilidad · commit `072/T2`
- Qué cambió: `panel/servidor/demo/base.ts:crearBaseDemo(urlBd)` devuelve `contarClientes`, `contarCalificaciones`, `disponibilidad`, `cerrar` y el `pool`. Los conteos son dos SQL fijos con un parámetro (`count(*)::int … WHERE cliente_id = $1`) y dan `{ filas }`, o `{ filas: null, motivo }` si no se pudo contar.
- Por qué así: el pool es chico y con cortes, como el de M2 (`max: 2`, 2 s para conseguir conexión, `statement_timeout` de 2 s y `query_timeout` de 2,5 s), para que una base que no contesta no deje colgada la vista (plan, Datos). El motivo de una falla sale de `motivoDeFalla`, que usa solo el código (`ECONNREFUSED` de Node, `28P01` de PostgreSQL) y nunca el mensaje del error: el de red trae la dirección y el de la base puede traer el usuario (RNF-19.4). Sin `PANEL_URL_BD` no se crea ningún pool, así que no hay nada a lo que conectarse. `pool.on('error')` está para que una conexión inactiva que se corta no tumbe el proceso.
- Cómo se conecta: T3 usa `pool` para la conexión de la restricción; T5 y T6 usan los dos conteos; T8 usa `disponibilidad` en `GET /panel/demo/estado`; T8 también llama a `cerrar` al apagar el servidor.
- Tests: `pruebas/panel/integracion/demo-base.test.ts` — PostgreSQL de Testcontainers con las migraciones de M2: conteos de uno y de otro cliente, un identificador con SQL que no se ejecuta, base sin configurar, base detenida (puerto sin nadie) y contraseña equivocada sin que el resultado repita dirección ni contraseña, el pool con sus cortes, nunca más de 2 conexiones con 6 consultas a la vez y, contra un servidor que acepta y calla, corte cerca de los 2 s.
- Para mirar con atención: `disponibilidad()` hace un `SELECT 1` cada vez; T8 la guarda unos segundos si hace falta, pero la política de caché se decide en la ruta, no acá. La contraseña de la prueba de la contraseña equivocada es inventada.
