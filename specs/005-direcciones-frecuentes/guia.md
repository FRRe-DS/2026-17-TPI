# Guía — Spec 005 Direcciones frecuentes

## Visión general
**Qué se construyó y para qué.** Las cinco operaciones de direcciones frecuentes de M2. Un cliente guarda lugares favoritos o recientes (texto, alias y coordenadas opcionales) para no escribirlos otra vez, los lista, filtra, corrige y borra; un operador puede consultarlos para asistirlo, pero no cambiarlos. M2 guarda una copia propia de cada dirección: no consulta a M4 ni conserva ids suyos (RNF-05).

**Recorrido de una petición** (`POST /api/v1/clientes/{clienteId}/direcciones`, el alta). Lo común a todas las operaciones está en la guía de la [spec 003](../003-base-servicio/guia.md):
1. Token y rol: `registrarPermisos` deja pasar solo a CLIENTE, que es lo que declara el contrato. Ajv valida los ids, `Idempotency-Key` y el cuerpo (tipo, largos, rangos de coordenadas, campos extra).
2. El manejador `crearDireccion` ([direcciones/operaciones.ts](../../src/direcciones/operaciones.ts)) lee la ruta, la clave y el cuerpo, y llama al servicio. No escribe logs (RNF-19).
3. `crearDireccion` ([direcciones/servicio.ts](../../src/direcciones/servicio.ts)): `exigirPropietario` (de la 004) exige `sub = clienteId`; después `conIdempotencia` ([bd/idempotencia.ts](../../src/bd/idempotencia.ts)) reserva la clave en una transacción.
4. Dentro de esa transacción, `exigirPerfil` (404 si no hay perfil) y `crearDireccion` ([direcciones/repositorio.ts](../../src/direcciones/repositorio.ts)) hace el INSERT con un id generado por M2; la respuesta se guarda con la clave.
5. `aDireccion` ([direcciones/modelo.ts](../../src/direcciones/modelo.ts)) convierte la fila al esquema `Direccion`. El manejador responde 201 con `Location`. Un error es un `Problema` ([errores.ts](../../src/errores.ts)) y sale en problem+json.

**Mapa.**
| Archivo | Responsabilidad | Requisitos | Tareas |
|---|---|---|---|
| `migraciones/1792768969582_direcciones.sql` | Tabla `direcciones_cliente`, checks con nombre e índices del listado | RF-2.2, RNF-05 | T1 |
| `src/direcciones/modelo.ts` | Tipos del contrato y de fila; `aDireccion`, `aPaginaDirecciones` | RF-2.2, RF-2.2.1, RF-2.2.2 | T2, T3 |
| `src/direcciones/repositorio.ts` | SQL: alta, consulta, listado, PATCH y DELETE, siempre por `(cliente_id, direccion_id)` | RF-2.2 a RF-2.2.4.1 | T2 a T4 |
| `src/direcciones/servicio.ts` | Rol efectivo, propiedad, perfil e idempotencia del alta | RF-2.2, RF-2.2.5, RNF-08 | T5 |
| `src/direcciones/operaciones.ts` | Los cinco manejadores HTTP | RNF-03 | T6 |
| `src/operaciones/index.ts` | Registra los cinco `operationId` | RNF-03 | T6 |
| `src/clientes/repositorio.ts` | `exigirPerfil` pasa a exportarse | RF-2.2 | T5 |
| `schemathesis.toml` | Acepta el 422 de idempotencia también en `crearDireccion` | RNF-07 | T7 |
| `pruebas/unitarias/direcciones.test.ts`, `pruebas/integracion/direcciones.test.ts` | Conversiones y propiedad; migración, repositorio y servicio con PostgreSQL real | RNF-05, RNF-07, RNF-08 | T1 a T5 |
| `pruebas/http/direcciones.test.ts`, `pruebas/integracion/direcciones-http.test.ts` | HTTP sin base y con base, y logs sin datos | RNF-03, RNF-19 | T6 |

