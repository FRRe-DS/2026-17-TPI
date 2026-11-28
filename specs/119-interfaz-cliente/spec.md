# Spec 119 — Interfaz rediseñada del cliente

Estado: aprobada
Issue: #119
Etapa: TP3
Responsable: @sandobaitt

## Contexto y objetivo
El panel de M2 (specs 071, 072 y 083) ya deja usar todas las operaciones del cliente, con login real de Keycloak o en modo de desarrollo. Su aspecto es el «Verde ciudad» de la spec 071. En el PR #118 el grupo acordó una identidad nueva, bordó y marfil, y Drazen Pavicich subió una maqueta del Inicio a #119.

Esta spec rediseña con esa identidad la parte del cliente: el sistema visual, el marco con su navegación, un Inicio nuevo y las pantallas de perfil, primer perfil, direcciones, preferencias, historial, calificar, calificaciones y estado de cuenta. Las operaciones y validaciones no cambian, y M2 tampoco: es trabajo del panel. El operador y el espacio de evaluación van en #155. El recorrido integral con capturas y la documentación final, en #120.

La maqueta es una referencia adaptada: se toma su composición, pero lo que M2 no entrega no se muestra (ver Decisiones). Los ID con `.83.` vienen de la versión de la spec 083 que se dividió en el PR #118 y se conservan por indicación del integrador; las reglas nuevas de esta spec llevan `.119.`.

## Usuarios
- Cliente de la plataforma: entra con su cuenta de Keycloak (modo real) o con una identidad simulada (modo de desarrollo) y gestiona su perfil, direcciones, preferencias, viajes, calificaciones y estado de cuenta.
- Persona con los roles CLIENTE y OPERADOR: en su parte de cliente ve lo mismo que un cliente; su parte de operador es de #155.

## Historias de usuario
- HU-1. Como cliente, quiero un Inicio con mi estado de cuenta y mis últimos viajes para saber de un vistazo si puedo viajar y qué me falta calificar.
- HU-2. Como cliente, quiero que todas mis pantallas tengan el mismo aspecto y la misma navegación, en la computadora y en el teléfono, para encontrar cada cosa sin pensar.
- HU-3. Como cliente, quiero que la app me avise antes de perder cambios sin guardar para no tener que volver a escribirlos.
- HU-4. Como cliente, quiero elegir el tema claro u oscuro para usar la app cómodo a cualquier hora.

## Requisitos funcionales
- RF-2.1.83.4: CUANDO el cliente abre Inicio, EL SISTEMA muestra un saludo con el `nombre` de su perfil, su estado de cuenta, accesos a Mi perfil, Direcciones y Preferencias, y hasta 5 viajes de la primera página de `listarHistorialViajes` pedida con `size=5`, con estados de carga, vacío y error independientes por sección y sin exigir que M6 esté disponible para mostrar el perfil y el estado de cuenta.
- RF-2.1.83.5: CUANDO el cliente edita su perfil, EL SISTEMA conserva los campos no modificados, envía solo los cambios que admite `actualizarCliente` y advierte antes de descartar cambios sin guardar al navegar dentro de la app.
- RF-2.1.119.1: CUANDO el cliente completa su primer perfil (RF-2.1.83.3 de la spec 083), EL SISTEMA presenta el formulario con el sistema visual de esta spec, sin cambiar los campos, las validaciones ni el manejo de la `Idempotency-Key`.
- RF-2.1.119.2: CUANDO el cliente entra a la app con sesión, EL SISTEMA abre Inicio, en los modos real y de desarrollo.
- RF-2.1.119.3: SI M2 responde `404` al pedir el perfil desde Inicio (modo de desarrollo, identidad simulada sin perfil), ENTONCES EL SISTEMA muestra solo la invitación a crear el perfil, como Mi perfil, sin pedir el estado de cuenta ni los viajes.
- RF-2.2.83.1: CUANDO el cliente abre Direcciones, EL SISTEMA permite listar y paginar, consultar, crear, editar y eliminar sus direcciones FAVORITA o RECIENTE con los campos y límites del contrato, y pide confirmación antes de eliminar.
- RF-2.3.83.1: CUANDO el cliente abre Preferencias, EL SISTEMA permite consultar y reemplazar tipos de vehículo, canales y necesidades de accesibilidad, y explica qué significa dejar vacía cada selección según el contrato.
- RF-2.4.83.1: CUANDO el cliente abre Mis viajes, EL SISTEMA muestra la página que recibe de M2, identifica los viajes simulados, ofrece «Calificar» solo en los viajes `COMPLETED` cuyo `calificado` no es `true` (también si falta el dato: decide M2) y muestra «Calificado», sin puntaje y con un enlace a Calificaciones, en los que tienen `calificado` igual a `true`; no muestra fechas, origen, destino, precios ni tipo de vehículo si M2 no los informa.
- RF-2.4.83.2: SI M6 no está disponible y M2 responde `503` con `Retry-After`, ENTONCES EL SISTEMA conserva la navegación de la cuenta, muestra que los viajes no están disponibles y ofrece reintentar la consulta después del plazo informado, sin presentar una página vacía como resultado exitoso; en Inicio solo se ve afectada la sección de viajes.
- RF-2.5.83.1: CUANDO el cliente califica un viaje, EL SISTEMA admite un puntaje entero de 1 a 5 y un comentario opcional dentro del contrato, evita envíos simultáneos desde el mismo formulario y reutiliza la `Idempotency-Key` del mismo envío al reintentar.
- RF-2.5.83.2: SI M2 rechaza una calificación, ENTONCES EL SISTEMA distingue `404`, `409` con type `/errores/calificacion-duplicada`, `422` con type `/errores/viaje-no-completado`, `422` con type `/errores/idempotencia-reutilizada` y `503`, conserva el formulario cuando corresponde y nunca informa éxito.
- RF-2.5.83.3: CUANDO el cliente abre Calificaciones, EL SISTEMA lista sus calificaciones paginadas con su puntaje y permite consultar el detalle de cada una; Inicio y Mis viajes no muestran puntajes.
- RF-2.6.83.1: CUANDO el cliente abre Estado de cuenta, EL SISTEMA muestra ACTIVO o BLOQUEADO y los bloqueos vigentes que entrega `obtenerEstadoCuenta`, sin inventar saldos ni pagos y sin impedir la edición del perfil por estar bloqueado.

