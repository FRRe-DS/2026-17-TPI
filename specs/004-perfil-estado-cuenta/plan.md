# Plan 004 — Perfil y estado de cuenta

Spec: [spec.md](spec.md) · Issue: #4 · Contrato: `contrato/openapi.yml`

## Resumen
Se agregan persistencia y manejadores para el perfil y los bloqueos. El estado de cuenta se obtiene en una consulta consistente, sin guardar un estado duplicado. Los POST comparten un mecanismo transaccional de idempotencia y las reglas de propiedad se verifican además de los roles ya declarados por el contrato.

## Estructura

| Archivo | Responsabilidad | Requisitos |
|---|---|---|
| `migraciones/<marca>_perfil_bloqueos.sql` | Tablas, índices, restricciones e idempotencia | RF-2.1, RF-2.6.1, RNF-05, RNF-08 |
| `src/bd/transaccion.ts` | Transacciones con tiempo máximo y clasificación de errores | RNF-08 |
| `src/bd/idempotencia.ts` | `conIdempotencia()`: idempotencia transaccional reutilizable (también la usa la spec 005) | RF-2.1, RF-2.6.1, RF-2.6.1.3, RNF-08 |
| `src/clientes/modelo.ts` | Tipos de dominio y transformaciones de filas | RF-2.1, RF-2.6 |
| `src/clientes/repositorio.ts` | Consultas y transacciones de perfiles/bloqueos | RF-2.1, RF-2.1.1, RF-2.1.1.1, RF-2.1.2, RF-2.1.2.1, RF-2.1.3, RF-2.1.3.1, RF-2.6 a RF-2.6.4 |
| `src/clientes/servicio.ts` | Rol efectivo, propiedad, vigencia, idempotencia, fecha de nacimiento guardable y reglas de negocio | RF-2.1, RF-2.1.1, RF-2.1.1.1, RF-2.1.2, RF-2.1.2.1, RF-2.1.3, RF-2.1.3.1, RF-2.1.4, RF-2.6 a RF-2.6.4 (con RF-2.6.1.1 a RF-2.6.1.3), RNF-08 |
| `src/clientes/operaciones.ts` | Manejadores HTTP de los ocho `operationId` | RNF-03 |
| `src/operaciones/index.ts` | Registra los nuevos manejadores | RNF-03 |
| `src/errores.ts` | Errores de dominio acordados | RF-2.1.3, RF-2.6.1.1, RF-2.6.1.2, RF-2.6.3 |
| `src/bd/pool.ts` | `clasificarError`: además, el carácter nulo (22021, 22P05) da 400 | RNF-03 |
| `src/logs.ts` | El serializador de errores no copia el mensaje de un error de datos de la base (SQLSTATE `22…`) | RNF-19 |
| `pruebas/unitarias/clientes.test.ts` | Vigencia, propiedad, paginación y mapeo | RF-2.1.1, RF-2.6, RF-2.6.2, RF-2.6.4 |
| `pruebas/integracion/clientes.test.ts` | Persistencia, transacciones y concurrencia | RNF-05, RNF-08 |
| `pruebas/http/clientes.test.ts` | Operaciones, roles, códigos y cuerpos, sin base | RF-2.1 a RF-2.6.4, RNF-03 |
| `pruebas/integracion/clientes-http.test.ts` | Las operaciones por HTTP con PostgreSQL real | RF-2.1 a RF-2.6.4, RNF-03, RNF-08, RNF-19 |
| `pruebas/http/roles-clientes.test.ts` | Matriz de roles efectivos de las ocho operaciones | RF-2.1.1.1, RF-2.1.2.1, RF-2.6, RNF-03 |
| `pruebas/unitarias/secretos.test.ts` | El serializador sin el valor de un error de datos de la base | RNF-19 |
| `schemathesis.toml`, `scripts/contrato-test.mjs` | Ajuste acotado de la prueba de contrato (422 solo donde el contrato lo declara; sin el carácter nulo), montado por el script | RNF-07 |
| `specs/004-perfil-estado-cuenta/guia.md` | Mapa y uso de la funcionalidad | RNF-20 |

