# Spec 071 — Front de M2: app de cliente y base del panel

Estado: implementada
Issue: #71
Etapa: TP1
Responsable: @sandobaitt

## Contexto y objetivo
M2 ya cumple RF-2.1 a RF-2.6, pero hoy solo se puede usar armando `curl` con tokens firmados a mano o corriendo `scripts/demo.mjs`, que imprime texto. Esta spec agrega una interfaz web, «el panel»: una app de cliente responsiva con las pantallas de perfil, direcciones frecuentes, preferencias, historial, calificaciones y estado de cuenta, las vistas del operador y de otro módulo, y la base que las sostiene (firma de tokens de desarrollo, detalle técnico de cada pedido y un M6 simulado). La app cubre desde ahora lo que el enunciado pide para TP3 en RNF-15 (cliente responsivo con estados claros de espera, confirmación, rechazo, cancelación, error y recuperación). La vista de demostración y las pruebas de integridad de datos (altas simultáneas, restricciones de la base, servicio con la base caída) son la segunda parte de este front y van en el issue #72, que depende de esta spec.

Regla de esta spec: lo que tiene funcionalidad pero todavía no existe (el inicio de sesión de M1, los viajes reales de M6) se construye igual en el panel, completo y con sus estados, contra una fuente simulada del propio panel; cuando el módulo real exista, solo se conecta esa fuente y las pantallas quedan igual.

En esta spec «el sistema» es el panel; cuando se habla del servicio, se lo llama «M2». El panel no es parte de M2: no cambia `src/`, `contrato/` ni `migraciones/`, y habla con M2 solo por su API HTTP. Se levanta de dos formas con el mismo código: en un contenedor de docker compose, con un perfil opcional que no cambia el arranque de quien no lo usa, o como proceso en la máquina de quien prueba.

## Usuarios
- Cliente de prueba: usa las pantallas de su propio perfil.
- Operador: busca un cliente, bloquea y levanta bloqueos.
- Otro módulo (rol SERVICIO, por ejemplo M5 o M9): consulta el estado de cuenta de un cliente.
- Evaluador o integrante del grupo: usa todo lo anterior, cambia los escenarios del M6 simulado y mira cada pedido y respuesta.

## Historias de usuario
- HU-1. Como cliente, quiero ver y editar mi perfil, mis direcciones y mis preferencias desde una pantalla, para no armar pedidos a mano.
- HU-2. Como cliente, quiero ver mi historial, calificar un viaje completado sin duplicarlo aunque toque dos veces, y ver mis calificaciones.
- HU-3. Como operador, quiero buscar un cliente, bloquearlo y levantar el bloqueo para asistirlo.
- HU-4. Como otro módulo, quiero consultar el estado de cuenta de un cliente para decidir si puede operar.
- HU-5. Como integrante del grupo, quiero ver el pedido, la respuesta y el identificador de correlación de cada acción para encontrarla en los logs de M2.
- HU-6. Como evaluador, quiero cambiar lo que responde el M6 simulado (viaje completado, en curso, ajeno, inexistente; lento o caído) para ver cómo reacciona M2 y cómo lo muestran las pantallas.
- HU-7. Como persona que prueba, quiero iniciar y cerrar sesión como en el producto final, aunque M1 todavía no exista, para que al conectarlo no cambie nada de lo que veo.

