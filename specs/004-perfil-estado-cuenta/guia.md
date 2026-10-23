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
