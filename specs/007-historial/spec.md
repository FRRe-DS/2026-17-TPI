# Spec 007 — Historial resumido de viajes

Estado: aprobada
Issue: #7
Etapa: TP1
Responsable: @sandobaitt

## Contexto y objetivo
El cliente quiere ver un resumen de sus viajes anteriores. Los viajes los guarda M6, no M2: M2 los pide a la API de M6 en cada consulta y los devuelve con el formato del contrato, sin copiarlos ni leer la base de M6 (RNF-05). Si M6 no contesta, M2 lo dice con un error explícito en vez de quedarse esperando (RNF-13). Esta spec cubre RF-2.4 del issue #7 y depende del perfil de la spec #4 y del contrato de M6 que el Grupo 12 subió a la cátedra (#57, ADR 057). M2 se presenta ante M6 con un token de servicio propio, según el acuerdo de tokens del consorcio (ADR 009, #9; cambio del #58).

## Usuarios
- Cliente autenticado, que consulta su propio historial.
- Operador, que puede consultar el historial de un cliente para asistirlo.

## Historias de usuario
- HU-1. Como cliente, quiero ver un resumen de mis viajes anteriores para saber qué viajes hice y cómo terminaron.
- HU-2. Como cliente, quiero recorrer mi historial por páginas para encontrar un viaje sin cargar toda la lista.
- HU-3. Como operador, quiero consultar el historial de un cliente para asistirlo sin poder cambiarlo.
- HU-4. Como cliente, quiero que, si el historial no se puede obtener en ese momento, la respuesta me lo diga con claridad para poder reintentar luego.

## Requisitos funcionales
- RF-2.4: CUANDO un CLIENTE consulta el historial de su propio perfil o un OPERADOR el de un cliente existente, EL SISTEMA obtiene los viajes del cliente de la API de M6 y responde `200` con la página pedida, ordenada del viaje más reciente al más antiguo.
- RF-2.4.1: EL SISTEMA devuelve de cada viaje su `viajeId`, su `estado` tal como lo informa M6, sin traducirlo, y su `conductorId` si M6 lo informa, y omite los campos del contrato que M6 no informa; si M6 no informa el conductor de un viaje, el viaje se incluye sin `conductorId`.
- RF-2.4.2: EL SISTEMA responde con `page` y `size` iguales a los pedidos (por defecto `0` y `20`, con `size` de `1` a `100`), `totalElementos` igual al total de viajes que informa M6 y `totalPaginas` igual a `totalElementos` dividido `size`, redondeado hacia arriba.
- RF-2.4.3: CUANDO el cliente existe pero M6 no informa viajes para él, o la página pedida queda fuera del total, EL SISTEMA responde `200` con `items` vacío y los totales que informa M6.
- RF-2.4.4: SI el perfil del `clienteId` no existe en M2, ENTONCES EL SISTEMA responde `404` sin llamar a M6.
- RF-2.4.5: SI CLIENTE es el único rol del token que admite la operación y su `sub` no coincide con `clienteId`, ENTONCES EL SISTEMA responde `403` sin llamar a M6.
- RF-2.4.6: SI M6 no responde a tiempo, no es alcanzable, responde un error `5xx` o una respuesta que no es JSON, ENTONCES EL SISTEMA, tras un solo reintento y sin superar el tiempo total de RNF-13.3, responde `503` en `application/problem+json` que nombra a M6 en `detail`, con la cabecera `Retry-After` (5 segundos por defecto, configurable), y no devuelve un historial parcial.
- RF-2.4.7: SI M6 rechaza el pedido de M2 con un `4xx` (por ejemplo `401`, `403` o `400`), ENTONCES EL SISTEMA responde `500` en `application/problem+json` sin datos de M6, porque el cliente de M2 no tiene la culpa, y registra la causa.
- RF-2.4.8: SI `page`, `size` o `clienteId` no cumplen el contrato, ENTONCES EL SISTEMA responde `400` sin llamar a M6.
- RF-2.4.9: EL SISTEMA pide a M6 solo los viajes del `clienteId` de la ruta, y SI M6 devuelve un viaje de otro cliente, ENTONCES EL SISTEMA no lo incluye en la respuesta y registra el hecho sin identificadores.
- RF-2.4.10: SI M6 responde `200` con un total que no es un entero mayor o igual que cero o con más viajes que el tamaño de página pedido, ENTONCES EL SISTEMA lo trata como falta de disponibilidad (RF-2.4.6) y no devuelve la respuesta de M6.
- RF-2.4.11: CUANDO M2 pide viajes a M6, EL SISTEMA envía en `Authorization: Bearer` un token de servicio que firma para ese intento según el acuerdo de M1 (ADR 009): JWT HS256 con la clave compartida del consorcio, `iss` igual al emisor que M2 ya valida, `sub` `m2-clientes`, `roles` `["SERVICIO"]`, `aud` igual a la audiencia de M6 y `exp` 60 segundos después de firmarlo; nunca reenvía el token de quien llamó a M2.

