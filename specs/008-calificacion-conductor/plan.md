# Plan 008 — Calificación del conductor

Spec: [spec.md](spec.md) · Issue: #8 · Contrato: `contrato/openapi.yml` · Depende de: specs #3, #4 y #7 · Contrato de M6: `contrato/dependencias/m6.yml` (ADR 057) · Token de servicio: ADR 009

## Resumen
Una tabla nueva, `calificaciones`, con la restricción única (cliente, viaje) que garantiza RNF-08. Un módulo `src/calificaciones/` con las tres operaciones. El cliente de M6 de la spec #7 gana `obtenerViaje` (`GET /trips/{id}`), con el mismo token de servicio, tiempo máximo, reintento y `Retry-After`. La idempotencia de la spec #4 gana una lectura de la respuesta guardada, para que una repetición no consulte a M6. El historial de la spec #7 agrega `calificado` con una consulta a la base. No cambia el contrato de M2 ni hay variables de entorno nuevas.

## Estructura

| Archivo | Responsabilidad | Requisitos |
|---|---|---|
| `migraciones/<marca>_calificaciones.sql` | Tabla `calificaciones`, restricción única e índice del listado | RNF-05, RNF-08, RF-2.5.3, RF-2.5.8 |
| `src/errores.ts` | `CalificacionDuplicada` (409) y `ViajeNoCompletado` (422), con `type` propio | RF-2.5.2, RF-2.5.3 |
| `src/bd/idempotencia.ts` | `buscarRespuesta`: la respuesta guardada de una solicitud, sin bloquear ni reservar | RF-2.5.4 |
| `src/historial/m6.ts` | `obtenerViaje(viajeId, clienteId, idCorrelacion)`: pedido a M6, lectura y comprobación de su respuesta | RF-2.5, RF-2.5.1, RF-2.5.5, RF-2.5.6, RF-2.5.13, RNF-13 |
| `src/historial/modelo.ts` | `conCalificado`: agrega `calificado` a cada viaje (pura) | RF-2.5.14 |
| `src/historial/servicio.ts` | Después de armar la página, consulta qué viajes están calificados y llama a `conCalificado` | RF-2.5.14 |
| `src/calificaciones/modelo.ts` | Tipos del contrato y `aCalificacion`, `aPaginaCalificaciones` (puras) | RF-2.5, RF-2.5.8 |
| `src/calificaciones/repositorio.ts` | Alta, existencia por (cliente, viaje), listado paginado, lectura por id y viajes calificados | RF-2.5, RF-2.5.3, RF-2.5.8 a RF-2.5.10, RF-2.5.14 |
| `src/calificaciones/servicio.ts` | Propiedad, perfil, duplicado, M6 y alta con idempotencia, en ese orden | RF-2.5 a RF-2.5.4, RF-2.5.11, RF-2.5.12 |
| `src/calificaciones/operaciones.ts` | Manejadores de las tres operaciones | RNF-03 |
| `src/operaciones/index.ts` | Registro de las tres por `operationId`, en el orden del contrato | RNF-03 |
| `schemathesis.toml` | `calificarConductor` acepta el `503` de M6 y el `422` | RNF-07 |
| `README.md` | Operaciones de calificaciones y cómo probarlas | RNF-20 |
| `pruebas/unitarias/calificaciones.test.ts` | `aCalificacion`, `aPaginaCalificaciones` | RF-2.5, RF-2.5.8 |
| `pruebas/unitarias/historial.test.ts` | `conCalificado` (se amplía) | RF-2.5.14 |
| `pruebas/modulos/m6.test.ts` | `obtenerViaje` contra un M6 simulado (se amplía) | RF-2.5.1, RF-2.5.2, RF-2.5.5, RF-2.5.6, RF-2.5.13 |
| `pruebas/integracion/calificaciones.test.ts` | Servicio con PostgreSQL real y M6 simulado: unicidad, concurrencia, repetición, orden de las comprobaciones, lectura y logs | RF-2.5 a RF-2.5.4, RF-2.5.8 a RF-2.5.11, RNF-05, RNF-08, RNF-19 |
| `pruebas/integracion/calificaciones-http.test.ts` | Contrato, permisos, validación y errores por HTTP | RF-2.5.5 a RF-2.5.7, RF-2.5.12, RNF-03, RNF-14 |
| `pruebas/integracion/historial.test.ts`, `historial-http.test.ts` | Se ajustan: cada viaje trae `calificado`; casos con y sin calificación | RF-2.5.14 |
| `pruebas/integracion/arranque.test.ts`, `salud.test.ts` | Las listas de operaciones implementadas suman las tres | RNF-03 |
| `specs/008-calificacion-conductor/guia.md` | Mapa y uso | RNF-20 |

