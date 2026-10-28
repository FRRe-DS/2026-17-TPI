# Tareas — Spec 072 Front de M2: vista de demostración e integridad de datos

Orden de dependencia, en cuatro tramos. Cada tarea es un commit `072/Tn: …`, con las pruebas primero. Al terminar cada tramo hay algo que se puede ver funcionando: A, las rutas `/panel/demo/…` respondiendo con M2 y la base reales; B, el perfil `panel` con el puente a la base; C, la vista completa en el navegador; D, la prueba en navegador y la documentación.

## Tramo A — Servidor del panel

- [x] **T1. Configuración nueva del panel.** RNF-06.5, RNF-19.4
  - Hecho cuando: `pruebas/panel/unitarias/config.test.ts` comprueba que `servidor/config.ts` lee `PANEL_URL_BD` (opcional; vacía, sin acciones de base), `PANEL_DOCKER` (`si` o `no`, por defecto `si`) y `PANEL_SERVICIO_BD` (por defecto `bd`, rechaza lo que no cumpla `^[a-z0-9][a-z0-9_-]{0,62}$`), que un error nombra la variable sin repetir su valor (una URL con contraseña no aparece en el mensaje), y que `entorno-ejemplo.ts` toma las tres de `ejemplo.env`; `ejemplo.env` tiene las cuatro variables nuevas (también `PANEL_PUERTO_BD`), comentadas, y `pruebas/unitarias/ejemplo-env.test.ts` las acepta.

- [x] **T2. Acceso a la base: conteos y disponibilidad.** RNF-05.4, RNF-19.4
  - Hecho cuando: `pruebas/panel/integracion/demo-base.test.ts`, con PostgreSQL de Testcontainers y las migraciones de M2, comprueba que `servidor/demo/base.ts` cuenta las filas de `clientes` y de `calificaciones` de un cliente, que sin `PANEL_URL_BD` informa «no configurada» sin conectarse, que con la base detenida devuelve `filas: null` con un motivo que lleva el código de Node y no la dirección ni la contraseña, y que el pool no pasa de 2 conexiones ni espera más de 2 s.

- [x] **T3. Prueba de la restricción del puntaje.** RNF-05.5, RNF-05.4
  - Hecho cuando: `pruebas/panel/integracion/demo-restriccion.test.ts`, contra la base real, comprueba que `servidor/demo/restriccion.ts` devuelve `restriccion: "calificaciones_puntaje_valido"`, código `23514` y el mensaje de PostgreSQL, que `filasAntes` es igual a `filasDespues`, que después no queda ninguna fila nueva en `calificaciones` ni una transacción abierta (`pg_stat_activity`), y que si la inserción no fallara (simulado con un pool de mentira) el resultado es `cumple: false` y se deshace igual.

- [x] **T4. Pedidos directos a M2 y al control del M6 simulado.** RNF-08.2, RNF-08.4, RNF-12.10
  - Hecho cuando: `pruebas/panel/http/demo-m2-directo.test.ts`, con `servidor-modulo.ts`, comprueba que `servidor/demo/m2-directo.ts` firma el token con `tokens.ts`, manda `Idempotency-Key`, `Content-Type` y un `X-Request-Id` con el prefijo de la corrida, corta a los 10 s devolviendo código `0`, y no registra nada en el buffer del detalle técnico; `pedirControlM6` queda separado en `servidor/m6-control.ts` y las pruebas de la 071 sobre `/panel/m6/…` siguen en verde sin cambios.

- [x] **T5. Altas simultáneas.** RNF-08.2, RNF-08.3
  - Hecho cuando: `pruebas/panel/integracion/demo-concurrencia.test.ts`, con M2 real, la base de Testcontainers y el panel, comprueba que `altasSimultaneas` con N = 10 y la misma clave da `{ 201: 10 }`, `cuerposIguales: true` y 1 fila, y con claves distintas da `{ 201: 1, 409: 9 }` y 1 fila, ambos con `cumple: true`; que los N pedidos salen a la vez (el M2 de mentira de una prueba HTTP los ve llegar antes de responder el primero); y que con la base del panel no disponible el resultado trae `filas: null` y `cumple: false`.

- [x] **T6. Calificaciones simultáneas.** RNF-08.4
  - Hecho cuando: la misma prueba de integración comprueba que `calificacionesSimultaneas` con N = 10 y con N = 50 da `{ 201: 1, 409: N−1 }` y 1 fila en `calificaciones` con el M6 simulado, que deja el modo del M6 como estaba (también si estaba en `caido` antes de empezar y si un paso falla), y anota en `guia.md` qué códigos dio N = 50 (si aparece algún `503` por capacidad de M2, se registra como hallazgo y la prueba de N = 50 se queda en lo que comprueba la integridad: 1 fila).

