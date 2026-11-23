# Spec 083 — Inicio de sesión real y nueva interfaz de M2

Estado: aprobada
Issue: #83
Etapa: TP3
Responsable: @DrazenPavicich (Drazen Pavicich)

## Contexto y objetivo

El panel actual cubre las operaciones de M2, pero firma tokens HS256 de desarrollo y no permite usar sus pantallas con M2 en modo jwks. El issue #83 pide inicio y cierre de sesión con Keycloak, permisos obtenidos del token, conservación de la demostración de desarrollo y una nueva interfaz responsiva. Su título, descripción, estado y ausencia de comentarios se consultaron mediante el complemento GitHub en esta sesión.

Se construirá la app principal de cliente y operador con la dirección visual bordó y marfil elegida por DRAZEN. Las herramientas de evaluación tendrán un espacio aparte. Los tokens vivirán en el servidor del frontend y el navegador recibirá solo una sesión opaca. Se utilizarán los usuarios de ejemplo del realm y cada cliente completará su perfil en M2 al primer ingreso.

M6 seguirá simulado durante este trabajo. La futura imagen del grupo de M6 se conectará por configuración en otro trabajo, sin reescribir las pantallas. La maqueta es una referencia de composición y estilo: sus fechas de viaje y puntajes ilustrativos no justifican inventar campos que la API no entregue.

El estado aprobada corresponde al candidato del PR de spec, según la convención del repositorio. La aprobación efectiva es el merge por el integrador; hasta entonces este documento no habilita implementación.

## Usuarios

- Cliente: usa exclusivamente su perfil, direcciones, preferencias, viajes, calificaciones y estado de cuenta.
- Operador: consulta un cliente por UUID y administra sus bloqueos según el contrato.
- Integrante o evaluador: usa las herramientas de diagnóstico y demostración en el entorno de desarrollo.
- SERVICIO: identidad de integración, sin inicio de sesión interactivo en la app principal.
- CONDUCTOR: usuario autenticable del realm sin operaciones de M2 autorizadas por ese rol solamente.

## Historias de usuario

- HU-1. Como cliente, quiero iniciar sesión con mi cuenta de ejemplo de Keycloak para usar mi cuenta de M2 sin elegir ni copiar una identidad.
- HU-2. Como cliente sin perfil, quiero completar mis datos después de autenticarme para comenzar a usar M2.
- HU-3. Como cliente, quiero gestionar mis datos y calificar mis viajes desde el teléfono o la computadora.
- HU-4. Como operador, quiero consultar un cliente y gestionar sus bloqueos sin atribuirme otro rol.
- HU-5. Como evaluador, quiero conservar la demostración y las pruebas de fallas en un espacio separado del uso normal.
- HU-6. Como integrante, quiero reemplazar más adelante el M6 simulado por el real mediante configuración.

## Requisitos funcionales

