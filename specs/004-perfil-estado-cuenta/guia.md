# Guía — Spec 004 Perfil y estado de cuenta

## Visión general
**Qué se construyó y para qué.** Las ocho operaciones de perfil y estado de cuenta de M2. Un cliente crea, consulta y actualiza su perfil; un operador bloquea clientes, consulta el historial de bloqueos y los levanta; y M5/M9 (rol SERVICIO) preguntan si un cliente puede operar. El estado (ACTIVO o BLOQUEADO) no se guarda: se calcula en cada lectura a partir de los bloqueos vigentes, y el historial nunca se borra.

**Recorrido de una petición** (`PATCH /api/v1/clientes/{clienteId}/bloqueos/{bloqueoId}`, levantar un bloqueo). Lo común a todas las operaciones está en la guía de la [spec 003](../003-base-servicio/guia.md):
1. Token y rol: `registrarPermisos` deja pasar solo a OPERADOR, que es lo que declara el contrato para esta operación. Los ids y el cuerpo los valida Ajv contra el contrato.
2. El manejador `levantarBloqueo` ([clientes/operaciones.ts](../../src/clientes/operaciones.ts)) lee la ruta y el cuerpo y llama al servicio.
3. `levantarBloqueo` ([clientes/servicio.ts](../../src/clientes/servicio.ts)) normaliza los UUID y toma el `sub` del token como autor. En las lecturas con dueño, `exigirPropietario` aplica la regla del rol efectivo.
4. `levantarBloqueo` ([clientes/repositorio.ts](../../src/clientes/repositorio.ts)) ejecuta un UPDATE condicional por vigencia. Si no cambió nada, una segunda lectura decide entre 404, 409 `bloqueo-ya-levantado` y 409 `bloqueo-no-vigente`.
5. `aBloqueo` ([clientes/modelo.ts](../../src/clientes/modelo.ts)) convierte la fila al esquema `Bloqueo`. Un error es un `Problema` ([errores.ts](../../src/errores.ts)) y sale en problem+json.

**Mapa.**
| Archivo | Responsabilidad | Requisitos | Tareas |
|---|---|---|---|
| `migraciones/1792723535129_perfil-bloqueos.sql` | Tablas `clientes`, `bloqueos_cliente` e `idempotencias`, con restricciones con nombre | RF-2.1, RF-2.6.1, RNF-05, RNF-08 | T1, V |
| `src/bd/transaccion.ts` | `transaccion()` con tope por sentencia y errores clasificados | RNF-08 | T2 |
| `src/bd/idempotencia.ts` | `conIdempotencia()`, reutilizable por la spec 005 | RF-2.1, RF-2.6.1, RF-2.6.1.3, RNF-08 | T3 |
| `src/bd/pool.ts` | `clasificarError`: además, el carácter nulo da 400 | RNF-03 | V, T10 |
| `src/clientes/modelo.ts` | Tipos del contrato y de fila, y sus conversiones | RF-2.1, RF-2.6 | T4, T6, T7, T8 |
| `src/clientes/repositorio.ts` | SQL de perfiles y bloqueos; `BLOQUEO_VIGENTE`, la única definición de vigencia | RF-2.1 a RF-2.6.4 | T4, T6, T7, T8, T10, T11 |
| `src/clientes/servicio.ts` | Rol efectivo, propiedad, idempotencia, `fechaNacimiento` guardable, `hasta` en UTC y su límite del año 9999 | RF-2.1.1.1, RF-2.1.2.1, RF-2.1.4, RF-2.6.1 a RF-2.6.1.3 | T5, T7, T8, T10, T11, T12 |
| `src/clientes/operaciones.ts` | Los ocho manejadores HTTP | RNF-03 | T5 a T8 |
| `src/operaciones/index.ts` | Registra los ocho `operationId` | RNF-03 | T9 |
| `src/errores.ts` | Errores de dominio: `perfil-ya-existe`, `idempotencia-reutilizada`, `bloqueo-vencido`, `bloqueo-hasta-fuera-de-rango`, `bloqueo-ya-levantado`, `bloqueo-no-vigente` | RF-2.1.3, RF-2.6.1.1, RF-2.6.1.2, RF-2.6.3.1 | T3 a T8, T10, T11 |
| `src/logs.ts` | `serializar`: de un error de datos de la base (SQLSTATE 22…) no guarda el mensaje ni el encabezado de la traza | RNF-19 | T12 |
| `schemathesis.toml`, `scripts/contrato-test.mjs` | Ajuste acotado de Schemathesis | RNF-07.2 | T10 |
| `pruebas/unitarias/clientes.test.ts`, `pruebas/integracion/clientes.test.ts` | Conversiones y reglas; persistencia, transacciones y concurrencia | RNF-07 | T1 a T8 |
| `pruebas/http/clientes.test.ts`, `pruebas/integracion/clientes-http.test.ts`, `pruebas/http/roles-clientes.test.ts` | HTTP sin base y con base, y la matriz de roles | RNF-03, RNF-07 | T5 a T12 |
| `pruebas/unitarias/secretos.test.ts` | El serializador ante errores de la clase 22 | RNF-19 | T12 |

