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
