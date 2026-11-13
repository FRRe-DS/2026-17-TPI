# Spec 007 — Historial resumido de viajes

Estado: implementada
Issue: #7
Etapa: TP1
Responsable: @sandobaitt

## Contexto y objetivo
El cliente quiere ver un resumen de sus viajes anteriores. Los viajes los guarda M6, no M2: M2 los pide a la API de M6 en cada consulta y los devuelve con el formato del contrato, sin copiarlos ni leer la base de M6 (RNF-05). Si M6 no contesta, M2 lo dice con un error explícito en vez de quedarse esperando (RNF-13). Esta spec cubre RF-2.4 del issue #7 y depende del perfil de la spec #4 y del contrato de M6 publicado en la cátedra (#57, ADR 057), en su versión `35b3c4d` (#96, ADR 096). M2 se presenta ante M6 con un token de servicio propio, según el acuerdo de tokens del consorcio (ADR 009, #9; cambio del #58).

## Usuarios
- Cliente autenticado, que consulta su propio historial.
- Operador, que puede consultar el historial de un cliente para asistirlo.

## Historias de usuario
- HU-1. Como cliente, quiero ver un resumen de mis viajes anteriores para saber qué viajes hice y cómo terminaron.
- HU-2. Como cliente, quiero recorrer mi historial por páginas para encontrar un viaje sin cargar toda la lista.
- HU-3. Como operador, quiero consultar el historial de un cliente para asistirlo sin poder cambiarlo.
- HU-4. Como cliente, quiero que, si el historial no se puede obtener en ese momento, la respuesta me lo diga con claridad para poder reintentar luego.

