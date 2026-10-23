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

### T4 — Repositorio de perfiles y sus transformaciones · commit `004/T4`
- Qué cambió:
  - [src/clientes/repositorio.ts](../../src/clientes/repositorio.ts): `crearPerfil`, `obtenerPerfil` y `actualizarPerfil`. Cada una recibe `consultar` como primer argumento, el del pool o el de una `transaccion()`, así sirven dentro de la idempotencia (T3) y fuera de ella.
    - `crearPerfil` inserta con `ON CONFLICT (cliente_id) DO NOTHING`; si no inserta nada, lanza `PerfilYaExiste` (409, RF-2.1.3).
    - `obtenerPerfil` lanza `NoEncontrado` (404, RF-2.1.3.1) si no hay fila.
    - `actualizarPerfil` hace un solo `UPDATE` con `COALESCE($n, columna)` y mueve `actualizado_en`; sin perfil, `NoEncontrado`; sin campos, devuelve el perfil sin tocarlo.
  - [src/clientes/modelo.ts](../../src/clientes/modelo.ts): los tipos del contrato (`Cliente`, `ClienteNuevo`, `ClienteCambios`, tomados de `src/generado/contrato.ts`), `FilaCliente` y `aCliente()`, que convierte la fila al esquema `Cliente`.
  - [src/errores.ts](../../src/errores.ts): `PerfilYaExiste` (409, `type: /errores/perfil-ya-existe`) y `NoEncontrado` con `detail` opcional (por defecto sigue diciendo «No existe la ruta pedida»).
- Por qué así:
  - El estado no se guarda: cada lectura lo calcula con un `EXISTS` sobre los bloqueos vigentes (plan, «Estado y vigencia»), porque el esquema `Cliente` lo exige. El predicado de vigencia es la constante `BLOQUEO_VIGENTE`; T6 lo reutiliza para `obtenerEstadoCuenta`.
  - `ON CONFLICT DO NOTHING` y no el `23505`: dentro de una transacción un error de la base la deja abortada, y la función no podría seguir consultando. Con dos altas a la vez, la segunda espera a la primera y, si esta confirma, no inserta nada (RNF-08.1).
  - Un solo `UPDATE` atómico: en READ COMMITTED, PostgreSQL vuelve a evaluar el `SET` sobre la última versión de la fila, así que dos `PATCH` a la vez de campos distintos se aplican uno detrás del otro y ninguno pisa al otro.
  - Ningún campo del contrato admite `null`, por eso `null` en el parámetro significa «no enviado» y `COALESCE` conserva el valor.
  - La fecha de nacimiento sale con `to_char(…, 'YYYY-MM-DD')` y no como `Date` de pg: pg la arma a medianoche de la zona del proceso y la fecha puede correrse un día. Sin fecha, el campo no está en la respuesta.
- Cómo se conecta: todavía no lo llama ningún manejador. El servicio de T5 llamará a `crearPerfil` dentro de `conIdempotencia()` y a las otras dos con el pool. Los errores de la base salen como los clasifica `consultar()`.
- Tests:
  - [pruebas/unitarias/clientes.test.ts](../../pruebas/unitarias/clientes.test.ts): `aCliente()` (campos, fechas en ISO, sin fecha no hay campo, estado según `bloqueado`) y las respuestas de `PerfilYaExiste` y `NoEncontrado`.
  - [pruebas/integracion/clientes.test.ts](../../pruebas/integracion/clientes.test.ts), bloque «el repositorio de perfiles», con una base migrada:
    - crear devuelve el perfil del contrato y `obtenerPerfil` lo repite; la fecha es opcional y vuelve igual en otra zona horaria;
    - un segundo perfil da `PerfilYaExiste` y deja el primero intacto; dos altas a la vez dejan una fila; un perfil repetido dentro de una transacción no la aborta;
    - obtener un perfil que no existe da 404 con detalle propio;
    - el estado sale BLOQUEADO con un bloqueo vigente y ACTIVO con uno levantado o vencido;
    - actualizar cambia solo lo enviado y mueve `actualizadoEn`; cambia todos los campos; agrega la fecha; conserva el estado; sin cambios no toca nada; sin perfil da 404; tres actualizaciones a la vez de campos distintos quedan todas.
  - En rojo primero: con un esbozo que lanzaba, fallaron las 15 de integración y no cargaba el módulo de las unitarias. Mutaciones de control: leyendo la fecha como `Date` fallan 5, y sin `ON CONFLICT` fallan 3.
  - `npm test` (2164), lint, build y spec-check en verde. Las pruebas del repositorio se corrieron tres veces seguidas sin fallas.
