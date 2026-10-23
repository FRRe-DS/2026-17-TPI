# Guía — Spec 005 Direcciones frecuentes

## Tareas
### T1 — Migración de direcciones con relación, checks e índices · commit `005/T1`
- Qué cambió:
  - [migraciones/1792768969582_direcciones.sql](../../migraciones/1792768969582_direcciones.sql), creada con `npx node-pg-migrate create direcciones --migration-file-language sql --migrations-dir migraciones` (plan, Datos). Crea `direcciones_cliente`:
    - `direccion_id` es la clave primaria y `cliente_id` apunta a `clientes(cliente_id)` con `ON DELETE CASCADE`.
    - Checks con nombre propio: `direcciones_cliente_tipo_valido` (solo `FAVORITA` o `RECIENTE`), `direcciones_cliente_texto_no_vacio` y `direcciones_cliente_coordenadas_validas` (las dos coordenadas o ninguna, dentro de `[-90, 90]` y `[-180, 180]`).
    - Solo el alias y las coordenadas aceptan nulo. `alias` es `varchar(50)` y `texto` es `varchar(255)`, como el contrato.
    - Dos índices para el listado: `direcciones_cliente_listado` `(cliente_id, creado_en DESC, direccion_id DESC)` y `direcciones_cliente_listado_por_tipo` `(cliente_id, tipo, creado_en DESC, direccion_id DESC)`.
    - La `Down Migration` borra la tabla.
  - [pruebas/integracion/clientes.test.ts](../../pruebas/integracion/clientes.test.ts): la prueba que revierte la migración de la 004 ahora revierte antes la de direcciones (ver «Para mirar con atención»).
- Por qué así: lo que el contrato exige de cada campo lo vuelve a exigir la base, además del OpenAPI, para que ningún camino de código guarde una fila inválida (RNF-05.1). No hay `actualizado_en`: el contrato no lo expone y no hay requisito de auditoría (plan, Datos). La idempotencia del alta no necesita tabla nueva: usa `idempotencias` de la 004.
- Cómo se conecta: `migrar()` ([src/bd/migraciones.ts](../../src/bd/migraciones.ts)) la aplica al arrancar, después de la de perfiles; no hubo que tocar código. T2 a T4 (repositorio) leen y escriben esta tabla; el índice del listado es el que usa T3.
- Tests: [pruebas/integracion/direcciones.test.ts](../../pruebas/integracion/direcciones.test.ts), con una base nueva del contenedor de Testcontainers:
  - la migración está una sola vez en `migraciones/` y no existe `migrations/`;
  - restricciones por nombre, tipo y definición, qué columnas aceptan nulo y los dos índices;
  - la base acepta una dirección solo con lo obligatorio (con `creado_en` puesto por ella), alias vacío, coordenadas en los extremos, los largos máximos y el mismo texto dos veces;
  - la base rechaza un cliente inexistente (23503), un `direccion_id` repetido (23505), un tipo inválido o en minúsculas (23514), texto vacío (23514), nulo (23502) o de 256 caracteres (22001), alias de 51 (22001), coordenadas incompletas y fuera de rango (23514), también por `UPDATE`;
  - borrar un perfil se lleva sus direcciones y no las de otro;
  - la `Down Migration`, corrida solo sobre este archivo (opción `file` del `runner`), borra la tabla y deja `clientes`, y `migrar()` la vuelve a aplicar.
  - En rojo primero: sin el archivo, fallaron las 18 pruebas. Al ponerlo, dos siguieron en rojo por un error real de la primera versión del check de coordenadas (ver abajo).
- Para mirar con atención:
  - Un `CHECK` que da NULL se acepta. Con `latitud NULL` y `longitud = 5`, `latitud BETWEEN -90 AND 90` da NULL y la segunda rama del `OR` quedaba como «desconocida», no como falsa: la fila entraba. Por eso la segunda rama pide `IS NOT NULL` en las dos coordenadas. Lo encontró la prueba de coordenadas incompletas.
  - Orden de reversión: `direcciones_cliente` depende de `clientes`, así que la `Down Migration` de la 004 ya no puede correr sola con la de direcciones aplicada (`cannot drop table clientes`). Se ajustó esa prueba para revertir primero la de direcciones (`DEPENDIENTES`) y esperar que `migrar()` aplique las dos al volver. Pasará lo mismo con la 006 cuando agregue su tabla.
  - `numeric` sin precisión para las coordenadas: el plan lo decide así y alcanza para la API sin PostGIS.

### T2 — Repositorio de alta y consulta por cliente · commit `005/T2`
- Qué cambió:
  - [src/direcciones/modelo.ts](../../src/direcciones/modelo.ts): los tipos `Direccion`, `DireccionNueva` y `TipoDireccion` salen del contrato generado. `FilaDireccion` es la fila como la entrega pg, y `aDireccion()` la pasa al esquema `Direccion`: la fecha en ISO 8601, las coordenadas como número y, sin alias o sin coordenadas, el campo no está.
  - [src/direcciones/repositorio.ts](../../src/direcciones/repositorio.ts): `crearDireccion()` inserta con parámetros y devuelve la fila con `RETURNING`; `obtenerDireccion()` busca por `(cliente_id, direccion_id)` y, si no hay fila, lanza `NoEncontrado`.
- Por qué así: mismo molde que [src/clientes/repositorio.ts](../../src/clientes/repositorio.ts): reciben `consultar`, así sirven dentro de la transacción idempotente de T5 y fuera de ella. La dirección de otro cliente da el mismo `NoEncontrado`, con el mismo detalle, que una inexistente: no se revela que existe (RF-2.2.2.1). El alias vacío se guarda vacío y vuelve vacío (spec, Casos límite). No hay `actualizado_en` ni `exigirPerfil` aquí: el plan pone la existencia del perfil en el servicio (T5).
- Cómo se conecta: las usará el servicio de T5 y los manejadores de T6. T3 y T4 suman al mismo archivo el listado, el PATCH y el DELETE.
- Tests:
  - [pruebas/unitarias/direcciones.test.ts](../../pruebas/unitarias/direcciones.test.ts): `aDireccion()` con y sin alias y coordenadas, alias vacío, extremos y cero, y que solo salgan los campos del esquema.
  - [pruebas/integracion/direcciones.test.ts](../../pruebas/integracion/direcciones.test.ts) (bloque «el repositorio de direcciones»), con PostgreSQL real: alta con todo y solo con lo obligatorio, coordenadas en los extremos, en cero y muy chicas sin perder valor, texto con comillas y punto y coma, el mismo contenido dos veces con ids distintos, id repetido (`Conflicto`), consulta de lo creado, y que una dirección ajena, una inexistente y un cliente sin perfil den `NoEncontrado`.
  - En rojo primero: sin `src/direcciones/` ninguno de los dos archivos cargaba.
- Para mirar con atención:
  - Sin perfil, `crearDireccion()` no da 404: la clave foránea de la base rechaza la fila (23503) y `consultar()` no la clasifica, así que saldría como 500. Por eso T5 tiene que comprobar el perfil antes, como dice el plan.
  - `numeric` llega como texto y se convierte con `Number()`. Con un número de JavaScript que viaja a la base como texto decimal y vuelve igual, el valor se conserva (hay una prueba con `1e-7`).

