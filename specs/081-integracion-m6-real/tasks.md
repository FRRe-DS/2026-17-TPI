# Tareas — Spec 081 Integración distribuida de M2 con el M6 real del Grupo 12

Orden de dependencia, en tres tramos. Cada tarea es un commit `081/Tn: …`, con las pruebas primero. Al terminar cada tramo hay algo que se puede ver funcionando: A, M2 contestando contra el M6 real levantado con compose; B, cada escenario de la spec pasando contra él; C, la prueba corriendo sola en CI y documentada, con las diferencias comunicadas.

## Tramo A — El entorno

- [x] **T1. Perfil `m6-real` de compose.** RNF-04.9, RNF-06.6
  - Hecho cuando: `docker compose --profile m6-real up -d --build --wait`, con `M2_URL_M6=http://m6-real:3006` en el entorno, deja sanos `m2`, `bd`, `m6-real` y `m6-real-bd`, y un `curl` a `127.0.0.1:3016/health` contesta `200`; sin el perfil, `docker compose up -d --build --wait` levanta lo mismo que antes y no crea ningún servicio de M6; con `--profile panel` el servicio `m6` simulado sigue ahí y no se mezcla con `m6-real`; `ejemplo.env` documenta `M6_REAL_PUERTO` y las credenciales de la base de M6; el commit del compose coincide con la punta de la rama `m6/base-de-datos` del Grupo 12 (si cambió, se anota cuál se fijó); una prueba de consistencia de `pruebas/unitarias/` acepta los servicios y variables nuevos; `git diff origin/main --stat -- src migraciones contrato` está vacío.

- [x] **T2. Arranque y parada de la prueba distribuida.** RNF-07.7, RNF-06.6
  - Hecho cuando: `npm run integracion:m6` corre el proyecto `distribuida` de `vitest.config.ts` (que no entra en `npm test`: `npm test` sigue pasando el mismo número de pruebas), `pruebas/distribuida/global.ts` levanta el entorno con el proyecto `m2-distribuida`, `M2_PUERTO=18082` y `M6_REAL_PUERTO=13006`, espera a que M2 y M6 respondan y lo baja con `down -v` al terminar (o lo deja con `M2_DEJAR_LEVANTADO=1`); una prueba mínima comprueba que `GET /health` de M2 y de M6 dan `200` y que M2 guarda y devuelve un perfil; con Docker detenido o con el build roto el mensaje dice qué falló y la corrida termina en rojo, no saltada; `ayudas/` ya trae `pedirM2`, `pedirM6` y el contador de pedidos, con pruebas unitarias del contador.

## Tramo B — Los escenarios contra el M6 real

- [x] **T3. Preparar viajes y el token de servicio.** RNF-07.11, RNF-07.7
  - Hecho cuando: `ayudas/viajes.ts` crea, con los atajos de demo de M6 y las rutas, cuerpos y roles leídos de `openapi.yaml` de M6 en el commit fijado, un viaje `COMPLETED`, uno `CANCELLED` (o anota en `guia.md` por qué M6 no permite llegar a ese estado) y uno en curso, para un cliente nuevo; `token-servicio.test.ts` comprueba que con el token de servicio de M2 (`sub` `m2-clientes`, `roles` `["SERVICIO"]`, firmado por M2) `GET /trips?clientId=…` y `GET /trips/{id}` contestan algo distinto de `401` y `403`, y que si M6 lo rechazara el mensaje de la falla trae el código HTTP y el `code` del `ErrorResponse` de M6 (comprobado con un pedido hecho a propósito sin token); las diferencias encontradas hasta acá están en `guia.md`.

- [x] **T4. Historial contra el M6 real.** RNF-07.8
  - Hecho cuando: `historial.test.ts` crea tres viajes de un cliente y uno de otro, califica uno de los tres, y comprueba que `GET /clientes/{id}/viajes` da `200` con exactamente los tres del cliente, `calificado: true` solo en el calificado, que `page=0&size=2` trae dos y `page=1&size=2` trae uno (M2 desde 0, M6 desde 1: el pedido que llega a M6 se ve con `pedirM6` y coincide), que un cliente sin viajes recibe una página vacía con `200`, y que el cuerpo valida contra `contrato/openapi.yml`.