- Para mirar con atención:
  - La cobertura de la vigencia aquí es mínima (vigente, levantado, vencido). Los casos de T6 (indefinidos, futuros, varios simultáneos, coincidencia con `bloqueosVigentes`) los cubre esa tarea.
  - `actualizarPerfil` no distingue entre «no enviado» y `null`: si algún día el contrato admite borrar la fecha de nacimiento, hará falta otra forma de decirlo.
  - Los datos personales del perfil no se registran en ningún lado: ninguna de estas funciones escribe logs y los errores no llevan el `clienteId` (RNF-19).

### T5 — Crear, obtener y actualizar perfil con rol efectivo y errores del contrato · commit `004/T5`
- Qué cambió:
  - [src/clientes/operaciones.ts](../../src/clientes/operaciones.ts): los manejadores `crearCliente`, `obtenerCliente` y `actualizarCliente`. Toman la identidad, los roles de la operación (`routeOptions.config.permisos`), el `clienteId`, la `Idempotency-Key` y el cuerpo, llaman al servicio y arman la respuesta. `crearCliente` pone `Location` y el código que devuelve la idempotencia.
  - [src/clientes/servicio.ts](../../src/clientes/servicio.ts):
    - `clienteDelToken` saca el `clienteId` del `sub`; si no es UUID, `SolicitudInvalida` (400).
    - `exigirPropietario` calcula los roles efectivos (token ∩ operación, sin repetidos) y exige `sub = clienteId` solo si son exactamente `[CLIENTE]`; si no, `SinPermiso` (403).
    - `normalizarUuid` deja el UUID en minúsculas y sin `urn:uuid:`.
    - `crearCliente` llama a `crearPerfil` dentro de `conIdempotencia`; `obtenerCliente` y `actualizarCliente` exigen la propiedad antes de ir a la base.
  - [src/errores.ts](../../src/errores.ts): `SolicitudInvalida(detail)` (400 genérico) y `SinPermiso` con `detail` opcional («El perfil pedido es de otro cliente»).
  - [src/bd/pool.ts](../../src/bd/pool.ts): `BaseDeDatos`, el tipo de `request.server.pool`, suma `connect` y `tiempoBdMs` para que los manejadores puedan abrir una `transaccion()`. `PoolTransaccional` sale de ahí. `POOL_FALSO` y los dos pools falsos de [pruebas/http/correlacion-logs.test.ts](../../pruebas/http/correlacion-logs.test.ts) se completaron.
- Por qué así:
  - La propiedad va antes de buscar el perfil: un CLIENTE no puede averiguar si existe el de otro (403 antes que 404).
  - Los repetidos se quitan porque, con `['CLIENTE','CLIENTE']`, contar roles se saltearía la regla.
  - El UUID se normaliza porque el formato `uuid` del contrato (Ajv) admite mayúsculas y `urn:uuid:`, que PostgreSQL no devuelve o no acepta. Así coinciden el `sub`, la ruta, la base y la huella (el aviso de la revisión).
  - La huella de `crearCliente` es solo el cuerpo: la ruta no tiene parámetros. El sujeto es el `clienteId` del token.
  - Las rutas, los roles y la validación siguen saliendo del contrato (ADR 003). Registrar estos manejadores en [src/operaciones/index.ts](../../src/operaciones/index.ts) es parte de T9, junto con [pruebas/integracion/arranque.test.ts](../../pruebas/integracion/arranque.test.ts).
