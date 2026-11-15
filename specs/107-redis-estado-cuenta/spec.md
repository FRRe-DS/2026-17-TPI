# Spec 107 — Caché del estado de cuenta con Redis

Estado: aprobada
Issue: #107
Etapa: TP2
Responsable: @sandobaitt

## Contexto y objetivo
M5 y M9 consultan el estado de cuenta de un cliente (`obtenerEstadoCuenta`, RF-2.6) cada vez que necesitan saber si puede operar. Hoy cada consulta calcula los bloqueos vigentes contra la base de M2. RNF-11 pide que un estado efímero se administre con Redis, con vencimiento (TTL) e invalidación.

El objetivo es que las lecturas repetidas del estado de cuenta no lleguen a la base, sin cambiar nunca lo que el cliente ve: la base sigue siendo la única fuente de verdad (RNF-05) y Redis solo guarda una copia que caduca. Si Redis no está, M2 sigue respondiendo igual desde la base (RNF-13).

Esta spec no cambia el contrato: la respuesta de `obtenerEstadoCuenta` es la misma con o sin caché. Depende de la spec 004 (perfil, estado de cuenta y bloqueos), ya implementada.

## Usuarios
- M5 y M9, con un token de rol SERVICIO y scope `clientes.estado:read`: son quienes más consultan.
- CLIENTE y OPERADOR: consultan el estado de cuenta; el OPERADOR además registra y levanta bloqueos.
- Quien opera M2: necesita ver si la caché funciona sin leer datos de ningún cliente.

## Historias de usuario
- HU-1. Como módulo que consulta el estado de cuenta, quiero respuestas rápidas aunque consulte muchas veces el mismo cliente, para no frenar mi propia operación.
- HU-2. Como operador, quiero que un bloqueo recién registrado o levantado se refleje en la siguiente consulta, para que la cuenta no quede habilitada o bloqueada por error.
- HU-3. Como quien opera M2, quiero que una caída de Redis no tire el servicio, para que M2 siga respondiendo desde su base.

## Requisitos funcionales
- RF-2.6.5: CUANDO se consulta el estado de una cuenta existente y la copia guardada en Redis para ese cliente no venció, EL SISTEMA responde `200` con esa copia sin consultar la base de datos para calcular el estado.
- RF-2.6.5.1: CUANDO se consulta el estado de una cuenta existente y no hay copia vigente en Redis, EL SISTEMA calcula el estado desde la base, responde `200` y guarda una copia con un tiempo de vida.
- RF-2.6.5.2: EL SISTEMA responde con el mismo cuerpo `EstadoCuenta` del contrato, con los mismos campos y la misma forma, haya salido de Redis o de la base.
- RF-2.6.5.3: EL SISTEMA verifica el token, el rol, el scope y la propiedad del cliente antes de mirar la caché, así que una copia guardada no se entrega a quien no tiene permiso.
- RF-2.6.5.4: SI el cliente consultado no existe, ENTONCES EL SISTEMA responde `404` sin guardar nada en Redis.
- RF-2.6.6: CUANDO un OPERADOR registra un bloqueo y la base lo confirma (`201`), EL SISTEMA descarta la copia guardada de ese cliente antes de responder, de modo que la siguiente consulta refleje el bloqueo.
- RF-2.6.6.1: CUANDO un OPERADOR levanta un bloqueo y la base lo confirma (`200`), EL SISTEMA descarta la copia guardada de ese cliente antes de responder.
- RF-2.6.6.2: SI el alta o el levantamiento de un bloqueo no se confirma en la base, ENTONCES EL SISTEMA conserva la copia guardada tal como estaba.
- RF-2.6.7: MIENTRAS un bloqueo vigente tenga fecha `hasta`, EL SISTEMA no conserva una copia del estado de cuenta más allá de ese instante, así que nunca devuelve `BLOQUEADO` por un bloqueo vencido.
- RF-2.6.8: SI Redis no responde dentro del tiempo configurado o rechaza la conexión, ENTONCES EL SISTEMA calcula el estado desde la base, responde igual que sin caché y registra el fallo sin datos del cliente.
- RF-2.6.8.1: SI no se pudo descartar la copia de un cliente tras confirmar un alta o un levantamiento de bloqueo, ENTONCES EL SISTEMA responde igual al operador, y mientras no confirme el descarte no sirve copias de ese cliente.