**Decisiones clave** (detalle en [plan.md](plan.md) y en las entradas de abajo):
- El estado se calcula y no se guarda, con `BLOQUEO_VIGENTE` en SQL y un mismo `CURRENT_TIMESTAMP` en cada sentencia: `estado` y `bloqueosVigentes` no pueden contradecirse (T6). Descartado: una columna `estado`, que habría que mantener al día cuando un bloqueo vence solo.
- Lo que no puede duplicarse lo garantiza la base: clave primaria del perfil, restricción única de idempotencia y UPDATE condicional para levantar (T1, T3, T8; RNF-08). Descartado: comprobar antes en código, que pierde ante dos solicitudes a la vez.
- La propiedad se exige solo si el único rol efectivo es CLIENTE (rol efectivo = roles del token ∩ roles de la operación; T5, T9).
- `hasta` se pasa a UTC en el servicio y no lo interpreta PostgreSQL, que rechaza desplazamientos que el contrato admite (T10).
- En `crearBloqueo`, antes de la idempotencia solo se rechaza lo que nunca pudo crearse (un `hasta` después del año 9999, 422 `bloqueo-hasta-fuera-de-rango`); el perfil (404) y la fecha pasada (422 `bloqueo-vencido`) se miran después, dentro del alta. Así, repetir un alta ya hecha devuelve su 201 aunque el `hasta` haya pasado (T11; RF-2.6.1.3, RNF-08). Descartado: comparar `hasta` con el reloj del servicio antes de la idempotencia, que daba 422 a una repetición legítima.
- Los valores que el contrato admite y la base no guarda dan 400, no 500: la `fechaNacimiento` del año `0000` se rechaza en el servicio antes de la idempotencia y de la propiedad, y el carácter nulo lo traduce `clasificarError` (T10, T12; RF-2.1.4). Y si un error de datos que nadie previó llega a un 500, el log guarda su código y su pila, no el valor (T12; RNF-19). Descartado: traducir el 22008 a 400, que también puede venir de un error del propio servicio.

**Conceptos que conviene entender.** Idempotencia con `Idempotency-Key`: la misma clave y el mismo cuerpo devuelven la respuesta guardada. READ COMMITTED y el bloqueo de fila: el segundo UPDATE espera al primero y vuelve a evaluar su condición. Rol efectivo. Paginación estable (orden total con desempate por id). Schemathesis y sus fases (examples, coverage, fuzzing, stateful).

**Cómo probarlo uno mismo** (comprobado el 2026-10-23 contra el compose; los tokens los firma el comando de tokens del contenedor):
```bash
docker compose up -d --build --wait
CLI=$(cat /proc/sys/kernel/random/uuid); B=http://localhost:8082/api/v1/clientes
token() { docker compose exec -T m2 node dist/herramientas/token.js --sub "$1" --roles "$2"; }
TC=$(token "$CLI" CLIENTE); TO=$(token operador-1 OPERADOR); TS=$(token m5-solicitud SERVICIO)
curl -i -X POST $B -H "Authorization: Bearer $TC" -H 'Idempotency-Key: alta-1' -H 'Content-Type: application/json' \
  -d '{"nombre":"Ana","apellido":"Gómez","telefono":"+5493624000000"}'        # 201 y Location; repetida, 201 igual; otra clave, 409 perfil-ya-existe
curl -X PATCH $B/$CLI -H "Authorization: Bearer $TC" -H 'Content-Type: application/json' -d '{"telefono":"+5493624111111"}'   # 200
curl -i -X POST $B/$CLI/bloqueos -H "Authorization: Bearer $TO" -H 'Idempotency-Key: bloqueo-1' \
  -H 'Content-Type: application/json' -d '{"motivo":"Deuda pendiente"}'     # 201, creadoPor operador-1; con hasta pasada, 422 bloqueo-vencido
curl $B/$CLI/estado-cuenta -H "Authorization: Bearer $TS"                   # 200 BLOQUEADO con el bloqueo; SERVICIO en $B/$CLI, 403
curl -X PATCH http://localhost:8082<Location del bloqueo> -H "Authorization: Bearer $TO" \
  -H 'Content-Type: application/json' -d '{"motivo":"Pagó la deuda"}'       # 200 levantado; otra vez, 409 bloqueo-ya-levantado
curl "$B/$CLI/bloqueos?vigente=false" -H "Authorization: Bearer $TO"        # 200, el levantado sigue en el historial
curl $B/$CLI/estado-cuenta -H "Authorization: Bearer $TC"                   # 200 ACTIVO; sobre otro cliente, 403
npm test && npm run contrato:test
```

