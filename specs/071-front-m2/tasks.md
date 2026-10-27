# Tareas — Spec 071 Front de M2: app de cliente y base del panel

Orden de dependencia, en cinco tramos. Cada tarea es un commit `071/Tn: …`, con las pruebas primero. Al terminar cada tramo hay algo que se puede ver funcionando: A y B, un panel sin pantallas que reenvía a M2 y un M6 simulado; C, el panel en compose con una página mínima; D, las pantallas; E, la prueba en navegador, CI y documentación.

## Tramo A — Servidor del panel

- [x] **T1. Dependencias, scripts y configuración del proyecto.** RNF-02.1, RNF-07.5
  - Hecho cuando: están instaladas las siete dependencias de desarrollo aprobadas (`react` y `react-dom` 19.3.1, `@types/react` y `@types/react-dom` 19.3.0, `@vitejs/plugin-react` 6.1.2, `playwright-core` 1.64.1, `axe-core` 4.14.0) con versión exacta; existen `panel/tsconfig.servidor.json`, `panel/tsconfig.cliente.json`, los scripts `panel:tipos` y `panel:build` (el segundo todavía solo compila el servidor), ESLint revisa `.tsx`, ignora `panel/dist/` y los tipos generados y prohíbe `dangerouslySetInnerHTML`, y `vitest.config.ts` incluye `pruebas/panel/` con el proyecto `navegador` aparte; `npm ci`, `npm run lint`, `npm run build` y `npm test` terminan en verde y `git diff --stat` no toca `src/`, `contrato/` ni `migraciones/`.

- [x] **T2. Configuración del panel y valores de `ejemplo.env`.** RNF-06.4
  - Hecho cuando: `pruebas/panel/unitarias/config.test.ts` comprueba que `servidor/config.ts` lee las variables `PANEL_*`, `M6_*` y `M2_*`, aplica los valores por defecto del plan, rechaza una clave de menos de 32 caracteres y un puerto inválido, y que `servidor/entorno-ejemplo.ts` carga los valores de `ejemplo.env` (forma `VARIABLE=${VARIABLE:-valor}`) sin pisar una variable ya definida y sin leer `.env`; `ejemplo.env` tiene la sección nueva con una línea comentada por variable.

- [x] **T3. Aplicación base del panel: seguridad de acceso, salud y logs.** RNF-12.8, RNF-19.3
  - Hecho cuando: `pruebas/panel/http/seguridad.test.ts` comprueba con `app.inject` que una solicitud con `Host` ajeno recibe `403` `application/problem+json` sin ejecutar nada, que un `POST` sin `Origin` o con un `Origin` distinto del propio recibe `403`, que ninguna respuesta lleva cabeceras CORS, que `GET /salud-panel` responde `200`, y que los logs son una línea JSON por pedido sin `authorization` ni cuerpo.

- [x] **T4. Firma de tokens de desarrollo.** RNF-12.6, RNF-19.3
  - Hecho cuando: `pruebas/panel/unitarias/tokens.test.ts` comprueba que un token firmado por `servidor/tokens.ts` lo acepta `verificarToken` de M2 con el emisor, la audiencia, la clave y el campo de roles de `ejemplo.env`, que vence a los 300 segundos, y que un `sub` vacío o de más de 128 caracteres y un rol fuera de CLIENTE, OPERADOR, SERVICIO y CONDUCTOR se rechazan.

- [x] **T5. Reenvío a M2 con token por pedido.** RNF-12.6, RNF-03.6, RNF-15.4
  - Hecho cuando: `pruebas/panel/http/reenvio.test.ts`, con un M2 de mentira (`servidor-modulo.ts`), comprueba que solo se reenvían `/api/v1/clientes…` y `GET /health`, que una ruta con `..`, `//` o `@` se rechaza, que el pedido sale con `Authorization` firmado y con `Idempotency-Key`, `Content-Type` y `X-Request-Id` (el recibido o uno `panel-…`), que un `problem+json` de M2 vuelve intacto con su código, `Location` y `Retry-After`, que un cuerpo de más de 1 MiB se rechaza y que sin respuesta de M2 en 10 segundos o con la conexión rechazada el panel responde `504` con `type` `/panel/errores/m2-no-responde`.

