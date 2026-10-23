# Guía — Spec 004 Perfil y estado de cuenta

## Visión general
Se escribe al validar la spec.

## Tareas
### T1 — Migración de perfiles, bloqueos e idempotencias · commit `004/T1`
- Qué cambió: [migraciones/1792723535129_perfil-bloqueos.sql](../../migraciones/1792723535129_perfil-bloqueos.sql), creada con `npx node-pg-migrate create perfil-bloqueos --migration-file-language sql --migrations-dir migraciones` (plan, Datos). Crea tres tablas:
  - `clientes`: `cliente_id` es la clave primaria (un perfil por `sub`, RF-2.1.3) y el teléfono tiene un `CHECK` con el patrón E.164 del contrato (`clientes_telefono_e164`).
  - `bloqueos_cliente`: clave foránea a `clientes`, motivo no vacío (`bloqueos_cliente_motivo_no_vacio`), y los tres datos de levantamiento juntos o ninguno (`bloqueos_cliente_levantamiento_completo`). Tiene dos índices: `bloqueos_cliente_historial` para el historial paginado y `bloqueos_cliente_sin_levantar`, parcial, para buscar los vigentes.
  - `idempotencias`: `UNIQUE NULLS NOT DISTINCT (operacion, sujeto, cliente_id, clave)` (`idempotencias_unica`) y `crearBloqueo` siempre con cliente (`idempotencias_crear_bloqueo_con_cliente`).
  - La `Down Migration` borra las tres en el orden inverso.
- Por qué así: lo que no puede duplicarse lo garantiza la base, no solo el código (RNF-08.1). Las restricciones tienen nombre propio para que la prueba las encuentre sin depender de los nombres que inventa PostgreSQL. Hay un `CHECK` del teléfono y uno del motivo vacío, como defensa además de la validación del contrato. En `idempotencias`, `estado`, `ubicacion` y `respuesta` aceptan nulo porque el registro se reserva antes del alta y se completa al terminarla, en la misma transacción (plan, «Crear perfil o bloqueo con idempotencia»). El estado de la cuenta no tiene columna: se calcula desde los bloqueos vigentes (plan, Decisiones).
- Cómo se conecta: `migrar()` ([src/bd/migraciones.ts](../../src/bd/migraciones.ts)) la aplica al arrancar, después de la inicial; no hubo que tocar código. T2 (`transaccion()`) y T3 (idempotencia) escriben en estas tablas. La 005 y la 006 cuelgan sus tablas de `clientes(cliente_id)`.
- Tests: [pruebas/integracion/clientes.test.ts](../../pruebas/integracion/clientes.test.ts), con una base nueva del contenedor de Testcontainers:
  - la migración está una sola vez en `migraciones/` y no existe `migrations/`;
  - restricciones de cada tabla por nombre, tipo y definición; qué columnas aceptan nulo; y los dos índices de `bloqueos_cliente`;
  - la base rechaza un segundo perfil (23505), un teléfono que no es E.164 (23514), un bloqueo de un cliente que no existe (23503), un motivo vacío (23514), un levantamiento incompleto (23514), una idempotencia de `crearBloqueo` sin cliente (23514) y una segunda de `crearCliente` con el mismo sujeto y clave y `cliente_id` nulo (23505); acepta un levantamiento completo y la misma clave de `crearBloqueo` para dos clientes;
  - la `Down Migration`, corrida solo sobre este archivo (opción `file` del `runner`), borra las tres tablas, y `migrar()` la vuelve a aplicar.
  - En rojo primero: sin el archivo, fallaron las 14 pruebas que había entonces. Mutación de control: sin `NULLS NOT DISTINCT`, fallan la inspección de `idempotencias` y la segunda alta de `crearCliente`.
  - `npm test` (2116), lint y build en verde. Con `docker compose up -d --build --wait`, el servicio aplica la migración al arrancar (`migraciones_aplicadas` tiene la inicial y esta) y `/health` responde 200.
- Para mirar con atención:
  - PostgreSQL 18 guarda los `NOT NULL` también como filas de `pg_constraint` (tipo `n`, con nombres como `idempotencias_clave_not_null`). La prueba los excluye al inspeccionar las restricciones y mira la nulabilidad aparte, en `information_schema.columns`.
  - El plan nombra el archivo `<marca>_perfil_bloqueos.sql`, con guion bajo, pero su comando (`create perfil-bloqueos`) genera `<marca>_perfil-bloqueos.sql`. Se siguió el comando.
  - `idempotencias` no tiene clave foránea a `clientes`: el plan no la pide. Cómo se trata un `crearBloqueo` para un cliente que no existe lo resuelven T3 y T7; como la reserva va en la misma transacción que el alta, un alta que falla la deshace también.
  - Que `hasta` sea futura no lo controla la base: el plan lo valida antes de insertar (T7).

