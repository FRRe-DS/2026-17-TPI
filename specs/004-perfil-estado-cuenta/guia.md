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
- Por qué así: el plan («Transacciones») pide el mismo tope de 2 s y la misma clasificación que `consultar()`. Es la base de la idempotencia de T3 y de las altas de la 005 (RNF-08). Una conexión que tuvo un corte por tiempo sigue ocupada en la base: si volviera al pool, la sentencia siguiente esperaría detrás de ella. Por eso se descarta. La base deshace la transacción al perder la sesión, pero recién cuando termina la sentencia en curso: desde la revisión (`004/V`), su propio corte (`statement_timeout`) la termina medio segundo después.
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
  - Una sentencia cortada por tiempo seguía corriendo en la base hasta terminar, con sus bloqueos. Lo resolvió la revisión (`004/V`, más abajo).
  - `fn` no debe dejar consultas sin esperar: la conexión vuelve al pool al terminar.

### T3 — Idempotencia transaccional reutilizable para las altas · commit `004/T3`
- Qué cambió:
  - [src/bd/idempotencia.ts](../../src/bd/idempotencia.ts), `conIdempotencia(pool, solicitud, alta)`: dentro de una `transaccion()`, reserva la clave en `idempotencias` (`INSERT … ON CONFLICT ON CONSTRAINT idempotencias_unica DO NOTHING`), ejecuta `alta`, guarda su respuesta (código, `Location` y cuerpo) y devuelve lo guardado.
  - Si la clave ya estaba, `repetida()` lee la fila con `FOR UPDATE`: con la misma huella devuelve la respuesta guardada sin llamar a `alta`; con otra, lanza `IdempotenciaReutilizada`.
  - La identidad (`SolicitudIdempotente`) es operación, sujeto del token, `clienteId` de la ruta (o `null`) y clave. `huella()` es el SHA-256 del JSON de cuerpo y parámetros de ruta, con las claves ordenadas.
  - [src/errores.ts](../../src/errores.ts), `IdempotenciaReutilizada`: 422 con `type: /errores/idempotencia-reutilizada`, sin la clave en el mensaje (RNF-19).
- Por qué así: el plan («Crear perfil o bloqueo con idempotencia») y el ADR 004 piden la reserva y el efecto en la misma transacción. Así no puede quedar una respuesta sin efecto ni un efecto sin respuesta (RNF-08). Está en `src/bd/` y no en `src/clientes/servicio.ts` (donde la ubica la tabla del plan) porque no sabe nada de clientes y la 005 la reusa tal cual. El servicio de T5 decide qué pasarle.
- Cómo se conecta: usa `transaccion()` de T2, así que hereda el tope de 2 s, el 409 y el 503. `alta` recibe el `consultar` de la transacción y tiene que hacer todo con él. La llaman los manejadores de `crearCliente` (T5) y `crearBloqueo` (T7), y las altas de direcciones de la 005.
- Tests: [pruebas/integracion/clientes.test.ts](../../pruebas/integracion/clientes.test.ts), bloque «conIdempotencia()», con altas de perfil y de bloqueo escritas en la prueba:
  - la primera vez ejecuta el alta una vez y guarda operación, sujeto, `cliente_id` nulo, clave, hash, estado, ubicación y respuesta;
  - un alta que falla no deja reserva: la misma clave la vuelve a ejecutar;
  - la misma solicitud, en secuencia, en otro orden de campos o cinco a la vez, da un solo efecto y respuestas idénticas;
  - otro cuerpo da 422 sin ejecutar el alta ni tocar lo guardado; dos cuerpos distintos a la vez con la misma clave dan uno bien, un 422 y un solo efecto;
  - la misma clave para otro `clienteId` crea el segundo bloqueo, y la de otro sujeto es otra solicitud;
  - dos claves distintas a la vez para el mismo perfil dejan uno, y el otro da `Conflicto`, con una sola reserva.
  - En rojo primero: con un esbozo que lanzaba, fallaron las 10. Mutación de control: sin `ON CONFLICT … DO NOTHING`, fallan las 5 de repetición y 422.
  - `npm test` (2140), lint, build y spec-check en verde. La de `clientes.test.ts` se corrió tres veces seguidas sin fallas.