- [x] **T6. Detalle técnico en el servidor: buffer de pedidos y `curl` equivalente.** RNF-14.9, RNF-19.3
  - Hecho cuando: `pruebas/panel/unitarias/pedidos.test.ts` comprueba que el buffer guarda los últimos 50 pedidos, el más nuevo primero, con método, ruta, código, duración y `X-Request-Id`, y que `curlEquivalente` arma el `curl` con `$TOKEN` y la dirección pública de M2, sin ningún token real; una prueba HTTP comprueba que `GET /panel/pedidos` lo devuelve y que el `Authorization` figura enmascarado como `Bearer ••••`.

## Tramo B — M6 simulado

- [ ] **T7. M6 simulado: API de `m6.yml` con verificación del token de servicio.** RNF-13.7
  - Hecho cuando: `pruebas/panel/unitarias/m6-simulado.test.ts` valida con Ajv contra `contrato/dependencias/m6.yml` el cuerpo de `GET /api/v1/trips` (`TripSummaryPage`) y de `GET /api/v1/trips/{id}` (`Trip`) y del `ErrorResponse`, y una prueba HTTP comprueba que sin token o con un token sin rol `SERVICIO`, de otra audiencia o con otra clave responde `401`, que filtra por `clientId` y `state`, y que un viaje inexistente da `404`.

- [ ] **T8. M6 simulado: canal de control, viajes de ejemplo y modos.** RNF-13.5, RF-2.1.10, RF-2.1.11
  - Hecho cuando: `pruebas/panel/http/m6-control.test.ts` comprueba que cargar el ejemplo de un cliente registra un viaje completado y uno en curso con ids derivados del `clienteId`, que repetirlo no duplica, que `escenarios` devuelve completado (`201`), en curso (`422`), ajeno y de otro cliente y inexistente (`404`, `404`) con sus ids, que en modo `caido` el puerto de la API rechaza conexiones mientras el de control responde, que volver a `normal` lo reabre, y que en modo `lento` la respuesta tarda al menos `M6_RETARDO_LENTO_MS`.

- [ ] **T9. Reenvío del panel al canal de control del M6 simulado.** RNF-13.5, RF-2.1.10
  - Hecho cuando: `pruebas/panel/http/m6-reenvio.test.ts` comprueba que `GET /panel/m6/estado`, `PUT /panel/m6/modo` y `POST /panel/m6/clientes/{clienteId}/ejemplo` llegan al canal de control con tiempo máximo de 3 segundos y sin reintento, que cualquier otra ruta bajo `/panel/m6/` se rechaza, que un `clienteId` que no es UUID da `400`, y que si el canal no responde el panel contesta `502` `application/problem+json`.

- [ ] **T10. Prueba de integración del panel con M2 real y M6 simulado.** RNF-13.5, RNF-13.7, RF-2.1.5, RF-2.5.15
  - Hecho cuando: `pruebas/panel/integracion/panel.test.ts`, con PostgreSQL real de Testcontainers, M2 en el proceso de la prueba, el M6 simulado y el panel, recorre por el panel: alta con la misma `Idempotency-Key` dos veces (un solo cliente), «cargar ejemplo» dos veces, historial con `calificado` falso, calificar el completado (`201`), repetirlo (`409`), el en curso (`422`), el ajeno y el inexistente (`404`), el modo `lento` y el `caido` (`503` con `Retry-After`), un bloqueo y su estado de cuenta, y un rol CONDUCTOR (`403`).

## Tramo C — Base del cliente y empaquetado

- [ ] **T11. Esqueleto del cliente React con Vite, enrutador por `#` y servicio de estáticos.** RNF-04.6, RNF-19.3, RNF-15.1
  - Hecho cuando: `npm run panel:build` compila el cliente con Vite a `panel/dist/cliente` y comprueba sus tipos con `tsc --noEmit`; `pruebas/panel/unitarias/rutas.test.ts` comprueba que `rutas.ts` interpreta cada ruta de las doce pantallas y manda a `#/ingresar` si no hay sesión; una prueba HTTP comprueba que el servidor sirve `/` con `Content-Security-Policy` (`default-src 'self'`), `X-Content-Type-Options` y `Referrer-Policy`, sin scripts ni estilos en línea, y que devuelve `index.html` para las rutas del cliente.