### T2 — `transaccion()` con el tiempo máximo y la clasificación de errores de la base · commit `004/T2`
- Qué cambió:
  - [src/bd/transaccion.ts](../../src/bd/transaccion.ts), `transaccion(pool, fn)`: pide una conexión al pool, ejecuta `BEGIN`, le pasa a `fn` una función `consultar` (tipo `Consultar`) que corre sobre esa conexión, y termina con `COMMIT`, o con `ROLLBACK` si algo falla, y entonces relanza el error. Devuelve lo que devuelve `fn`.
  - Cada sentencia, también `BEGIN`, `COMMIT`, `ROLLBACK` y el pedido de la conexión, pasa por `conTiempoMaximo` y `clasificarError` de [src/bd/pool.ts](../../src/bd/pool.ts): `23505` da `Conflicto` (409), sin base o sin respuesta da `BaseNoDisponible` (503) con la causa en `cause`, y el resto sale tal cual, para el 500. Un error propio de `fn` también sale tal cual.
  - `deshacer()`: después de un `BaseNoDisponible`, la conexión se descarta (`release(true)`) sin `ROLLBACK`; si el `ROLLBACK` falla, también se descarta.
  - [src/bd/pool.ts](../../src/bd/pool.ts): `PoolBd.tiempoBdMs` pasó de privado a público y de solo lectura, para que `transaccion()` use el mismo tope.
- Por qué así: el plan («Transacciones») pide el mismo tope de 2 s y la misma clasificación que `consultar()`. Es la base de la idempotencia de T3 y de las altas de la 005 (RNF-08). Una conexión que tuvo un corte por tiempo sigue ocupada en la base: si volviera al pool, la sentencia siguiente esperaría detrás de ella. Por eso se descarta, y la base deshace la transacción al perder la sesión.
- Cómo se conecta: reusa las piezas de [src/bd/pool.ts](../../src/bd/pool.ts) sin cambiar `consultar()`. Recibe un `PoolTransaccional` (`connect` y `tiempoBdMs` del `PoolBd`). Hoy no la usa ningún manejador: la usan T3 (idempotencia) y T4 (repositorio).
- Tests: [pruebas/integracion/clientes.test.ts](../../pruebas/integracion/clientes.test.ts), bloque «transaccion()», con la base migrada y un pool nuevo por prueba:
  - COMMIT: guarda, devuelve el resultado de `fn` y suelta la conexión; otra conexión no ve los cambios hasta el `COMMIT`; `fn` recibe las filas de sus consultas.
  - ROLLBACK: un error propio de `fn` sale idéntico (`toBe`), lo hecho no queda y la conexión sirve para la transacción siguiente.
  - 409: un duplicado da `Conflicto` y deshace también lo anterior de la misma transacción; dos transacciones a la vez con el mismo `cliente_id` dan una confirmada, un `Conflicto` y una sola fila.
  - 500: una tabla que no existe sale con su `42P01`, y la transacción queda deshecha.
  - 503: una base que no acepta conexiones (`ECONNREFUSED` en `cause`) no llega a llamar a `fn`; una sentencia en curso que la base corta y una transacción cortada entre dos sentencias dan `BaseNoDisponible` con `57P01`, deshacen lo hecho y descartan la conexión.
  - Tope: `pg_sleep(10)` da `BaseNoDisponible` entre 2 s y 3 s, con la conexión descartada y lo anterior deshecho; dos sentencias de 1,2 s cada una salen bien, porque el tope es por sentencia y no por transacción.
  - En rojo primero: sin el módulo no cargaba el archivo. Con un esbozo que solo llamaba a `pool.consultar` (sin `BEGIN` ni `COMMIT`) fallaron 7. Mutación de control: sin el oyente de `'error'`, la prueba del corte entre sentencias falla con errores sin atender.
  - `npm test` (2130), lint, build y spec-check en verde. La de `clientes.test.ts` se corrió tres veces seguidas sin fallas.
- Para mirar con atención:
  - Mientras la conexión está prestada, pg-pool no escucha su evento `'error'`. Si la base la corta entre dos sentencias, pg lo emite sin oyente y se cae el proceso. `transaccion()` pone un oyente, guarda el primer error y lo usa como causa del 503 de la sentencia siguiente (si no, esa sentencia fallaría con un mensaje que `clasificarError` no reconoce, y sería un 500). Una conexión descartada conserva el oyente, porque pg todavía puede emitir el corte.
  - Con un corte por tiempo, `conTiempoMaximo` y el `query_timeout` de pg disparan en el mismo milisegundo: la causa del 503 es `TiempoAgotado` o `Query read timeout`, según cuál llegue primero. La prueba acepta las dos.
  - Una sentencia cortada por tiempo sigue corriendo en la base hasta que termina (no hay `statement_timeout` en la base). Una sentencia que espera un bloqueo de fila podría retener los suyos un tiempo más. Queda anotado para T3, que reserva filas de `idempotencias`.
  - `fn` no debe dejar consultas sin esperar: la conexión vuelve al pool al terminar.