## Requisitos no funcionales
- RNF-05: EL SISTEMA trata a la base propia de M2 como única fuente de verdad del estado de cuenta; Redis guarda solo una copia con vencimiento y nada que no pueda reconstruirse desde la base.
- RNF-06: EL SISTEMA toma de variables de entorno la dirección de Redis, el tiempo de vida de la copia y el tiempo máximo de espera, con valores por defecto de desarrollo en el archivo de ejemplo; SI la dirección de Redis no está definida, ENTONCES EL SISTEMA funciona sin caché.
- RNF-07: EL SISTEMA verifica estas reglas con pruebas unitarias, pruebas de integración con Redis y PostgreSQL reales en contenedor, y pruebas de contrato sobre `obtenerEstadoCuenta`.
- RNF-11: EL SISTEMA administra con Redis la copia del estado de cuenta con un TTL que acota su antigüedad y con invalidación explícita al cambiar los bloqueos del cliente.
- RNF-13: SI Redis está caído o lento, ENTONCES EL SISTEMA no responde `503` por eso ni espera más que el tiempo máximo configurado por cada operación contra Redis, y no reintenta de forma bloqueante.
- RNF-14: CUANDO se consulta `GET /health`, EL SISTEMA decide `200` o `503` solo por la base y no consulta a Redis, así que la caída de Redis no cambia ese resultado ni el cuerpo; el estado de Redis se informa en el log (RF-2.6.8).
- RNF-19: EL SISTEMA no escribe en los logs ni en las claves de Redis datos del perfil, motivos de bloqueo ni tokens; la clave identifica al cliente solo por su `clienteId`.
- RNF-20: EL SISTEMA documenta en la guía qué se guarda, cuánto dura, cuándo se invalida y cómo comprobarlo.

## Contrato y dependencias
- Operaciones del contrato que cubre: `GET /api/v1/clientes/{clienteId}/estado-cuenta` (obtenerEstadoCuenta), sin cambios de esquema. `crearBloqueo` y `levantarBloqueo` solo ganan el descarte de la copia.
- Operaciones de otros módulos que consume: ninguna. Redis es una dependencia de infraestructura propia de M2; si no responde, M2 sigue desde su base (RF-2.6.8).

## Casos límite
- Dos consultas simultáneas sin copia: ambas pueden ir a la base y guardar; el resultado es el mismo y no hay duplicados que importen.
- Un bloqueo se registra mientras otra consulta ya leyó la base y aún no guardó: la copia vieja no debe sobrevivir más que su TTL, y el descarte posterior la elimina si llegó a guardarse.
- Un bloqueo con `hasta` a segundos del vencimiento: la copia dura como máximo hasta ese instante (RF-2.6.7).
- Un bloqueo vigente sin `hasta`: solo lo acota el TTL y la invalidación.
- Reinicio o vaciado de Redis: se pierden las copias, no datos; la siguiente consulta las reconstruye.
- Redis lento, no caído: cada operación se corta al tiempo máximo y se sigue por la base.
- Cliente sin bloqueos vigentes: también se guarda `ACTIVO`.

## Fuera de alcance
- Cachear perfil, direcciones, preferencias, calificaciones o historial.
- Mensajería con RabbitMQ y eventos `cliente.bloqueado` y `cliente.desbloqueado` (RNF-10): espera la respuesta de la cátedra.
- Cambiar el contrato público o los permisos de `obtenerEstadoCuenta`.
- Alta disponibilidad, clúster o persistencia de Redis.
- Guardar la clave de idempotencia en Redis: sigue en la base (RNF-08).

## Criterios de finalización
- Con Redis levantado, dos consultas seguidas del mismo cliente hacen una sola lectura de estado en la base.
- Tras registrar o levantar un bloqueo, la siguiente consulta refleja el cambio.
- Un bloqueo con `hasta` que vence no se sigue informando después de vencer.
- `docker compose up` levanta Redis junto al servicio y la base, y la demostración muestra la caché en uso.
- Con Redis detenido, `obtenerEstadoCuenta` responde `200` con el mismo cuerpo y `/health` responde `200`.
- Sin dirección de Redis configurada, el servicio arranca y funciona sin caché.
- `npm test`, `npm run contrato:test` y `node scripts/spec-check.mjs` en verde.

## Decisiones
- Se cachea solo `obtenerEstadoCuenta`, la consulta que más se repite y la que consumen otros módulos; mantiene la spec chica y demostrable.
- La invalidación es explícita en el alta y el levantamiento de bloqueos, además del TTL, porque el TTL solo no alcanza para reflejar un bloqueo recién puesto.
- El TTL de la copia por defecto es de 60 s: acota cuánto puede durar un error si falla una invalidación. Es configurable (RNF-06).
- Redis es opcional: sin dirección configurada, M2 funciona sin caché. Así RNF-11 no vuelve obligatoria una dependencia nueva para quien levante M2 sin compose.
- Solo se guardan respuestas `200`; ningún error ni `404` se cachea.
- Redis corre en el compose por defecto, para que RNF-11 se vea funcionando en la entrega de TP2 y en el script de demostración; la variable de dirección sigue siendo opcional para quien arranque M2 sin compose.

## Dudas abiertas
Ninguna.