- [ ] **T12. Imagen del panel y del M6 simulado, y perfil `panel` de compose.** RNF-04.6
  - Hecho cuando: `docker compose --profile panel up -d --build --wait` deja sanos `panel` y `m6`, con el panel publicado solo en `127.0.0.1:8083` y el control del M6 en `127.0.0.1:3007`; `docker compose up -d --build --wait` sin el perfil no crea ninguno de los dos; `docker compose --profile panel config` no cambia los servicios `m2` y `bd`; las imágenes parten de `node:24.22.0-trixie-slim`, instalan con `npm ci --omit=dev --ignore-scripts` y corren como `node`.

- [ ] **T13. `npm run panel` en la máquina y script de humo.** RNF-04.7, RNF-06.4
  - Hecho cuando: con `docker compose up -d --build --wait` y `docker compose --profile panel up -d --build --wait m6` levantados, `npm run panel` compila, arranca con los valores de `ejemplo.env` y `node scripts/panel-humo.mjs` termina en verde (salud del panel, `GET /health` reenviado, estado del M6 simulado, `403` con `Origin` ajeno); el mismo script termina en verde contra el perfil `panel` de compose.

- [ ] **T14. Capa de API del cliente: pedidos a M2, errores y tiempo máximo.** RNF-03.6, RNF-15.4, RNF-02.3
  - Hecho cuando: `pruebas/panel/unitarias/api.test.ts` comprueba, con un `fetch` de mentira, que `api/m2.ts` corta a los 10 segundos, que el `504` del panel y el tiempo agotado dan el mismo error «M2 no responde», que un `problem+json` llega completo (código, `type`, `title`, `detail`, `Retry-After`, `X-Request-Id`) y que toda ruta que arma el cliente existe en `contrato/openapi.yml` con ese método.

- [ ] **T15. Fuentes simuladas, sesión y clientes recordados.** RNF-02.2, RNF-12.9, RF-2.1.6, RF-2.1.7
  - Hecho cuando: `pruebas/panel/unitarias/sesion.test.ts` y `recordados.test.ts` comprueban que `fuentes/sesion-simulada.ts` implementa `FuenteDeSesion` (iniciar, cerrar, actual) con almacenamiento de sesión sin tokens y funciona si el almacenamiento falla, que `logica/recordados.ts` conserva hasta 10 clientes con el nuevo primero, sin repetidos y descartando lo que no tenga forma de `{ id: uuid, nombre }`, y que las dos fuentes exponen la etiqueta «simulado, pendiente de M1 / M6».

- [ ] **T16. Hooks de carga y de acción.** RNF-15, RNF-15.2, RNF-15.4
  - Hecho cuando: `pruebas/panel/unitarias/estados.test.ts` comprueba los reductores de `usar-carga` (`cargando → listo | vacio | error`, con reintento que repite el mismo pedido) y de `usar-accion` (espera, éxito con aviso, error con «Reintentar» y la misma clave de idempotencia), y que `logica/clave-idempotencia.ts` genera la clave al abrir, la conserva ante un error o un tiempo agotado y la descarta tras un éxito o al cerrar.

- [ ] **T17. Dirección visual, variables de diseño y estructura responsiva.** RNF-15.1, RNF-15.3, RNF-12.7
  - Hecho cuando: está elegida la dirección visual con las skills en el orden del plan y anotada en `guia.md`; existen las variables de diseño en claro y oscuro, el menú por rol y el encabezado con las etiquetas «simulado» en todas las vistas, sin fuentes ni recursos de terceros; `pruebas/panel/unitarias/contraste.test.ts` calcula que cada par de colores de texto y fondo de las variables cumple 4,5:1 en los dos modos, y la estructura se ve sin desplazamiento horizontal a 360 y a 1280 píxeles.

- [ ] **T18. Componentes base: botón de acción, aviso, diálogo de confirmación, formulario y estado de pantalla.** RNF-15, RNF-15.2, RNF-15.3
  - Hecho cuando: existen los componentes con CSS Modules y, en `pruebas/panel/unitarias/componentes.test.ts`, la lógica de cada uno (qué se deshabilita y qué se muestra en cada estado, a qué campo se asocia un error, qué texto lee una región `aria-live`) está probada; se usan `<button>`, `<label>`, `<dialog>` y `aria-describedby`, y el foco pasa al título de la pantalla al cambiar de ruta.

## Tramo D — Pantallas