**Decisiones clave** (detalle en [plan.md](plan.md) y en las entradas de abajo):
- Una dirección de otro cliente es 404, igual que una inexistente; se busca siempre por `(cliente_id, direccion_id)`, así no se revela que existe (T2, T4). Descartado: buscar solo por `direccion_id` y comparar después.
- La propiedad se exige solo si el único rol efectivo es CLIENTE: CLIENTE+OPERADOR lee direcciones ajenas, pero solo escribe las propias (T5). Se reutiliza `exigirPropietario` de la 004 y no hay un segundo mecanismo.
- El alta reutiliza `conIdempotencia`; el perfil se comprueba dentro de la transacción, así que sin perfil no queda reserva y la clave sirve después (T5). Descartado: una tabla propia de idempotencia.
- El borrado es físico y la actualización es parcial con `COALESCE`: el contrato no admite `null`, así que alias y coordenadas se reemplazan pero no se quitan (T4).
- El listado trae perfil, total y página en una sola sentencia, con orden `creado_en DESC, direccion_id DESC` para que la paginación sea estable (T3).

**Conceptos que conviene entender.** Idempotencia con `Idempotency-Key`. Rol efectivo (roles del token ∩ roles de la operación). Paginación con orden total (desempate por id). `numeric` de PostgreSQL llega como texto. Un `CHECK` que da NULL se acepta.

**Cómo probarlo uno mismo** (comprobado el 2026-10-23 contra el compose, con datos ficticios; el token lo firma el comando de tokens del contenedor):
```bash
docker compose up -d --build --wait
CLI=$(cat /proc/sys/kernel/random/uuid); B=http://localhost:8082/api/v1/clientes
token() { docker compose exec -T m2 node dist/herramientas/token.js --sub "$1" --roles "$2"; }
TC=$(token "$CLI" CLIENTE); TO=$(token operador-1 OPERADOR)
curl -X POST $B -H "Authorization: Bearer $TC" -H 'Idempotency-Key: perfil-1' -H 'Content-Type: application/json' \
  -d '{"nombre":"Ana","apellido":"Ejemplo","telefono":"+5493624000000"}'                       # 201: hace falta el perfil (spec 004)
curl -i -X POST $B/$CLI/direcciones -H "Authorization: Bearer $TC" -H 'Idempotency-Key: dir-1' -H 'Content-Type: application/json' \
  -d '{"tipo":"FAVORITA","alias":"Casa","texto":"Calle Falsa 123","coordenadas":{"latitud":-27.45,"longitud":-58.98}}'   # 201 y Location; repetida, 201 igual; con otro cuerpo, 422 idempotencia-reutilizada
curl "$B/$CLI/direcciones?tipo=FAVORITA&size=5" -H "Authorization: Bearer $TO"                  # 200: un OPERADOR lee las de un cliente
curl -X PATCH $B/$CLI/direcciones/<direccionId> -H "Authorization: Bearer $TC" -H 'Content-Type: application/json' -d '{"alias":"Trabajo"}'   # 200, solo cambia el alias
curl -X PATCH $B/$CLI/direcciones/<direccionId> -H "Authorization: Bearer $TO" -H 'Content-Type: application/json' -d '{"alias":"X"}'         # 403: un OPERADOR no escribe
curl -i -X DELETE $B/$CLI/direcciones/<direccionId> -H "Authorization: Bearer $TC"              # 204 sin cuerpo; otra vez, 404
npm test && npm run contrato:test
```

**Preguntas de comprobación** (la respuesta, entre paréntesis, dice dónde buscarla):
1. Un token CLIENTE+OPERADOR pide la lista de otro cliente y después intenta borrarle una dirección: ¿qué recibe en cada caso y por qué? (`exigirPropietario`, roles de cada operación en el contrato; T5).
2. Dos altas llegan a la vez con la misma `Idempotency-Key` y el mismo cuerpo: ¿cuántas filas quedan y qué recibe cada una? ¿Y si los cuerpos difieren? (`conIdempotencia`, `idempotencias_unica`; T5).
3. Un cliente con perfil y sin direcciones, y un `clienteId` sin perfil, piden el listado: ¿qué recibe cada uno y qué parte de la consulta lo decide? (`listarDirecciones` del repositorio, el `FROM clientes`; T3).
4. ¿Por qué un PATCH con `{"alias": ""}` cambia el alias y uno con `{}` da 400 antes de llegar al servicio? (`COALESCE` y `minProperties` del contrato; T4).

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

### T3 — Listado, filtro, orden y paginación estable · commit `005/T3`
- Qué cambió:
  - [src/direcciones/repositorio.ts](../../src/direcciones/repositorio.ts): `listarDirecciones()` devuelve una `PaginaDirecciones` de un cliente, con el filtro opcional por `tipo` y la página pedida (`PedidoListado`).
  - [src/direcciones/modelo.ts](../../src/direcciones/modelo.ts): `aPaginaDirecciones()` arma la página con los totales (`totalPaginas = ceil(total / size)`).