- RF-2.1.83.1: CUANDO una persona sin sesión abre la app principal, EL SISTEMA ofrece iniciar sesión con Keycloak y no permite elegir rol, sub ni clienteId manualmente.
- RF-2.1.83.2: CUANDO un CLIENTE vuelve de Keycloak con sesión válida, EL SISTEMA consulta obtenerCliente usando su sub como clienteId; si obtiene 200 abre su cuenta y si obtiene 404 ofrece completar el perfil, sin interpretar 401, 403 ni 503 como ausencia de perfil.
- RF-2.1.83.3: CUANDO un CLIENTE confirma su primer perfil, EL SISTEMA llama a crearCliente con los campos del contrato y una Idempotency-Key conservada en los reintentos del mismo envío; abre su cuenta tras 201 y, ante 409 de perfil ya existente, vuelve a consultar su propio perfil antes de continuar.
- RF-2.1.83.4: CUANDO el cliente abre Inicio, EL SISTEMA muestra su nombre, su estado de cuenta, accesos a sus tareas y una página de viajes obtenida mediante listarHistorialViajes, con estados independientes por sección y sin exigir que M6 esté disponible para acceder al perfil.
- RF-2.1.83.5: CUANDO el cliente edita su perfil, EL SISTEMA conserva los campos no modificados, envía solo los cambios admitidos por actualizarCliente y advierte antes de descartar cambios sin guardar al navegar dentro de la app.
- RF-2.2.83.1: CUANDO el cliente abre Direcciones, EL SISTEMA permite listar y paginar, consultar, crear, editar y eliminar sus direcciones FAVORITA o RECIENTE con los campos y límites del contrato, solicitando confirmación antes de eliminar.
- RF-2.3.83.1: CUANDO el cliente abre Preferencias, EL SISTEMA permite consultar y reemplazar tipos de vehículo, canales y necesidades de accesibilidad, explicando el significado de las selecciones vacías según el contrato.
- RF-2.4.83.1: CUANDO el cliente abre Mis viajes, EL SISTEMA muestra la página recibida de M2, identifica los viajes simulados y ofrece Calificar únicamente para viajes COMPLETED no calificados; omite fechas, origen, destino, precios y tipo de vehículo si M2 no los informa.
- RF-2.4.83.2: SI M6 no está disponible y M2 devuelve 503 con Retry-After, ENTONCES EL SISTEMA conserva la navegación de cuenta y ofrece reintentar la consulta después del plazo informado, sin presentar una página vacía como resultado exitoso.
- RF-2.5.83.1: CUANDO el cliente califica un viaje, EL SISTEMA permite puntaje entero de 1 a 5 y comentario opcional dentro del contrato, evita envíos simultáneos desde el mismo formulario y reutiliza la Idempotency-Key del mismo envío al reintentar.
- RF-2.5.83.2: SI M2 rechaza una calificación, ENTONCES EL SISTEMA distingue 404, 409 con type /errores/calificacion-duplicada, 422 con type /errores/viaje-no-completado, 422 con type /errores/idempotencia-reutilizada y 503, conserva el formulario cuando corresponde y nunca informa éxito.
- RF-2.5.83.3: CUANDO el cliente abre Calificaciones, EL SISTEMA lista sus calificaciones paginadas y permite consultar su detalle; solo muestra puntajes en Inicio o Mis viajes si se obtuvieron de una calificación propia mediante la API.
- RF-2.6.83.1: CUANDO el cliente abre Estado de cuenta, EL SISTEMA muestra ACTIVO o BLOQUEADO y los bloqueos vigentes entregados por obtenerEstadoCuenta, sin inventar saldos ni pagos y sin impedir la edición del perfil por estar bloqueado.
- RF-2.6.83.2: CUANDO un OPERADOR consulta un UUID, EL SISTEMA muestra los datos permitidos del cliente y sus bloqueos, permite crear o levantar bloqueos con confirmación y motivo, y actualiza el estado mostrado tras una operación exitosa.

## Requisitos no funcionales

