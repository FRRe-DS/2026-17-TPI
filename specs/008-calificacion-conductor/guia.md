# Guía — Spec 008 Calificación del conductor

## Visión general
Se escribe al validar (T10).

## Tareas

### T1 — Tabla `calificaciones` · commit `008/T1`
- Qué cambió: `migraciones/1792984495482_calificaciones.sql` crea `calificaciones` (`calificacion_id`, `cliente_id`, `viaje_id`, `conductor_id`, `puntaje`, `comentario`, `creado_en`), la restricción única `calificaciones_cliente_viaje_unica` sobre (`cliente_id`, `viaje_id`), el check `calificaciones_puntaje_valido` (1 a 5) y el índice `calificaciones_listado`. Su Down borra la tabla.
- Por qué así: la unicidad vive en la base y no solo en el código, para que dos solicitudes a la vez, con la misma clave de idempotencia o con claves distintas, dejen una sola fila (RNF-08, RF-2.5.3). `viaje_id` y `conductor_id` son los identificadores de M6 y no llevan clave foránea ni más datos del viaje (RNF-05). `comentario` es `varchar(500)` y acepta vacío, como el contrato; es lo único que admite nulo. `cliente_id` sí tiene clave foránea a `clientes` con borrado en cascada, como las direcciones. El índice del listado ordena por fecha y desempata por id, igual que el de direcciones, para paginar de forma estable (RF-2.5.8). El índice de la restricción única sirve también a la búsqueda por cliente y viaje (RF-2.5.3, RF-2.5.14).
- Cómo se conecta: el servicio aplica las migraciones al arrancar (`src/bd/migraciones.ts`), así que la tabla aparece sola. Todavía no hay código que la use: el repositorio es T3.
- Tests: `pruebas/integracion/calificaciones.test.ts` (restricciones por nombre, nulos, índice, lo que acepta y rechaza la base, diez inserciones a la vez del mismo cliente y viaje que dejan una fila, borrado en cascada, Down y reaplicación) sobre PostgreSQL real. `pruebas/integracion/clientes.test.ts` suma `calificaciones` a las migraciones que se revierten antes que `perfil-bloqueos`, porque ahora también cuelga de `clientes`.
- Para mirar con atención: el nombre de la migración tiene la marca de tiempo que puso `node-pg-migrate create`; no se renombra. La restricción única dice «UNIQUE (cliente_id, viaje_id)» tal cual lo escribe PostgreSQL, y la prueba lo compara textualmente.
