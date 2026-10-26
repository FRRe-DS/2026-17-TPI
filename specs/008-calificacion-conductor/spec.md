# Spec 008 — Calificación del conductor

Estado: aprobada
Issue: #8
Etapa: TP1
Responsable: @sandobaitt

## Contexto y objetivo
Después de un viaje completado, el cliente quiere valorar al conductor con un puntaje del 1 al 5 y, si quiere, un comentario. El viaje y su conductor los conoce M6, no M2: M2 le pregunta a M6 si el viaje está completado y si el cliente fue su pasajero, y de esa respuesta saca el conductor calificado (el cliente no lo informa). M2 guarda solo la calificación, con una copia propia del identificador del viaje y del conductor, y no copia datos del viaje (RNF-05). Cada viaje se califica una sola vez por el mismo cliente, y esa garantía vive en la base y en la idempotencia, no solo en el código (RNF-08). Esta spec cubre RF-2.5 del issue #8 y depende del perfil de la spec #4, del contrato de M6 que el Grupo 12 subió a la cátedra (#57, ADR 057) y del token de servicio de la spec #7 (ADR 009).

## Usuarios
- Cliente autenticado, que califica los viajes que hizo y consulta sus calificaciones.
- Operador, que puede consultar las calificaciones de un cliente para asistirlo, sin poder crearlas.

## Historias de usuario
- HU-1. Como cliente, quiero calificar al conductor de un viaje completado para dejar mi valoración del servicio.
- HU-2. Como cliente, quiero que un reintento o un doble toque no cree dos calificaciones del mismo viaje para que mi valoración cuente una sola vez.
- HU-3. Como cliente, quiero listar y consultar mis calificaciones para ver qué valoré.
- HU-4. Como cliente, quiero ver en mi historial qué viajes ya califiqué para no intentarlo de nuevo.
- HU-5. Como operador, quiero consultar las calificaciones de un cliente para asistirlo sin poder cambiarlas.