- RNF-02.83.1: EL SISTEMA utiliza las operaciones existentes de M2 sin modificar contrato/, src/ ni migraciones/, y mantiene los datos de viajes en M6, sin consultar su base ni acceder a la base de M2 desde la app principal.
- RNF-02.83.2: EL SISTEMA mantiene M6 simulado durante esta entrega, muestra esa condición en las vistas que dependen de viajes y permite cambiar la dirección de M6 por configuración de M2 sin modificar las pantallas.
- RNF-03.83.1: SI M2 devuelve un error, ENTONCES EL SISTEMA muestra un mensaje comprensible y permite consultar el código, type, title, detail y X-Request-Id recibidos sin exponer credenciales ni reemplazar el error por éxito.
- RNF-04.83.1: CUANDO se levanta el entorno de app real documentado, EL SISTEMA ejecuta frontend, M2 en modo jwks, base de M2, Keycloak y base de Keycloak con imágenes de versión fija y chequeos de salud; mantiene el simulador M6 y Redis como servicios auxiliares necesarios para esta configuración.
- RNF-06.83.1: EL SISTEMA toma de configuración externa el modo de autenticación, direcciones de frontend, M2 y Keycloak, realm, cliente OIDC y retornos autorizados, sin incluir secretos en los archivos enviados al navegador.
- RNF-07.83.1: EL SISTEMA cubre con pruebas unitarias e integración la sesión, permisos, primer ingreso, idempotencia y errores; incluye un recorrido de navegador con Keycloak real y M6 simulado para cliente y operador, además de conservar las pruebas del modo de desarrollo.
- RNF-12.83.1: CUANDO una persona inicia sesión en modo real, EL SISTEMA la autentica mediante OpenID Connect con Authorization Code y PKCE S256 usando m2-front, valida la transacción de autorización y obtiene los roles, scopes y sub de la identidad autenticada, sin recopilar su contraseña en formularios propios.
- RNF-12.83.2: EL SISTEMA conserva access token y refresh token únicamente en el servidor del frontend, entrega al navegador una sesión opaca mediante cookie HttpOnly, limita su uso al origen previsto y exige protección contra solicitudes de cambio originadas desde otros sitios.
- RNF-12.83.3: MIENTRAS la app funciona en modo real, EL SISTEMA usa la credencial de la sesión para reenviar solicitudes a M2 y no firma tokens HS256 ni acepta X-Panel-Rol o X-Panel-Sub como identidad; los permisos definitivos siguen siendo comprobados por M2.
- RNF-12.83.4: CUANDO la credencial necesita renovación, EL SISTEMA intenta renovarla sin duplicar operaciones de negocio; si la sesión ya no puede renovarse, termina la sesión local y ofrece volver a ingresar sin ejecutar automáticamente escrituras pendientes.
- RNF-12.83.5: CUANDO la persona cierra sesión, EL SISTEMA invalida su sesión local, inicia el cierre de sesión en Keycloak y vuelve al acceso de la app; si Keycloak falla, mantiene cerrada la sesión local e informa que no se pudo confirmar el cierre remoto.
- RNF-12.83.6: EL SISTEMA ofrece navegación según los roles efectivos y scopes de la identidad, mantiene la propiedad del CLIENTE y muestra acceso no permitido a un CONDUCTOR sin otro rol habilitado; no permite inicio interactivo como SERVICIO ni cambiar de rol arbitrariamente en modo real.
- RNF-12.83.6.1: CUANDO una identidad tiene CLIENTE y OPERADOR, EL SISTEMA ofrece el selector Mi cuenta / Operación, conserva ambos roles y sus scopes al cambiar de espacio y limita el perfil propio al sub de esa identidad.
- RNF-12.83.4.1: SI la sesión termina con cambios sin guardar, ENTONCES EL SISTEMA conserva el formulario visible mientras la página siga abierta, avisa antes de volver al login y permite copiar lo escrito; no persiste el borrador, advierte que puede perderse durante la redirección y no reenvía escrituras al reingresar.
- RNF-12.83.7: EL SISTEMA mantiene la firma HS256 y las herramientas de las specs 071 y 072 en modo de desarrollo explícito, separa Evaluación de la navegación cotidiana y no habilita en modo real las rutas de suplantación de identidad, control de M6, acceso directo a base ni comandos Docker por el solo hecho de ocultar sus enlaces.
- RNF-13.83.1: SI Keycloak no responde durante acceso o renovación, ENTONCES EL SISTEMA termina la espera dentro del plazo externo configurado, informa el problema y ofrece recuperación sin usar una identidad simulada como alternativa automática.
- RNF-14.83.1: EL SISTEMA conserva X-Request-Id en las solicitudes reenviadas y en los detalles de error, y no comparte entre usuarios autenticados el historial técnico de pedidos y respuestas.
- RNF-15.83.1: EL SISTEMA aplica en todas las pantallas de la app y de evaluación la nueva identidad bordó y marfil, con temas claro y oscuro, navegación lateral en escritorio y navegación compacta en móvil, sin desplazamiento horizontal entre 360 y 1440 píxeles.
- RNF-15.83.2: EL SISTEMA ofrece controles de al menos 44 por 44 píxeles, contraste de texto de al menos 4,5:1, foco visible, uso completo por teclado, mensajes de campo asociados y respeto de prefers-reduced-motion.
- RNF-15.83.3: EL SISTEMA representa carga, vacío, éxito, confirmación, cancelación, rechazo, error y recuperación, conserva datos de formularios ante fallas recuperables y respeta los límites máximos de texto del contrato sin romper la presentación.
- RNF-19.83.1: EL SISTEMA excluye tokens, contraseñas, cookies de sesión y códigos de autorización de logs, almacenamiento del navegador, respuestas de diagnóstico y detalle técnico, y muestra Authorization siempre enmascarado.
- RNF-20.83.1: EL SISTEMA documenta los modos real y de desarrollo, variables, comandos de compose, usuarios de ejemplo, M6 simulado y pruebas verificadas; actualiza PRODUCT.md y DESIGN.md con la dirección elegida al implementar, conservando la trazabilidad de las specs reemplazadas.