## Contrato
- Se implementan `crearCliente`, `obtenerCliente`, `actualizarCliente`, `obtenerEstadoCuenta`, `listarBloqueos`, `crearBloqueo`, `obtenerBloqueo` y `levantarBloqueo`.
- `src/operaciones/index.ts` solo asocia cada `operationId` con su manejador. Las rutas, validaciones y autorizaciones por rol siguen saliendo del OpenAPI, según ADR 003.
- Se calcula `rolesEfectivos = rolesDelToken ∩ rolesDeLaOperacion`; `sub = clienteId` se exige únicamente si ese conjunto es `[CLIENTE]`. OPERADOR puede leer perfiles y administrar bloqueos. SERVICIO solo llega a `obtenerEstadoCuenta` porque las demás rutas no admiten ese rol.
- Los errores genéricos conservan `about:blank`. Los errores de dominio usan `/errores/perfil-ya-existe`, `/errores/idempotencia-reutilizada`, `/errores/bloqueo-ya-levantado`, `/errores/bloqueo-vencido`, `/errores/bloqueo-hasta-fuera-de-rango` y `/errores/bloqueo-no-vigente`, sin cambiar los códigos declarados por el contrato.

## Datos

### `clientes`
- `cliente_id uuid PRIMARY KEY`.
- `nombre varchar(100) NOT NULL`, `apellido varchar(100) NOT NULL`.
- `telefono varchar(16) NOT NULL` con `CHECK` equivalente al formato E.164 del contrato.
- `fecha_nacimiento date NULL`.
- `creado_en timestamptz NOT NULL DEFAULT clock_timestamp()`.
- `actualizado_en timestamptz NOT NULL DEFAULT clock_timestamp()`; lo cambia explícitamente cada actualización.

No se guarda `estado`: se calcula con `EXISTS` sobre bloqueos vigentes. La clave primaria garantiza un perfil por `sub` (RF-2.1.3, RNF-08.1).

### `bloqueos_cliente`
- `bloqueo_id uuid PRIMARY KEY`, generado por M2.
- `cliente_id uuid NOT NULL REFERENCES clientes(cliente_id)`.
- `motivo varchar(500) NOT NULL` y no vacío.
- `hasta timestamptz NULL`. Que sea posterior al instante de creación lo comprueba el mismo `INSERT`, condicionado a `hasta > clock_timestamp()` (el valor de `creado_en`), y no el reloj del servicio (RF-2.6.1.1).
- `creado_en timestamptz NOT NULL DEFAULT clock_timestamp()`, `creado_por text NOT NULL`.
- El campo `desde` que expone el contrato se mapea a `creado_en`; no se persiste otra marca temporal.
- `levantado_en timestamptz NULL`, `levantado_por text NULL`, `motivo_levantamiento varchar(500) NULL`.
- `CHECK` exige los tres datos de levantamiento juntos o los tres ausentes.
- Índices `(cliente_id, creado_en DESC, bloqueo_id DESC)` y parcial por `cliente_id` para filas sin levantar; la condición temporal `hasta > now()` se evalúa en la consulta porque no es inmutable para un índice parcial.