## Requisitos no funcionales
- RNF-03: EL SISTEMA implementa `listarHistorialViajes` con las validaciones, códigos y errores `application/problem+json` del contrato.
- RNF-05: EL SISTEMA no copia ni guarda viajes de M6 ni lee la base de M6; el historial se arma en cada consulta con la respuesta de la API de M6.
- RNF-06: EL SISTEMA lee la dirección y la audiencia de M6 de variables de entorno, firma el token de servicio con la clave de tokens que ya lee del entorno, no guarda ninguna en el repositorio y no arranca si falta la dirección.
- RNF-07: EL SISTEMA verifica las reglas con pruebas unitarias, HTTP, integración con un M6 simulado y la prueba de contrato.
- RNF-13: CUANDO M2 llama a M6, EL SISTEMA aplica a la llamada el tiempo máximo por intento, el reintento de lecturas y la respuesta `503` definidos por la spec #3 (RNF-13.1 a RNF-13.3).
- RNF-14: EL SISTEMA registra la llamada a M6 y su causa de falla con el identificador de correlación de la solicitud.
- RNF-19: EL SISTEMA no registra tokens (ni el de quien llama ni el que firma ante M6), cuerpos de M6, identificadores de viajes ni de conductores en los logs.
- RNF-20: EL SISTEMA documenta en la guía el recorrido de una consulta, qué campos salen de M6, cómo se prueba con un M6 simulado y qué pasa si M6 falla.