## Requisitos funcionales
- RF-2.1.5: CUANDO la persona pulsa «Entrar como cliente nuevo», EL SISTEMA genera un UUID, crea el perfil con `crearCliente` usando una `Idempotency-Key` propia y abre las pantallas del cliente con ese perfil.
- RF-2.1.6: CUANDO la persona abre el panel, EL SISTEMA ofrece hasta 10 clientes de prueba usados antes en ese navegador, guardando de cada uno solo su UUID y su nombre, y permite entrar de nuevo con un clic.
- RF-2.1.7: SI M2 responde `404` para un cliente recordado, ENTONCES EL SISTEMA lo marca «ya no existe» y ofrece quitarlo de la lista.
- RF-2.1.8: CUANDO el cliente abre su perfil, EL SISTEMA lo muestra con `obtenerCliente`, y CUANDO edita nombre, apellido, teléfono o fecha de nacimiento y confirma, EL SISTEMA envía solo los campos modificados con `actualizarCliente` y muestra el perfil devuelto.
- RF-2.1.9: SI M2 responde `400` a un envío de formulario, ENTONCES EL SISTEMA muestra el `detail` del problema junto al formulario y conserva lo que la persona escribió.
- RF-2.1.10: CUANDO la persona pulsa «Cargar ejemplo» en un cliente, EL SISTEMA crea por la API de M2 tres direcciones (una `FAVORITA` y dos `RECIENTE`) y unas preferencias de ejemplo, y registra en el M6 simulado, por su canal de control, un viaje completado y uno en curso de ese cliente.
- RF-2.1.11: SI «Cargar ejemplo» se pulsa más de una vez sobre el mismo cliente, ENTONCES EL SISTEMA no duplica direcciones ni viajes: reutiliza las mismas `Idempotency-Key` y los mismos identificadores de viaje.
- RF-2.2.6: CUANDO el cliente abre sus direcciones, EL SISTEMA las lista paginadas con `listarDirecciones` y permite crear (`crearDireccion`) y editar (`actualizarDireccion`) una con tipo, alias, texto y coordenadas opcionales, dentro de los límites del contrato.
- RF-2.2.7: CUANDO el cliente pulsa «Eliminar» en una dirección, EL SISTEMA pide confirmación y solo si la persona confirma llama a `eliminarDireccion`; si cancela, no llama a M2 y la dirección sigue en la lista.
- RF-2.3.6: CUANDO el cliente abre sus preferencias, EL SISTEMA las muestra con `obtenerPreferencias` (vacías si no hay guardadas) y, al confirmar, las guarda con `guardarPreferencias` eligiendo solo valores que el contrato admite.
- RF-2.4.12: CUANDO el cliente abre su historial, EL SISTEMA lo muestra paginado con `listarHistorialViajes`, indicando en cada viaje su estado y si ya está calificado, y ofrece «Calificar» solo en los viajes completados que no lo están.
- RF-2.4.13: SI M2 responde `503` por M6 con `Retry-After`, ENTONCES EL SISTEMA dice que el historial depende del módulo de viajes, cuenta regresivamente los segundos del encabezado, ofrece «Reintentar» y deja el resto de las pantallas utilizables.
- RF-2.5.15: CUANDO el cliente abre el formulario de calificación, EL SISTEMA genera una `Idempotency-Key` que conserva hasta que el envío termine bien o la persona cierre el formulario, y la reutiliza en cada reintento del mismo envío; mientras espera la respuesta, el botón de enviar queda deshabilitado, así que un doble toque envía un solo pedido.
- RF-2.5.16: SI M2 rechaza una calificación, ENTONCES EL SISTEMA muestra un mensaje distinto según el `type` o el código: `404` «viaje no encontrado», `409` `/errores/calificacion-duplicada` «ya lo calificaste», `422` `/errores/viaje-no-completado` «el viaje todavía no está completado», `422` `/errores/idempotencia-reutilizada` y `503` como en RF-2.4.13.
- RF-2.5.17: CUANDO el cliente abre «Mis calificaciones», EL SISTEMA las lista paginadas con `listarCalificaciones` y muestra el detalle de una con `obtenerCalificacion`.
- RF-2.6.5: CUANDO el cliente abre su estado de cuenta, EL SISTEMA muestra con `obtenerEstadoCuenta` si está activo o bloqueado y los bloqueos vigentes.
- RF-2.6.6: CUANDO un operador busca un cliente por su UUID, EL SISTEMA muestra su estado de cuenta, lista sus bloqueos (`listarBloqueos`), crea uno (`crearBloqueo`) con los campos que pide el contrato y lo levanta (`levantarBloqueo`), y tras cada acción actualiza el estado mostrado.
- RF-2.6.7: CUANDO la persona entra como otro módulo con un identificador que nombra al módulo (por defecto `m5-despacho`, editable), EL SISTEMA le permite consultar el estado de cuenta de cualquier UUID con `obtenerEstadoCuenta` y no le ofrece ninguna otra operación.