## Requisitos funcionales
- RF-2.5: CUANDO un CLIENTE envía para su propio perfil un `viajeId` y un `puntaje` válidos, con `comentario` opcional, de un viaje que M6 informa `COMPLETED` y cuyo `clientId` es el del cliente, EL SISTEMA guarda la calificación con el `conductorId` que informa M6, responde `201` con la calificación y devuelve una cabecera `Location` que apunta a ella.
- RF-2.5.1: SI M6 informa que el viaje no existe o que pertenece a otro cliente, ENTONCES EL SISTEMA responde `404` sin guardar nada y sin distinguir los dos casos.
- RF-2.5.2: SI M6 informa un viaje del cliente cuyo `state` es un texto distinto de `COMPLETED` (incluido uno que M2 no conoce), ENTONCES EL SISTEMA responde `422` con `type: /errores/viaje-no-completado` sin guardar nada.
- RF-2.5.3: SI el cliente ya calificó ese viaje, ENTONCES EL SISTEMA responde `409` con `type: /errores/calificacion-duplicada`, también cuando el segundo intento llega con otra `Idempotency-Key` o a la vez que el primero, y conserva solo la primera calificación; cuando la calificación ya existe en la base de M2, lo responde sin llamar a M6.
- RF-2.5.4: CUANDO se repite una calificación con la misma `Idempotency-Key` y el mismo cuerpo, EL SISTEMA devuelve la respuesta original (`201`, mismo cuerpo y `Location`) sin crear otra calificación y sin volver a consultar a M6; solo se guarda la respuesta exitosa, así que una clave cuyo primer intento terminó en error se evalúa de nuevo; SI la clave se reutiliza con otro cuerpo, ENTONCES EL SISTEMA responde `422` con `type: /errores/idempotencia-reutilizada`.
- RF-2.5.5: SI M6 no responde a tiempo, no es alcanzable, responde un error `5xx`, una respuesta que no es JSON, o un viaje sin la forma esperada (sin `state` o con un `state` que no es texto, sin `clientId`, o, estando `COMPLETED`, sin `driverId` o con un `driverId` que no es un UUID), ENTONCES EL SISTEMA, tras el reintento de RNF-13, responde `503` en `application/problem+json` que nombra a M6 en `detail`, con la cabecera `Retry-After` (la misma configuración que el historial), y no guarda nada.
- RF-2.5.6: SI M6 rechaza el pedido de M2 con un `4xx` distinto de `404` (por ejemplo `401`, `403` o `400`), ENTONCES EL SISTEMA responde `500` en `application/problem+json` sin datos de M6, porque el cliente de M2 no tiene la culpa, y registra la causa.
- RF-2.5.7: SI el cuerpo no cumple el contrato (falta `viajeId` o `puntaje`, `viajeId` no es un UUID, `puntaje` no es un entero de 1 a 5, `comentario` de más de 500 caracteres, campos extra) o falta la `Idempotency-Key` (1 a 255 caracteres), o SI en cualquiera de las tres operaciones `clienteId` o `calificacionId` no son UUID, o `page` o `size` están fuera de rango, ENTONCES EL SISTEMA responde `400` sin llamar a M6 ni guardar nada.
- RF-2.5.8: CUANDO un CLIENTE lista sus calificaciones o un OPERADOR lista las de un cliente existente, EL SISTEMA devuelve una página ordenada de la más nueva a la más antigua, con un orden estable aunque dos calificaciones tengan la misma fecha de creación, con `page` y `size` iguales a los pedidos (por defecto `0` y `20`, con `size` de `1` a `100`), `totalElementos` igual a la cantidad de calificaciones del cliente y `totalPaginas` igual a `totalElementos` dividido `size`, redondeado hacia arriba.
- RF-2.5.9: CUANDO el cliente existe pero no tiene calificaciones, o la página pedida queda fuera del total, EL SISTEMA responde `200` con `items` vacío y los totales correctos.
- RF-2.5.10: CUANDO una persona con un rol admitido consulta una calificación que pertenece al cliente de la ruta, EL SISTEMA responde `200` con esa calificación; SI la calificación no existe o es de otro cliente, ENTONCES EL SISTEMA responde `404`.
- RF-2.5.11: SI el perfil del `clienteId` no existe en M2, ENTONCES EL SISTEMA responde `404` sin llamar a M6.
- RF-2.5.12: SI CLIENTE es el único rol del token que admite la operación y su `sub` no coincide con `clienteId`, ENTONCES EL SISTEMA responde `403` sin llamar a M6.
- RF-2.5.13: CUANDO M2 consulta el viaje a M6, EL SISTEMA usa el token de servicio de la spec #7 (RF-2.4.11), firmado para cada intento, y nunca reenvía el token de quien llamó a M2.
- RF-2.5.14: CUANDO un CLIENTE o un OPERADOR consulta el historial de un cliente (spec #7), EL SISTEMA agrega a cada viaje `calificado` igual a `true` si ese cliente tiene una calificación de ese viaje y `false` si no, a partir de la base de M2 y sin llamar de nuevo a M6; SI la base de M2 no responde, ENTONCES EL SISTEMA responde `503` genérico y no devuelve el historial sin `calificado`.

## Requisitos no funcionales
- RNF-03: EL SISTEMA implementa `listarCalificaciones`, `calificarConductor` y `obtenerCalificacion` con las validaciones, códigos y errores `application/problem+json` del contrato.
- RNF-05: EL SISTEMA guarda las calificaciones solo en la base propia de M2 mediante una migración versionada, y del viaje conserva únicamente su identificador y el del conductor; no copia otros datos de M6 ni lee su base.
- RNF-06: EL SISTEMA usa para M6 la misma dirección, audiencia y clave que el historial, sin variables nuevas obligatorias.
- RNF-07: EL SISTEMA verifica las reglas con pruebas unitarias, HTTP, integración sobre PostgreSQL real con un M6 simulado, y la prueba de contrato.
- RNF-08: SI se repite o concurre una calificación del mismo viaje y cliente, con la misma clave de idempotencia o con otra, ENTONCES EL SISTEMA produce un solo registro, garantizado por una restricción única en la base, y las demás solicitudes reciben la respuesta de RF-2.5.3 o RF-2.5.4.
- RNF-13: CUANDO M2 llama a M6, EL SISTEMA aplica el tiempo máximo por intento, el reintento de lecturas y la respuesta `503` definidos por la spec #3 (RNF-13.1 a RNF-13.3); la consulta del viaje es una lectura (`GET`).
- RNF-14: EL SISTEMA registra la causa de cada falla de la llamada a M6 con el identificador de correlación de la solicitud, como el historial de la spec #7.
- RNF-19: EL SISTEMA no registra tokens, comentarios, claves de idempotencia, ni identificadores de viajes, conductores o calificaciones en los logs.
- RNF-20: EL SISTEMA documenta en la guía el recorrido de una calificación, qué sale de M6, cómo se garantiza la unicidad y cómo se prueba con un M6 simulado.

## Contrato y dependencias
- Operaciones del contrato que cubre:
  - `GET /api/v1/clientes/{clienteId}/calificaciones (listarCalificaciones)`, roles `CLIENTE` y `OPERADOR`;
  - `POST /api/v1/clientes/{clienteId}/calificaciones (calificarConductor)`, rol `CLIENTE`;
  - `GET /api/v1/clientes/{clienteId}/calificaciones/{calificacionId} (obtenerCalificacion)`, roles `CLIENTE` y `OPERADOR`.
- Amplía `GET /api/v1/clientes/{clienteId}/viajes (listarHistorialViajes)`, de la spec #7, con el campo `calificado` que el contrato ya declara (RF-2.5.14).
- Operaciones de otros módulos que consume: M6, `GET /trips/{id}`, para verificar que el viaje esté `COMPLETED`, que su `clientId` sea el del cliente y obtener su `driverId`. Si M6 no contesta: RF-2.5.5.
- Depende de la spec #4: toda operación comprueba que el perfil del `clienteId` existe; si no, `404`.
- Depende de la spec #7: el cliente de M6, el token de servicio, el tiempo máximo, el reintento y la configuración.
- La propiedad se exige igual que en las specs #4, #5 y #7: `calificarConductor` solo admite CLIENTE, así que solo el propio cliente califica; un token CLIENTE+OPERADOR puede listar y consultar las calificaciones de otro cliente. SERVICIO no está admitido.
- El contrato de M6 es el extraído en `contrato/dependencias/m6.yml` (ADR 057); se prueba con un M6 simulado que lo cumple. El contrato de M6 no declara campos obligatorios en `Trip`: M2 exige `state`, `clientId` y, para calificar, `driverId`.

## Casos límite
- Viaje inexistente en M6 y viaje de otro cliente dan el mismo `404`, para no revelar a un cliente que un viaje ajeno existe.
- Un viaje en cualquier estado distinto de `COMPLETED` (`PENDING_ARRIVAL`, `DRIVER_ARRIVED`, `IN_PROGRESS`, `CANCELLED_BY_CLIENT`, `CANCELLED_BY_DRIVER` o un texto que M2 no conoce) da `422` `viaje-no-completado`; no se guarda nada. Si `state` falta o no es texto, es `503`.
- Dos solicitudes simultáneas con claves distintas para el mismo viaje: una responde `201` y la otra `409`; en la base queda una sola fila.
- Dos solicitudes simultáneas con la misma clave y el mismo cuerpo: un solo efecto y la misma respuesta para ambas.
- Un cliente puede calificar dos viajes distintos del mismo conductor; el límite es uno por viaje y cliente.
- `puntaje` `0`, `6`, `4.5`, `"5"` o `null` responden `400`; `comentario` vacío es válido porque el contrato no fija mínimo.
- El `conductorId` guardado es el que informó M6 en ese momento; no cambia si M6 reasigna el viaje después.
- Si M6 falla, nada se guarda; el cliente puede reintentar con la misma clave y la calificación se crea cuando M6 vuelva. Lo mismo vale para un `404` o un `422`: la clave no queda gastada, y si el viaje termina después, el mismo reintento funciona.
- El viaje ya está calificado y M6 está caído: un intento con otra clave responde `409`, porque la calificación existe en la base de M2 y no hace falta consultar a M6.
- Un token sin rol CLIENTE (solo OPERADOR o SERVICIO) que intenta calificar recibe `403`: la operación solo admite CLIENTE.
- Los UUID de la ruta, del cuerpo y de M6 se comparan sin distinguir mayúsculas de minúsculas.
- Un reintento con la misma clave y el mismo cuerpo después de que se creó la calificación devuelve `201` con la original aunque M6 esté caído, porque no se vuelve a consultar.
- Un cliente con bloqueo vigente puede calificar: el bloqueo lo consultan otros módulos y no restringe esta operación.
- La base de M2 no responde: `503` genérico (`about:blank`), sin guardar nada.
- Una calificación de otro cliente nunca se revela: dentro del cliente pedido responde `404`.

## Fuera de alcance
- Calcular o exponer el promedio de calificación del conductor, por M2 o por M3: el contrato de M2 no lo tiene. Si algún módulo lo necesita, se pide por un cambio de contrato aparte.
- Editar, borrar o reemplazar una calificación: el contrato no tiene esas operaciones.
- Plazo máximo para calificar después del viaje.
- Calificar al cliente (RF-3.7, que es de M3) o enviar la calificación al conductor o a M6.
- Moderar o filtrar comentarios.
- Eventos hacia otros módulos: en TP1 M2 solo lee de M6.
- Pedir el token de servicio a M1 o firmarlo con clave asimétrica (ADR 009).

## Criterios de finalización
- `listarCalificaciones`, `calificarConductor` y `obtenerCalificacion` figuran como implementadas y pasan la prueba de contrato; `listarHistorialViajes` devuelve `calificado`.
- Las pruebas cubren: calificación feliz, viaje inexistente, ajeno, no completado, duplicado con otra clave y concurrente, repetición idempotente con la misma clave y con otro cuerpo, validación del cuerpo, permisos, perfil inexistente, listado y página vacía, fallas de M6 (tiempo, 5xx, no JSON, forma incompleta, 4xx), y `calificado` en el historial con y sin calificación.
- Existe una restricción única en la base sobre cliente y viaje, comprobada en una prueba de integración con concurrencia.
- `npm test`, `npm run lint`, `npm run build`, `npm run contrato:test` y `node scripts/spec-check.mjs` terminan en verde.
- El M6 simulado de las pruebas cumple `contrato/dependencias/m6.yml` y comprueba el token de servicio.
- La guía explica el recorrido y cómo probarlo con un M6 simulado.

## Decisiones
- El promedio del conductor queda fuera de alcance: el contrato de M2 no lo tiene y exponerlo exige acordarlo con el Grupo 1 y con M3. Alternativas descartadas: exponerlo desde M2 o dejar que lo calcule M3 ahora, porque ambas piden un cambio de contrato que no es solo nuestro.
- Un viaje ajeno responde `404`, igual que uno inexistente, para no revelar su existencia. Alternativas descartadas: `403`, que confirma que el viaje existe, y `422`, que se confunde con «viaje no completado».
- Un viaje `COMPLETED` sin `driverId`, o con una respuesta sin `state` o `clientId`, es falta de disponibilidad (`503`) como en el historial (RF-2.4.10 de la spec #7): el contrato de M2 exige `conductorId` y M2 no inventa conductores. Alternativas descartadas: `422`, porque el cliente no tiene la culpa, y guardar sin conductor.
- Un cliente bloqueado puede calificar: el bloqueo se consulta desde M5 y M9 para pedir o pagar viajes, el contrato no lo exige aquí y el viaje ya ocurrió. Alternativa descartada: rechazar con `403` o `422`, que agrega una regla que nadie pidió.
- `calificado` se completa en esta spec (RF-2.5.14) porque su sentido es «el cliente ya calificó este viaje» y solo existe cuando hay calificaciones; la spec #7 lo dejó fuera de alcance hasta esta. Lo resuelve una consulta a la base de M2 por página, sin pasar por M6. Alternativa descartada: dejarlo para una spec aparte, que obligaría a abrir otro cambio de la #7 para un campo que ya está en el contrato.
- La verificación del viaje usa el mismo cliente, token de servicio, tiempo máximo y reintento que el historial. Un `404` de M6 es «viaje no encontrado» (`404`), no un error de configuración, porque aquí M2 consulta un viaje puntual que el cliente nombró; en el historial, en cambio, el `404` no tiene sentido. Los demás `4xx` siguen siendo `500` (RF-2.5.6).
- Los `type` de error son estables y relativos: `/errores/calificacion-duplicada` (el que muestra el contrato), `/errores/viaje-no-completado` y `/errores/idempotencia-reutilizada` (el de las specs #4 y #5). El `503` por M6 usa `about:blank`, como en la spec #7, hasta que el Grupo 1 fije un valor.
- Supuestos a confirmar con M6 y el Grupo 12, ninguno cambia el plan: que `GET /trips/{id}` acepte a un token de servicio (el contrato lo dice en su descripción), que `state` `COMPLETED` sea el único estado que habilita calificar y que `driverId` venga informado en todo viaje completado y que los estados sean los de su contrato (`PENDING_ARRIVAL`, `DRIVER_ARRIVED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED_BY_CLIENT`, `CANCELLED_BY_DRIVER`); si cambian, se ajusta el cliente de M6 (ver `contrato/dependencias/m6-propuesta.md`, preguntas 5 y 6).

- Cuando el viaje ya está calificado en la base de M2, el `409` sale sin llamar a M6, porque es un dato propio, no revela nada ajeno y ahorra una llamada. Alternativa descartada: consultar siempre a M6 primero, que daría `503` a quien reintenta con M6 caído aunque la respuesta ya se conozca.
- Solo la respuesta exitosa de una clave de idempotencia se guarda, como en las specs #4 y #5: un error no gasta la clave, y quien reintenta cuando el viaje ya terminó o M6 volvió consigue la calificación. Alternativa descartada: guardar también los errores, que obligaría al cliente a inventar una clave nueva tras cada falla.
- Cualquier `state` de texto distinto de `COMPLETED` da `422`, y `503` solo si falta o no es texto, porque solo `COMPLETED` habilita calificar y así M2 no se rompe si M6 agrega estados. Alternativa descartada: `503` ante un estado desconocido, que le diría al cliente que reintente algo que nunca va a funcionar.
- RNF-14 se escribe como en la spec #7: se registra la causa de las fallas de la llamada a M6, no cada llamada. Registrar todas queda para el cambio pendiente que arregla las dos specs a la vez.
- RF-2.5.14 reemplaza la línea «Calcular o devolver `calificado`» del fuera de alcance de la spec #7 y completa su RF-2.4.1. Esa spec se actualiza después con `sdd-change`, en otra rama y con su issue; esta PR no la toca.

## Dudas abiertas
Ninguna. Lo que depende de M6 y del Grupo 1 está como supuesto en `## Decisiones`.