- [x] **T7. Control de Docker.** RNF-13.4, RNF-13.6, RNF-12.10
  - Hecho cuando: `pruebas/panel/unitarias/docker.test.ts`, con un `ejecutar` de mentira, comprueba que `servidor/demo/docker.ts` llama a `docker` con exactamente `["compose", "stop", "bd"]`, `["compose", "start", "bd"]` y `["compose", "ps", "--format", "json", "bd"]`, sin shell, con la raíz del repositorio como `cwd` y cortes de 30, 60 y 5 s; que informa no disponible con su motivo y `comoActivar` para `PANEL_DOCKER=no`, `ENOENT`, «permission denied» y servicio ausente, sin rutas ni variables en el texto; que guarda la disponibilidad 10 s; y que sin Docker disponible `apagar` y `encender` no ejecutan nada.

- [x] **T8. Rutas de la vista en el servidor.** RNF-12.10, RNF-13.4, RNF-13.6, RNF-19.4, RNF-05.4
  - Hecho cuando: `pruebas/panel/http/demo-rutas.test.ts`, con base, Docker y M2 de mentira, comprueba `GET /panel/demo/estado`, `POST /panel/demo/altas-simultaneas`, `POST /panel/demo/calificaciones-simultaneas`, `POST /panel/demo/restriccion-puntaje`, `POST /panel/demo/base/apagar` y `…/encender` (`409` `/panel/errores/docker-no-disponible` sin Docker) y `GET /panel/demo/salud` (`estado: null` si M2 no contesta en 3 s); que un cuerpo con N fuera de 2 a 50, otro `modo` o campos de más recibe `400`; que cada ruta da `403` con `Host` u `Origin` ajenos sin ejecutar nada; y que ni las respuestas ni las líneas de log contienen la URL ni la contraseña de la base.

## Tramo B — Empaquetado

- [x] **T9. Puente a la base, perfil `panel` y humo.** RNF-04.8, RNF-06.5, RNF-13.6
  - Hecho cuando: `panel/puente-bd/main.ts` une cada conexión de su puerto con `bd:5432` (prueba HTTP con un servidor TCP de eco); `panel/Dockerfile` tiene el destino `puente-bd`; `docker compose --profile panel up -d --build --wait` deja sano `bd-puente` publicado solo en `127.0.0.1:5433` y el panel con `PANEL_URL_BD` y `PANEL_DOCKER=no`; `docker compose up -d --build --wait` sin el perfil no publica ningún puerto nuevo y no cambia `m2` ni `bd` (`pruebas/unitarias/consistencia.test.ts`); y `scripts/panel-humo.mjs` comprueba que `GET /panel/demo/estado` da base disponible y Docker no disponible con su motivo, contra el perfil y contra `npm run panel` en la máquina.

## Tramo C — Cliente

- [x] **T10. Catálogo de casos.** RNF-07.3, RNF-07.4
  - Hecho cuando: `pruebas/panel/unitarias/casos.test.ts` comprueba que `logica/casos.ts` tiene casos en las ocho áreas, en el orden de `docs/probar-m2.md`, con ids únicos; que cada `operacion` existe en `contrato/openapi.yml` con ese método y ruta, que cada `esperado.estado` está declarado en sus respuestas y que cada `type` es uno de los errores de M2; y que cada variable que usa una ruta la guarda un paso anterior del mismo caso.

- [x] **T11. Ejecutar un caso, comparar y ejecutar todo.** RNF-07.4, RNF-07.6
  - Hecho cuando: `pruebas/panel/unitarias/ejecutar-caso.test.ts`, con un `pedir` y un M6 de mentira, comprueba que `logica/ejecutar-caso.ts` prepara, ejecuta y devuelve pedido, respuesta, esperado y veredicto; que una preparación fallida da ✘ «no se pudo preparar»; que un caso de resiliencia repone el modo anterior del M6 aunque falle; que `ejecutarTodo` va uno tras otro, informa el avance, sigue tras un ✘ o una excepción y termina con `{ correctos, incorrectos }`; y que `logica/resultado.ts` decide por código, `type`, `Retry-After`, `Location` y `application/problem+json`, con el motivo en una línea.