## Requisitos no funcionales
- RNF-02.119.1: EL SISTEMA cambia solo el panel (`panel/`): no modifica `contrato/`, `src/` ni `migraciones/`, y no agrega paquetes npm.
- RNF-07.119.1: EL SISTEMA verifica el rediseño con pruebas unitarias de su lógica, pruebas de integración de las pantallas, y pruebas de navegador en 360, 768, 1280 y 1440 píxeles, con tema claro y oscuro, que comprueban la ausencia de desplazamiento horizontal y de violaciones serias o críticas de axe en cada pantalla de cliente, y el contraste de las pantallas de operador y evaluación; las pruebas existentes de las specs 071, 072 y 083 siguen en verde.
- RNF-15.83.1: EL SISTEMA aplica la identidad bordó y marfil en todas las pantallas de cliente, en los modos real y de desarrollo, con temas claro y oscuro, navegación lateral en escritorio y navegación compacta en el teléfono, sin desplazamiento horizontal entre 360 y 1440 píxeles.
- RNF-15.119.1: MIENTRAS el ancho de la ventana es menor que 960 píxeles, EL SISTEMA muestra un encabezado con un botón «Menú» que indica si está abierto (`aria-expanded`) y despliega las siete secciones del cliente (Inicio, Mi perfil, Direcciones, Preferencias, Mis viajes, Calificaciones y Estado de cuenta) y el selector de tema, se cierra con Escape o al elegir una sección y devuelve el foco al botón.
- RNF-15.119.2: EL SISTEMA sigue el tema del sistema operativo hasta que el cliente elige claro u oscuro con el selector de la barra lateral o del menú, recuerda esa elección en el navegador y mantiene en los dos temas un contraste de texto de al menos 4,5:1.
- RNF-15.119.3: EL SISTEMA usa una tipografía propia servida por el panel, sin recursos de terceros y con su licencia en el repositorio.
- RNF-15.119.6: SI la tipografía propia no carga, ENTONCES EL SISTEMA usa la del sistema sin romper la presentación.
- RNF-15.119.4: SI el cliente intenta salir de un formulario con cambios sin guardar (perfil, primer perfil, dirección, preferencias o calificación) navegando dentro de la app, cambiando de espacio o cerrando sesión (en el modo de desarrollo, también para cambiar de identidad), ENTONCES EL SISTEMA pide confirmación y, si cancela, conserva lo escrito.
- RNF-15.119.5: EL SISTEMA mantiene en el rediseño lo que exigen RNF-15.83.2 y RNF-15.83.3 de la spec 083 (controles de 44×44 píxeles, foco visible, uso con teclado, errores asociados a su campo, `prefers-reduced-motion`, todos los estados y textos máximos del contrato) y RNF-15.4 de la spec 071 («M2 no responde» con «Reintentar»), con los textos en español y en voseo.
- RNF-15.119.7: EL SISTEMA muestra en el encabezado un círculo con las iniciales y el nombre del perfil cuando está cargado, el selector de espacio de la spec 083 si la persona tiene los roles CLIENTE y OPERADOR, y el botón «Cerrar sesión»; en el modo de desarrollo, además, el rol y el identificador de la sesión simulada, y «Cerrar sesión» lleva a Ingresar para elegir otra identidad; sin migas de pan ni menú desplegable de usuario.
- RNF-15.119.8: MIENTRAS #155 no rediseñe el operador y la evaluación, EL SISTEMA mantiene esas pantallas operativas con la identidad nueva, sin cambiar su composición y con un contraste de texto de al menos 4,5:1 en claro y oscuro.
- RNF-19.119.1: EL SISTEMA no agrega a las pantallas rediseñadas tokens, cookies ni códigos de autorización, y sigue cumpliendo RNF-19.83.1 y RNF-19.83.2 de la spec 083.
- RNF-20.119.1: EL SISTEMA documenta en `panel/DESIGN.md` y `panel/PRODUCT.md` la identidad bordó y marfil que reemplaza a «Verde ciudad», y en la guía las diferencias con la maqueta por los datos que M2 no entrega.