- Para mirar con atención:
  - La primera respuesta también sale de lo guardado (`UPDATE … RETURNING`), no del valor que devolvió `alta`. `jsonb` reordena las claves, y sin esto la primera respuesta y las repetidas tenían el mismo contenido en distinto orden. Por eso el cuerpo que devuelve `alta` tiene que estar ya en la forma del contrato: un `Date` volvería como texto.
  - La concurrencia la resuelve la restricción única: la segunda reserva espera a que termine la transacción de la primera. Si la primera confirma, la segunda lee su respuesta; si falla, la segunda hace el alta. Si la primera tarda más de 2 s, la segunda da 503.
  - Los errores no se guardan: un alta que falla (409, 404, 422 de negocio) deshace la reserva y la misma clave puede volver a intentarla.
  - La huella no incluye el sujeto ni la operación, que ya están en la identidad. Si un cuerpo trae un campo `undefined`, `JSON.stringify` lo omite: da lo mismo que no mandarlo.

### V — Correcciones de la revisión independiente de T1 a T3 · commit `004/V`
- Qué cambió:
  - [src/bd/pool.ts](../../src/bd/pool.ts), `PoolBd`: le pasa a la base `statement_timeout = tiempoBdMs + 500 ms` (`MARGEN_CORTE_BASE_MS`). La revisión comprobó que una sentencia cortada por M2 seguía viva en la base: la base no lee el cierre de la conexión hasta terminar la sentencia, y mientras tanto conservaba sus bloqueos. Un reintento con la misma clave daba 503 otra vez, y con la base lenta las sesiones se acumulaban. Ahora la base la corta sola medio segundo después. El que responde sigue siendo el corte de M2, así que el `57014` de la base no llega a ninguna respuesta y su clasificación (500, spec 003) no cambia. Vale también para `consultar()`.
  - [migraciones/1792723535129_perfil-bloqueos.sql](../../migraciones/1792723535129_perfil-bloqueos.sql): `bloqueos_cliente_motivo_levantamiento_no_vacio`, el mismo resguardo que ya tenía `motivo` (el contrato pide `minLength: 1`). Se editó la migración de T1 porque todavía no estaba publicada. Una base local que ya la tenía aplicada hay que rehacerla con `docker compose down -v`.
  - [src/bd/idempotencia.ts](../../src/bd/idempotencia.ts), `laFila()`: compara `cliente_id` con `IS NULL` o con `=` según el caso. Con `IS NOT DISTINCT FROM`, PostgreSQL no usaba el índice único (lo vio la revisión con `EXPLAIN`). `huella` pasó a ser un objeto (`Record<string, unknown>`): con `undefined`, `JSON.stringify` no da texto y el hash fallaba.
  - [src/bd/transaccion.ts](../../src/bd/transaccion.ts): el comentario de `deshacer()` decía que la base deshace al perder la sesión, sin aclarar que es recién al terminar la sentencia.
- Tests:
  - [pruebas/unitarias/bd.test.ts](../../pruebas/unitarias/bd.test.ts): el pool pide `statement_timeout` de 2000 con 1500 de tiempo de base.
  - [pruebas/integracion/clientes.test.ts](../../pruebas/integracion/clientes.test.ts):
    - después del corte, la sesión desaparece de `pg_stat_activity` en menos de un segundo y un alta del mismo perfil sale sin esperar;
    - la prueba de descarte quedó solo con eso (antes decía «deshecho» y solo miraba que la fila no estuviera confirmada);
    - las restricciones de `bloqueos_cliente` incluyen la nueva, y un levantamiento con motivo vacío da 23514.
  - En rojo primero, fallaron las 4. El cambio del índice no tiene prueba propia: con pocas filas, PostgreSQL elige recorrer la tabla igual. Lo cubren las pruebas de idempotencia, que siguen en verde.
  - `npm test` (2142), lint y build en verde, y tres corridas seguidas de las pruebas de la base sin fallas.
- Para T5 y T7 (avisos de la revisión, sin verificar):
  - `clienteId` de la ruta en minúsculas antes de ponerlo en la huella: la columna `uuid` normaliza el valor y la huella no, así que un UUID en mayúsculas daría 422 en lugar de repetir.
  - `alta` no debe atrapar un error de la base y seguir: sin savepoints, la transacción queda abortada y la sentencia siguiente da `25P02` (500).
  - Un `COMMIT` cortado por tiempo da 503 aunque la base pueda haber confirmado. Con idempotencia, el reintento devuelve lo guardado. Sin ella (el PATCH de T5), el resultado queda ambiguo.
  - `idempotencias` guarda el cuerpo de la respuesta, con datos personales, sin vencimiento ni purga. No lo pide TP1: anotarlo para una etapa siguiente.