- Por qué así: una sola sentencia trae el perfil, el total del filtro y la página (`LATERAL`), igual que `listarBloqueos()` de la 004: comparten instantánea, así que el total coincide con lo que se pagina. El orden es `creado_en DESC, direccion_id DESC`, el de los dos índices de T1; el id desempata dos direcciones con la misma fecha y la paginación no repite ni saltea (RF-2.2.1). El filtro por tipo cambia la condición fija de la consulta y pasa el tipo como parámetro: nada de texto interpolado.
- Cómo se conecta: T5 y T6 la llamarán desde el servicio y el manejador de `listarDirecciones`, con `page` y `size` ya validados por el contrato (0 en adelante; 1 a 100).
- Tests:
  - [pruebas/unitarias/direcciones.test.ts](../../pruebas/unitarias/direcciones.test.ts): `aPaginaDirecciones()` con orden recibido, sin elementos, página fuera del total y totales en múltiplos exactos del tamaño.
  - [pruebas/integracion/direcciones.test.ts](../../pruebas/integracion/direcciones.test.ts), bloque `listarDirecciones()`, con PostgreSQL real: lista completa con empate de fecha, favoritas y recientes con sus totales, páginas que recorren todo sin repetir, paginación con filtro, `size` 1 y 100, página fuera del total (con y sin filtro), página enorme, cliente sin direcciones, aislamiento entre clientes, cliente sin perfil y misma forma que la consulta individual.
  - En rojo primero: `listarDirecciones is not a function`.
- Para mirar con atención:
  - Sin perfil da `NoEncontrado` desde el propio repositorio, porque el perfil es la fila base del `JOIN`. Así un cliente existente sin direcciones (200, página vacía) y uno inexistente (404) se distinguen en la misma sentencia (spec, Contrato y dependencias).
  - `page * size` se topa en `Number.MAX_SAFE_INTEGER`: una página gigante desbordaría el `OFFSET` de la base y daría un 500; con el tope da una página vacía.
  - Con tablas chicas no se mira el plan de ejecución: no se comprobó con `EXPLAIN` que la base use los índices. Es una deuda menor, si el listado se llega a notar lento.

### T4 — Actualización parcial y borrado físico · commit `005/T4`
- Qué cambió:
  - [src/direcciones/repositorio.ts](../../src/direcciones/repositorio.ts): `actualizarDireccion()` cambia solo los campos recibidos y devuelve la dirección completa; `eliminarDireccion()` borra la fila. Las dos buscan por `(cliente_id, direccion_id)`.
  - [src/direcciones/modelo.ts](../../src/direcciones/modelo.ts): el tipo `DireccionCambios`, del contrato.
- Por qué así:
  - El PATCH usa `COALESCE($n, columna)`, como `actualizarPerfil()` de la 004: el contrato no admite null en ningún campo, así que `null` quiere decir «no se envió» y la columna conserva su valor. Un alias vacío no es null y sí reemplaza. El plan hablaba de armar el `UPDATE` solo con las propiedades presentes; el efecto es el mismo (los campos ausentes no cambian, `creado_en` tampoco) y evita construir SQL a mano. Las coordenadas se reemplazan juntas, como pide el check de la base. No se pueden quitar: el contrato no lo permite (spec, Casos límite).
  - Un `UPDATE` es atómico: dos PATCH a la vez de campos distintos se aplican uno detrás del otro y ninguno pisa al otro (RNF-08 no lo pide aquí, pero la prueba lo deja asentado).
  - El `DELETE` es físico (spec, Decisiones). Si no borró ninguna fila, `NoEncontrado`: sirve igual para «ya borrada» (RF-2.2.4.1), «de otro cliente» y «nunca existió».