## Contrato y dependencias
- Operaciones del contrato que usa el panel (ya implementadas en M2, sin cambios): `obtenerCliente`, `crearCliente`, `actualizarCliente`, `listarDirecciones`, `obtenerDireccion`, `crearDireccion`, `actualizarDireccion`, `eliminarDireccion`, `obtenerPreferencias`, `guardarPreferencias`, `listarHistorialViajes`, `calificarConductor`, `listarCalificaciones`, `obtenerCalificacion` y `obtenerEstadoCuenta`.
- Operaciones de otros módulos que consume: ninguna directa. Los viajes llegan por `listarHistorialViajes` de M2, que llama a M6; si M6 no contesta, M2 responde `503` con `Retry-After` y aplica RF-2.4.83.2. La sesión sigue la spec 083 (Keycloak en modo real).

## Casos límite
- Nombre de 100 caracteres: el saludo de Inicio y el encabezado lo recortan con puntos suspensivos y el nombre completo sigue disponible para lectores de pantalla; nada se desborda a 360 píxeles.
- El historial tiene menos de 5 viajes: Inicio muestra los que hay. No tiene ninguno: «Todavía no tenés viajes», sin botón Calificar.
- M6 no responde o M2 devuelve `503` para los viajes: en Inicio, solo la sección de viajes muestra el aviso y «Reintentar» cuando vence el `Retry-After`; el estado de cuenta y los accesos funcionan.
- Falla `obtenerEstadoCuenta` pero el perfil carga: Inicio muestra el saludo y los viajes, y la franja de estado muestra el error con «Reintentar».
- Cuenta BLOQUEADA: la franja de Inicio dice «Cuenta bloqueada» y cuántos bloqueos vigentes hay, con el enlace a Estado de cuenta; las operaciones que el contrato admite siguen disponibles.
- Un viaje con un `estado` que el panel no conoce: se muestra tal cual, sin «Calificar».
- Un viaje `COMPLETED` sin el dato `calificado`: se ofrece «Calificar», como hoy; si ya estaba calificado, M2 responde `409` y se aplica RF-2.5.83.2.
- El cliente eligió el tema oscuro y después el sistema pasa a claro: se mantiene su elección hasta que la cambie.
- El navegador no deja guardar la elección del tema (modo privado o almacenamiento bloqueado): el tema sigue al sistema y nada falla.
- La fuente propia no llega a cargar: se ve con la del sistema y el diseño no se rompe.
- El menú del teléfono está abierto y el cliente rota la pantalla a más de 960 píxeles: el menú desplegable se cierra y aparece la barra lateral.
- Cambios sin guardar y la sesión vence: manda el reingreso de la spec 083, que no ejecuta escrituras pendientes.
- Cambios sin guardar y el cliente toca «Cerrar sesión» o cambia de espacio: se pide confirmación; si cancela, sigue en el formulario con lo escrito (RNF-15.119.4).
- Modo de desarrollo con una identidad simulada sin perfil: Inicio invita a crear el perfil y no pide nada más (RF-2.1.119.3).
- Cambios sin guardar y el cliente cierra la pestaña o recarga: queda fuera de RNF-15.119.4, que cubre la navegación dentro de la app.
- Perfil inexistente (`404`) en modo real: antes de Inicio se pide el primer perfil, como en la spec 083.

## Fuera de alcance
- Operador y espacio de evaluación con el diseño nuevo: #155.
- Recorrido integral con Keycloak real, capturas finales y documentación de uso: #120.
- Sesión, OIDC, renovación y cierre de sesión: spec 083.
- Fechas, origen, destino, tipo de vehículo y precio en los viajes, y puntajes en Inicio o Mis viajes: M2 no los entrega en el historial. Mostrarlos pide un cambio de contrato aparte.
- Barra de navegación inferior en el teléfono.
- La meta de rendimiento de RNF-16: la define el consorcio.
- Avisar al cerrar la pestaña o recargar con cambios sin guardar.
- Cambios en M2, en su contrato o en su base, y paquetes npm nuevos.

