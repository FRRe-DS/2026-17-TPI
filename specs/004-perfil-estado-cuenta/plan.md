# Plan 004 — Perfil y estado de cuenta

Spec: [spec.md](spec.md) · Issue: #4 · Contrato: `contrato/openapi.yml`

## Resumen
Se agregan persistencia y manejadores para el perfil y los bloqueos. El estado de cuenta se obtiene en una consulta consistente, sin guardar un estado duplicado. Los POST comparten un mecanismo transaccional de idempotencia y las reglas de propiedad se verifican además de los roles ya declarados por el contrato.

## Estructura

| Archivo | Responsabilidad | Requisitos |
|---|---|---|
| `migraciones/<marca>_perfil_bloqueos.sql` | Tablas, índices, restricciones e idempotencia | RF-2.1, RF-2.6.1, RNF-05, RNF-08 |
| `src/bd/transaccion.ts` | Transacciones con tiempo máximo y clasificación de errores | RNF-08 |
| `src/clientes/modelo.ts` | Tipos de dominio y transformaciones de filas | RF-2.1, RF-2.6 |
| `src/clientes/repositorio.ts` | Consultas y transacciones de perfiles/bloqueos | RF-2.1, RF-2.1.1, RF-2.1.1.1, RF-2.1.2, RF-2.1.2.1, RF-2.1.3, RF-2.1.3.1, RF-2.6 a RF-2.6.4 |
| `src/clientes/servicio.ts` | Rol efectivo, propiedad, vigencia, idempotencia y reglas de negocio | RF-2.1, RF-2.1.1, RF-2.1.1.1, RF-2.1.2, RF-2.1.2.1, RF-2.1.3, RF-2.1.3.1, RF-2.6 a RF-2.6.4, RNF-08 |
| `src/clientes/operaciones.ts` | Manejadores HTTP de los ocho `operationId` | RNF-03 |
| `src/operaciones/index.ts` | Registra los nuevos manejadores | RNF-03 |
| `src/errores.ts` | Errores de dominio acordados | RF-2.1.3, RF-2.6.3 |
| `pruebas/unitarias/clientes.test.ts` | Vigencia, propiedad, paginación y mapeo | RF-2.1.1, RF-2.6, RF-2.6.2, RF-2.6.4 |
| `pruebas/integracion/clientes.test.ts` | Persistencia, transacciones y concurrencia | RNF-05, RNF-08 |
| `pruebas/http/clientes.test.ts` | Operaciones, roles, códigos y cuerpos | RF-2.1 a RF-2.6.4, RNF-03 |
| `specs/004-perfil-estado-cuenta/guia.md` | Mapa y uso de la funcionalidad | RNF-20 |

## Contrato
- Se implementan `crearCliente`, `obtenerCliente`, `actualizarCliente`, `obtenerEstadoCuenta`, `listarBloqueos`, `crearBloqueo`, `obtenerBloqueo` y `levantarBloqueo`.
- `src/operaciones/index.ts` solo asocia cada `operationId` con su manejador. Las rutas, validaciones y autorizaciones por rol siguen saliendo del OpenAPI, según ADR 003.
- Se calcula `rolesEfectivos = rolesDelToken ∩ rolesDeLaOperacion`; `sub = clienteId` se exige únicamente si ese conjunto es `[CLIENTE]`. OPERADOR puede leer perfiles y administrar bloqueos. SERVICIO solo llega a `obtenerEstadoCuenta` porque las demás rutas no admiten ese rol.
- Los errores genéricos conservan `about:blank`. Los errores de dominio usan `/errores/perfil-ya-existe`, `/errores/idempotencia-reutilizada`, `/errores/bloqueo-ya-levantado`, `/errores/bloqueo-vencido` y `/errores/bloqueo-no-vigente`, sin cambiar los códigos declarados por el contrato.

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
- `hasta timestamptz NULL`, validada antes de insertar para que sea posterior al instante de la transacción.
- `creado_en timestamptz NOT NULL DEFAULT clock_timestamp()`, `creado_por text NOT NULL`.
- `levantado_en timestamptz NULL`, `levantado_por text NULL`, `motivo_levantamiento varchar(500) NULL`.
- `CHECK` exige los tres datos de levantamiento juntos o los tres ausentes.
- Índices `(cliente_id, creado_en DESC, bloqueo_id DESC)` y parcial por `cliente_id` para filas sin levantar; la condición temporal `hasta > now()` se evalúa en la consulta porque no es inmutable para un índice parcial.