- Cómo se conecta: T5 las envuelve en el servicio (rol efectivo y propiedad) y T6 las expone como `actualizarDireccion` y `eliminarDireccion`; el 204 sin cuerpo lo arma el manejador.
- Tests: [pruebas/integracion/direcciones.test.ts](../../pruebas/integracion/direcciones.test.ts), bloques `actualizarDireccion()` y `eliminarDireccion()`, con PostgreSQL real:
  - PATCH de cada campo por separado (el resto y `creadoEn` quedan), varios a la vez, alias vacío, alta de alias y coordenadas en una dirección que no los tenía, sin campos, texto con comillas, sin tocar a una vecina, de otro cliente (queda como estaba), inexistente y dos PATCH simultáneos;
  - DELETE que borra la fila y la saca de la consulta y del listado, una sola fila entre dos de igual texto, repetido, de otro cliente (no se borra), inexistente y dos simultáneos (uno gana, el otro `NoEncontrado`).
  - En rojo primero: `actualizarDireccion is not a function` y `eliminarDireccion is not a function`.
- Para mirar con atención:
  - Sin campos, `actualizarDireccion()` no ejecuta el `UPDATE` y devuelve la dirección: el contrato exige al menos uno (`minProperties: 1`), así que ese caso ya sale como 400 antes de llegar acá.
  - No hay prueba unitaria de «armado de cambios» (el plan la preveía) porque con `COALESCE` no hay armado que probar: lo cubre la integración.

### T5 — Rol efectivo, propiedad e idempotencia en el servicio · commit `005/T5`
- Qué cambió:
  - [src/direcciones/servicio.ts](../../src/direcciones/servicio.ts): las cinco operaciones (`crearDireccion`, `listarDirecciones`, `obtenerDireccion`, `actualizarDireccion`, `eliminarDireccion`). Cada una exige la propiedad, normaliza los ids de la ruta y llama al repositorio. El alta, además, va con idempotencia y comprueba el perfil.
  - [src/clientes/repositorio.ts](../../src/clientes/repositorio.ts): `exigirPerfil()` pasa a ser exportada, sin otros cambios, para que el alta de direcciones la use.
- Por qué así:
  - Propiedad: se reutiliza `exigirPropietario()` de la 004 ([src/clientes/servicio.ts](../../src/clientes/servicio.ts)) y no se arma un segundo mecanismo. Los roles efectivos son los del token que admite la operación; solo si quedan exactamente en `[CLIENTE]` se exige `sub = clienteId`. Como las lecturas admiten CLIENTE y OPERADOR y las escrituras solo CLIENTE, CLIENTE+OPERADOR lee direcciones ajenas pero solo escribe las propias (RF-2.2.5, spec, Contrato y dependencias). El 403 va antes de cualquier consulta: un CLIENTE no averigua si existe otro perfil.
  - Alta (plan, Lógica, Crear): propiedad → reserva de la clave con `conIdempotencia()` ([src/bd/idempotencia.ts](../../src/bd/idempotencia.ts)) → dentro de la misma transacción, `exigirPerfil()` y el `INSERT`. Sin perfil, `NoEncontrado`: la transacción se deshace, no queda reserva y la misma clave sirve cuando el perfil exista. Comprobarlo antes del `INSERT` evita que la clave foránea (23503) termine en un 500 (lo anotado en T2).
  - Idempotencia: `operacion = 'crearDireccion'`; el sujeto es el sub normalizado, que por la propiedad es el cliente de la ruta; `cliente_id` es siempre ese cliente, nunca null; la huella lleva el cuerpo tal como llegó y el cliente de la ruta. La reserva es por operación: la misma clave en `crearBloqueo` no choca. Otro cuerpo con la misma clave da `IdempotenciaReutilizada` (422, spec, Decisiones).
  - Las lecturas y escrituras sobre una dirección no consultan el perfil aparte: sin perfil no puede haber direcciones (clave foránea), así que el 404 del repositorio ya cubre ese caso. El listado sí lo distingue, desde T3.