## Requisitos funcionales
- RF-2.4: CUANDO un CLIENTE consulta el historial de su propio perfil o un OPERADOR el de un cliente existente, EL SISTEMA obtiene los viajes del cliente de la API de M6 y responde `200` con la página pedida, ordenada del viaje más reciente al más antiguo en el orden que entrega M6 (RF-2.4.14).
- RF-2.4.1: EL SISTEMA devuelve de cada viaje su `viajeId`, su `estado` tal como lo informa M6, sin traducirlo, y su `conductorId` si M6 lo informa, y omite los campos del contrato que M6 no informa; si M6 no informa el conductor de un viaje, el viaje se incluye sin `conductorId`. Además, EL SISTEMA agrega a cada viaje `calificado`, que no viene de M6 sino de las calificaciones de M2 (RF-2.5.14 de la spec #8).
- RF-2.4.2: EL SISTEMA responde con `page` y `size` iguales a los pedidos (por defecto `0` y `20`, con `size` de `1` a `100`), `totalElementos` igual al total de viajes que informa M6 y `totalPaginas` igual a `totalElementos` dividido `size`, redondeado hacia arriba.
- RF-2.4.3: CUANDO el cliente existe pero M6 no informa viajes para él, o la página pedida queda fuera del total, EL SISTEMA responde `200` con `items` vacío y los totales que informa M6.
- RF-2.4.4: SI el perfil del `clienteId` no existe en M2, ENTONCES EL SISTEMA responde `404` sin llamar a M6.
- RF-2.4.5: SI CLIENTE es el único rol del token que admite la operación y su `sub` no coincide con `clienteId`, ENTONCES EL SISTEMA responde `403` sin llamar a M6.
- RF-2.4.6: SI M6 no responde a tiempo, no es alcanzable, responde un error `5xx` o una respuesta que no es JSON, ENTONCES EL SISTEMA, tras un solo reintento y sin superar el tiempo total de RNF-13.3, responde `503` en `application/problem+json` que nombra a M6 en `detail`, con la cabecera `Retry-After` (5 segundos por defecto, configurable), y no devuelve un historial parcial.
- RF-2.4.7: SI M6 rechaza el pedido de M2 con un `4xx` distinto de `429` (por ejemplo `401`, `403`, `400` o `404`), ENTONCES EL SISTEMA responde `500` en `application/problem+json` sin datos de M6, porque el cliente de M2 no tiene la culpa, y registra la causa.
- RF-2.4.8: SI `page`, `size` o `clienteId` no cumplen el contrato, ENTONCES EL SISTEMA responde `400` sin llamar a M6.
- RF-2.4.9: EL SISTEMA pide a M6 solo los viajes del `clienteId` de la ruta, y SI M6 devuelve un viaje de otro cliente, ENTONCES EL SISTEMA no lo incluye en la respuesta y registra el hecho sin identificadores.
- RF-2.4.10: SI M6 responde `200` con un total que no es un entero mayor o igual que cero o con más viajes que el tamaño de página pedido, ENTONCES EL SISTEMA lo trata como falta de disponibilidad (RF-2.4.6) y no devuelve la respuesta de M6.
- RF-2.4.11: CUANDO M2 pide viajes a M6, EL SISTEMA envía en `Authorization: Bearer` un token de servicio que firma para ese intento según el acuerdo de M1 (ADR 009): JWT HS256 con la clave compartida del consorcio, `iss` igual al emisor que M2 ya valida, `sub` `m2-clientes`, `roles` `["SERVICIO"]`, `aud` igual a la audiencia de M6 y `exp` 60 segundos después de firmarlo; nunca reenvía el token de quien llamó a M2.
- RF-2.4.14: EL SISTEMA devuelve los viajes de cada página en el mismo orden en que los entrega M6, sin reordenarlos; el orden del más reciente al más antiguo queda a cargo de M6, cuyo contrato lo declara por `createdAt` descendente.
- RF-2.4.15: SI M6 responde `429` (su límite de pedidos), ENTONCES EL SISTEMA no reintenta la llamada y responde `503` en `application/problem+json` que nombra a M6 en `detail`, con la cabecera `Retry-After` igual a los segundos que informa M6 en su `Retry-After` si están escritos solo con dígitos y valen de 1 a 3600 y, si no, igual al valor configurado (RF-2.4.6), y no devuelve un historial parcial.

## Requisitos no funcionales
- RNF-03: EL SISTEMA implementa `listarHistorialViajes` con las validaciones, códigos y errores `application/problem+json` del contrato.
- RNF-05: EL SISTEMA no copia ni guarda viajes de M6 ni lee la base de M6; el historial se arma en cada consulta con la respuesta de la API de M6.
- RNF-06: EL SISTEMA lee la dirección y la audiencia de M6 de variables de entorno, firma el token de servicio con la clave de tokens que ya lee del entorno, no guarda ninguna en el repositorio y no arranca si falta la dirección.
- RNF-07: EL SISTEMA verifica las reglas con pruebas unitarias, HTTP, integración con un M6 simulado y la prueba de contrato.
- RNF-13: CUANDO M2 llama a M6, EL SISTEMA aplica a la llamada el tiempo máximo por intento, el reintento de lecturas y la respuesta `503` definidos por la spec #3 (RNF-13.1 a RNF-13.3); un `429` de M6 no se reintenta (RF-2.4.15).
- RNF-14: EL SISTEMA registra cada llamada a M6, salga bien o mal (RNF-14.10), y la causa de su falla (RNF-14.8), con el identificador de correlación de la solicitud, y le envía ese identificador a M6 en el encabezado que declara su contrato (RNF-14.11).
- RNF-14.10: CUANDO termina una llamada a M6, EL SISTEMA registra una línea con el identificador de correlación de la solicitud, el módulo llamado, el código que respondió M6 (o que no respondió), la cantidad de intentos y la duración total en milisegundos, sin lo que prohíbe RNF-19.
- RNF-14.11: CUANDO M2 llama a M6, EL SISTEMA envía el identificador de correlación de la solicitud en el encabezado `X-Correlation-Id`, que es el que declara el contrato de M6, además del encabezado configurado (RNF-14.7 de la spec #3) y con el mismo valor.
- RNF-14.12: SI el identificador de correlación de la solicitud tiene más de 100 caracteres, que es el máximo que admite el contrato de M6, ENTONCES EL SISTEMA no envía `X-Correlation-Id` en esa llamada, tampoco cuando ese es el encabezado configurado; en ese caso la llamada sale sin identificador de correlación, como excepción a RNF-14.7 de la spec #3.
- RNF-19: EL SISTEMA no registra tokens (ni el de quien llama ni el que firma ante M6), cuerpos de M6, identificadores de viajes ni de conductores en los logs.
- RNF-20: EL SISTEMA documenta en la guía el recorrido de una consulta, qué campos salen de M6, cómo se prueba con un M6 simulado y qué pasa si M6 falla.

## Contrato y dependencias
- Operación del contrato que cubre: `GET /api/v1/clientes/{clienteId}/viajes (listarHistorialViajes)`, roles `CLIENTE` y `OPERADOR`.
- Operaciones de otros módulos que consume: M6, `GET /trips` con el filtro `clientId` y la paginación de M6, para obtener los viajes resumidos del cliente. Si M6 no contesta: RF-2.4.6. Si M6 limita los pedidos de M2 (`429`): RF-2.4.15.
- Depende de la spec #4: toda operación comprueba que el perfil del `clienteId` existe; si no, `404`.
- El contrato de M6 es el publicado en la cátedra (`contratos/m6_viajes/openapi.yml`, commit `35b3c4d`), extraído en `contrato/dependencias/m6.yml` (ADR 096, que actualiza el 057). A un módulo de servicio, M6 le exige `clientId` o `driverId` (`400` sin ninguno de los dos); M2 siempre manda `clientId`. Se prueba con un M6 simulado que cumple ese archivo.
- Ese contrato limita los pedidos de un módulo de servicio a 1200 por minuto: al superarlos responde `429` con `Retry-After` en segundos. También declara `X-Correlation-Id` (hasta 100 caracteres) como encabezado de correlación.
- El token de servicio sigue el acuerdo de M1 del consorcio (ADR 009, #9): mientras M1 no exista, el módulo que llama firma su propio token con la clave compartida.
- La propiedad se exige igual que en las specs #4 y #5: un token con CLIENTE y OPERADOR puede consultar el historial de otro cliente; un token solo CLIENTE, únicamente el propio. SERVICIO no está admitido.

## Casos límite
- El `page` de M2 empieza en `0`, el de M6 en `1`, y el tamaño de página es el mismo: M2 traduce entre los dos y el cliente ve siempre la numeración del contrato de M2.
- Una página fuera del total responde `200` con `items` vacío y los totales correctos.
- M6 tarda más del tiempo máximo en un intento: se reintenta una vez (una lectura) y, si vuelve a fallar, `503`. El tiempo total no supera la suma de los intentos y la pausa.
- M6 responde `200` con un cuerpo que no tiene la forma esperada: es falta de disponibilidad, `503`.
- M6 devuelve un viaje sin `driverId`: su contrato ya lo exige en todo viaje (ADR 096), así que es una respuesta fuera de contrato. M2 lo incluye igual, sin `conductorId` (RF-2.4.1).
- M6 informa un `estado` que M2 no conoce: se devuelve tal cual; el contrato dice «sin traducir».
- El historial no se guarda: dos consultas seguidas pueden devolver resultados distintos si M6 cambió entre ellas.
- Un cliente que existe en M2 y no tiene viajes: `200` con `items` vacío, nunca `404`.
- La base de M2 no responde al buscar el perfil: `503` genérico, sin llamar a M6.
- La base de M2 no responde al buscar `calificado` (RF-2.5.14): `503` genérico, y no se devuelve un historial sin ese campo.
- M6 rechaza el token de servicio de M2 (otra clave, otra audiencia o un rol que no admite): es un `4xx` de M6, `500` (RF-2.4.7).
- El reintento lleva un token nuevo, firmado para ese intento: nunca vence entre un intento y el siguiente.
- M6 entrega una página fuera de orden: M2 la devuelve igual. El orden es responsabilidad de M6 y M2 no lo verifica ni lo corrige (RF-2.4.14).
- Una llamada a M6 que sale bien al segundo intento deja una sola línea con dos intentos y el código final (RNF-14.10).
- M6 responde `429` con `Retry-After: 30`: M2 responde `503` con `Retry-After: 30`, sin reintentar. Si el `Retry-After` de M6 falta, es `0`, pasa de 3600 (también un número enorme) o trae algo que no son solo dígitos (un signo, decimales, una unidad como `30s`, una fecha HTTP o el encabezado repetido, que llega como `30, 30`), M2 responde `503` con el valor configurado. Los ceros a la izquierda valen: `030` es 30 y M2 responde `Retry-After: 30` (RF-2.4.15).
- Un intento a M6 falla por tiempo y el reintento recibe `429`: vale el `429`, y M2 responde `503` con el `Retry-After` de M6.
- El identificador de correlación tiene entre 101 y 128 caracteres (la spec #3 admite hasta 128, RNF-14.3): M2 se lo manda a M6 en el encabezado configurado y no en `X-Correlation-Id` (RNF-14.12).
- El encabezado configurado (`M2_ENCABEZADO_CORRELACION`) ya es `X-Correlation-Id`: M2 lo envía una sola vez. Con un identificador de más de 100 caracteres no lo envía, y esa llamada sale sin correlación (RNF-14.12).
- El identificador tiene exactamente 100 caracteres: se envía en `X-Correlation-Id`.

## Fuera de alcance
- Guardar o cachear viajes de M6 (la caché queda para TP2).
- Obtener `calificado` de M6: no es un dato de M6. Lo completa M2 con sus propias calificaciones, en la spec #8 (RF-2.5.14).
- Devolver `origen`, `destino`, `iniciadoEn` y `finalizadoEn`, que el resumen de M6 no informa.
- Devolver `tipoVehiculo`: el resumen de M6 ya trae `vehicleType`, pero con valores (`CAR`, `MOTORCYCLE`) que no son los del contrato de M2 (`AUTO`, `MOTO`). Ver Decisiones.
- Frenar los pedidos a M6 antes de llegar a su límite con los encabezados `RateLimit-*`, y usar su GET condicional (`If-None-Match`) o sus filtros `from`, `to` y `state`.
- Filtrar por estado o fecha, cambiar el orden o consultar el detalle de un viaje.
- Reordenar los viajes o comprobar el orden que entrega M6 (RF-2.4.14).
- Traducir los estados de M6 a los de M2.
- Recibir eventos de M6; en TP1 M2 solo lee.
- Pedir el token de servicio a M1 o firmarlo con clave asimétrica: queda para cuando M1 exista (ADR 009).

## Criterios de finalización
- `listarHistorialViajes` figura como implementada y pasa la prueba de contrato.
- Las pruebas cubren propiedad y permisos, perfil inexistente, traducción de páginas, página vacía y fuera del total, campos presentes y ausentes, y fallas de M6 (tiempo, 5xx, no JSON, 4xx).
- `npm test`, `npm run lint`, `npm run build`, `npm run contrato:test` y `node scripts/spec-check.mjs` terminan en verde.
- El M6 simulado de las pruebas cumple `contrato/dependencias/m6.yml` (ADR 096), comprueba el token de servicio de M2 y lee la correlación de `X-Correlation-Id`.
- La guía explica el recorrido y cómo probarlo con un M6 simulado.
- Una prueba comprueba que M2 conserva el orden de M6 (RF-2.4.14) y otra, la línea de log de una llamada a M6 que sale bien y de una que falla (RNF-14.10).
- La guía incluye `calificado` (spec #8) y remite a la prueba con el M6 real del Grupo 12 (spec #81).
- Las pruebas comprueban el `503` ante un `429` de M6, con el `Retry-After` de M6 y con el configurado, y que no se reintenta (RF-2.4.15); y que cada llamada a M6 lleva `X-Correlation-Id` con el identificador de la solicitud, salvo cuando pasa de 100 caracteres (RNF-14.11, RNF-14.12).
- La guía y los textos de las pruebas ya no nombran `CANCELLED_BY_*`, `/trips/{id}`, `/api/v1` en la dirección de M6 ni `ErrorResponse`.

## Decisiones
- Se devuelve solo lo que el resumen de M6 informa (`viajeId`, `estado`, `conductorId`) y se omite el resto, más `calificado`, que completa M2 (spec #8), porque el contrato de M2 lo permite (solo `viajeId` y `estado` son obligatorios) y no se inventan datos. Alternativas descartadas: pedir el detalle de cada viaje a M6 (hasta 100 llamadas por consulta y datos de ubicación que M2 no necesita) y completar fechas con valores que no son las del viaje.
- Los permisos siguen a las specs #4 y #5: el mismo criterio de propiedad por rol efectivo.
- Un `4xx` de M6 responde `500` y no un error de cliente, porque indica un problema de configuración o de acuerdo entre módulos, no del pedido del cliente. La excepción es el `429`, que no es un rechazo sino un límite (RF-2.4.15).
- Se exige `Retry-After` solo en este `503`, con 5 segundos por defecto configurables, porque el contrato lo declara para esta respuesta y hoy ningún `503` de M2 lo envía. Alternativa descartada: dejarlo sin cumplir.
- La dirección y la audiencia de M6 son variables de entorno, y la dirección es obligatoria al arrancar para que una mala configuración se vea al iniciar. Alternativa descartada: dejarla opcional y responder `503` sin llamar.
- M2 firma su propio token de servicio, de vida corta y nuevo en cada intento, porque el acuerdo de M1 (ADR 009) dice que todo token vence y que, mientras M1 no exista, el módulo que llama firma el suyo con la clave compartida; M6 ya acepta `roles: ["SERVICIO"]`. Alternativas descartadas: un token fijo por variable de entorno, como se había implementado en T1 y T2 (vence, o no vence y viola el acuerdo), y reenviar el token del cliente (el acuerdo no lo prevé, y con el de un operador M6 no filtraría igual).
- M2 manda siempre el `clienteId` de la ruta, que además es el filtro que M6 exige a un token de servicio, y descarta cualquier viaje de otro cliente por si M6 devolviera uno. Un `404` de M6 se trata como `4xx` (RF-2.4.7): es un error de configuración, no un cliente sin viajes.
- `conductorId` se devuelve si M6 lo informa y nunca se registra en los logs.
- El orden del historial (del más reciente al más antiguo, RF-2.4) queda a cargo de M6, que pagina y declara `createdAt` descendente en su contrato; M2 conserva el orden que recibe (RF-2.4.14). Decidido por Lautaro el 2026-11-08, tras la validación. Alternativas descartadas: reordenar en M2 (solo ordenaría dentro de una página, porque la paginación la hace M6, y el resumen de M2 no trae la fecha) y pedir a M6 un parámetro de orden (su contrato no lo tiene).
- Toda llamada a M6 deja una línea de log al terminar, no solo las que fallan (RNF-14.10), para poder seguir una solicitud entre M2 y M6 con el mismo identificador. La validación encontró que solo se registraban las fallas.
- **Cambio del 2026-11-11 (#96, ADR 096): M2 se alinea con la versión `35b3c4d` del contrato de M6.**
  - Un `429` de M6 responde `503` con el `Retry-After` de M6 y no se reintenta (RF-2.4.15). Hasta ahora daba `500` como cualquier `4xx`, que le dice al cliente que algo está roto cuando solo hay que esperar. El límite de M6 es por módulo y por minuto: M6 sabe cuándo se reinicia, y reintentar a los 200 ms cae en la misma ventana y gasta otro pedido. Se acepta el valor de M6 de 1 a 3600 segundos, el mismo rango que `M2_REINTENTAR_DESPUES_S`. Alternativas descartadas: seguir con `500`, reintentar, y usar siempre el valor configurado. No se pide cambio del contrato de M2: el `503` de `listarHistorialViajes` ya declara `Retry-After`, y aunque su descripción dice que M6 «no respondió a tiempo», para quien llama a M2 un `429` de M6 es lo mismo: M6 no puede atender ahora y hay que reintentar después.
  - M2 manda la correlación a M6 también en `X-Correlation-Id` (RNF-14.11), como se anticipó en la spec #81: M6 lee ese encabezado y no `X-Request-Id`, así que hasta ahora generaba su propio identificador y un pedido no se podía seguir de un módulo al otro. Alternativa descartada: cambiar el valor por defecto de `M2_ENCABEZADO_CORRELACION`, que cambia el encabezado que M2 recibe y devuelve a quienes lo llaman (spec #3).
  - Un identificador de más de 100 caracteres no se manda en `X-Correlation-Id` (RNF-14.12): se pierde la traza de esa llamada en M6, pero M2 no manda un valor que el contrato de M6 no admite. Alternativas descartadas: mandarlo igual (un M6 que valide el largo respondería `400` y M2 `500`, por un encabezado que eligió quien llama) y recortarlo (en M6 quedaría un identificador que no es el de M2). Si el encabezado configurado es el mismo `X-Correlation-Id`, es el único caso en que M2 no envía la correlación que pide RNF-14.7 de la spec #3; la excepción está escrita en RNF-14.12 y la spec #3 no se cambia, porque su regla general sigue valiendo.
  - M2 se sigue presentando con `roles: ["SERVICIO"]` (RF-2.4.11). Decidido por Lautaro el 2026-11-11. El contrato publicado nombra el rol `SYSTEM` pero no dice en qué campo del token va; `SERVICIO` es el rol del acuerdo de M1 (ADR 009) y del contrato de M2, el M6 real del Grupo 12 lo acepta como alias de `SYSTEM` (spec #81) y ese grupo dijo que va a subir los alias a la cátedra. Riesgo aceptado: el M6 del Grupo 5 no está obligado a aceptarlo; si un M6 lo rechaza, M2 responde `500` (RF-2.4.7) y se cambia el rol con otro cambio de esta spec. Alternativa descartada: pasar a `SYSTEM` adivinando el campo.
  - `tipoVehiculo` sigue fuera de alcance aunque el resumen de M6 ya trae `vehicleType`: el contrato de la cátedra dice `CAR` y `MOTORCYCLE`, el de M2 `AUTO` y `MOTO`, y el repositorio del Grupo 12 ya pasó a `AUTO` y `MOTO` sin subirlo todavía a la cátedra. Cuando ese cambio entre, M2 lo devuelve sin traducir, con otro cambio de esta spec. Alternativa descartada: traducir ahora los valores, que habría que deshacer.
  - M2 sigue aceptando un viaje sin `driverId` aunque el contrato de M6 ya lo exige (decisión de Lautaro del 2026-11-10): incluirlo sin `conductorId` no inventa datos y evita que un viaje mal informado deje al cliente sin historial.
- Supuestos provisorios a confirmar con M6 y el Grupo 1. Ninguno cambia el plan; si alguno cambia, se ajusta la configuración:
  - Audiencia y emisor que valida M6: su contrato no los dice. Supuesto: `aud` `m6-viajes` (configurable) e `iss` el del consorcio (`m1-identidad`). Pregunta abierta para el Grupo 12 en FRRe-DS/2026-12-TPI#9.
  - Campos del resumen: `TripSummary` no trae origen, destino ni fechas de inicio y fin (`createdAt` no es el inicio del viaje), y su `vehicleType` todavía no coincide con el de M2. Se devuelven solo `viajeId`, `estado` y `conductorId`, más `calificado`, que completa M2 con sus calificaciones (spec #8).
  - Contrato del Grupo 5: es el mismo que publica la cátedra, confirmado por los dos grupos (ADR 096).
  - `type` del `503` por dependencia: el contrato dice «propio» sin fijar valor. Supuesto: `about:blank`, como la spec #3. Depende del Grupo 1.

## Dudas abiertas
Ninguna. Lo que depende de M6 y del Grupo 1 está como supuesto en `## Decisiones`.