## Requisitos no funcionales
- RNF-02.1: EL SISTEMA no modifica `src/`, `contrato/` ni `migraciones/`, y habla con M2 solo por su API HTTP.
- RNF-02.2: EL SISTEMA construye completas, con todos sus estados, las pantallas de lo que depende de un módulo o contrato que todavía no existe (el inicio y cierre de sesión de M1 y los viajes de M6), contra una fuente simulada del propio panel, las marca «simulado, pendiente de <módulo>» y deja la conexión con el módulo real en un único punto, de modo que conectarla cambie ese punto y no las pantallas.
- RNF-02.3: SI una funcionalidad pendiente necesita una operación que el contrato de M2 no tiene, ENTONCES EL SISTEMA la simula solo dentro del panel y no llama a una ruta que no esté en `contrato/openapi.yml`; agregar esa operación a M2 es un cambio de contrato aparte.
- RNF-03.6: EL SISTEMA muestra los errores de M2 tal como los devuelve: el código HTTP, el `type`, el `title` y el `detail` del `application/problem+json`, y nunca los reemplaza por un éxito.
- RNF-04.6: CUANDO se levanta `docker compose --profile panel up -d --build --wait`, EL SISTEMA corre el panel y el M6 simulado cada uno en su contenedor, con chequeo de salud para que `--wait` espere, junto a M2 y su base, y el panel queda publicado solo en `127.0.0.1`; SI se levanta sin el perfil `panel`, ENTONCES EL SISTEMA no agrega ningún servicio ni cambia el arranque de M2.
- RNF-04.7: CUANDO se levanta el panel como proceso en la máquina, EL SISTEMA muestra las mismas pantallas y funciona con el mismo código, hablando con M2 y con el canal de control del M6 simulado por los puertos publicados en `127.0.0.1`.
- RNF-06.4: EL SISTEMA se configura por variables de entorno (puerto del panel, dirección de M2, dirección del canal de control del M6 simulado, y clave, emisor y audiencia de los tokens de desarrollo), con los valores por defecto de `ejemplo.env` adecuados a cada forma de levantarlo, y no guarda secretos en el repositorio.
- RNF-07.5: EL SISTEMA cubre en sus pruebas automáticas la lógica propia del panel (firma de tokens, enmascarado, rechazo de orígenes ajenos, M6 simulado) y un recorrido en navegador real, a 360 y a 1280 píxeles de ancho, de las pantallas del cliente.
- RNF-12.6: CUANDO la persona elige un rol (CLIENTE, OPERADOR, SERVICIO o CONDUCTOR) y un identificador, EL SISTEMA firma por cada pedido un token de desarrollo con la clave, el emisor y la audiencia de M2 (ADR 009) que vence a los 5 minutos, y lo usa para llamar a M2.
- RNF-12.7: EL SISTEMA muestra en todas las vistas que los tokens y el M6 son simulados.
- RNF-12.8: SI una acción del panel que no es una consulta llega con un `Host` que no es el propio del panel o con un `Origin` distinto del suyo, ENTONCES EL SISTEMA responde `403` sin ejecutar nada; el panel solo es accesible desde la propia máquina (`127.0.0.1`), también cuando corre en el contenedor.
- RNF-12.9: CUANDO la persona abre el panel sin sesión, EL SISTEMA muestra una pantalla de inicio de sesión que funciona con la fuente simulada de RNF-02.2 (elegir rol e identificador, o «Entrar como cliente nuevo»), y CUANDO pulsa «Cerrar sesión», EL SISTEMA olvida el rol y el cliente actuales y vuelve a esa pantalla.
- RNF-13.5: CUANDO la persona elige el escenario del M6 simulado (viaje completado, en curso, ajeno, inexistente) y su modo (normal, lento o caído), EL SISTEMA lo configura por el canal de control del M6 simulado, sin usar Docker, y muestra qué respuesta esperar de M2 (`201`, `422`, `404`, `404`, y `503` con `Retry-After` para lento y caído).
- RNF-13.7: EL SISTEMA incluye un M6 simulado que cumple `contrato/dependencias/m6.yml`, alcanzable por M2 con el nombre y el puerto que ya espera (`m6:3006`) sin cambiar su configuración, y que responde según el escenario y el modo vigentes.
- RNF-14.9: CUANDO la persona abre «Detalle técnico», EL SISTEMA muestra los últimos 50 pedidos con método, ruta, código, duración y `X-Request-Id`, y permite copiar el `curl` equivalente con el token reemplazado por una variable; EL SISTEMA envía en cada pedido un `X-Request-Id` propio para que se lo encuentre en `docker compose logs m2`.
- RNF-15: EL SISTEMA muestra en cada pantalla de cliente estados claros de espera, confirmación, rechazo, cancelación, error y recuperación.
- RNF-15.1: EL SISTEMA se usa sin desplazamiento horizontal desde 360 hasta 1440 píxeles de ancho, con controles táctiles de al menos 44×44 píxeles.
- RNF-15.2: MIENTRAS una operación espera respuesta, EL SISTEMA muestra un indicador de espera y deshabilita el control que la envió; CUANDO termina bien, muestra un aviso con lo que se hizo; SI falla, ENTONCES muestra el error de RNF-03.6 y un botón «Reintentar» que repite el mismo pedido.
- RNF-15.3: EL SISTEMA se puede usar solo con teclado, muestra el foco, tiene un contraste de texto de al menos 4,5:1, asocia cada mensaje de error con su campo y respeta `prefers-reduced-motion`.
- RNF-15.4: SI M2 no responde en 10 segundos, ENTONCES EL SISTEMA corta la espera, muestra «M2 no responde» con «Reintentar» y no deja ningún control deshabilitado.
- RNF-15.5: EL SISTEMA muestra los textos en español y, con los valores máximos del contrato (nombre de 100 caracteres, texto de dirección de 255, comentario de 500), no rompe su diseño.
- RNF-19.3: EL SISTEMA no entrega al navegador ni guarda en él la clave ni los tokens, no los escribe en sus logs (JSON) ni en la pantalla, y muestra el encabezado `Authorization` enmascarado.
- RNF-20.2: EL SISTEMA documenta en el README, en `docs/probar-m2.md` y en la guía de esta spec cómo se levanta de cada forma, qué hace cada vista y qué está simulado.