## Criterios de finalización
- Las pantallas de cliente (Inicio, Mi perfil, primer perfil, Direcciones, Preferencias, Mis viajes, Calificar, Calificaciones y Estado de cuenta) usan la identidad bordó y marfil en claro y oscuro, en los modos real y de desarrollo, con las mismas operaciones que antes.
- Inicio tiene, como la maqueta de #119: saludo con el nombre, franja de estado de cuenta con enlace a Estado de cuenta, «Últimos viajes» y «Tu cuenta» con accesos a Mi perfil, Direcciones y Preferencias; las diferencias por RF-2.4.83.1 y RF-2.5.83.3 están en la guía.
- Las pantallas de operador y evaluación siguen funcionando y pasan la prueba de contraste en claro y oscuro (RNF-15.119.8).
- Las pruebas de navegador pasan en 360, 768, 1280 y 1440 píxeles, en claro y oscuro, sin desplazamiento horizontal ni violaciones serias o críticas de axe.
- `npm test`, `npm run lint`, `npm run build` y `node scripts/spec-check.mjs` en verde, incluidas las pruebas del panel de las specs 071, 072 y 083.
- `panel/DESIGN.md` y `panel/PRODUCT.md` describen la identidad nueva; la fuente propia tiene su licencia en el repositorio.

## Decisiones
- La maqueta de #119 es una referencia adaptada: se toma su composición (barra lateral bordó, saludo, franja de estado de cuenta, «Últimos viajes» y «Tu cuenta») y se omite lo que M2 no entrega. Decidido por Lautaro el 2026-11-28. Alternativas descartadas: usar solo los colores y diseñar de cero, que lleva más tiempo, y copiarla exacta, que obliga a cambiar el contrato o a inventar datos.
- Sin fechas en la lista de viajes: M6 no informa el inicio ni el fin del viaje en su resumen y M2 no los devuelve. Sale de la decisión anterior.
- Inicio y Mis viajes muestran «Calificado» sin puntaje, con un enlace a Calificaciones. Decidido por Lautaro el 2026-11-28. El historial no trae el identificador de la calificación, así que el enlace va a la lista y no a una calificación puntual. Alternativa descartada: pedir además `listarCalificaciones` y cruzarla por viaje, que suma un pedido y deja sin puntaje los viajes cuya calificación cae en otra página.
- Tipografía propia: un archivo woff2 con licencia libre (OFL) copiado al panel con su licencia, sin paquete npm. Decidido por Lautaro el 2026-11-28. Cuál fuente se elige en el plan. Alternativa descartada: seguir con `system-ui`, que cambia según el sistema y se aleja de la maqueta.
- En el teléfono, menú desplegable desde el encabezado con las siete secciones, como hoy pero con el diseño nuevo. Decidido por Lautaro el 2026-11-28. Alternativa descartada: barra inferior con «Más», que es más trabajo y deja tres secciones a dos toques.
- El rediseño vale para los dos modos del panel: las dos apps comparten pantallas, marco y variables de estilo, y separarlas duplicaría el trabajo.
- Selector de tema en la barra lateral, como en la maqueta, que arranca siguiendo al sistema. La elección se guarda en el navegador porque es una comodidad de cada persona, no un dato de M2.
- Clarificación del 2026-11-28 (Lautaro aceptó todas las recomendaciones):
  - Operador y evaluación toman la identidad nueva por compartir variables y marco, pero su composición se rehace en #155; mientras tanto se exige que funcionen y tengan buen contraste (RNF-15.119.8). Alternativa descartada: dejarlas con los colores viejos, que obliga a mantener dos juegos de variables.
  - Inicio pasa a ser la pantalla de entrada del cliente (RF-2.1.119.2), porque es la pensada para eso; hoy se entra a Mi perfil.
  - Con una identidad simulada sin perfil, Inicio solo invita a crearlo (RF-2.1.119.3): el estado de cuenta y los viajes también darían `404`.
  - El aviso de cambios sin guardar cubre cerrar sesión y cambiar de identidad (RNF-15.119.4), porque en los dos casos se pierde lo escrito.
  - Encabezado sin migas de pan ni menú de usuario (RNF-15.119.7): las secciones son de un nivel y «Cerrar sesión» ya está a la vista. Corrección al escribir el plan: el modo de desarrollo no tiene un selector de identidad en el encabezado; se cambia de identidad cerrando sesión y volviendo a Ingresar, así que el aviso de cambios sin guardar cubre ese caso al cubrir «Cerrar sesión».
- Las reglas nuevas llevan `.119.`; los ID `.83.` se conservan tal como los dejó la división del PR #118, ajustados a las decisiones de arriba (RF-2.4.83.1 y RF-2.5.83.3).

## Dudas abiertas
Ninguna.
