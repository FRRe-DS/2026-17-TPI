# Spec 081 — Integración distribuida de M2 con el M6 real del Grupo 12

Estado: implementada
Issue: #81
Etapa: TP2
Responsable: @sandobaitt

## Contexto y objetivo
M2 consume a M6 (Viajes y Ciclo de Vida) en dos funcionalidades: el historial de viajes de un cliente (RF-2.4, spec 007) y la calificación de un viaje completado (RF-2.5, spec 008). Hasta ahora todo se probó contra un M6 simulado que cumple `contrato/dependencias/m6.yml`, extraído del contrato de la cátedra.

Ese contrato se mergeó en la cátedra el 2026-10-29 (FRRe-DS/2026-TPI#9) y el Grupo 12 ya tiene su implementación en `FRRe-DS/2026-12-TPI`: un servicio en el puerto 3006, con su base PostgreSQL y su `docker-compose.yml`. Para la entrega de TP2 la cátedra pide probar la integración con otro módulo (RNF-07, integración distribuida).

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
- RNF-13.8: CUANDO el M6 real se detiene o no responde dentro del tiempo máximo de M2, EL SISTEMA responde `503` con `Retry-After` en el historial y en la calificación, y sigue respondiendo `200` en el perfil y en las direcciones; CUANDO M6 vuelve a estar disponible, EL SISTEMA vuelve a responder `200` en historial y calificación sin reiniciar M2.
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
- M6 limita los pedidos por servicio (1200 por minuto, `429` con `Retry-After`): la prueba no puede acercarse a ese límite.
- Iniciar un viaje en M6 exige un código de QR, que hoy M6 valida de forma simulada dentro de su propio servicio. Si el Grupo 12 integra el M8 real, ese paso de la prueba puede cambiar.
- El M6 real no valida la firma del token (su README lo anota como pendiente): la prueba no demuestra que M6 autentique a M2, solo que lo acepta y lo reconoce con el rol correcto.
- M6 lee el encabezado `X-Correlation-Id` y M2 manda `X-Request-Id`: hoy un pedido no se puede seguir de un módulo al otro por su identificador.

## Fuera de alcance
- Cambiar el código o el contrato de M6.
- Probar que M5 o M9 consulten el estado de cuenta de M2 (otro issue; ver #54).
- Reemplazar el M6 simulado del panel y de las pruebas existentes, que se quedan para las demostraciones y para las pruebas que no necesitan a otro grupo.
- Pruebas de carga o de rendimiento (RNF-16, TP3).
- Validar los tokens con Keycloak (#80).

## Criterios de finalización
- Un perfil de compose levanta el M6 real (versión fija) con su base, y M2 responde contra él cambiando solo `M2_URL_M6`.
- La prueba de integración corre todos los escenarios de RNF-07.8 a RNF-07.11 y RNF-13.8 contra el M6 real y termina en verde.
- Cada diferencia encontrada entre `m6.yml` y el M6 real figura en la guía con su resolución, y las que correspondan al Grupo 12 están comunicadas en su repositorio.
- `docs/probar-m2.md` explica cómo repetir la prueba.
- `npm test` y `node scripts/spec-check.mjs` en verde.

## Decisiones
Aclaradas el 2026-11-07, por delegación de @sandobaitt (se aplicó la recomendación de cada una).
- **Cómo se levanta el M6 real:** un servicio de compose, en un perfil propio, cuyo `build` apunta al repositorio del Grupo 12 fijado a un commit (RNF-04.9). No se copia su código y la versión queda reproducible. Alternativa descartada: clonarlo a mano en una carpeta, que depende de lo que cada persona tenga en su máquina.
- **Qué commit se fija:** el último de la rama por defecto del Grupo 12 al escribir el plan, anotado en `docs/probar-m2.md`, y se actualiza a propósito cuando ellos cambien. Su rama por defecto no es `main` sino `m6/base-de-datos`; hoy termina en `7d3d5af` (2026-11-06, merge del PR #6 «1er adaptación nuevo contrato»). El plan lo fija y la tarea de compose lo vuelve a comprobar antes de usarlo.
- **Si la prueba corre en CI:** no en cada PR, porque construir otro repositorio alarga el CI. Corre en un job aparte, al mergear a `main` y a pedido, y cada persona la corre en local antes de una entrega. Ese job no es uno de los checks que exige la protección de `main`. Alternativa descartada: correrla en cada PR, que haría depender el merge de un repositorio ajeno.
- **Qué responde M2 ante un `429` de M6:** hoy da `500`; la propuesta es `503` con el `Retry-After` de M6, tratándolo como falta de disponibilidad. Cambia las specs 007 y 008, así que va por `sdd-change` en un issue aparte y no se resuelve acá. Esta spec no depende de eso: la prueba se mantiene lejos del límite (ver Casos límite).
- **`X-Correlation-Id`:** M2 mandará también ese encabezado, con el mismo valor que `X-Request-Id`, para poder seguir un pedido de un módulo al otro (RNF-14). Va por `sdd-change` de la 007 y la 008, en un issue aparte. Mientras tanto la diferencia queda anotada en la guía.
- **Cómo comunicar las diferencias al Grupo 12:** un issue en su repositorio por cada diferencia, enlazado desde la guía. Publicarlos es una acción hacia afuera del grupo: se redactan en la implementación y se publican solo con el OK de @sandobaitt.

## Dudas abiertas
Ninguna.