## Contrato y dependencias
- Operaciones del contrato que consume (las 20, sin cambiarlas): `verificarSalud`, `crearCliente`, `obtenerCliente`, `actualizarCliente`, `listarDirecciones`, `crearDireccion`, `obtenerDireccion`, `actualizarDireccion`, `eliminarDireccion`, `obtenerPreferencias`, `guardarPreferencias`, `listarHistorialViajes`, `listarCalificaciones`, `calificarConductor`, `obtenerCalificacion`, `obtenerEstadoCuenta`, `listarBloqueos`, `crearBloqueo`, `obtenerBloqueo`, `levantarBloqueo`. El panel no agrega rutas a M2.
- Operaciones de otros módulos: el panel no llama a M1 ni a M6. M2 llama a M6 (`GET /trips`, `GET /trips/{id}`), y para eso el panel trae un M6 simulado con un canal de control propio (RNF-13.5, RNF-13.7). Si el M6 simulado no está, M2 responde `503` con `Retry-After`, y el panel lo muestra (RF-2.4.13).
- Depende de las specs 004 a 008 (implementadas), de `scripts/demo.mjs` y `docs/probar-m2.md` (#68) y del ADR 009 (tokens de desarrollo). El #72 depende de esta spec.
- Cuando existan M1 y M6 reales, cambian el origen del token y la dirección de M6 (RNF-02.2); las pantallas quedan.

## Casos límite
- M2 no está levantado al abrir el panel: se muestra «M2 no responde» con la orden para levantarlo, no una pantalla en blanco.
- El panel en el contenedor se levanta antes que M2 o la base: espera a que estén sanos y, mientras tanto, muestra «M2 no responde» (RNF-15.4).
- El puerto del panel está ocupado: el panel termina con un mensaje que nombra la variable que lo cambia.
- Doble clic o dos pestañas con el mismo cliente: un solo efecto por el envío (RF-2.5.15) y la lista se refresca al volver.
- Un cliente recordado ya no existe (después de `docker compose down -v`): RF-2.1.7.
- Base caída con las pantallas abiertas: `503` genérico (`about:blank`) con el aviso de RNF-15.2 y recuperación al volver.
- El navegador no deja guardar datos (modo privado): el panel funciona sin recordar clientes.
- Un cliente bloqueado puede seguir viendo sus pantallas: el bloqueo informa, no oculta (el contrato no lo restringe en las operaciones de M2).
- Un rol no admitido (CONDUCTOR, o CLIENTE sobre otro `clienteId`) obtiene `403` y el panel lo muestra con el error de RNF-03.6.
- Pedidos que llegan desde otra página web a las acciones del panel: RNF-12.8.
- El M6 simulado en modo «caído» o «lento» mientras se califica: `503` con `Retry-After` en la pantalla y el mismo formulario reintentable con la misma clave (RF-2.5.15).
- «Cargar ejemplo» con M6 simulado no disponible: se cargan direcciones y preferencias, se informa que los viajes no se pudieron registrar y se puede reintentar sin duplicar (RF-2.1.11).

## Fuera de alcance
- La conexión con el M1 y el M6 reales: el panel los simula y deja un único punto de conexión (RNF-02.2), pero conectarlos es de cuando existan.
- Pantallas de otros módulos (pedir un viaje, mapa, pagos, conductores).
- Cambios en `src/`, `contrato/` o `migraciones/`, incluidos CORS en M2 y una interfaz tipo Swagger dentro del servicio.
- La vista de demostración, las altas simultáneas, la restricción de la base y apagar la base: son del issue #72.
- Revertir y reaplicar migraciones desde el panel (modifica el esquema; queda como comando manual en la guía).
- Sembrar la base de antemano y borrarla desde el panel: los datos de ejemplo se cargan por la API (`docker compose down -v` sigue siendo manual).
- Publicar el panel en la nube, HTTPS o usarlo en producción: es una herramienta de desarrollo y demostración.
- Aplicación móvil nativa, otros idiomas y la meta de rendimiento de RNF-16.

## Criterios de finalización
- Cada pantalla de cliente, la vista de operador y la de otro módulo cumplen sus RF con M2 y el M6 simulado levantados, y cada pantalla muestra sus estados de espera, confirmación, rechazo, cancelación, error y recuperación.
- El inicio y cierre de sesión funcionan con la fuente simulada y están marcados como pendientes de M1; la fuente está en un único punto.
- Existe una prueba automática en navegador a 360 y a 1280 píxeles de ancho sin desplazamiento horizontal.
- `git diff --stat origin/main` no muestra cambios en `src/`, `contrato/` ni `migraciones/`.
- `docker compose up -d --build --wait` sigue funcionando sin cambios para quien no usa el panel, y `docker compose --profile panel up -d --build --wait` levanta además el panel y el M6 simulado.
- `npm test`, `npm run lint`, `npm run build`, `npm run contrato:test` y `node scripts/spec-check.mjs` terminan en verde.
- El README, `docs/probar-m2.md` y la guía explican cómo levantar el panel de cada forma.

## Decisiones
- Una sola app para la que usa el cliente y la que usa quien evalúa, por delegación de Lautaro del 2026-10-27, pensando en TP3. Alternativas descartadas: solo un panel de demostración, que no cumple RNF-15 y se tira; y dos aplicaciones separadas, que duplican pantallas y conexión con M2.
- División en dos specs: esta (#71) deja la app de cliente y la base del panel, y el #72 suma la vista de demostración y la integridad de datos. Con todo junto la spec pasaría de 10 tareas. La app queda completa y utilizable sin el #72; el #72 necesita a esta. Los ID de los requisitos que pasan al #72 conservan su número (RNF-05.4, 05.5, 07.3, 07.4, 08.2 a 08.4, 13.4 y 13.6) para no perder la trazabilidad.
- Lo pendiente se construye ahora y se conecta después (regla de Lautaro del 2026-10-27, repetida): inicio y cierre de sesión (M1) y viajes (M6) funcionan contra una fuente simulada del panel, marcados como pendientes, con un único punto de conexión. Si lo pendiente exigiera una operación nueva en M2, no se inventa: es un cambio de contrato (RNF-02.3). Alternativa descartada: dejar esas pantallas vacías o «próximamente» hasta que existan los módulos.
- El M6 simulado es un servicio propio del perfil `panel`, con un canal de control por HTTP: el panel cambia escenarios y modos (normal, lento, caído) sin tocar Docker, y así todo el panel funciona igual en el contenedor y en la máquina. Alternativas descartadas: que lo levante el propio panel con Docker (dos implementaciones según cómo corra, y no sirve en el contenedor), y que viva dentro del panel (no lo alcanzaría M2 en `m6:3006` cuando el panel corre en la máquina).
- Dos formas de levantar el panel con el mismo código: en un contenedor de compose con el perfil `panel` y como proceso en la máquina. La única acción que necesita controlar Docker (apagar y encender la base) queda en el #72, donde se deshabilita en el contenedor porque darle el socket de Docker equivale a dar control de la máquina.
- Revertir migraciones desde el panel queda fuera, por decisión de Lautaro del 2026-10-27: borra una tabla y los cambios de esquema piden aprobación.
- Sin cambios en M2: el panel firma los tokens de desarrollo y los pone en el pedido por su cuenta, y la clave nunca llega al navegador (RNF-19.3). Alternativa descartada: agregar CORS y un endpoint de tokens a M2, que toca `src/` y el contrato.
- Roles del selector: CLIENTE, OPERADOR, SERVICIO y CONDUCTOR. El contrato declara los tres primeros; CONDUCTOR es un rol que M2 reconoce y existe para mostrar el `403`.
- Arranque: «Entrar como cliente nuevo» y un botón «Cargar ejemplo» (RF-2.1.10) que crea direcciones y preferencias por la API y deja viajes en el M6 simulado. Alternativa descartada: sembrar la base, que cambia el esquema o agrega migraciones fuera de esta spec.
- Numeración: los ID derivados continúan después del último de cada RF en las specs 004 a 008 (RF-2.1.5, RF-2.2.6, RF-2.3.6, RF-2.4.12, RF-2.5.15, RF-2.6.5), porque `spec-check` no admite ID locales y una spec nueva no puede crear un RF-2.7.
- Etapa TP1 aunque RNF-15 sea de TP3: el issue #71 lo pide y completarlo en TP3 es agregar pantallas, no rehacer. Soporte de plataformas igual al de `scripts/demo.mjs` (Linux, macOS, Windows con Docker).
- El diseño visual lo delega Lautaro a quien implementa, con las skills de diseño instaladas; las decisiones de estilo van en el plan, no en esta spec.
- Supuesto sobre M6: el M6 simulado cumple `contrato/dependencias/m6.yml`; si el Grupo 12 cambia algo, se ajusta el simulado y las pantallas del historial y de calificar quedan igual.

## Dudas abiertas
Ninguna.