### `idempotencias`
- `operacion text`, `sujeto text`, `cliente_id uuid NULL`, `clave varchar(255)`, `hash_solicitud text`, `estado smallint`, `ubicacion text`, `respuesta jsonb`, `creado_en timestamptz`.
- Clave primaria `(operacion, sujeto, cliente_id, clave)`, con `cliente_id` no nulo para `crearBloqueo`; el hash incluye cuerpo y parámetros de ruta. Así un operador puede reutilizar una clave para otro cliente sin devolver la respuesta del primero.
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

### Levantar bloqueo
Un `UPDATE ... WHERE cliente_id = $1 AND bloqueo_id = $2 AND levantado_en IS NULL AND (hasta IS NULL OR hasta > CURRENT_TIMESTAMP)` guarda los tres datos de levantamiento. Si no cambia filas, una lectura distingue 404, 409 por ya levantado y 409 por vencido. La operación no borra ni altera el motivo original.

### Paginación
Se limita con `LIMIT size OFFSET page * size`; el total se cuenta con el mismo filtro y la misma transacción. Orden: `creado_en DESC, bloqueo_id DESC`.

## Pruebas
- Unitarias: propiedad del CLIENTE; vigencia sin fin, futura, vencida y levantada; estado con varios bloqueos; orden/paginación y conversión exacta a los esquemas del contrato.
- HTTP: las ocho operaciones; 201/200/404/409/422; `Location`; PATCH parcial; filtro `vigente`; tokens CLIENTE+OPERADOR; SERVICIO rechazado fuera de estado de cuenta; respuestas problem+json.
- Integración: migración up/down; transacciones; perfil único bajo concurrencia; idempotencia igual/diferente, concurrente y entre dos clientes; bloqueo con `hasta` pasada; actualización sin perder campos; historial conservado; levantamiento concurrente o vencido; estado y lista de vigentes consistentes.
- Contrato: las ocho operaciones dejan de figurar pendientes y Schemathesis las prueba contra el servicio levantado.

## Trazabilidad

| Requisito | Cobertura |
|---|---|
| RF-2.1, RF-2.1.1, RF-2.1.1.1, RF-2.1.2, RF-2.1.2.1, RF-2.1.3, RF-2.1.3.1 | Tabla `clientes`, servicio, manejadores y pruebas HTTP/integración |
| RF-2.6, RF-2.6.1, RF-2.6.2, RF-2.6.3, RF-2.6.3.1, RF-2.6.4 | Tabla `bloqueos_cliente`, consultas de vigencia, operaciones y pruebas |
| RNF-03 | Registro desde OpenAPI, errores y prueba de contrato |
| RNF-05 | Migración propia y repositorio SQL |
| RNF-07 | Pruebas unitarias, HTTP, integración y contrato |
| RNF-08 | Claves/restricciones, transacciones y pruebas concurrentes |
| RNF-19 | Logs sin cuerpos ni campos de dominio; pruebas de ausencia |
| RNF-20 | `guia.md` por tarea y visión general al validar |

## Decisiones
- SQL explícito y funciones de repositorio pequeñas, siguiendo la spec base; no se agrega ORM ni dependencia.
- El estado se deriva, no se almacena.
- La idempotencia se resuelve en la misma transacción que el efecto para no dejar respuestas sin efecto ni efectos sin respuesta.
- El ADR 004 documenta las transacciones y la idempotencia reutilizable, porque las specs #5 y futuras escrituras las comparten.

## Dudas abiertas
Ninguna.