## Contrato y dependencias

- Se consumen las 20 operaciones de contrato/openapi.yml: verificarSalud; crearCliente, obtenerCliente, actualizarCliente; listarDirecciones, crearDireccion, obtenerDireccion, actualizarDireccion, eliminarDireccion; obtenerPreferencias, guardarPreferencias; listarHistorialViajes; listarCalificaciones, calificarConductor, obtenerCalificacion; obtenerEstadoCuenta, listarBloqueos, crearBloqueo, obtenerBloqueo y levantarBloqueo.
- Keycloak: realm y cliente público m2-front de la spec 080, con scopes clientes:read, clientes:write y clientes.estado:read según la operación. Acceso, retorno, renovación y cierre pertenecen al frontend, no son nuevas operaciones del servicio M2.
- M6 simulado: M2 consume GET /trips y GET /trips/{tripId}; el frontend consulta viajes solo por M2. El control del simulador corresponde exclusivamente al entorno de evaluación de desarrollo.
- Dependencias existentes: specs 071, 072 y 080, scopes del contrato acordados en #79. La integración real con M6 del #81 no se incorpora a esta entrega.
- Este borrador propone reemplazar el comportamiento de sesión simulada de RF-2.1.5 a RF-2.1.7 y RNF-12.6, RNF-12.7 y RNF-12.9 de la spec 071 solo en modo real; esos comportamientos permanecen en desarrollo. RNF-19.3 de la 071 se conserva al mantener tokens en servidor.
- La selección visual aprobada reemplaza la estética anterior de PRODUCT.md y DESIGN.md al implementar, sin cambiar las reglas de negocio. No se modifican otras carpetas de specs en esta propuesta.

## Casos límite

- Cancelación del login, retorno repetido, código vencido, state o nonce inválidos: no abren sesión ni crean perfiles.
- Usuario autenticado sin scopes o sin un rol admitido: no se interpreta como usuario nuevo y no se le asignan permisos desde el frontend.
- Identidad con CLIENTE y OPERADOR: ofrece Mi cuenta / Operación sin modificar roles ni identidad; inicialmente abre Mi cuenta y no exige crear un perfil para usar el espacio Operación.
- Dos pestañas completan el perfil: una creación y una recuperación del perfil existente, sin duplicados.
- Cookie vencida o servidor del frontend reiniciado: se ofrece reingreso. Con formulario sin guardar se muestra el aviso y la posibilidad de copiar antes de redirigir; no se promete recuperarlo tras la redirección.
- M6 caído y cuenta disponible: Inicio puede mostrar error solo en viajes; perfil, direcciones, preferencias y estado de cuenta siguen funcionando.
- Viaje ya calificado desde otra pestaña: 409 visible y actualización del listado, sin una segunda calificación.
- Un cliente bloqueado conserva las operaciones que el contrato permite sobre su propia cuenta.
- Una fecha o un precio dibujado en la maqueta no se muestra si no proviene de la API; calificado no equivale a conocer el puntaje.
- Parámetros de retorno ajenos al origen permitido, cambio de usuario y solicitudes de otro origen no revelan sesiones ni registros de otras personas.
- Entorno de desarrollo sin Docker en el servidor del panel: conserva los botones de control de base deshabilitados con su explicación, como en la spec 072.