**Preguntas de comprobación** (la respuesta, entre paréntesis, dice dónde buscarla):
1. Un bloqueo con `hasta` a las 10:00 y nadie lo levanta: ¿qué estado da la cuenta a las 10:01 y qué campos tiene el bloqueo? (`BLOQUEO_VIGENTE`, `aBloqueo`; T6).
2. Dos operadores levantan el mismo bloqueo a la vez: ¿qué recibe cada uno y por qué la clasificación del 409 va en una segunda sentencia? (`levantarBloqueo` del repositorio; T8).
3. Un token con CLIENTE+OPERADOR pide el perfil de otro y después lo quiere actualizar: ¿qué recibe en cada caso? (`exigirPropietario`; T5, T9).
4. Un operador reintenta un alta de bloqueo con la misma clave, pero para otro cliente: ¿se crea un bloqueo nuevo? (huella y sujeto en `servicio.crearBloqueo`; T3, T7).
5. ¿Por qué `contrato:test` acepta 422 en `crearCliente` y `crearBloqueo`, y en ninguna otra operación? (`schemathesis.toml`; T10).

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
- Por qué así: el plan («Crear perfil o bloqueo con idempotencia») y el ADR 004 piden la reserva y el efecto en la misma transacción. Así no puede quedar una respuesta sin efecto ni un efecto sin respuesta (RNF-08). Está en `src/bd/` y no en `src/clientes/servicio.ts` (donde la ubicaba la tabla del plan antes del #47) porque no sabe nada de clientes y la 005 la reusa tal cual. El servicio de T5 decide qué pasarle.
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

### T7 — Crear y consultar bloqueos con historial paginado · commit `004/T7`
- Qué cambió:
  - [src/clientes/repositorio.ts](../../src/clientes/repositorio.ts):
    - `crearBloqueo(consultar, clienteId, bloqueoId, datos, autor)`: primero `exigirPerfil` (404), después un `INSERT … SELECT` que solo inserta si `hasta` es nula o posterior a `clock_timestamp()`, el mismo valor que queda en `creado_en`; si no inserta, `BloqueoVencido` (422).
    - `obtenerBloqueo(consultar, clienteId, bloqueoId)`: busca por los dos ids; uno de otro cliente es 404 «No existe el bloqueo pedido».
    - `listarBloqueos(consultar, clienteId, { vigente?, page, size })`: una sola sentencia con `clientes`, un `LATERAL` con el total del filtro y otro con la página (`ORDER BY creado_en DESC, bloqueo_id DESC LIMIT … OFFSET …`). Sin perfil, 404. Tipo `PedidoHistorial`.
  - [src/clientes/modelo.ts](../../src/clientes/modelo.ts): `BloqueoNuevo`, `PaginaBloqueos` y `aPaginaBloqueos()` (totales y `totalPaginas = ceil(total / size)`).
  - [src/clientes/servicio.ts](../../src/clientes/servicio.ts): `crearBloqueo` (chequeo previo de fecha pasada, `bloqueoId` con `randomUUID()`, alta dentro de `conIdempotencia` con sujeto = `sub` del operador, cliente de la ruta y huella `{ cuerpo, ruta: { clienteId } }`), `listarBloqueos` y `obtenerBloqueo` (normalizan los UUID de la ruta).
  - [src/clientes/operaciones.ts](../../src/clientes/operaciones.ts): los manejadores `crearBloqueo` (201, `Location`), `listarBloqueos` y `obtenerBloqueo`.
  - [src/errores.ts](../../src/errores.ts): `BloqueoVencido` (422, `type: /errores/bloqueo-vencido`).
- Por qué así:
  - `creado_en` y la referencia de `hasta` son el mismo `clock_timestamp()`, así que `desde` (= `creadoEn`) nunca queda después de `hasta`, y un bloqueo recién creado siempre es vigente.
  - Los dos rechazos del alta (404 y 422) se deciden con lecturas y un `INSERT` condicional, no con errores de la base: dentro de la transacción de la idempotencia no la abortan, y como la transacción se deshace, tampoco queda la clave reservada.
  - El servicio rechaza un `hasta` ya pasado según su reloj antes de ir a la base. Además de ahorrar la transacción, cubre el año 0000: el formato `date-time` del contrato (Ajv) lo admite y PostgreSQL no (sería un 500). Las demás formas raras que admite el contrato (`+05` sin minutos, segundo 60, separador en minúscula o espacio) PostgreSQL las entiende, así que `hasta` se le pasa como texto y no como `Date` de JS, que no las lee.
  - La huella incluye el cliente de la ruta, y la fila de idempotencia lo guarda: la misma clave del mismo operador para otro cliente crea otro bloqueo (plan, «idempotencias»).
  - Total y página en una sola sentencia: comparten instantánea e instante, y el total coincide con lo paginado aunque entren bloqueos o venzan en medio. El desempate por `bloqueo_id` hace estable el orden entre páginas.
  - `OFFSET` es `min(page * size, MAX_SAFE_INTEGER)`: el contrato no pone máximo a `page`, y un valor enorme desbordaría el bigint (500); cualquier valor por encima del tope ya queda fuera del total y da `items` vacío.
  - `page` y `size` llegan siempre al manejador: el validador (`useDefaults`) pone 0 y 20.
- Cómo se conecta: los tres manejadores quedan sin registrar en [src/operaciones/index.ts](../../src/operaciones/index.ts) (T9). `crearBloqueo` reutiliza `conIdempotencia()` de T3 y `COLUMNAS_BLOQUEO` de T6; la cuenta pasa a BLOQUEADA porque `obtenerEstadoCuenta` lee la misma tabla.
- Tests:
  - [pruebas/unitarias/clientes.test.ts](../../pruebas/unitarias/clientes.test.ts): `aPaginaBloqueos` (forma, seis casos de `totalPaginas`, página fuera del total) y la respuesta de `BloqueoVencido`.
  - [pruebas/integracion/clientes.test.ts](../../pruebas/integracion/clientes.test.ts): `crearBloqueo` (forma del contrato, autor, `desde` = `creadoEn`, `hasta` con desplazamiento horario, `hasta` pasada o igual a ahora sin crear nada, 404 antes que 422, la transacción sigue sirviendo tras un rechazo); `obtenerBloqueo` (otro cliente, inexistente, vencido y levantado con `vigente: false`); `listarBloqueos` (orden con empate, filtros `true` y `false`, tres páginas sin repetir, página fuera del total, `page = 1e23`, sin bloqueos, sin perfil, sin mezclar clientes).
  - [pruebas/http/clientes.test.ts](../../pruebas/http/clientes.test.ts) (sin base): 401; 403 para CLIENTE, SERVICIO y CONDUCTOR; 400 sin `Idempotency-Key`, por cuerpos inválidos, por query inválida y por ids que no son UUID; 422 `bloqueo-vencido` con `hasta` en 2020 y en el año 0000, sin el motivo en la respuesta.
  - [pruebas/integracion/clientes-http.test.ts](../../pruebas/integracion/clientes-http.test.ts): 201 con autor, `desde` y `Location`, y `Location` devuelve lo mismo; la cuenta queda BLOQUEADA; misma clave a la vez y repetida, un solo bloqueo y la misma respuesta; otra huella, 422 `idempotencia-reutilizada`; misma clave para otro cliente, otro bloqueo; 404 sin perfil; historial con página por defecto, orden, filtro, segunda página y página fuera; 404 para un bloqueo de otro cliente; los logs sin motivos, clave ni token.
  - En rojo primero: fallaron 107 (no existían los módulos ni los manejadores). Mutaciones de control: invertir el desempate hace fallar 3; quitar la condición de `hasta` del `INSERT` hace fallar 2.
  - `npm test` (2303), lint, build y spec-check en verde.
- Para mirar con atención:
  - El chequeo previo del servicio usa el reloj del contenedor de M2, y el definitivo, el de PostgreSQL. Con relojes desfasados, un `hasta` que cae entre los dos puede dar 422 en el servicio cuando la base lo habría aceptado. En el compose comparten el reloj del host.
  - Los manejadores no escriben logs: ni el motivo ni el `sub` del operador salen en ellos (RNF-19). El `Location` lleva solo ids.
  - `obtenerBloqueo` no comprueba el perfil aparte: sin perfil no puede haber bloqueos (clave foránea), y el 404 dice «bloqueo».

### T8 — Levantar bloqueos sin borrar historial y proteger la concurrencia · commit `004/T8`
- Qué cambió:
  - [src/clientes/repositorio.ts](../../src/clientes/repositorio.ts): `levantarBloqueo(consultar, clienteId, bloqueoId, motivo, autor)`. Un `UPDATE … WHERE cliente_id = $1 AND bloqueo_id = $2 AND ${BLOQUEO_VIGENTE}` guarda en una sola sentencia `levantado_en = CURRENT_TIMESTAMP`, `levantado_por` y `motivo_levantamiento`, y devuelve la fila con `COLUMNAS_BLOQUEO`. Si no cambió nada, una segunda sentencia lee `levantado_en IS NOT NULL` y decide: sin fila, `NoEncontrado` (404 «No existe el bloqueo pedido»); levantado, `BloqueoYaLevantado`; si no, `BloqueoNoVigente`.
  - [src/errores.ts](../../src/errores.ts): `BloqueoYaLevantado` (409, `type: /errores/bloqueo-ya-levantado`) y `BloqueoNoVigente` (409, `type: /errores/bloqueo-no-vigente`).
  - [src/clientes/modelo.ts](../../src/clientes/modelo.ts): el tipo `LevantamientoBloqueo` del contrato. [src/clientes/servicio.ts](../../src/clientes/servicio.ts): `levantarBloqueo` (normaliza los UUID de la ruta; el autor es el `sub` del operador). [src/clientes/operaciones.ts](../../src/clientes/operaciones.ts): el manejador `levantarBloqueo` (200 con el bloqueo).
- Por qué así:
  - La concurrencia la resuelve PostgreSQL: el segundo `UPDATE` espera el bloqueo de fila del primero y, cuando este confirma, vuelve a evaluar el `WHERE` sobre la fila nueva (READ COMMITTED), que ya no está vigente, y no cambia nada. Un 200 y un 409, y la fila queda con los datos del que ganó (RNF-08). Si el primero se deshace, el segundo levanta.
  - La clasificación va en otra sentencia, y no en la misma con un CTE, a propósito: una sola sentencia lee con la instantánea de antes del otro levantamiento, vería la fila sin levantar y la tomaría por vencida (409 equivocado). Ninguno de los tres estados (inexistente, levantado, vencido) se deshace, así que la segunda lectura no contradice al `UPDATE`.
  - El plan y la spec no se contradicen: ya levantado da `/errores/bloqueo-ya-levantado` y vencido da `/errores/bloqueo-no-vigente`, los dos 409 (spec, Casos límite y Criterios; plan, «Levantamiento»). La descripción del contrato solo nombra el primer caso; el código es el mismo.
  - `levantado_en` es el mismo `CURRENT_TIMESTAMP` contra el que se comprobó la vigencia: el bloqueo estaba vigente en el instante en que quedó levantado. El motivo original, `creado_por`, `hasta` y `creado_en` no se tocan; el `CHECK` de levantamiento completo de T1 sigue valiendo.
  - Sin idempotencia: el contrato no pide `Idempotency-Key` en el PATCH, y repetirlo da 409 sin cambiar nada.
- Cómo se conecta: el manejador queda sin registrar en [src/operaciones/index.ts](../../src/operaciones/index.ts) (T9). Reutiliza `BLOQUEO_VIGENTE` y `COLUMNAS_BLOQUEO` (T6); el historial (T7) y el estado de cuenta (T6) ven el cambio porque leen la misma tabla.
- Tests:
  - [pruebas/integracion/clientes.test.ts](../../pruebas/integracion/clientes.test.ts), bloque `levantarBloqueo`: autor, instante y motivo juntos y el resto intacto; el historial lo conserva entre los no vigentes y la cuenta vuelve a ACTIVO; levantar uno de dos deja BLOQUEADO; ya levantado, 409 y la fila igual; vencido, 409 y sin datos de levantamiento; otro cliente o inexistente, 404; un segundo levantamiento que espera el bloqueo de fila de una transacción abierta (se comprueba en `pg_stat_activity` que espera) y da `BloqueoYaLevantado` al confirmar; diez pares concurrentes, cada uno con un éxito y un `BloqueoYaLevantado`; la transacción sigue sirviendo tras un rechazo.
  - [pruebas/http/clientes.test.ts](../../pruebas/http/clientes.test.ts) (sin base): 401; 403 para CLIENTE, SERVICIO y CONDUCTOR; 400 por cuerpos inválidos y por ids que no son UUID. [pruebas/integracion/clientes-http.test.ts](../../pruebas/integracion/clientes-http.test.ts): 200 con el `sub` como `levantadoPor`, historial y cuenta; 409 `bloqueo-ya-levantado` con el cuerpo completo y sin cambiar el bloqueo; 409 `bloqueo-no-vigente`; dos PATCH a la vez, un 200 y un 409; 404 problem+json; logs sin motivos ni token.
  - [pruebas/unitarias/clientes.test.ts](../../pruebas/unitarias/clientes.test.ts): la respuesta de los dos errores nuevos. Estas dos se escribieron después del código (lo cubrían ya las HTTP).
  - En rojo primero: fallaron 107 (no existían `levantarBloqueo` ni su manejador). Mutación de control: quitar la condición de vigencia del `UPDATE` hace fallar 8. Las 24 de levantamiento pasaron cinco veces seguidas.
  - `npm test` (2329), lint, build y spec-check en verde.
- Para mirar con atención:
  - Dentro de una transacción, `CURRENT_TIMESTAMP` es el inicio de la transacción, no el de la sentencia. Hoy nadie levanta dentro de una; si alguien lo hace en una transacción larga, la vigencia se evalúa contra ese instante.
  - La prueba del bloqueo de fila depende de que el pool tenga al menos tres conexiones (la transacción, el segundo levantamiento y la consulta a `pg_stat_activity`).

### T9 — Registrar las ocho operaciones y completar las pruebas por rol efectivo · commit `004/T9`
- Qué cambió:
  - [src/operaciones/index.ts](../../src/operaciones/index.ts): `manejadores` suma `crearCliente`, `obtenerCliente`, `actualizarCliente`, `obtenerEstadoCuenta`, `listarBloqueos`, `crearBloqueo`, `obtenerBloqueo` y `levantarBloqueo`, de [src/clientes/operaciones.ts](../../src/clientes/operaciones.ts), junto a `verificarSalud`. No hay lógica nueva: las rutas, la validación y los roles siguen saliendo del contrato (ADR 003).
- Por qué así:
  - Con las ocho registradas, el servicio las expone y `npm run contrato:test` las incluye entre las implementadas (T10 lo valida).
  - Las pruebas de roles usan los `manejadores` y el contrato reales del servicio, no un contrato armado: si alguien cambia el `security` del contrato o quita un manejador, fallan.
- Cómo se conecta: arranque ([src/arranque.ts](../../src/arranque.ts)) y `contrato-test.mjs` leen `manejadores` de este archivo, así que no hubo que tocarlos. El registro de operaciones al arrancar ahora lista las ocho como implementadas.
- Tests:
  - [pruebas/http/roles-clientes.test.ts](../../pruebas/http/roles-clientes.test.ts) (archivo nuevo, que la tabla del plan nombra desde el #47; sin base, con `POOL_FALSO`: pasar la autorización llega a la base y da 500, un rechazo nunca la toca): los ocho `operationId` están registrados y el contrato declara los roles de la matriz; por cada operación, 401 en problem+json sin token y con firma ajena, y siete combinaciones de roles sobre el recurso propio (CLIENTE, OPERADOR, SERVICIO, CONDUCTOR, CLIENTE+OPERADOR, CLIENTE+CONDUCTOR, CLIENTE+SERVICIO) con llega a la base o 403 en problem+json; sobre el recurso de otro: solo CLIENTE y CLIENTE+CONDUCTOR reciben 403 en las tres operaciones con propiedad, CLIENTE+OPERADOR lee perfil y cuenta pero no actualiza, OPERADOR y SERVICIO llegan donde el contrato los admite, y SERVICIO recibe 403 en las otras siete.
  - [pruebas/integracion/arranque.test.ts](../../pruebas/integracion/arranque.test.ts): con el contrato del repositorio, el log de operaciones lista como implementadas las ocho y `verificarSalud`. La prueba de pendientes usaba `obtenerCliente` como ejemplo de operación sin manejador; ahora usa `listarDirecciones` (de la spec 005).
  - [pruebas/integracion/salud.test.ts](../../pruebas/integracion/salud.test.ts): la prueba que fijaba `Object.keys(manejadores)` en `['verificarSalud']` ahora fija los nueve.
  - En rojo primero: fallaron 86 (ninguna de las ocho estaba registrada, así que las rutas daban 404). Al registrar, solo quedó la prueba de pendientes de `arranque`, que se corrigió como se explica arriba.
  - `npm test` (2414), lint, build y spec-check en verde.
- Para mirar con atención:
  - La matriz de roles está escrita a mano en la prueba y se compara con el contrato: es doble llave a propósito. Si el contrato cambia un rol, hay que cambiar las dos y entender por qué.
  - El 500 de «llega a la base» es del pool falso, no un comportamiento del servicio. Los resultados reales con base de cada operación están en `clientes-http.test.ts`.

### T10 — Validar contrato, regresión y documentación de la spec · commit `004/T10`
- Qué cambió: `npm run contrato:test` corrió Schemathesis sobre las nueve operaciones (las ocho y `/health`). La primera corrida encontró dos 500 reales, que se arreglaron, y dos 422 acordados que el chequeo `positive_data_acceptance` toma por rechazos indebidos.
  - [src/clientes/servicio.ts](../../src/clientes/servicio.ts): `instanteUtc(texto)` pasa un date-time del contrato a milisegundos UTC, con las mismas formas que admite Ajv. `crearBloqueo` lo usa para el chequeo previo y le manda la base en UTC. Si `hasta` cae después del año 9999 en UTC, `NoProcesable` (422, `about:blank`).
  - [src/bd/pool.ts](../../src/bd/pool.ts): `clasificarError` convierte 22021 y 22P05 (el carácter nulo en un texto o un jsonb) en `SolicitudInvalida` (400).
  - [src/errores.ts](../../src/errores.ts): `NoProcesable`, el 422 genérico. [src/clientes/repositorio.ts](../../src/clientes/repositorio.ts): solo el comentario de `crearBloqueo`.
  - [schemathesis.toml](../../schemathesis.toml) (nuevo) y [scripts/contrato-test.mjs](../../scripts/contrato-test.mjs), que lo monta en el contenedor y se lo pasa con `--config-file`.
- Por qué así:
  - **500 por desplazamiento horario.** `hasta: 9389-01-20T16:00:33+16:42` cumple el contrato (Ajv admite hasta ±23:59), pero PostgreSQL solo entiende hasta ±15:59 (22009, un 500). La decisión de T7 de pasar el texto tal cual queda reemplazada: el servicio calcula el instante, y así el chequeo previo y la base usan el mismo valor. No se usa `Date.parse`, que no lee el separador en minúscula ni el segundo 60.
  - **Año 10000.** Con un desplazamiento negativo, el último día de 9999 cae en 10000 UTC, y la respuesta no se podría escribir con el año de cuatro cifras que pide el formato. 422 y no 400, porque es una regla que el esquema no expresa, y `crearBloqueo` declara 422 («la regla de negocio no se cumple»).
  - **500 por el carácter nulo.** PostgreSQL no guarda U+0000 en un texto, y el contrato lo admite en `nombre`, `apellido` y `motivo`. Se ataja en `clasificarError` y no campo por campo: sirve para cualquier texto, también para los de las specs siguientes, y la transacción se deshace igual.
  - **Ajuste de Schemathesis (Lautaro lo eligió el 2026-10-23 entre: ajuste acotado, dejarlo fallando o llevarlo al grupo).** `positive_data_acceptance` acepta además el 422 solo en `crearCliente` y `crearBloqueo`, que lo declaran en el contrato: Idempotency-Key reutilizada con otro cuerpo, `hasta` pasada y año 10000. `generation.allow-x00 = false` deja de generar el carácter nulo, como recomienda la documentación de Schemathesis para bases que no lo guardan; el manejo del nulo lo prueban nuestras pruebas. Ningún otro chequeo cambia. Descartado: sumar 400 a los aceptados, que dejaría de detectar rechazos indebidos por validación.
- Cómo se conecta: `contrato-test.mjs` (spec 003) sigue igual en lo demás. El archivo vive en la raíz y no en `contrato/`, que solo se toca desde una rama `contrato/`.
- Tests:
  - [pruebas/unitarias/clientes.test.ts](../../pruebas/unitarias/clientes.test.ts): `instanteUtc` con `Z`, `+05:30`, `+0530`, `+05`, `t`/`z` en minúscula, espacio, fracción larga y corta, ±16:42 y −23:59, segundo 60, año 0099 y año 0000, y el borde del año 10000.
  - [pruebas/unitarias/bd.test.ts](../../pruebas/unitarias/bd.test.ts): 22021 y 22P05 dan `SolicitudInvalida`.
  - [pruebas/http/clientes.test.ts](../../pruebas/http/clientes.test.ts): año 10000 en UTC, 422 sin tocar la base. [pruebas/integracion/clientes-http.test.ts](../../pruebas/integracion/clientes-http.test.ts): cuatro `hasta` de borde dan 201 con el instante en UTC; un texto con el nulo da 400 en las cuatro operaciones que escriben, sin guardar nada.
  - [pruebas/unitarias/contrato-test.test.ts](../../pruebas/unitarias/contrato-test.test.ts): `schemathesis.toml` solo tiene `allow-x00 = false` y dos bloques de operación, cada uno con los valores por defecto más 422, y el contrato declara 422 en las dos operaciones.
  - En rojo primero: 15 por la fecha, 4 por el nulo y el 422, y la del `schemathesis.toml`, que todavía no existía.
  - `npm run contrato:test`: dos corridas con 4115 y 4021 casos, todos bien, en las cuatro fases. `npm test` (2436), lint, build, `spec-check` y el lint del contrato (3 avisos, ningún error; el contrato no cambió) en verde. Los ejemplos de la visión general se corrieron contra el compose.
- Para mirar con atención:
  - Schemathesis avisa «Schema validation mismatch» en `crearBloqueo` (y a veces en `crearCliente`): la mayoría de las fechas que genera ya pasaron, o repite la clave. Es un aviso, no una falla, y se explica por la regla de `hasta` futura que el esquema no puede expresar.
  - Un texto con sustitutos UTF-16 sueltos (`\ud8ef`) no falla: Node lo guarda como U+FFFD. Cambia el dato sin avisar; el contrato no dice nada al respecto.
  - La fracción de `hasta` se corta al milisegundo, la precisión con la que se responde.
  - La tabla «Estructura» del plan nombra `src/bd/idempotencia.ts`, `pruebas/integracion/clientes-http.test.ts`, `pruebas/http/roles-clientes.test.ts` y `schemathesis.toml` desde el #47, y `src/bd/pool.ts` y `scripts/contrato-test.mjs` desde el #49.

### T11 — Idempotencia de `crearBloqueo` antes que el vencimiento de `hasta`, y tipo propio para el año 9999 · commit `004/T11`
- Qué cambió:
  - [src/clientes/servicio.ts](../../src/clientes/servicio.ts), `crearBloqueo`: ya no compara `hasta` con `Date.now()`. Antes de `conIdempotencia()` solo rechaza un `hasta` posterior al año 9999 en UTC, con `BloqueoHastaFueraDeRango`. Uno anterior al año 0001 (`PRIMER_INSTANTE`) va a la base como `-infinity`.
  - [src/errores.ts](../../src/errores.ts): `BloqueoHastaFueraDeRango` (422, `/errores/bloqueo-hasta-fuera-de-rango`) reemplaza a `NoProcesable`, que era un 422 con `about:blank` y no tenía otro uso.
  - [src/clientes/repositorio.ts](../../src/clientes/repositorio.ts): solo el comentario de `crearBloqueo`. Su `INSERT` condicional ya era la comparación definitiva, y ahora es la única.
- Por qué así: lo pidió el cambio de spec (#47), que salió de la primera validación. El chequeo previo con el reloj del servicio corría antes de la idempotencia. Una repetición con la misma clave y el mismo cuerpo, después de vencido `hasta`, respondía 422 en lugar del 201 guardado (RF-2.6.1.3, RNF-08), y un cliente sin perfil, 422 en lugar de 404. Ahora el orden es: año 9999 → idempotencia → perfil (404) → `INSERT` (422 `bloqueo-vencido`), como en plan.md, «Crear bloqueo: orden de las reglas». El año 9999 sí va antes porque no depende del momento: ninguna repetición pudo haber dado 201.
- Cómo se conecta: el 422 `bloqueo-vencido` sale ahora dentro del alta de `conIdempotencia()`; el error deshace la transacción y, con ella, la reserva de la clave, así que la misma clave sirve después con otro cuerpo. `schemathesis.toml` no cambia: el 422 sigue declarado en `crearBloqueo`.
- Tests:
  - [pruebas/unitarias/clientes.test.ts](../../pruebas/unitarias/clientes.test.ts): la forma de `BloqueoHastaFueraDeRango`.
  - [pruebas/http/clientes.test.ts](../../pruebas/http/clientes.test.ts) (sin base): dos `hasta` después del año 9999 en UTC dan 422 con el tipo propio y sin el motivo. Salieron de acá los casos de 2020 y año `0000`: ya no se rechazan sin ir a la base.
  - [pruebas/integracion/clientes-http.test.ts](../../pruebas/integracion/clientes-http.test.ts), bloque «el orden de las reglas»:
    - un alta con `hasta` a 1,5 s, repetida con la misma clave cuando ya venció, devuelve el mismo 201 y `Location`, y con otro cuerpo da 422 `idempotencia-reutilizada`, con un solo bloqueo;
    - un cliente sin perfil con `hasta` en 2020 o en el año `0000` (también con desplazamiento `+23:59`) da 404;
    - con perfil, esas fechas dan 422 `bloqueo-vencido`, no crean nada y dejan la clave libre;
    - el año 9999 da 422 `bloqueo-hasta-fuera-de-rango`, con perfil o sin él, sin crear nada.
  - En rojo primero: fallaron 8 (el 201 repetido, los tres 404, los tres `type` propios y el constructor nuevo).
  - `npm test` (2444), lint, build y `contrato:test` (9 operaciones, 3580 casos) en verde.
- Para mirar con atención:
  - Queda sin efecto el aviso de T7 sobre relojes desfasados entre el contenedor de M2 y PostgreSQL: el servicio ya no mira su reloj para `hasta`.
  - La prueba de la repetición espera unos 1,7 s reales, porque el vencimiento lo decide el reloj de la base y no se puede simular desde la prueba.
  - `-infinity` no llega nunca a una respuesta: el `INSERT` no inserta y sale el 422.

### Validación — spec 004 contra la implementación · commit `004/V: validación`
- Qué se comprobó (2026-10-23, `/sdd-validate`): cada requisito de spec.md tiene prueba automática en verde (`npm test`, 2444 pruebas en 28 archivos) y las ocho operaciones pasan `npm run contrato:test` (9 operaciones con `/health`, 5281 casos, todas las fases). Lint, build y `spec-check` en verde.
- Evidencia en vivo contra el compose (localhost:8082): los 16 requisitos funcionales y los casos límite de perfil y bloqueos con curl, también el que falló en la validación anterior: un alta de bloqueo con `hasta` a 3 s, repetida con la misma clave 4 s después, devuelve el mismo 201 con el mismo cuerpo y `Location`; con otro cuerpo, 422 `idempotencia-reutilizada`. Los logs de esa corrida no tienen nombres, teléfonos, motivos, claves ni tokens (RNF-19).
- Qué cambió: «Estado: implementada» en spec.md, y el mapa y las decisiones de esta guía con T11.
- Para mirar con atención:
  - La repetición de un alta devuelve la respuesta guardada tal cual, así que un bloqueo ya vencido vuelve con `vigente: true`, el valor del momento del alta (RF-2.6.1.3). El estado actual se consulta con `obtenerBloqueo`.
  - Schemathesis avisa que `crearBloqueo` rechaza la mayoría de los datos generados: son los `hasta` pasados (422 `bloqueo-vencido`), aceptados en `schemathesis.toml` (T10).
  - Sugerencia sin hacer: `rolesDe` (`src/clientes/operaciones.ts`) devuelve `[]` si a la ruta le faltan los permisos, y entonces no exige la propiedad. Hoy no pasa: una ruta sin permisos no se registra (`registrarPermisos`), y `roles-clientes.test.ts` comprueba que el contrato declara los roles de las ocho operaciones.
- Después: la revisión independiente del PR #48 encontró que una `fechaNacimiento` del año `0000` daba 500 con la fecha en el log. Esta validación queda sin efecto: el cambio de spec del #49 sumó RF-2.1.4 y T12, y la spec volvió a «aprobada» hasta validarla otra vez.

### T12 — Fecha de nacimiento del año `0000` y logs sin el valor de un error de datos de la base · commit `004/T12`
- Qué cambió:
  - [src/clientes/servicio.ts](../../src/clientes/servicio.ts), `exigirFechaGuardable`: una `fechaNacimiento` que empieza con `0000` da `SolicitudInvalida` (400, `about:blank`, sin la fecha en el `detail`). `crearCliente` la llama después de `clienteDelToken` y antes de `conIdempotencia()`; `actualizarCliente`, antes de `exigirPropietario`.
  - [src/logs.ts](../../src/logs.ts), `serializar`: si el `code` es un texto que empieza con `22` (data_exception), `mensaje` es «Error de datos de la base: mensaje omitido» y `traza` es solo la pila desde la primera línea `at …` (`soloLaPila`); sin ninguna, no hay `traza`. El código, el tipo y la causa se guardan como siempre, y la causa pasa por la misma regla.
- Por qué así: el formato `date` de Ajv admite el año `0000` y PostgreSQL lo rechaza con 22008, que `clasificarError` no conoce: era un 500, y el mensaje de pg (`date/time field value out of range: "0000-01-01"`) quedaba en `err.mensaje` y `err.traza` (RF-2.1.4, RNF-19). Se rechaza en el servicio y no traduciendo el 22008, que también puede venir de un error del propio servicio; y el serializador cubre toda la clase 22, no una lista de códigos (plan, «Valores que la base no puede guardar» y Decisiones).
- Cómo se conecta: `exigirFechaGuardable` va donde terminan las validaciones del contrato y empiezan las del servicio, así que en el PATCH un CLIENTE sobre otro perfil también recibe el 400 y no el 403. El serializador es el de `registrarErrorInterno` (spec 003): todo 500 registrado pasa por él.
- Tests:
  - [pruebas/http/clientes.test.ts](../../pruebas/http/clientes.test.ts) (sin base, con `POOL_FALSO`): el año `0000` (también el 29 de febrero) da 400 con el cuerpo exacto al crear y al actualizar, solo o con otros campos, y también sobre otro perfil.
  - [pruebas/integracion/clientes-http.test.ts](../../pruebas/integracion/clientes-http.test.ts): con base, el PATCH del año `0000` no cambia nada, ni los otros campos enviados; el alta no crea el perfil y deja libre la clave; `0001-01-01` y `9999-12-31` se guardan y vuelven iguales. Bloque «un error de datos de la base que nadie previó»: el error real de pg de `SELECT $1::date` con `0000-01-01`, por el serializador y por HTTP (un manejador de prueba que lo provoca): 500, y el log tiene el `22008` y no la fecha.
  - [pruebas/unitarias/secretos.test.ts](../../pruebas/unitarias/secretos.test.ts): 22008, 22P02 y 22001 con el valor en el mensaje; mensaje de varias líneas; sin pila; como causa de otro error; códigos que no son de la clase 22 (23505, numérico, `0822`) y el error 23502 de siempre quedan igual.
  - En rojo primero: 16 de 21. Ya pasaban, y quedan como regresión, la de `0001`/`9999` y las 4 unitarias de los errores que no son de la clase 22.
  - `npm test` (2465), lint, build y `contrato:test` (9 operaciones; 2172 casos en esa corrida, la cantidad varía en cada una) en verde. Contra el compose, el POST con `0000-01-01` da 400 y la fecha no aparece en los logs.
- Para mirar con atención:
  - La regla es del año, no de la fecha: `0000-02-29` también es 400 aunque el formato lo admita como bisiesto.
  - Un 500 por un error de la clase 22 ahora se diagnostica por el código, la pila y el id de correlación, sin el texto de pg. Es lo que se eligió en el plan.
  - Queda pendiente avisar al Grupo 1 para que el contrato excluya el año `0000` y el carácter nulo.

### Validación con T12 — spec 004 contra la implementación · commit `004/V: validación`
- Qué se comprobó (2026-10-23, `/sdd-validate`, 3.ª vez): cada requisito de spec.md, también RF-2.1.4 y RNF-19 ampliado, tiene prueba automática en verde (`npm test`, 2465 pruebas en 28 archivos), y las ocho operaciones pasan `npm run contrato:test` (9 operaciones con `/health`, 3491 casos, todas las fases). Lint, build y `spec-check` en verde. Revisión independiente (`reviewer`) del cambio desde la validación anterior: aprobada.
- Evidencia en vivo contra el compose rehecho (localhost:8082), con curl, de todos los requisitos funcionales. Las de T12: `POST` con `fechaNacimiento` `0000-01-01`, 400, y el perfil no se crea (la misma clave crea después el bueno); `PATCH` con `0000-06-30`, 400 sin cambiar nada; un CLIENTE sobre otro perfil con el año `0000`, 400 y no 403; `0001-01-01` y `9999-12-31` se guardan y vuelven iguales. Los logs de esa corrida no tienen nombres, teléfonos, motivos, claves, tokens ni las fechas enviadas (RNF-19).
- Qué cambió: «Estado: implementada» en spec.md; el mapa y las decisiones de la Visión general, con T12; en la entrada T12, la cuenta de pruebas en rojo y la cantidad de casos de Schemathesis.
- Para mirar con atención (de la revisión; ninguno bloquea):
  - `soloLaPila` corta la traza en la primera línea `    at …`. Un mensaje de la clase 22 que citara un valor con un salto de línea seguido de `    at` dejaría el resto en la traza. Hoy no se llega con datos de la solicitud: las conversiones de tipo (fechas, uuid, enteros) no admiten saltos de línea, y el texto con el carácter nulo da 22021, que no cita el valor.
  - Un `sub` de OPERADOR de más de unos 2 KB podría dar 500 en `crearBloqueo` (54000: no entra en el índice único de `idempotencias`), sin datos en el log. No se reprodujo. El `sub` lo firma M1 y el contrato no lo acota; cubrirlo sería un `/sdd-change`.
  - `tasks.md` y el plan dicen `SELECT '0000-01-01'::date`; la prueba usa `SELECT $1::date` con el valor como parámetro, que da el mismo 22008 y se parece más al camino real.