## Contrato
- Se implementan `listarCalificaciones` (`GET /api/v1/clientes/{clienteId}/calificaciones`, `CLIENTE` y `OPERADOR`), `calificarConductor` (`POST` en la misma ruta, `CLIENTE`) y `obtenerCalificacion` (`GET .../{calificacionId}`, `CLIENTE` y `OPERADOR`). Se amplía `listarHistorialViajes` con `calificado`, que el contrato ya declara. No se cambia el contrato.
- La validación del cuerpo (`viajeId` UUID, `puntaje` entero de 1 a 5, `comentario` de hasta 500 caracteres, sin campos extra), de `Idempotency-Key`, de `clienteId`, `calificacionId`, `page` y `size` sale del OpenAPI (`400` antes del manejador, RF-2.5.7). El cuerpo no se convierte de tipo, así que `"5"` y `4.5` dan `400`.
- Rol efectivo y propiedad como en las specs #5 y #7 (`exigirPropietario`): `calificarConductor` solo admite CLIENTE, así que el `sub` tiene que ser el `clienteId`; un token sin CLIENTE recibe `403` del autorizador. Las dos lecturas admiten CLIENTE y OPERADOR.
- Errores de dominio: `409` con `type: /errores/calificacion-duplicada`, `422` con `type: /errores/viaje-no-completado` y `422` con `type: /errores/idempotencia-reutilizada` (el de las specs #4 y #5). El `503` por M6 es `about:blank` con `Retry-After`; el de la base no lleva `Retry-After`.

## Datos
Una migración nueva, `calificaciones`:

| Columna | Tipo | Notas |
|---|---|---|
| `calificacion_id` | `uuid` PK | lo genera M2 |
| `cliente_id` | `uuid` NOT NULL | `REFERENCES clientes (cliente_id) ON DELETE CASCADE`, como las direcciones |
| `viaje_id` | `uuid` NOT NULL | identificador del viaje en M6: sin clave foránea (RNF-05) |
| `conductor_id` | `uuid` NOT NULL | el `driverId` que informó M6 al calificar |
| `puntaje` | `smallint` NOT NULL | `CHECK (puntaje BETWEEN 1 AND 5)` |
| `comentario` | `varchar(500)` | nulo si no se envió; vacío es válido |
| `creado_en` | `timestamptz` NOT NULL | `DEFAULT clock_timestamp()` |

- `CONSTRAINT calificaciones_cliente_viaje_unica UNIQUE (cliente_id, viaje_id)`: lo que garantiza RNF-08 y RF-2.5.3 aunque haya concurrencia o claves distintas. Su índice sirve también a la búsqueda por cliente y viaje.
- `CREATE INDEX calificaciones_listado ON calificaciones (cliente_id, creado_en DESC, calificacion_id DESC)`: el orden estable del listado (RF-2.5.8).
- Down: `DROP TABLE calificaciones`. Se guardan solo los identificadores del viaje y del conductor, nada más de M6 (RNF-05).
- No se agrega nada a `idempotencias`: la tabla de la spec #4 ya sirve para esta operación (`operacion` = `calificarConductor`).

## Lógica

### Calificar (`servicio.calificarConductor`)
```
1. exigirPropietario(identidad, clienteId, rolesDeLaOperacion)           # 403, sin tocar la base ni M6
2. cliente = normalizarUuid(clienteId); viaje = minúsculas(cuerpo.viajeId)
   solicitud = { operacion: 'calificarConductor', sujeto: normalizarUuid(identidad.sub), clienteId: cliente, clave,
                 huella: { cuerpo: { ...cuerpo, viajeId: viaje }, ruta: { clienteId: cliente } } }
3. guardada = buscarRespuesta(pool, solicitud)                           # misma clave y cuerpo: devolver la guardada (RF-2.5.4);
   si guardada: devolverla                                               #   otro cuerpo: IdempotenciaReutilizada (422). Sin M6
4. exigirPerfil(pool, cliente)                                           # 404 (RF-2.5.11), sin M6
5. si existeCalificacion(pool, cliente, viaje): CalificacionDuplicada    # 409 sin M6 (RF-2.5.3)
6. v = m6.obtenerViaje(viaje, cliente, idCorrelacion)
   si v == null: NoEncontrado                                            # inexistente o ajeno, igual (RF-2.5.1)
   si v.estado != 'COMPLETED': ViajeNoCompletado                         # 422 (RF-2.5.2)
7. conIdempotencia(pool, solicitud, alta):                               # una transacción corta, sin M6 adentro
     alta: INSERT calificaciones (id nuevo, cliente, viaje, v.conductorId, puntaje, comentario)
           si choca con calificaciones_cliente_viaje_unica: CalificacionDuplicada (409)
           devuelve { estado: 201, ubicacion: /api/v1/clientes/{cliente}/calificaciones/{id}, cuerpo: aCalificacion(fila) }
```
- El paso 3 va antes que el 4 y el 5: una repetición exitosa devuelve el `201` original aunque la calificación ya exista (que sería un `409`) y aunque M6 esté caído.
- Los pasos 3 a 6 solo leen. Dos solicitudes con la misma clave que llegan a la vez pueden pasar el paso 3 y llamar las dos a M6; en el paso 7 la segunda espera a la primera en la restricción única de `idempotencias` y recibe su respuesta guardada: un solo registro. Con claves distintas, la segunda espera en `calificaciones_cliente_viaje_unica` y recibe `409`.
- Si `alta` falla, la transacción se deshace y la clave queda libre: un error no se guarda (spec, RF-2.5.4).
- El perfil ya se comprobó en el paso 4; no hay operación que borre perfiles, y la clave foránea cubre el resto. Si igual faltara, sale como cualquier error de la base.

### Lectura del viaje de M6 (`m6.obtenerViaje`)
```
respuesta = cliente.obtener('/trips/' + viajeId, idCorrelacion)      # reintenta una vez; puede lanzar ModuloNoDisponible
si respuesta.estado == 404: devolver null                            # RF-2.5.1
si respuesta.estado >= 400: lanzar ErrorDeIntegracion                # 500, la causa lleva solo el código (RF-2.5.6)
v = respuesta.cuerpo
si v no es objeto, o v.state no es texto, o v.clientId no es texto: lanzar ModuloNoDisponible('M6')     # 503 (RF-2.5.5)
si minúsculas(v.clientId) != minúsculas(clienteId): devolver null    # ajeno: igual que inexistente, antes de mirar el estado
si v.state != 'COMPLETED': devolver { estado: v.state }
si v.driverId no es un UUID: lanzar ModuloNoDisponible('M6')         # 503
devolver { estado: 'COMPLETED', conductorId: minúsculas(v.driverId) }
```
- El dueño se comprueba antes que el estado y antes que `driverId`: un viaje ajeno nunca revela su estado, ni siquiera con una respuesta mal formada (RF-2.5.1).
- `viajeId` ya es un UUID validado por el contrato, así que no necesita escaparse en la ruta.

### Listar y consultar
- `listarCalificaciones`: una sola sentencia, como el listado de direcciones: el perfil, el total del cliente y la página, con el orden `creado_en DESC, calificacion_id DESC`. Sin perfil, `404`. La página va desde `page * size` con el mismo tope que las direcciones: una página enorme queda fuera del total y responde `200` con `items` vacío (RF-2.5.9).
- `obtenerCalificacion`: `SELECT … WHERE cliente_id = $1 AND calificacion_id = $2`; sin fila, `404`, sea porque el perfil no existe, la calificación no existe o es de otro cliente (RF-2.5.10, RF-2.5.11). No hay llamada a M6.

### `calificado` en el historial (`servicio.listarHistorialViajes`)
```
pagina = aPaginaViajes(cuerpoM6, cliente, page, size)
si pagina.items está vacío: devolver pagina
ids = pagina.items.map(viajeId en minúsculas)
calificados = SELECT viaje_id FROM calificaciones WHERE cliente_id = $1 AND viaje_id = ANY($2::uuid[])
devolver conCalificado(pagina, calificados)         # calificado: calificados.has(viajeId) en cada viaje
```
- Es una sola consulta por página y usa el índice de la restricción única. Si la base falla, sale el `503` genérico de la base y no se devuelve el historial sin `calificado` (RF-2.5.14).
- `conCalificado` es pura: `{ ...pagina, items: items.map(v => ({ ...v, calificado: calificados.has(v.viajeId.toLowerCase()) })) }`.

## Integraciones
- **M6**, `GET /trips/{id}` (lectura): el mismo `ClienteModulo` de la spec #7, así que un intento tarda como máximo `M2_TIEMPO_MODULOS_MS` (2 s), se reintenta una vez tras 200 ms y, si falla, `503` con `detail` «M6 no está disponible» y `Retry-After` (RNF-13.1 a RNF-13.3). Un `4xx` distinto de `404` no se reintenta y responde `500` (RF-2.5.6). Un `404` es «viaje no encontrado».
- La credencial es el token de servicio de la spec #7, firmado para cada intento (RF-2.5.13); no se reenvía el token de quien llamó a M2.
- La llamada a M6 va **fuera** de la transacción de base de datos (ver Decisiones). La falla de M6 no deja nada guardado: no hay escritura hasta el paso 7.
- No hay variables de entorno nuevas (RNF-06): `M2_URL_M6`, `M2_AUDIENCIA_M6` y `M2_REINTENTAR_DESPUES_S` ya existen.

## Pruebas
- Unitarias: `aCalificacion` (con y sin comentario, comentario vacío presente, `creadoEn` en ISO), `aPaginaCalificaciones` (totales, página vacía), `conCalificado` (con, sin y mayúsculas).
- Módulos (servidor HTTP simulado de M6): `obtenerViaje` con `COMPLETED` y conductor; estados distintos (`IN_PROGRESS`, `CANCELLED_BY_CLIENT`, uno desconocido) que devuelven el estado sin conductor; viaje ajeno y `404` que dan `null`; `400`, `401`, `403` que dan `500`; `5xx`, demora mayor al tiempo y no JSON que dan `503` tras un reintento; `state` o `clientId` ausentes o que no son texto, y `COMPLETED` sin `driverId` o con uno que no es UUID, que dan `503`; el viaje ajeno con respuesta mal formada da `null`, no `503`; el token de servicio llega, verifica con la clave y la audiencia de M6 y es nuevo en cada intento.
- Integración (PostgreSQL real y M6 simulado): alta feliz y fila guardada con el conductor de M6; viaje ajeno, inexistente y no completado sin fila; duplicado con otra clave (`409`) sin llamar a M6, también con M6 caído; repetición con la misma clave y cuerpo (`201` original, sin segunda llamada a M6 y con M6 caído); misma clave con otro cuerpo (`422`); una clave tras un error se evalúa de nuevo; concurrencia (diez altas a la vez con claves distintas: un `201`, nueve `409`, una fila; diez con la misma clave: un solo efecto y la misma respuesta); perfil inexistente sin llamar a M6; `403` de propiedad sin tocar la base; listado (orden, desempate, página vacía y fuera del total, perfil inexistente); lectura por id (propia, ajena, inexistente); `calificado` verdadero y falso en el historial; ningún token, comentario, clave ni identificador en los logs.
- HTTP: `201` con `Location`, `400` (cuerpo, clave, ids, `page`, `size`), `401`, `403` (otro cliente, OPERADOR, SERVICIO), `404`, `409` y `422` con su `type`, `500` y `503` con `Retry-After`, problem+json; el `503` de la base sin `Retry-After`.
- Contrato: las tres operaciones dejan de figurar pendientes. En la prueba de contrato no hay M6, así que `calificarConductor` acepta el `503` y el `422` en `schemathesis.toml`, como el historial y las otras altas.

## Trazabilidad

| Requisito | Cobertura |
|---|---|
| RF-2.5, RF-2.5.1, RF-2.5.2 | `servicio.ts`, `m6.ts`, `repositorio.ts`, pruebas de módulos, integración y HTTP |
| RF-2.5.3, RNF-08 | Migración (restricción única), `servicio.ts` (paso 5 y paso 7), pruebas de integración con concurrencia |
| RF-2.5.4 | `idempotencia.ts` (`buscarRespuesta`), `servicio.ts` (paso 3), pruebas de integración |
| RF-2.5.5, RF-2.5.6, RF-2.5.13, RNF-13 | `m6.ts`, cliente de módulos de la spec #3, pruebas de módulos y HTTP |
| RF-2.5.7 | Validación del contrato y pruebas HTTP |
| RF-2.5.8, RF-2.5.9, RF-2.5.10 | `repositorio.ts`, `modelo.ts`, pruebas de integración y HTTP |
| RF-2.5.11, RF-2.5.12 | `servicio.ts` (pasos 1 y 4), pruebas de integración y HTTP |
| RF-2.5.14 | `historial/servicio.ts`, `historial/modelo.ts`, `repositorio.ts`, pruebas unitarias e integración |
| RNF-03 | Registro por OpenAPI, pruebas HTTP y de contrato |
| RNF-05 | Migración con solo los identificadores del viaje y del conductor; M6 solo por su API |
| RNF-06 | Sin variables nuevas; las de la spec #7 |
| RNF-07 | Unitarias, módulos, HTTP, integración y contrato |
| RNF-14 | Correlación hacia M6 y causa en el log del `503` y del `500` |
| RNF-19 | Pruebas de logs en integración: comentario, clave, token e identificadores fuera del log |
| RNF-20 | Guía por tarea y visión general al validar |

## Decisiones
- **La llamada a M6 va fuera de la transacción.** `conIdempotencia` abre una transacción y ejecuta el alta adentro. Poner ahí la llamada a M6 la mantendría abierta hasta unos 4,2 s, con una conexión del pool ocupada, y una solicitud con la misma clave que llega a la vez esperaría la reserva más que el corte de 2 s por sentencia y fallaría con `503`. En cambio, se leen primero la respuesta guardada, el perfil y el duplicado (pasos 3 a 5), luego se consulta a M6, y recién entonces se abre la transacción corta que reserva la clave e inserta. Alternativa descartada: todo adentro de `alta`, más simple pero con esos dos costos.
- **`buscarRespuesta` es un cambio aditivo en `src/bd/idempotencia.ts`**, de la spec #4: una lectura sin bloqueo que devuelve la respuesta guardada si la solicitud ya se completó, `IdempotenciaReutilizada` si la clave se usó con otro cuerpo, y `null` si no existe o sigue en curso (sin respuesta todavía). Una solicitud en curso sigue su camino y espera en `conIdempotencia`. `conIdempotencia` y su comportamiento no cambian. Alternativa descartada: no leer antes y aceptar que una repetición consulte a M6 de nuevo, que rompería RF-2.5.4 con M6 caído.
- **`obtenerViaje` se agrega a `src/historial/m6.ts`** y no se mueve el archivo: es el mismo cliente, la misma configuración y las mismas funciones de comprobación (`esObjeto`, `esUuid`). Mover el archivo a `src/modulos/` cambiaría imports de la spec #7 sin cambiar nada de lo que hace. Alternativa descartada: un cliente de M6 nuevo, que duplicaría el token de servicio y la configuración.
- **El dueño se comprueba dentro de `obtenerViaje`**, que recibe el `clienteId`: así la regla «el viaje ajeno no revela su estado» no depende de que quien llama se acuerde de aplicarla en orden. Devuelve `null` para el viaje inexistente y para el ajeno.
- **`CalificacionDuplicada` se lanza en el repositorio** al capturar el `Conflicto` genérico que `consultar()` produce por la violación única, porque el `409` de esta operación tiene `type` propio. El `Conflicto` de otro origen sigue siendo genérico. Alternativa descartada: leer el nombre de la restricción del error de pg, que `consultar()` no expone a propósito (RNF-08.1).
- **Sin ADR**: ninguna decisión afecta al grupo ni cambia un acuerdo. **Sin dependencias nuevas.**
- **Migración**: se genera con el nombre y la marca de tiempo del resto (`<marca>_calificaciones.sql`) y se prueba hacia arriba y hacia abajo en `migraciones.test.ts`. Es un cambio de esquema: se pregunta antes de aplicarla en T1 (AGENTS.md).
- **Pruebas de la spec #7**: las que comparan el cuerpo exacto del historial se ajustan para incluir `calificado: false`. No cambia ninguna regla de la #7 salvo lo que RF-2.5.14 amplía.

## Dudas abiertas
Ninguna. Los supuestos con M6 y el Grupo 12 están en `## Decisiones` de la spec.