- [x] **T12. Catálogo completo contra M2 real.** RNF-07.3, RNF-07.4
  - Hecho cuando: `pruebas/panel/integracion/demo-casos.test.ts`, con M2 real, la base de Testcontainers, el M6 simulado y el panel, ejecuta `ejecutarTodo` con todo el catálogo por el reenvío del panel y todos los casos dan ✔; si algún caso no da lo que dice el contrato, se corrige el caso (no M2) o se anota como hallazgo de M2 en `guia.md` y se avisa antes de seguir.

- [x] **T13. Lógica de integridad, salud en vivo y API del cliente.** RNF-13.4, RNF-08.2, RNF-08.3, RNF-08.4
  - Hecho cuando: `pruebas/panel/unitarias/integridad.test.ts` y `salud-en-vivo.test.ts` comprueban que `logica/integridad.ts` acepta N entero de 2 a 50 y da el motivo si no, y arma la tabla de conteo y el veredicto desde `ResultadoSimultaneo`; que el reductor de `logica/salud-en-vivo.ts` va de quieto a apagando, observando, encendiendo y recuperada al primer `200`, o no-volvio a los 60 s; que `hooks/usar-sondeo.ts` pide cada 2 s y para al desmontarse (con temporizadores falsos); y que `api/panel.ts` tiene una función por ruta `/panel/demo/…` con el corte de 10 s de la 071 (o 70 s para encender).

- [x] **T14. Vista «Demostración»: ruta, menú y casos.** RNF-07.3, RNF-07.4, RNF-07.6, RNF-15.6
  - Hecho cuando: `rutas.ts` interpreta `#/demostracion` y `logica/menu.ts` la ofrece a los cuatro roles (`rutas.test.ts`, `menu.test.ts`); `pantallas/demostracion.tsx` muestra los casos por área con «Ejecutar» y `componentes/resultado-caso` (pedido, respuesta, esperado, ✔ «Correcto» o ✘ «No coincide»), y «Ejecutar todo» con el avance y el resumen; los botones se deshabilitan mientras esperan; mirada en Chrome a 360 y 1280 px.

- [x] **T15. Sección «Integridad».** RNF-08.2, RNF-08.3, RNF-08.4, RNF-05.5, RNF-15.6
  - Hecho cuando: la vista muestra las tres pruebas simultáneas con el campo N (por defecto 10, error junto al campo si no es válido) y «Probar la restricción del puntaje», cada una con `componentes/prueba-integridad` (conteo por código en una tabla que se desplaza dentro de su caja a 360 px, filas, esperado y veredicto, y el mensaje de PostgreSQL como texto); `pruebas/panel/integracion/pantalla-demostracion.test.ts` recorre las cuatro contra M2 real y la base; mirada en Chrome.

- [x] **T16. Sección «Base de datos».** RNF-13.4, RNF-13.6, RNF-15.6
  - Hecho cuando: `componentes/control-base` muestra «Apagar la base» (con confirmación de `dialogo-confirmar`; «Cancelar» no llama a nada) y «Encender la base» con la salud en vivo, o, sin Docker, los dos deshabilitados con el motivo y cómo activarlos y el resto de la vista utilizable; una prueba contra el panel con un Docker de mentira recorre apagar (se ve el `503`), encender (vuelve a `200`) y el caso «no volvió»; y se comprueba a mano con el panel en la máquina que apagar y encender la base real funcionan, con la evidencia en `guia.md`.

## Tramo D — Prueba en navegador y documentación

- [ ] **T17. Prueba en navegador de la vista.** RNF-15.6, RNF-07.6, RNF-13.6
  - Hecho cuando: `npm run panel:navegador` recorre `#/demostracion` a 360 y 1280 px en claro y oscuro sin desplazamiento horizontal, con controles de al menos 44×44 px, uso solo con teclado y sin violaciones de `axe-core`; «Ejecutar todo» llega al resumen; una prueba simultánea muestra su tabla; un doble clic lanza una sola ejecución; y con `PANEL_DOCKER=no` apagar y encender están deshabilitados con su motivo. El job `panel` de CI lo corre sin cambiar los nombres de los jobs que exige la protección de `main`.

- [ ] **T18. Documentación.** RNF-20.3
  - Hecho cuando: el `README.md` y `docs/probar-m2.md` (sección 7) explican la vista, cómo activar las acciones de Docker (panel en la máquina, grupo `docker`), qué comprueba cada prueba de integridad y el puente en `127.0.0.1:5433`; `guia.md` tiene una entrada por tarea; `git diff --stat origin/main` no muestra cambios en `src/`, `contrato/` ni `migraciones/`; y `node scripts/spec-check.mjs` termina en verde.