- Cómo se conecta: las pruebas pasan los tres manejadores a `crearApp` con el contrato real (`cargarContrato()`). El token y el rol los resuelve `registrarPermisos`, la validación el compilador del contrato, y los errores `responderProblema`.
- Tests:
  - [pruebas/unitarias/clientes.test.ts](../../pruebas/unitarias/clientes.test.ts): `normalizarUuid`, `clienteDelToken` con cinco `sub` que no son UUID, y `exigirPropietario`: dueño, otro, CLIENTE+OPERADOR en lectura y escritura, CLIENTE+CONDUCTOR, CLIENTE repetido y OPERADOR.
  - [pruebas/http/clientes.test.ts](../../pruebas/http/clientes.test.ts), con `POOL_FALSO` (si tocaran la base darían 500): 401 sin token; 403 por rol (OPERADOR, SERVICIO o CONDUCTOR al crear; SERVICIO al leer; OPERADOR al actualizar); 403 por propiedad (CLIENTE, CLIENTE+CONDUCTOR y CLIENTE+OPERADOR al actualizar); 400 por `sub` que no es UUID (sin el `sub` en la respuesta), sin `Idempotency-Key`, por cuerpos inválidos, por un `clienteId` que no es UUID y por un PATCH vacío o con campos de más.
  - [pruebas/integracion/clientes-http.test.ts](../../pruebas/integracion/clientes-http.test.ts), con la base real:
    - 201 con perfil, `Location` y `sub` en mayúsculas normalizado; misma clave, misma respuesta; otra huella, 422 con su tipo; otra clave, 409 `perfil-ya-existe` sin cambiar el perfil;
    - a la vez: claves distintas dan 201 y 409 con un solo perfil, y la misma clave da dos 201 iguales; clave de 255 sirve y la de 256 da 400;
    - 200 del dueño (también con la ruta en mayúsculas), de OPERADOR y de CLIENTE+OPERADOR sobre otro; 404 en problem+json;
    - PATCH parcial 200 que conserva lo demás, 404, y CLIENTE+OPERADOR sobre otro da 403 sin cambiar nada;
    - los logs de todo ese recorrido no tienen nombre, apellido, teléfono, fechas, la clave ni el token.
  - En rojo primero: sin los módulos no cargaban; con esbozos fallaron 31 (pasaban los 401, los 403 por rol y los 400 del contrato, que ya resuelve la base del servicio). Mutaciones de control: sin la regla de propiedad fallan 9, y sin quitar repetidos falla la de CLIENTE repetido.
  - `npm test` (2217), lint, build y spec-check en verde. Las HTTP con base, tres corridas sin fallas.
- Para mirar con atención:
  - La respuesta de `crearCliente` sale de `idempotencias` (jsonb) y sus claves vienen en otro orden que las de `obtenerCliente`. El contenido es el mismo y JSON no fija el orden, pero las pruebas comparan objetos y no texto.
  - Me equivoqué con la `Idempotency-Key`: creí que el contrato no tenía largo máximo y empecé a guardar su SHA-256. Tiene `maxLength: 255`, igual que la columna, así que lo revertí. Una clave de 256 da 400 antes de llegar al manejador.
  - El 403 por propiedad tiene un `detail` propio. Es distinto del 403 por rol, para que quien consume la API sepa por qué.

### T6 — Vigencia y estado de cuenta consistente · commit `004/T6`
- Qué cambió:
  - [src/clientes/repositorio.ts](../../src/clientes/repositorio.ts): `obtenerEstadoCuenta(consultar, clienteId)`. Una sola sentencia con `clientes LEFT JOIN bloqueos_cliente` filtrado por `BLOQUEO_VIGENTE` devuelve una fila por bloqueo vigente (del más nuevo al más antiguo), o una sin bloqueo si no hay ninguno; sin filas, `NoEncontrado` (404). `COLUMNAS_BLOQUEO` es la lista de columnas de `FilaBloqueo` con `vigente` calculado; T7 la reutiliza para el historial.
  - [src/clientes/modelo.ts](../../src/clientes/modelo.ts): `Bloqueo` y `EstadoCuenta` (tipos del contrato), `FilaBloqueo`, `aBloqueo()` y `aEstadoCuenta()`. El estado sale de la cantidad de bloqueos vigentes que se devuelven.
  - [src/clientes/servicio.ts](../../src/clientes/servicio.ts): `obtenerEstadoCuenta`, con `exigirPropietario` antes de ir a la base. [src/clientes/operaciones.ts](../../src/clientes/operaciones.ts): el manejador `obtenerEstadoCuenta`.