## Contrato y dependencias
- Operación del contrato que cubre: `GET /api/v1/clientes/{clienteId}/viajes (listarHistorialViajes)`, roles `CLIENTE` y `OPERADOR`.
- Operaciones de otros módulos que consume: M6, `GET /trips` con el filtro `clientId` y la paginación de M6, para obtener los viajes resumidos del cliente. Si M6 no contesta: RF-2.4.6.
- Depende de la spec #4: toda operación comprueba que el perfil del `clienteId` existe; si no, `404`.
- El contrato de M6 es el que el Grupo 12 subió a la cátedra (FRRe-DS/2026-TPI#9), extraído en `contrato/dependencias/m6.yml` (ADR 057). Con un token de servicio, M6 exige al menos un filtro (`400` sin él). Se prueba con un M6 simulado que cumple ese archivo.
- El token de servicio sigue el acuerdo de M1 del consorcio (ADR 009, #9): mientras M1 no exista, el módulo que llama firma su propio token con la clave compartida.
- La propiedad se exige igual que en las specs #4 y #5: un token con CLIENTE y OPERADOR puede consultar el historial de otro cliente; un token solo CLIENTE, únicamente el propio. SERVICIO no está admitido.

## Casos límite
- El `page` de M2 empieza en `0`, el de M6 en `1`, y el tamaño de página es el mismo: M2 traduce entre los dos y el cliente ve siempre la numeración del contrato de M2.
- Una página fuera del total responde `200` con `items` vacío y los totales correctos.
- M6 tarda más del tiempo máximo en un intento: se reintenta una vez (una lectura) y, si vuelve a fallar, `503`. El tiempo total no supera la suma de los intentos y la pausa.
- M6 responde `200` con un cuerpo que no tiene la forma esperada: es falta de disponibilidad, `503`.
- M6 devuelve un viaje sin `driverId` (por ejemplo, uno cancelado antes de asignar conductor): el viaje se incluye sin `conductorId`.
- M6 informa un `estado` que M2 no conoce: se devuelve tal cual; el contrato dice «sin traducir».
- El historial no se guarda: dos consultas seguidas pueden devolver resultados distintos si M6 cambió entre ellas.
- Un cliente que existe en M2 y no tiene viajes: `200` con `items` vacío, nunca `404`.
- La base de M2 no responde al buscar el perfil: `503` genérico, sin llamar a M6.
- M6 rechaza el token de servicio de M2 (otra clave, otra audiencia o un rol que no admite): es un `4xx` de M6, `500` (RF-2.4.7).
- El reintento lleva un token nuevo, firmado para ese intento: nunca vence entre un intento y el siguiente.

## Fuera de alcance
- Guardar o cachear viajes de M6 (la caché queda para TP2).
- Calcular o devolver `calificado`: depende de las calificaciones de la spec de RF-2.5, que todavía no existe. Hasta entonces el campo no se devuelve.
- Devolver `tipoVehiculo`, `origen`, `destino`, `iniciadoEn` y `finalizadoEn` mientras M6 no los informe en el resumen.
- Filtrar por estado o fecha, cambiar el orden o consultar el detalle de un viaje.
- Traducir los estados de M6 a los de M2.
- Recibir eventos de M6; en TP1 M2 solo lee.
- Pedir el token de servicio a M1 o firmarlo con clave asimétrica: queda para cuando M1 exista (ADR 009).

## Criterios de finalización
- `listarHistorialViajes` figura como implementada y pasa la prueba de contrato.
- Las pruebas cubren propiedad y permisos, perfil inexistente, traducción de páginas, página vacía y fuera del total, campos presentes y ausentes, y fallas de M6 (tiempo, 5xx, no JSON, 4xx).
- `npm test`, `npm run lint`, `npm run build`, `npm run contrato:test` y `node scripts/spec-check.mjs` terminan en verde.
- El M6 simulado de las pruebas cumple `contrato/dependencias/m6.yml` (ADR 057) y comprueba el token de servicio de M2.
- La guía explica el recorrido y cómo probarlo con un M6 simulado.

## Decisiones
- Se devuelve solo lo que el resumen de M6 informa (`viajeId`, `estado`, `conductorId`) y se omite el resto, porque el contrato de M2 lo permite (solo `viajeId` y `estado` son obligatorios) y no se inventan datos. Alternativas descartadas: pedir el detalle de cada viaje a M6 (hasta 100 llamadas por consulta y datos de ubicación que M2 no necesita) y completar fechas con valores que no son las del viaje.
- Los permisos siguen a las specs #4 y #5: el mismo criterio de propiedad por rol efectivo.
- Un `4xx` de M6 responde `500` y no un error de cliente, porque indica un problema de configuración o de acuerdo entre módulos, no del pedido del cliente. [Pendiente de confirmar al acordar el contrato con M6.]
- Se exige `Retry-After` solo en este `503`, con 5 segundos por defecto configurables, porque el contrato lo declara para esta respuesta y hoy ningún `503` de M2 lo envía. Alternativa descartada: dejarlo sin cumplir.
- La dirección y la audiencia de M6 son variables de entorno, y la dirección es obligatoria al arrancar para que una mala configuración se vea al iniciar. Alternativa descartada: dejarla opcional y responder `503` sin llamar.
- M2 firma su propio token de servicio, de vida corta y nuevo en cada intento, porque el acuerdo de M1 (ADR 009) dice que todo token vence y que, mientras M1 no exista, el módulo que llama firma el suyo con la clave compartida; M6 ya acepta `roles: ["SERVICIO"]`. Alternativas descartadas: un token fijo por variable de entorno, como se había implementado en T1 y T2 (vence, o no vence y viola el acuerdo), y reenviar el token del cliente (el acuerdo no lo prevé, y con el de un operador M6 no filtraría igual).
- M2 manda siempre el `clienteId` de la ruta, que además es el filtro que M6 exige a un token de servicio, y descarta cualquier viaje de otro cliente por si M6 devolviera uno. Un `404` de M6 se trata como `4xx` (RF-2.4.7): es un error de configuración, no un cliente sin viajes.
- `conductorId` se devuelve si M6 lo informa y nunca se registra en los logs.
- Supuestos provisorios a confirmar con M6 y el Grupo 1. Ninguno cambia el plan; si alguno cambia, se ajusta la configuración:
  - Audiencia y emisor que valida M6: su contrato no los dice. Supuesto: `aud` `m6-viajes` (configurable) e `iss` el del consorcio (`m1-identidad`). Pregunta para el Grupo 12 en `contrato/dependencias/m6-propuesta.md` (#57).
  - Campos del resumen: `TripSummary` no trae origen, destino, tipo de vehículo ni fechas de inicio y fin (`createdAt` no es el inicio del viaje). Se devuelven solo `viajeId`, `estado` y `conductorId`.
  - Contrato del Grupo 5: es el mismo que subió el Grupo 12 a la cátedra (ADR 057).
  - `type` del `503` por dependencia: el contrato dice «propio» sin fijar valor. Supuesto: `about:blank`, como la spec #3. Depende del Grupo 1.

## Dudas abiertas
Ninguna. Lo que depende de M6 y del Grupo 1 está como supuesto en `## Decisiones`.