## Fuera de alcance

- Registro de nuevas credenciales en Keycloak: se usan los usuarios de ejemplo, por decisión del usuario.
- Recuperación y revocación de credenciales, HTTPS, límite de pedidos y despliegue público.
- Cambiar validación JWT de M2, el contrato público, el esquema de datos o la lógica de negocio del backend.
- Integrar, descargar o publicar la futura imagen de M6; la conexión se realizará en otro trabajo.
- Mapas, solicitud o reserva de viajes, pagos, saldos, búsqueda de clientes por nombre o listado general de clientes: el contrato actual de M2 no los ofrece.
- Una interfaz de inicio de sesión para cuentas SERVICIO y la obtención de sus tokens en modo real.
- Caché o persistencia de viajes en el frontend como sustituto de consultar M2.
- Nuevas dependencias sin autorización; su necesidad se evalúa en el plan.

## Criterios de finalización

- Cliente de ejemplo inicia sesión en Keycloak, completa su perfil si falta, usa las pantallas de cuenta y cierra sesión con M2 en jwks.
- Operador de ejemplo consulta un cliente por UUID, crea un bloqueo y lo levanta; un cliente no puede realizar esas acciones ni acceder a otro perfil.
- La sesión y sus tokens cumplen RNF-12.83.2 y RNF-19.83.1; en modo real no se puede recuperar la suplantación mediante rutas o encabezados de desarrollo.
- Las pantallas conservan las operaciones del contrato, el tratamiento de errores e idempotencia y cumplen los estados y medidas de RNF-15.
- M6 sigue simulado y su condición es visible; su indisponibilidad no inutiliza el resto de M2.
- El entorno de desarrollo conserva demostración y control del simulador sin exponerlos desde la app real.
- Compose permite ejecutar el recorrido real con las cinco piezas principales y los auxiliares; imágenes y dependencias quedan versionadas.
- npm test, npm run lint, npm run build, npm run panel:build, pruebas de navegador con Keycloak real, npm run contrato:test y node scripts/spec-check.mjs terminan en verde antes de declarar implementada la spec.
- Se completa el plan con trazabilidad, tareas de 20 a 30 minutos, guía de implementación y documentación de arranque; no se confunde la aprobación visual con el merge de la spec.

## Decisiones

- Confirmadas por DRAZEN: rediseño completo, dirección visual bordó y marfil de la maqueta, prioridad de cliente y operador y evaluación en un espacio aparte.
- Confirmado por DRAZEN: M6 simulado por ahora; integración futura por configuración cuando esté la imagen del otro grupo.
- Confirmado por DRAZEN: tokens guardados en servidor y cookie de sesión para el navegador. Se descarta la propuesta inicial de tokens en memoria del navegador para preservar RNF-19.3 y aprovechar el proxy existente; no se propone instalar keycloak-js para esta arquitectura.
- Confirmado por DRAZEN: acceso con usuarios de ejemplo; no habilitar registro de nuevas credenciales en este trabajo. Completar el perfil en M2 sigue siendo parte del primer ingreso.
- Confirmado por DRAZEN: una identidad CLIENTE y OPERADOR utiliza selector Mi cuenta / Operación conservando sus permisos reales.
- Confirmado por DRAZEN: sesión vencida con formulario abierto permite avisar y copiar antes del reingreso; no se almacena el borrador ni se reenvía automáticamente. La redirección puede perderlo.
- El modo de desarrollo firmado se conserva conforme al issue #83; su separación de despliegue y acceso se detalla en el plan y debe impedir que se active desde una sesión real.

## Dudas abiertas

Ninguna.