### `idempotencias`
- `operacion text`, `sujeto text`, `cliente_id uuid NULL`, `clave varchar(255)`, `hash_solicitud text`, `estado smallint`, `ubicacion text`, `respuesta jsonb`, `creado_en timestamptz`.
- `UNIQUE NULLS NOT DISTINCT (operacion, sujeto, cliente_id, clave)` y `CHECK (operacion <> 'crearBloqueo' OR cliente_id IS NOT NULL)`. No es una clave primaria: PostgreSQL fuerza `NOT NULL` en sus columnas, y `crearCliente`, que no lleva `clienteId` en la ruta, guarda su clave con `cliente_id` nulo. Con `NULLS NOT DISTINCT`, dos altas de `crearCliente` con el mismo sujeto y clave chocan (23505) igual que las demás; el `CHECK` exige el cliente de la ruta a `crearBloqueo`. El hash incluye cuerpo y parámetros de ruta. Así un operador puede reutilizar una clave para otro cliente sin devolver la respuesta del primero.
- Alta del registro de idempotencia y efecto de negocio ocurren en la misma transacción. Ante conflicto, se bloquea la fila: misma huella devuelve estado, `Location` y cuerpo guardados; otra huella produce 422.

La migración incluye `Down Migration` en el orden inverso. No toca tablas de otras specs. Se crea con `npx node-pg-migrate create perfil-bloqueos --migration-file-language sql --migrations-dir migraciones`.

## Lógica

### Propiedad
`exigirPropietario(identidad, clienteId, rolesOperacion)` calcula `rolesEfectivos`. Compara el UUID normalizado con `identidad.sub` solo cuando el conjunto es exactamente `[CLIENTE]`. El OPERADOR y SERVICIO no usan esta regla fuera de las operaciones que el contrato les habilita.

### Transacciones
`transaccion(pool, fn)` abre un cliente del pool, ejecuta `BEGIN`, entrega una función de consulta y termina con `COMMIT` o `ROLLBACK`. Cada sentencia aplica el mismo tope de 2 s de `consultar()` y usa la misma clasificación: `23505` da 409, indisponibilidad da 503 y los demás errores siguen a 500. Es la base reutilizable de la idempotencia de esta spec y de la #5.

### Estado y vigencia
Una consulta a la base usa un único instante de PostgreSQL:

```text
vigente = levantado_en IS NULL AND (hasta IS NULL OR hasta > CURRENT_TIMESTAMP)
estado = existe(vigente) ? BLOQUEADO : ACTIVO
```

`obtenerEstadoCuenta` trae el perfil y sus bloqueos vigentes dentro de una sola consulta/transacción de lectura para que `estado` y `bloqueosVigentes` no se contradigan.

### Crear perfil o bloqueo con idempotencia
1. Canonicalizar cuerpo y parámetros de ruta ya validados y calcular SHA-256.
2. Abrir `transaccion()` y reservar `(operacion, sujeto, clienteId, clave)`.
3. Si existe con otro hash, abortar con 422; si existe con el mismo hash, devolver la respuesta guardada.
4. Ejecutar el alta, guardar la respuesta y confirmar.
5. La restricción única sigue protegiendo el perfil cuando distintas claves compiten por el mismo `clienteId`.

### Crear bloqueo: orden de las reglas (RF-2.6.1.1 a RF-2.6.1.3)
1. El contrato valida la solicitud (400).
2. El servicio pasa `hasta` a UTC (`instanteUtc`). Si cae después del año 9999, `BloqueoHastaFueraDeRango` (422, `/errores/bloqueo-hasta-fuera-de-rango`) sin ir a la base: no depende del momento, así que ninguna repetición pudo haber dado 201. Si cae antes del año 0001, va a la base como `-infinity`, que PostgreSQL acepta en `timestamptz` y es anterior a cualquier instante. No hay ninguna comparación con `Date.now()`.
3. `conIdempotencia()`: la misma clave, cliente y cuerpo devuelven la respuesta guardada, aunque `hasta` ya haya pasado (RF-2.6.1.3); otro cuerpo, 422 `idempotencia-reutilizada`.
4. Dentro del alta, el repositorio comprueba el perfil (404) y después hace el `INSERT` condicional. Si no inserta, `BloqueoVencido` (422); el error deshace la transacción, y con ella la reserva de la clave.