- Cómo se conecta: T6 lo llama desde `src/direcciones/operaciones.ts`, pasando los roles de la operación (`request.routeOptions.config.permisos`) como en [src/clientes/operaciones.ts](../../src/clientes/operaciones.ts), y arma el 201 con `Location` a partir de `RespuestaIdempotente`.
- Tests:
  - [pruebas/unitarias/direcciones.test.ts](../../pruebas/unitarias/direcciones.test.ts), con un pool que falla si se usa: CLIENTE ajeno da 403 en las cinco sin tocar la base; el dueño (también con mayúsculas y `urn:uuid:`) llega a la base; OPERADOR lee; CLIENTE+OPERADOR lee ajeno pero no escribe; CLIENTE+SERVICIO ajeno da 403; el detalle del 403 no lleva ids.
  - [pruebas/integracion/direcciones.test.ts](../../pruebas/integracion/direcciones.test.ts), bloque «el servicio de direcciones con la base»:
    - el alta da 201 con `Location`, guarda la reserva con operación, sujeto y cliente, y responde en minúsculas;
    - sin perfil da 404 y no deja reserva; con el perfil creado, la misma clave hace el alta;
    - un alta ajena da 403 sin reserva;
    - CLIENTE+OPERADOR escribe solo en lo propio;
    - idempotencia: misma clave y mismo cuerpo, también con los campos reordenados; otro cuerpo da 422; misma clave en dos clientes y en `crearBloqueo`;
    - concurrencia: cinco altas iguales a la vez dan una sola fila, y cuatro con cuerpos distintos dan un 201, tres 422 y una fila;
    - las lecturas y escrituras se prueban por rol, con ids en mayúsculas, con un cliente sin perfil y con direcciones ajenas o ya borradas.
  - En rojo primero: no existía `src/direcciones/servicio.ts`. Las pruebas de concurrencia pasaron en 8 corridas seguidas.
- Para mirar con atención:
  - El servicio confía en que `registrarPermisos` ya rechazó los tokens sin un rol admitido, igual que en la 004: un OPERADOR solo, llamando directo a `crearDireccion` sin pasar por HTTP, no tendría rol efectivo y no se le exigiría propiedad. Por HTTP no llega (403 de `autorizar`); lo comprobará T6.
  - `idempotencias` tiene un CHECK que exige `cliente_id` para `crearBloqueo`, pero no para `crearDireccion`. El código siempre lo pone; sumar el CHECK sería un cambio de esquema que no pide la spec.

### T6 — Exponer y registrar las cinco operaciones del contrato · commit `005/T6`
- Qué cambió:
  - [src/direcciones/operaciones.ts](../../src/direcciones/operaciones.ts): los cinco manejadores (`listarDirecciones`, `crearDireccion`, `obtenerDireccion`, `actualizarDireccion`, `eliminarDireccion`). Leen la solicitud ya validada, llaman al servicio de T5 y arman la respuesta: el 201 con `Location` y el 204 sin cuerpo.
  - [src/operaciones/index.ts](../../src/operaciones/index.ts): los registra por `operationId`, en el orden del contrato. Con eso `registrarOperaciones` crea las cinco rutas, con la validación y los roles que salen del OpenAPI (RNF-03).
  - [pruebas/integracion/arranque.test.ts](../../pruebas/integracion/arranque.test.ts), [pruebas/integracion/salud.test.ts](../../pruebas/integracion/salud.test.ts): las listas fijas de operaciones implementadas suman las cinco. En el primero, un ejemplo de operación *pendiente* usaba `listarDirecciones`; ahora usa `listarCalificaciones`, que el servicio sigue sin implementar.
- Por qué así: mismo molde que [src/clientes/operaciones.ts](../../src/clientes/operaciones.ts). Los manejadores no validan ni autorizan: el contrato ya lo hizo, y la propiedad la exige el servicio con los roles que el contrato da a la operación (`request.routeOptions.config.permisos`). No escriben logs, así que el texto, el alias, las coordenadas y la clave de idempotencia no salen de ahí (RNF-19). `identidadDe()` y `rolesDe()` se repiten de los de perfil en vez de compartirse: son tres líneas y así cada spec queda independiente.
- Cómo se conecta: es el último eslabón; la petición pasa por `autorizar` (401 y 403 por el rol) → validación del contrato (400) → manejador → servicio (403 por propiedad, 404, 422) → repositorio. T7 corre además la prueba de contrato (`npm run contrato:test`).
- Tests:
  - [pruebas/http/direcciones.test.ts](../../pruebas/http/direcciones.test.ts), sin base (el pool falso falla si se consulta):
    - 401 en las cinco; 403 por el rol para SERVICIO y CONDUCTOR, y para OPERADOR en las tres escrituras;
    - 403 por propiedad en las cinco, también para CLIENTE+OPERADOR en las escrituras, sin ids en el detalle; el 403 va antes que los errores del cuerpo y la ruta;
    - 400 para 19 cuerpos de alta inválidos, 11 de PATCH y 7 consultas del listado, y para ids que no son UUID; el 400 no devuelve texto, alias ni coordenadas;
    - 405.
  - [pruebas/integracion/direcciones-http.test.ts](../../pruebas/integracion/direcciones-http.test.ts), con PostgreSQL real: 201 con `Location` que se puede seguir, solo con lo obligatorio, caracteres especiales, U+0000 (400 y no 500); idempotencia repetida, con otro cuerpo (422 con `/errores/idempotencia-reutilizada`) y concurrente; alta sin perfil (404 y luego 201 con la misma clave); listado con filtro, páginas, página fuera del total y vacío; lectura por dueño, OPERADOR y CLIENTE+OPERADOR; PATCH mínimo y completo; DELETE con 204 sin cuerpo ni `Content-Type`, repetido (404), de otro cliente (404); y los logs, con datos ficticios reconocibles, sin ninguno de ellos ni la clave ni `Bearer`.
  - En rojo primero: no existía `src/direcciones/operaciones.js`.