- [ ] **T19. Inicio de sesión simulado, «Entrar como cliente nuevo» y clientes recordados.** RF-2.1.5, RF-2.1.6, RF-2.1.7, RNF-12.9
  - Hecho cuando: contra el panel con M2 real, la pantalla `ingresar` permite elegir rol e identificador o crear un cliente con `crearCliente` (formulario con valores de ejemplo editables y validaciones del contrato, `Idempotency-Key` propia), lista los recordados con un clic para volver a entrar, marca «ya no existe» al `404` y permite quitarlo, y «Cerrar sesión» olvida el rol y el cliente; `pruebas/panel/integracion/pantalla-ingresar.test.ts` lo recorre.

- [ ] **T20. Perfil: ver y editar.** RF-2.1.8, RF-2.1.9
  - Hecho cuando: `pruebas/panel/unitarias/cambios.test.ts` comprueba que `logica/cambios.ts` manda solo los campos distintos y no llama a M2 si no hay ninguno; la pantalla `perfil` muestra `obtenerCliente`, guarda con `actualizarCliente` y, ante un `400`, muestra el `detail` junto al formulario conservando lo escrito.

- [ ] **T21. «Cargar ejemplo».** RF-2.1.10, RF-2.1.11
  - Hecho cuando: `pruebas/panel/unitarias/ejemplo.test.ts` comprueba que `logica/ejemplo.ts` arma tres direcciones (una `FAVORITA`, dos `RECIENTE`) con claves `ejemplo-dir-{n}-{clienteId}`, unas preferencias y la llamada al M6 simulado, y que un fallo del paso de M6 deja lo demás hecho y reintentable; la pantalla informa cada paso, y repetir el botón no duplica nada (comprobado contra M2 real).

- [ ] **T22. Direcciones: listar, crear y editar.** RF-2.2.6
  - Hecho cuando: la pantalla `direcciones` lista paginado con `listarDirecciones`, crea con `crearDireccion` y edita con `actualizarDireccion` (tipo, alias, texto y coordenadas opcionales, con los límites del contrato y los errores `400` junto al campo), y una prueba contra M2 real comprueba el alta, la edición precargada con `obtenerDireccion` y el paginado.

- [ ] **T23. Direcciones: eliminar con confirmación.** RF-2.2.7
  - Hecho cuando: «Eliminar» abre el diálogo de confirmación y solo al confirmar llama a `eliminarDireccion`; «Cancelar» no hace ningún pedido y la dirección sigue en la lista, comprobado en una prueba contra M2 real.

- [ ] **T24. Preferencias.** RF-2.3.6
  - Hecho cuando: la pantalla `preferencias` muestra `obtenerPreferencias` (vacías si no hay), ofrece solo los valores del contrato (tipos de vehículo, canales, accesibilidad, observaciones hasta 255 caracteres) y guarda con `guardarPreferencias`; una prueba contra M2 real comprueba que lo guardado se vuelve a leer.

- [ ] **T25. Historial con «calificado» y cuenta regresiva.** RF-2.4.12, RF-2.4.13
  - Hecho cuando: `pruebas/panel/unitarias/cuenta-regresiva.test.ts` comprueba que `logica/cuenta-regresiva.ts` lee `Retry-After` de 1 a 3600 y cuenta hasta 0; la pantalla `historial` lista paginado con estado y «calificado», ofrece «Calificar» solo en los completados sin calificar, y ante el `503` de M6 explica que depende del módulo de viajes, cuenta los segundos, ofrece «Reintentar» y deja el menú utilizable (comprobado con el M6 simulado en modo `caido`).

- [ ] **T26. Calificar al conductor.** RF-2.5.15, RF-2.5.16
  - Hecho cuando: `pruebas/panel/unitarias/mensajes.test.ts` comprueba que `logica/mensajes.ts` da el texto de `404`, de `409` `/errores/calificacion-duplicada`, de `422` `/errores/viaje-no-completado` y `/errores/idempotencia-reutilizada` y de `503`; el formulario (puntaje 1 a 5, comentario hasta 500 con contador) conserva la `Idempotency-Key` ante un error y la reutiliza al reintentar, y deshabilita el botón mientras espera, de modo que dos toques envían un solo pedido (comprobado contra M2 real).

- [ ] **T27. Mis calificaciones y detalle.** RF-2.5.17
  - Hecho cuando: la pantalla `calificaciones` lista paginado con `listarCalificaciones` y abre el detalle con `obtenerCalificacion`, y el `404` de otra persona se muestra como «no encontrada», comprobado contra M2 real.