- [x] **T5. Calificación y duplicado contra el M6 real.** RNF-07.9
  - Hecho cuando: `calificacion.test.ts` lleva un viaje a `COMPLETED` en M6 y comprueba que calificarlo da `201`, que el `conductorId` guardado es el que devuelve `getTrip` de M6 (no el que mande el cliente), que repetir con otra `Idempotency-Key` da `409` con `type: /errores/calificacion-duplicada`, que `listarCalificaciones` muestra una sola calificación, y que el cuerpo de cada respuesta valida contra el contrato.

- [x] **T6. Rechazos contra el M6 real.** RNF-07.10
  - Hecho cuando: `rechazos.test.ts` comprueba que calificar un viaje inexistente en M6 da `404`, uno de otro cliente da `404`, uno `CANCELLED` o en curso da `422` con `type: /errores/viaje-no-completado`, y que en los tres casos `listarCalificaciones` sigue vacía; la prueba usa los viajes de T3 y deja anotado en `guia.md` cualquier diferencia de código o de `type` frente a lo que dice `m6.yml`.

- [x] **T7. Resiliencia contra el M6 real.** RNF-13.8
  - Hecho cuando: `resiliencia.test.ts` corre al final y, con `docker compose stop m6-real`, el historial y la calificación dan `503` con `Retry-After` y el perfil y las direcciones dan `200`; con `start` y la salud de M6, historial y calificación vuelven a `200`/`201` sin reiniciar `m2` (el `StartedAt` del contenedor de `m2` no cambia); con `pause`, ambos dan `503` con `Retry-After` en menos de 10 s y lo propio de M2 sigue en `200`; un `finally` deja a M6 corriendo aunque un paso falle; una prueba final comprueba que el total de pedidos a M6 de la corrida no pasa de 600.

## Tramo C — CI, documentación y comunicación

- [x] **T8. Job de CI aparte.** RNF-07.7
  - Hecho cuando: `.github/workflows/integracion-m6.yml` corre `npm run integracion:m6` en `push` a `main` y en `workflow_dispatch`, imprime `docker compose logs` si falla, y no aparece en los checks de un PR; `ci.yml` no cambia; una ejecución manual del workflow en la rama termina en verde (o, si no se puede lanzar antes del merge, se anota en `guia.md` y se lanza en cuanto el PR esté en `main`).

- [x] **T9. Documentación.** RNF-20.4
  - Hecho cuando: `docs/probar-m2.md` tiene una sección nueva que dice cómo levantar M2 con el M6 real (comando, variables, puertos), cómo correr `npm run integracion:m6`, qué commit del Grupo 12 se usa y cómo cambiarlo, y qué salida esperar, y todos esos comandos se corrieron tal como están escritos; `README.md` la enlaza; `guia.md` tiene la tabla de diferencias (comportamiento observado, lo que dice `m6.yml`, resolución y a quién se le consulta) con las de T3 a T7, y la visión general de la guía.

- [x] **T10. Diferencias para el Grupo 12 y propuestas de cambio.** RNF-20.4
  - Hecho cuando: por cada diferencia de la tabla que le toque al Grupo 12 hay un texto de issue redactado en `guia.md` (qué se observó, qué dice el contrato, qué se pide); @sandobaitt revisó los textos y, con su OK explícito, los issues están publicados en `FRRe-DS/2026-12-TPI` y sus enlaces figuran en la tabla (sin OK, la tarea queda con los textos listos y se anota que falta publicarlos); el `429` como `503` y el `X-Correlation-Id` están descritos en `guia.md` como propuestas de `sdd-change` de la 007 y la 008, para abrir sus issues con permiso.