- Para mirar con atención:
  - El 403 por propiedad lleva en `instance` la ruta pedida, que contiene el `clienteId` de la URL. No es una filtración (es lo que mandó quien llama); lo que se comprueba es que el detalle no lleve ningún id.
  - `manejadores` tiene que seguir el orden del contrato: una prueba de [pruebas/unitarias/contrato-test.test.ts](../../pruebas/unitarias/contrato-test.test.ts) compara ese orden con el de `listarOperaciones()`.
  - La prueba de contrato con Schemathesis (`npm run contrato:test`) todavía no se corrió para estas cinco: es la T7.

### T7 — Validar contrato, regresión y documentación · commit `005/T7`
- Qué cambió:
  - [schemathesis.toml](../../schemathesis.toml): `crearDireccion` se suma a `crearCliente` y `crearBloqueo` en `positive_data_acceptance`, con la misma lista de estados (los de Schemathesis más el 422).
  - [pruebas/unitarias/contrato-test.test.ts](../../pruebas/unitarias/contrato-test.test.ts): la prueba que vigila esa configuración espera ahora las tres operaciones.
  - Esta guía: la «Visión general».
- Por qué así: la primera corrida de `npm run contrato:test` dio un único fallo: `POST …/direcciones` respondió 422 `idempotencia-reutilizada` a un cuerpo válido, porque Schemathesis reutilizó una `Idempotency-Key` con otro cuerpo. Es el 422 que el contrato declara para esa operación, y el mismo caso que ya tenían `crearCliente` y `crearBloqueo` (spec 004, guía, T10). El ajuste es acotado: no se desactiva ningún chequeo, solo se acepta el 422 en una operación que lo declara; la prueba de la configuración comprueba que cada operación incluida lo declare y que no se acepte ningún otro código de más.
- Cómo se conecta: `scripts/contrato-test.mjs` lee `schemathesis.toml` al correr; no hubo que tocar el script.
- Tests y evidencia (2026-10-23):
  - `npm run contrato:test` (14 operaciones implementadas, las cinco de direcciones incluidas): dos corridas seguidas con exit 0; 2744 y 2745 casos generados, todos pasan, en las cuatro fases (examples, coverage, fuzzing, stateful).
  - `npm test`: 2631 pruebas en 32 archivos. `npm run lint` y `npm run build` sin errores. `node scripts/spec-check.mjs --rama impl/005-direcciones-frecuentes --base origin/main`: solo el error de la spec 004 (T12 sin marcar en `main`), ajeno a esta rama.
  - Los ejemplos `curl` de la visión general se ejecutaron contra el compose reconstruido: 201 con `Location`, repetido 201, otro cuerpo 422, lista del OPERADOR 200, PATCH 200, PATCH de OPERADOR 403, DELETE 204 y repetido 404.
- Para mirar con atención:
  - Schemathesis casi no llega al 200 de `GET` y `DELETE` sobre una dirección ni al `GET` del listado: genera ids al azar y recibe 404 («Missing test data»). Esa parte la cubren las pruebas de integración HTTP (T6), no la de contrato. Lo mismo le pasa a las operaciones de perfil y bloqueos de la 004; si se quiere más profundidad, hay que enlazar las operaciones en el contrato o dar ids reales en la configuración.
  - En el 201 del alta, el JSON sale con las claves en otro orden que en un `GET` (la respuesta pasa por `jsonb` para que la primera y las repetidas sean idénticas). El contenido es el mismo.
  - La corrida creó datos ficticios en el volumen local `datos-bd` del compose; no entran al repositorio.