- [ ] **T28. Estado de cuenta del cliente.** RF-2.6.5
  - Hecho cuando: la pantalla `estado-cuenta` muestra con `obtenerEstadoCuenta` si el cliente está activo o bloqueado y sus bloqueos vigentes, y un cliente bloqueado sigue pudiendo ver sus pantallas, comprobado contra M2 real.

- [ ] **T29. Vista del operador: buscar, bloquear y levantar.** RF-2.6.6
  - Hecho cuando: la pantalla `operador` busca un cliente por UUID, muestra su estado y sus bloqueos con `listarBloqueos`, crea uno con `crearBloqueo` (motivo de 1 a 500 caracteres y `hasta` opcional) y lo levanta con `levantarBloqueo`, actualizando el estado tras cada acción, comprobado contra M2 real.

- [ ] **T30. Vista de otro módulo.** RF-2.6.7
  - Hecho cuando: al entrar como SERVICIO con el identificador por defecto `m5-despacho` (editable), la pantalla `otro-modulo` solo ofrece consultar el estado de cualquier UUID con `obtenerEstadoCuenta` y el menú no muestra ninguna otra operación, comprobado contra M2 real.

- [ ] **T31. Pantalla de detalle técnico.** RNF-14.9
  - Hecho cuando: la pantalla `detalle-tecnico` lista los últimos 50 pedidos con método, ruta, código, duración y `X-Request-Id`, permite copiar el `curl` equivalente con `$TOKEN` y muestra el `Authorization` enmascarado; el `X-Request-Id` de un pedido hecho desde cualquier pantalla aparece en `docker compose logs m2`.

- [ ] **T32. Pantalla del M6 simulado: escenarios y modos.** RNF-13.5, RNF-12.7
  - Hecho cuando: la pantalla `m6-simulado` permite elegir el modo (normal, lento, caído), muestra los cuatro escenarios con su id y la respuesta esperada de M2 (`201`, `422`, `404`, `404`; `503` con `Retry-After` para lento y caído), copia el id al formulario de calificar, y lleva la etiqueta «simulado, pendiente de M6».

## Tramo E — Prueba en navegador, CI y documentación

- [ ] **T33. Prueba en navegador I: base, tamaños, teclado y accesibilidad.** RNF-07.5, RNF-15.1, RNF-15.3
  - Hecho cuando: `npm run panel:navegador` levanta M2 real, el M6 simulado y el panel, abre Chrome con `playwright-core` y, a 360 y a 1280 píxeles, en modo claro y oscuro, recorre cada pantalla comprobando que no hay desplazamiento horizontal, que los controles miden al menos 44×44 píxeles, que se puede usar solo con teclado con foco visible y que `axe-core` no informa violaciones de contraste ni de etiquetas.

- [ ] **T34. Prueba en navegador II: estados, doble clic y valores máximos.** RNF-15, RNF-15.2, RNF-15.4, RNF-15.5, RF-2.5.15
  - Hecho cuando: `npm run panel:navegador` comprueba por pantalla los estados de espera, confirmación, rechazo, cancelación, error y recuperación, que un doble clic al calificar envía un solo pedido, que con nombre de 100 caracteres, dirección de 255 y comentario de 500 el diseño no se rompe, y que con M2 detenido aparece «M2 no responde» con «Reintentar» sin controles deshabilitados.

- [ ] **T35. Integración continua.** RNF-07.5, RNF-04.6, RNF-02.1
  - Hecho cuando: `build-test` corre también `npm run panel:build`; existe un job `panel` que corre después de `build-test`, ejecuta `npm run panel:navegador` con el Chrome de `ubuntu-24.04` y levanta el perfil `panel` para `scripts/panel-humo.mjs`; los nombres de los jobs que exige la protección de `main` no cambian, y `git diff --stat origin/main` no muestra cambios en `src/`, `contrato/` ni `migraciones/`.

- [ ] **T36. Documentación.** RNF-20.2
  - Hecho cuando: el `README.md`, `docs/probar-m2.md` y `ejemplo.env` explican cómo levantar el panel de las dos formas, qué hace cada vista y qué está simulado; `guia.md` tiene una entrada por tarea y su visión general explica React, Vite, los hooks y los dos puntos de conexión para quien nunca los usó; `node scripts/spec-check.mjs` termina en verde.