- Por qué así:
  - `estado` y `bloqueosVigentes` no pueden contradecirse porque el primero se deduce de la segunda, y ambas salen de una misma sentencia, con un mismo `CURRENT_TIMESTAMP` (plan, «Estado y vigencia»). No hace falta una transacción de lectura aparte: una sentencia ya es una sola instantánea.
  - La vigencia vive solo en SQL (`BLOQUEO_VIGENTE`), no hay una segunda versión en TypeScript que pueda diferir de la de `obtenerPerfil`.
  - `desde` es `creado_en`; un bloqueo vencido por su fecha no lleva `levantadoEn`, `levantadoPor` ni `motivoLevantamiento`: no está levantado (spec, Casos límite).
  - La propiedad se exige solo si el único rol efectivo es CLIENTE: OPERADOR, CLIENTE+OPERADOR y SERVICIO ven cualquier cuenta (RF-2.6).
- Cómo se conecta: el manejador queda sin registrar en [src/operaciones/index.ts](../../src/operaciones/index.ts); eso es T9. Las pruebas lo pasan a `crearApp`.
- Tests:
  - [pruebas/unitarias/clientes.test.ts](../../pruebas/unitarias/clientes.test.ts): `aBloqueo()` (campos, `desde`, fin, levantado, vencido sin campos de levantamiento) y `aEstadoCuenta()` (ACTIVO sin bloqueos, BLOQUEADO con uno o varios, orden recibido).
  - [pruebas/integracion/clientes.test.ts](../../pruebas/integracion/clientes.test.ts), bloque `obtenerEstadoCuenta`: sin bloqueos; indefinido; futuro; vencido; levantado (con y sin fin); varios mezclados con orden; levantar uno de dos y luego el último; un bloqueo que vence solo en 700 ms; bloqueos de otro cliente; `estado`, `bloqueosVigentes` y el estado de `obtenerPerfil` coinciden en seis casos; 40 lecturas con bloqueos entrando y venciendo sin contradicciones; 404.
  - [pruebas/http/clientes.test.ts](../../pruebas/http/clientes.test.ts) (sin base): 401, 403 por propiedad (también CLIENTE+CONDUCTOR), 403 por rol, 400 por `clienteId` inválido. [pruebas/integracion/clientes-http.test.ts](../../pruebas/integracion/clientes-http.test.ts): 200 ACTIVO, 200 BLOQUEADO con vigentes y sin vencidos, OPERADOR, CLIENTE+OPERADOR y SERVICIO sobre otro, 403, 404 problem+json y `clienteId` en mayúsculas.
  - En rojo primero: faltaban `aBloqueo`, `aEstadoCuenta` y `obtenerEstadoCuenta`, y fallaron las 70 pruebas nuevas y las de los archivos que los importan. Mutación de control: reemplazando la condición de `hasta` por `TRUE` fallan 5 (vencido, varios, vence solo, y las dos del estado en HTTP y repositorio).
  - `npm test` (2247), lint, build y spec-check en verde.
- Para mirar con atención:
  - El LEFT JOIN usa `levantado_en` y `hasta` sin alias dentro de `BLOQUEO_VIGENTE`: es inequívoco porque `clientes` no tiene esas columnas. Si alguien las agrega, la consulta fallará con «ambiguous», no devolverá datos mal.
  - Un bloqueo cuyo `hasta` coincide exactamente con el instante de la consulta no es vigente (`hasta > CURRENT_TIMESTAMP` es estricto), igual que la regla de la spec. La prueba de vencimiento natural espera 1 s sobre un fin de 700 ms.
  - La prueba de «40 lecturas» confirma que no hay contradicción, pero la garantía es estructural (una sentencia, estado deducido), no estadística.

