# Spec 005 — Direcciones frecuentes

Estado: borrador
Issue: #5
Etapa: TP1
Responsable: @pablonacho

## Contexto y objetivo
El cliente necesita conservar orígenes y destinos favoritos o recientes para reutilizarlos. M2 guarda una copia propia del texto y, si se informan, las coordenadas; no guarda identificadores internos ni consulta la base de M4. Esta spec cubre RF-2.2 del issue #5 y depende de que exista el perfil de la spec #4.

## Usuarios
- Cliente autenticado, que administra sus propias direcciones.
- Operador, que puede consultarlas para asistencia sin modificarlas.

## Historias de usuario
- HU-1. Como cliente, quiero registrar una dirección favorita o reciente para volver a usarla sin escribirla otra vez.
- HU-2. Como cliente, quiero listar y filtrar mis direcciones para encontrar rápidamente la adecuada.
- HU-3. Como cliente, quiero corregir o eliminar una dirección que ya no utilizo.
- HU-4. Como operador, quiero consultar las direcciones de un cliente para asistirlo sin poder cambiarlas.

## Requisitos funcionales
- RF-2.2: CUANDO un CLIENTE registra para su propio perfil una dirección válida de tipo `FAVORITA` o `RECIENTE`, EL SISTEMA guarda una copia propia del texto, alias opcional y coordenadas opcionales, responde `201` y devuelve una cabecera `Location`.
- RF-2.2.1: CUANDO un CLIENTE lista sus direcciones o un OPERADOR lista las de un cliente existente, EL SISTEMA devuelve una página ordenada de la más nueva a la más antigua y, si se envía `tipo`, incluye solo `FAVORITA` o `RECIENTE` según corresponda.
- RF-2.2.2: CUANDO un CLIENTE consulta una dirección propia o un OPERADOR consulta una dirección del cliente indicado, EL SISTEMA responde `200` con esa dirección; SI la dirección no pertenece al cliente de la ruta o no existe, ENTONCES EL SISTEMA responde `404`.
- RF-2.2.3: CUANDO un CLIENTE envía uno o más campos válidos de una dirección propia, EL SISTEMA actualiza solo esos campos, conserva los demás y responde `200`.
- RF-2.2.4: CUANDO un CLIENTE elimina una dirección propia existente, EL SISTEMA la elimina y responde `204` sin cuerpo; SI vuelve a consultarla o eliminarla, ENTONCES EL SISTEMA responde `404`.
- RF-2.2.5: SI un CLIENTE intenta listar, crear, consultar, actualizar o eliminar direcciones bajo otro `clienteId`, ENTONCES EL SISTEMA responde `403`; un OPERADOR solo puede listar y consultar.

## Requisitos no funcionales
- RNF-03.1: EL SISTEMA implementa exactamente las cinco operaciones, validaciones, códigos y errores `application/problem+json` definidos para direcciones en `contrato/openapi.yml`.
- RNF-05.1: EL SISTEMA guarda la copia de cada dirección solo en la base propia de M2 mediante una migración versionada y no accede a datos internos de M4.
- RNF-07.1: EL SISTEMA verifica las reglas con pruebas unitarias, HTTP, integración sobre PostgreSQL real y pruebas de contrato.
- RNF-08.1: SI se repite o concurre un alta con la misma clave de idempotencia, ENTONCES EL SISTEMA produce un solo efecto y devuelve la respuesta prevista por el contrato.
- RNF-19.1: EL SISTEMA no registra textos, alias, coordenadas, cuerpos, tokens ni claves de idempotencia en los logs.
- RNF-20.1: EL SISTEMA documenta en la guía el modelo de copia propia, permisos y forma de probar las direcciones.

## Contrato y dependencias
- Operaciones que cubre: `GET /api/v1/clientes/{clienteId}/direcciones (listarDirecciones)`, `POST /api/v1/clientes/{clienteId}/direcciones (crearDireccion)`, `GET /api/v1/clientes/{clienteId}/direcciones/{direccionId} (obtenerDireccion)`, `PATCH /api/v1/clientes/{clienteId}/direcciones/{direccionId} (actualizarDireccion)` y `DELETE /api/v1/clientes/{clienteId}/direcciones/{direccionId} (eliminarDireccion)`.
- Depende de la spec #4: toda operación comprueba que el perfil del `clienteId` existe; si no, responde `404`.
- M4 puede haber originado el texto o las coordenadas fuera de M2, pero M2 no lo llama y no conserva identificadores de M4.
- CLIENTE administra solo sus direcciones; OPERADOR tiene lectura; SERVICIO no está admitido por estas operaciones.

## Casos límite
- Texto vacío, texto de más de 255 caracteres, alias de más de 50, latitud fuera de `[-90, 90]`, longitud fuera de `[-180, 180]`, coordenadas incompletas, tipo desconocido o campos extra responden `400`.
- Alias vacío es válido porque el contrato no fija longitud mínima; no equivale a un alias ausente.
- El contrato no permite `null` en alias ni coordenadas: un PATCH puede reemplazarlos, pero no quitarlos. Cambiar esa capacidad requiere primero cambiar el contrato.
- La misma dirección puede existir más de una vez si se crea con claves idempotentes diferentes; esta spec no define igualdad semántica entre textos o coordenadas.
- Repetir un POST con la misma `Idempotency-Key` y el mismo cuerpo devuelve la respuesta original; reutilizarla con otro cuerpo responde `422`.
- Una página fuera del total responde `200` con `items` vacío y conserva los totales correctos.
- El orden es estable aunque dos direcciones tengan la misma fecha de creación.
- Una dirección de otro cliente nunca se revela: dentro del cliente pedido responde `404`.
- El borrado es definitivo; no hay historial de direcciones eliminadas en el contrato ni en el issue.

## Fuera de alcance
- Geocodificar texto, validar que una dirección exista en el mundo real o llamar a M4.
- Sincronizar automáticamente lugares usados en viajes o crear recientes desde otro módulo.
- Limitar la cantidad de favoritas o recientes y eliminar recientes automáticamente.
- Compartir direcciones entre clientes o conservar un historial después del borrado.
- Permitir quitar alias o coordenadas con `null` sin un cambio previo del contrato.

## Criterios de finalización
- Las cinco operaciones figuran como implementadas y pasan la prueba de contrato.
- Las pruebas cubren propiedad, permisos, validación, filtro, paginación, orden, actualización parcial, borrado e idempotencia concurrente.
- `npm test`, `npm run lint`, `npm run build`, `npm run contrato:test` y `node scripts/spec-check.mjs` terminan en verde.
- La migración es reversible y la guía contiene ejemplos reproducibles sin exponer ubicaciones reales.

## Decisiones
- M2 almacena una instantánea autónoma de texto y coordenadas, sin referencia a M4, como exige RNF-05.
- El listado se ordena por `creadoEn` descendente y luego por `direccionId` descendente para que la paginación sea estable.
- El DELETE realiza borrado físico porque ni el contrato ni el issue piden historial; agregar borrado lógico cambiaría la semántica y el almacenamiento sin beneficio requerido.

## Dudas abiertas
- [NECESITA ACLARACIÓN] Confirmar el `type` del 422 por reutilizar una clave con otro cuerpo; se recomienda el mismo `/errores/idempotencia-reutilizada` de la spec #4.