```text
crearBloqueo(hasta):
  si hasta > 9999-12-31T23:59:59.999Z (UTC) → 422 bloqueo-hasta-fuera-de-rango
  enBase = hasta < 0001-01-01T00:00:00Z ? '-infinity' : ISO UTC de hasta
  conIdempotencia(clave, cliente, cuerpo):
    exigirPerfil → 404
    INSERT … WHERE hasta IS NULL OR hasta > clock_timestamp() → sin fila: 422 bloqueo-vencido
```

### Valores que la base no puede guardar (RF-2.1.4, RNF-19)
- `fechaNacimiento` del año `0000`: Ajv la acepta como `date` y PostgreSQL la rechaza (22008, que hoy sale como 500). `crearCliente` y `actualizarCliente` del servicio la rechazan con `SolicitudInvalida` (400, `about:blank`) antes de todo lo demás: en `crearCliente`, después de leer el `clienteId` del token y antes de `conIdempotencia()`; en `actualizarCliente`, antes de `exigirPropietario`. Así ocupa el lugar de una validación más del contrato y no consulta la base. Basta mirar los cuatro primeros caracteres: el formato `date` ya garantiza `AAAA-MM-DD`, y de `0001` a `9999` PostgreSQL acepta todos los años.
- Carácter nulo: `clasificarError` traduce 22021 y 22P05 a `SolicitudInvalida` (T10). El texto sí llega a la base, pero la sentencia falla, y la transacción y la reserva de idempotencia se deshacen.
- Defensa en los logs: `serializar()` de `src/logs.ts`, ante un error cuyo `code` empieza con `22` (data_exception), guarda en `mensaje` un texto fijo («Error de datos de la base: mensaje omitido») y quita de `traza` su primera línea, que repite el mensaje; conserva `tipo`, `codigo` y el resto de la traza. Los mensajes de esa clase citan el valor rechazado (`date/time field value out of range: "…"`), así que un error de datos que nadie previó tampoco deja la solicitud en el log. Las demás clases no cambian: ya se omiten `detail` y `where`, que son los que traen datos de la fila.

### Levantar bloqueo
Un `UPDATE ... WHERE cliente_id = $1 AND bloqueo_id = $2 AND levantado_en IS NULL AND (hasta IS NULL OR hasta > CURRENT_TIMESTAMP)` guarda los tres datos de levantamiento. Si no cambia filas, una lectura distingue 404, 409 por ya levantado y 409 por vencido. La operación no borra ni altera el motivo original.

### Paginación
Se limita con `LIMIT size OFFSET page * size`; el total se cuenta con el mismo filtro y la misma transacción. Orden: `creado_en DESC, bloqueo_id DESC`.

## Pruebas
- Unitarias: propiedad del CLIENTE; vigencia sin fin, futura, vencida y levantada; estado con varios bloqueos; orden/paginación y conversión exacta a los esquemas del contrato.
- HTTP: las ocho operaciones; 201/200/404/409/422; `Location`; PATCH parcial; filtro `vigente`; tokens CLIENTE+OPERADOR; SERVICIO rechazado fuera de estado de cuenta; respuestas problem+json.
- Integración: migración up/down; transacciones; perfil único bajo concurrencia; idempotencia igual/diferente, concurrente y entre dos clientes; bloqueo con `hasta` pasada; actualización sin perder campos; historial conservado; levantamiento concurrente o vencido; estado y lista de vigentes consistentes.
- Contrato: las ocho operaciones dejan de figurar pendientes y Schemathesis las prueba contra el servicio levantado.
- Orden de las reglas de `crearBloqueo`: alta con `hasta` cercana, repetida con la misma clave cuando ya venció, devuelve el mismo 201 y no crea otro bloqueo; con otro cuerpo, 422 `idempotencia-reutilizada`; cliente sin perfil con `hasta` pasada (también del año `0000`), 404; año `0000` con perfil, 422 `bloqueo-vencido`; después del año 9999, 422 `bloqueo-hasta-fuera-de-rango`.
- Valores que la base no puede guardar: sin base (`POOL_FALSO`), `crearCliente` y `actualizarCliente` con `fechaNacimiento` del año `0000` dan 400 problem+json (si tocaran la base darían 500), también un CLIENTE sobre otro perfil en el PATCH; con base, el perfil no cambia y `0001-01-01` y `9999-12-31` se guardan y vuelven iguales. Unitaria: `serializarError` de un error con `code` 22008 y el valor en el mensaje no contiene el valor ni en `mensaje` ni en `traza`, y conserva `codigo`; uno de otra clase queda como antes. Integración: el error real de pg de `SELECT '0000-01-01'::date`, pasado por el serializador, no contiene `0000-01-01`.
- Al registrar los nuevos manejadores, se actualiza `pruebas/integracion/arranque.test.ts`, que inicialmente espera que la única operación implementada sea `verificarSalud`.

