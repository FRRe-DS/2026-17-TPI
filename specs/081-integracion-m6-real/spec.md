# Spec 081 — Integración distribuida de M2 con el M6 real del Grupo 12

Estado: aprobada
Issue: #81
Etapa: TP2
Responsable: @sandobaitt

## Contexto y objetivo
M2 consume a M6 (Viajes y Ciclo de Vida) en dos funcionalidades: el historial de viajes de un cliente (RF-2.4, spec 007) y la calificación de un viaje completado (RF-2.5, spec 008). Hasta ahora todo se probó contra un M6 simulado que cumple `contrato/dependencias/m6.yml`, extraído del contrato de la cátedra.

Ese contrato se mergeó en la cátedra el 2026-10-29 (FRRe-DS/2026-TPI#9) y el Grupo 12 ya tiene su implementación en `FRRe-DS/2026-12-TPI`: un servicio en el puerto 3006, con su base PostgreSQL y su `docker-compose.yml`. Para la entrega de TP2 la cátedra pide probar la integración con otro módulo (RNF-07, integración distribuida). La prueba mostró que el M6 real ya seguía una versión más nueva del contrato (`35b3c4d`, 2026-11-01); desde el 2026-11-11 `m6.yml` es la extracción de esa versión (#96, ADR 096).

El objetivo es levantar M2 junto al M6 real, recorrer contra él los escenarios de historial, calificación y falla, y dejar escrito qué difiere entre lo que M2 supone (`m6.yml`) y lo que M6 hace. La spec no agrega funcionalidad a M2: M2 sigue siendo el mismo servicio, apuntado a otro M6 solo por configuración. Si la prueba descubre una diferencia que obligue a cambiar M2, ese cambio va por `sdd-change` en la spec que corresponda (007 u 008), no acá.

En esta spec «el sistema» es el conjunto M2 más el entorno de integración (compose y prueba) que lo corre contra el M6 real.

## Usuarios
- Integrante del grupo: levanta M2 con el M6 real y corre la prueba antes de una entrega.
- Evaluador de la cátedra: ve la integración funcionando con un módulo de otro grupo.
- Grupo 12: recibe las diferencias que la prueba encuentre en su módulo.

## Historias de usuario
- HU-1. Como integrante del grupo, quiero levantar M2 y el M6 real del Grupo 12 con un comando, para probar la integración sin armar nada a mano (RNF-04).
- HU-2. Como integrante del grupo, quiero que el historial y la calificación se prueben contra el M6 real, para saber que M2 funciona con el módulo de verdad y no solo con su simulación (RNF-07).
- HU-3. Como evaluador, quiero ver qué hace M2 cuando el M6 real se detiene o no contesta, para comprobar que no se bloquea y que lo propio de M2 sigue funcionando (RNF-13).
- HU-4. Como integrante del grupo, quiero que las diferencias entre `m6.yml` y el M6 real queden anotadas con su resolución, para que el Grupo 12 y nosotros sepamos qué corregir y dónde.

## Requisitos funcionales
(Ninguno: M2 no cambia. Los comportamientos de historial y calificación ya están en las specs 007 y 008; esta spec pide comprobarlos contra el M6 real y por eso van como requisitos no funcionales.)

## Requisitos no funcionales
- RNF-04.9: EL SISTEMA permite levantar el M6 real del Grupo 12, con su propia base, junto a M2 mediante un perfil de compose, a partir de una versión fija de su repositorio, sin copiar su código al repositorio de M2 y sin reemplazar al servicio `m6` simulado.
- RNF-06.6: CUANDO el M6 real está levantado, EL SISTEMA lo alcanza desde M2 solo por configuración externa (`M2_URL_M6`), sin cambios en `src/`.
- RNF-07.7: CUANDO se corre la prueba de integración distribuida, EL SISTEMA levanta M2, su base y el M6 real, y ejecuta contra el M6 real todos los escenarios de esta spec, sin el M6 simulado.
- RNF-07.8: CUANDO un cliente tiene viajes creados en el M6 real y se pide su historial, EL SISTEMA responde `200` con esos viajes y solo esos, con el campo `calificado` en `true` o `false` según la tabla de calificaciones de M2, y con la paginación de M2 (`page` desde 0 y `size`) traducida a la de M6 (`page` desde 1 y `pageSize`).
- RNF-07.9: CUANDO un cliente califica un viaje que el M6 real llevó a `COMPLETED`, EL SISTEMA responde `201` y guarda como conductor el que informó M6; CUANDO el mismo cliente vuelve a calificar ese viaje con otra `Idempotency-Key`, EL SISTEMA responde `409` con `type: /errores/calificacion-duplicada` y conserva solo la primera calificación.
- RNF-07.10: SI el viaje que se califica no existe en M6, o pertenece a otro cliente, ENTONCES EL SISTEMA responde `404` y no guarda nada; SI el viaje existe pero no está en `COMPLETED`, ENTONCES EL SISTEMA responde `422` con `type: /errores/viaje-no-completado` y no guarda nada.
- RNF-07.11: CUANDO M2 consulta al M6 real con su token de servicio (`sub` `m2-clientes`, `roles` `["SERVICIO"]`, ADR 009), EL SISTEMA obtiene una respuesta distinta de `401` y `403`; SI M6 rechaza ese token, ENTONCES la prueba falla y muestra el código y el `code` de error de M6.
- RNF-07.14: CUANDO la prueba de integración distribuida le manda al M6 real un pedido con el encabezado `X-Correlation-Id`, EL SISTEMA comprueba que la respuesta de M6 trae ese mismo valor en `X-Correlation-Id`; SI no lo trae, ENTONCES la prueba falla y muestra el valor recibido.
- RNF-13.8: CUANDO el M6 real se detiene o no responde dentro del tiempo máximo de M2, EL SISTEMA responde `503` con `Retry-After` en el historial y en la calificación, y sigue respondiendo `200` en el perfil y en las direcciones; CUANDO M6 vuelve a estar disponible, EL SISTEMA vuelve a responder `200` en el historial y `201` en la calificación, sin reiniciar M2.
- RNF-20.4: EL SISTEMA documenta en `docs/probar-m2.md` cómo levantar M2 con el M6 real y correr la prueba (comandos, versión de M6 usada y salida esperada), y en la guía de esta spec cada diferencia encontrada con el comportamiento observado, lo que dice `m6.yml` y a quién se le consulta.

## Contrato y dependencias
- Operaciones del contrato que cubre: `GET /api/v1/clientes/{clienteId}/viajes` (`listarHistorialViajes`), `POST /api/v1/clientes/{clienteId}/calificaciones` (`calificarConductor`), y para comprobar el resultado `listarCalificaciones` y `obtenerCalificacion`. No se agrega ni se cambia ninguna operación.
- Operaciones de otros módulos que consume:
  - M6, `listTrips` (`GET /trips`, con `clientId`): si no responde, `503` con `Retry-After` (RF-2.4.6).
  - M6, `getTrip` (`GET /trips/{tripId}`): si no responde, `503` con `Retry-After` (RF-2.5.5).
  - Solo para preparar la prueba, no las consume M2: `createTrip`, `registerArrival`, `startTrip` y `completeTrip` de M6, que llevan un viaje de `PENDING_ARRIVAL` a `COMPLETED`.

## Casos límite
- Un cliente sin viajes en el M6 real: el historial devuelve una página vacía con `200`.
- Un viaje del cliente en `CANCELLED` o en curso: no se puede calificar (`422`).
- M6 limita los pedidos por servicio (1200 por minuto, `429` con `Retry-After`): la prueba no puede acercarse a ese límite. Qué responde M2 ante ese `429` está en las specs 007 y 008 (RF-2.4.15 y RF-2.5.18) y se prueba con el M6 simulado, no acá.
- Iniciar un viaje en M6 exige un código de QR, que hoy M6 valida de forma simulada dentro de su propio servicio. Si el Grupo 12 integra el M8 real, ese paso de la prueba puede cambiar.
- El M6 real no valida la firma del token (su README lo anota como pendiente): la prueba no demuestra que M6 autentique a M2, solo que lo acepta y lo reconoce con el rol correcto.
- M2 le manda a M6 la correlación en `X-Correlation-Id` (RNF-14.11 de la spec 007) y M6 la devuelve en su respuesta, pero la respuesta de M6 a M2 no se ve desde afuera. Por eso se comprueban las dos mitades por separado: que M2 lo envía, en las pruebas de la spec 007 con el M6 simulado; que el M6 real lo toma y lo devuelve, acá (RNF-07.14).
- El contrato publicado de M6 nombra el rol `SYSTEM` y M2 se presenta con `roles: ["SERVICIO"]`, que el M6 real acepta como alias documentado solo en su repositorio. Si una versión nueva de M6 deja de aceptarlo, RNF-07.11 falla y lo avisa.

## Fuera de alcance
- Cambiar el código o el contrato de M6.
- Probar que M5 o M9 consulten el estado de cuenta de M2 (otro issue; ver #54).
- Reemplazar el M6 simulado del panel y de las pruebas existentes, que se quedan para las demostraciones y para las pruebas que no necesitan a otro grupo.
- Pruebas de carga o de rendimiento (RNF-16, TP3), y provocar el `429` del M6 real, que exige más de 1200 pedidos en un minuto.
- Validar los tokens con Keycloak (#80).

## Criterios de finalización
- Un perfil de compose levanta el M6 real (versión fija) con su base, y M2 responde contra él cambiando solo `M2_URL_M6`.
- La prueba de integración corre todos los escenarios de RNF-07.8 a RNF-07.11, RNF-07.14 y RNF-13.8 contra el M6 real y termina en verde.
- Cada diferencia encontrada entre `m6.yml` y el M6 real figura en la guía con su resolución, y las que correspondan al Grupo 12 están comunicadas en su repositorio.
- `docs/probar-m2.md` explica cómo repetir la prueba.
- La tabla de diferencias de la guía compara al M6 real con `m6.yml` en su versión `35b3c4d`: las filas que eran diferencias solo porque `m6.yml` estaba desactualizado (1, 4, 11 y 12) figuran como cerradas, y las del `429` y de `X-Correlation-Id` (7 y 8), como resueltas por las specs 007 y 008.
- `npm test` y `node scripts/spec-check.mjs` en verde.

## Decisiones
Aclaradas el 2026-11-07, por delegación de @sandobaitt (se aplicó la recomendación de cada una).
- **Cómo se levanta el M6 real:** un servicio de compose, en un perfil propio, cuyo `build` apunta al repositorio del Grupo 12 fijado a un commit (RNF-04.9). No se copia su código y la versión queda reproducible. Alternativa descartada: clonarlo a mano en una carpeta, que depende de lo que cada persona tenga en su máquina.
- **Qué commit se fija:** el último de la rama por defecto del Grupo 12 al escribir el plan, anotado en `docs/probar-m2.md`, y se actualiza a propósito cuando ellos cambien. Su rama por defecto no es `main` sino `m6/base-de-datos`; hoy termina en `7d3d5af` (2026-11-06, merge del PR #6 «1er adaptación nuevo contrato»). El plan lo fija y la tarea de compose lo vuelve a comprobar antes de usarlo.
- **Si la prueba corre en CI:** no en cada PR, porque construir otro repositorio alarga el CI. Corre en un job aparte, al mergear a `main` y a pedido, y cada persona la corre en local antes de una entrega. Ese job no es uno de los checks que exige la protección de `main`. Alternativa descartada: correrla en cada PR, que haría depender el merge de un repositorio ajeno.
- **Qué responde M2 ante un `429` de M6:** hoy da `500`; la propuesta es `503` con el `Retry-After` de M6, tratándolo como falta de disponibilidad. Cambia las specs 007 y 008, así que va por `sdd-change` en un issue aparte y no se resuelve acá. Esta spec no depende de eso: la prueba se mantiene lejos del límite (ver Casos límite). **Resuelto el 2026-11-11:** RF-2.4.15 de la spec 007 y RF-2.5.18 de la 008 (#96).
- **`X-Correlation-Id`:** M2 mandará también ese encabezado, con el mismo valor que `X-Request-Id`, para poder seguir un pedido de un módulo al otro (RNF-14). Va por `sdd-change` de la 007 y la 008, en un issue aparte. Mientras tanto la diferencia queda anotada en la guía. **Resuelto el 2026-11-11:** RNF-14.11 y RNF-14.12 de la spec 007 (#96).
- **Cómo comunicar las diferencias al Grupo 12:** un issue en su repositorio por cada diferencia, enlazado desde la guía. Publicarlos es una acción hacia afuera del grupo: se redactan en la implementación y se publican solo con el OK de @sandobaitt.
- **RNF-13.8 y el código de la calificación (cambio del 2026-11-08):** el texto decía que, al volver M6, la calificación respondía `200`. Es `201`, como dice el contrato (`calificarConductor`), RNF-07.9 de esta misma spec, el plan y `resiliencia.test.ts`. Se corrige solo el texto; no cambia código, plan ni tareas. Alternativa descartada: cambiar el contrato o la prueba a `200`, que contradiría a RNF-07.9 y a lo acordado con la cátedra.
- **Cambio del 2026-11-11 (#96, ADR 096): `m6.yml` pasa a la versión `35b3c4d` del contrato de M6.**
  - Se suma RNF-07.14: la prueba comprueba contra el M6 real que `X-Correlation-Id` es el encabezado que M6 toma y devuelve. Es la mitad que el M6 simulado no puede demostrar. Alternativa descartada: comprobar de punta a punta que el identificador de un pedido a M2 llega a M6, porque M2 no muestra la respuesta de M6 y el M6 real no registra las consultas en su log (visto en su commit `7d3d5af`).
  - M2 se sigue presentando con `roles: ["SERVICIO"]` y RNF-07.11 no cambia (decisión de Lautaro del 2026-11-11, en la spec 007).
  - La tabla de diferencias se pone al día en la guía: varias filas existían solo porque `m6.yml` era de una versión anterior.

## Dudas abiertas
Ninguna.