## Trazabilidad

| Requisito | Cobertura |
|---|---|
| RF-2.1, RF-2.1.1, RF-2.1.1.1, RF-2.1.2, RF-2.1.2.1, RF-2.1.3, RF-2.1.3.1 | Tabla `clientes`, servicio, manejadores y pruebas HTTP/integración |
| RF-2.1.4 | «Valores que la base no puede guardar»: rechazo en el servicio antes de la idempotencia y de la propiedad; pruebas HTTP sin y con base |
| RF-2.6, RF-2.6.1, RF-2.6.2, RF-2.6.3, RF-2.6.3.1, RF-2.6.4 | Tabla `bloqueos_cliente`, consultas de vigencia, operaciones y pruebas |
| RF-2.6.1.1, RF-2.6.1.2, RF-2.6.1.3 | «Crear bloqueo: orden de las reglas»: `INSERT` condicional, `BloqueoHastaFueraDeRango` antes de la idempotencia y repetición idempotente; pruebas HTTP con base |
| RNF-03 | Registro desde OpenAPI, errores y prueba de contrato |
| RNF-05 | Migración propia y repositorio SQL |
| RNF-07 | Pruebas unitarias, HTTP, integración y contrato |
| RNF-08 | Claves/restricciones, transacciones y pruebas concurrentes |
| RNF-19 | Logs sin cuerpos ni campos de dominio; el serializador omite el mensaje de los errores de datos de la base (`src/logs.ts`); pruebas de ausencia, también con un error real de pg |
| RNF-20 | `guia.md` por tarea y visión general al validar |

## Decisiones
- SQL explícito y funciones de repositorio pequeñas, siguiendo la spec base; no se agrega ORM ni dependencia.
- El estado se deriva, no se almacena.
- La idempotencia se resuelve en la misma transacción que el efecto para no dejar respuestas sin efecto ni efectos sin respuesta.
- En `crearBloqueo`, solo el límite del año 9999 se comprueba antes de la idempotencia. Descartado: un chequeo previo de `hasta` contra el reloj del servicio, porque una repetición tardía respondía 422 en vez del 201 guardado y un cliente sin perfil, 422 en vez de 404.
- Un `hasta` anterior al año 0001 va a la base como `-infinity` y no se rechaza aparte. Descartado: rechazarlo en el servicio, porque daría 422 antes del 404 de un cliente sin perfil.
- La `fechaNacimiento` del año `0000` se rechaza en el servicio y no traduciendo el 22008 en `clasificarError`. Descartado: traducir el 22008, porque ese código también sale de errores de programación (una fecha mal armada por el servicio) que deben seguir siendo 500, y porque en `crearCliente` el rechazo llegaría después de reservar la clave de idempotencia.
- El serializador omite el mensaje de toda la clase 22, no solo del 22008. Descartado: una lista de códigos, que deja afuera el próximo error de datos que nadie previó. Se pierde el texto del error en el log, pero quedan el código y la traza para diagnosticarlo.
- El ADR 004 documenta las transacciones y la idempotencia reutilizable, porque las specs #5 y futuras escrituras las comparten.

## Dudas abiertas
Ninguna.
