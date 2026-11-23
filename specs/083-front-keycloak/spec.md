# Spec 083 — Sesión real del frontend con Keycloak

Estado: aprobada
Issue: #83
Etapa: TP3
Responsable: @DrazenPavicich (Drazen Pavicich)

## Contexto y objetivo

El panel actual firma tokens HS256 de desarrollo y no permite usar sus pantallas con M2 en modo jwks. Esta spec conecta el acceso y cierre de sesión con Keycloak, conserva los permisos del contrato y mantiene el modo de desarrollo para evaluación.

La revisión de @sandobaitt en el PR #118 divide el trabajo en tres: sesión en #83; nueva interfaz y entrega integral en dos issues de continuación. Sus textos propuestos están en issue-interfaz.md e issue-entrega.md. El compose de la app real y el entorno de navegador con Keycloak pertenecen a sesión: son necesarios para probar el login, no se postergan a entrega.

Los tokens viven en el servidor del frontend y el navegador recibe solo una sesión opaca. Se usan usuarios de ejemplo del realm, sin registro nuevo, y cada CLIENTE completa su perfil M2 al primer ingreso. M6 sigue simulado, con viajes precargados por configuración para que sea posible calificar en modo real sin herramientas de desarrollo.

La identidad bordó y marfil está acordada para el issue de interfaz. Esta spec adapta las pantallas existentes al acceso real y no implementa el rediseño completo. La referencia de la maqueta y el estado de su adjunto se encuentran en maqueta.md.

El estado aprobada identifica al candidato de PR. La aprobación efectiva es el merge por el integrador; hasta entonces no se implementa.

## Usuarios

- CLIENTE: opera sobre el perfil identificado por su sub.
- OPERADOR: consulta clientes por UUID y administra bloqueos según el contrato.
- Integrante o evaluador: utiliza un proceso de desarrollo separado con firma HS256.
- SERVICIO: cuenta de integración sin login interactivo.
- CONDUCTOR: usuario de ejemplo sin acceso a operaciones de M2 por ese rol solamente.
- CLIENTE y OPERADOR: una identidad con dos espacios de navegación y sus permisos reales.

## Historias de usuario

- HU-1. Como cliente, quiero iniciar sesión con Keycloak sin elegir manualmente identidad o rol.
- HU-2. Como cliente sin perfil, quiero completar mis datos al primer ingreso.
- HU-3. Como operador o persona con doble rol, quiero acceder al espacio permitido sin suplantar usuarios.
- HU-4. Como integrante, quiero ejecutar un login real comprobable en Chrome con viajes simulados y sin publicar la base.
- HU-5. Como evaluador, quiero conservar el proceso de desarrollo sin que sus herramientas se habiliten desde una sesión real.

## Requisitos funcionales

- RF-2.1.83.1: CUANDO una persona sin sesión abre la app real, EL SISTEMA ofrece iniciar sesión con Keycloak y no permite elegir rol, sub ni clienteId manualmente.
- RF-2.1.83.2: CUANDO un CLIENTE vuelve de Keycloak con sesión válida, EL SISTEMA consulta obtenerCliente usando su sub como clienteId; con 200 abre la cuenta y con 404 ofrece completar el perfil, sin interpretar 401, 403 ni 503 como perfil inexistente.
- RF-2.1.83.3: CUANDO un CLIENTE confirma su primer perfil, EL SISTEMA llama a crearCliente con los campos del contrato y una Idempotency-Key conservada en los reintentos del mismo envío; abre la cuenta tras 201 y ante 409 consulta de nuevo el perfil propio antes de continuar.

## Requisitos no funcionales

- RNF-02.83.1: EL SISTEMA consume la API existente sin modificar contrato/, src/ ni migraciones/, sin consultar bases ajenas desde la app real.
- RNF-02.83.2: EL SISTEMA mantiene M6 simulado, identifica esa condición en las pantallas de viajes y permite cambiar la dirección del servicio por configuración de M2 sin reescribir pantallas.
- RNF-02.83.3: CUANDO se habilita la precarga de desarrollo del M6 simulado, EL SISTEMA carga al arrancar un viaje completado y otro en curso para cada sub configurado, incluidos cliente1 y cliente2; sin la variable conserva el arranque vacío y repetir la carga usa los mismos identificadores sin duplicar viajes.
- RNF-03.83.1: SI M2 devuelve un error, ENTONCES EL SISTEMA conserva su código, type, title, detail y X-Request-Id, ofrece un mensaje comprensible y no lo reemplaza por éxito ni expone credenciales.
- RNF-04.83.1: CUANDO se levanta el entorno real documentado, EL SISTEMA ejecuta frontend, M2 en jwks, base de M2, Keycloak y base de Keycloak con imágenes de versión fija y salud verificable, más Redis y M6 simulado como auxiliares.
- RNF-04.83.2: CUANDO se levanta el entorno real o el perfil panel sin habilitar explícitamente el puente de desarrollo, EL SISTEMA no inicia bd-puente ni publica puertos de la base de M2; el puente solo se activa mediante un perfil propio documentado.
- RNF-06.83.1: EL SISTEMA toma de configuración externa el modo, las direcciones de frontend, M2 y Keycloak, realm, cliente OIDC, retornos autorizados y precarga del simulador, sin incluir secretos en archivos del navegador.
- RNF-07.83.1: EL SISTEMA prueba sesión, permisos, primer ingreso, concurrencia, errores y aislamiento con unitarias e integración y un recorrido en Chrome con Keycloak real y M6 simulado precargado, conservando las pruebas de desarrollo.
- RNF-12.83.1: CUANDO una persona inicia sesión real, EL SISTEMA usa OpenID Connect Authorization Code con PKCE S256 y m2-front, valida la transacción y obtiene roles, scopes y sub de la identidad autenticada, sin recopilar contraseñas en formularios propios.
- RNF-12.83.2: EL SISTEMA conserva access token y refresh token solo en el servidor y entrega una cookie de sesión opaca HttpOnly con protección contra cambios originados desde otros sitios.
- RNF-12.83.3: MIENTRAS el modo es real, EL SISTEMA reenvía a M2 la credencial de la sesión, no firma HS256 ni acepta X-Panel-Rol o X-Panel-Sub como identidad, y mantiene la autorización definitiva en M2.
- RNF-12.83.4: CUANDO hace falta renovar la credencial, EL SISTEMA intenta renovarla sin duplicar operaciones; si la sesión no puede renovarse la termina y ofrece reingreso sin ejecutar escrituras pendientes.
- RNF-12.83.4.1: SI termina la sesión con un formulario sin guardar, ENTONCES EL SISTEMA lo mantiene visible mientras la página siga abierta, permite copiar antes de volver al login y advierte que el borrador puede perderse al redirigir, sin persistirlo ni autoenviarlo.
- RNF-12.83.5: CUANDO se cierra sesión, EL SISTEMA invalida primero la sesión local y solicita el cierre remoto; si Keycloak falla, la sesión local permanece cerrada y se informa que el cierre remoto no está confirmado.
- RNF-12.83.6: EL SISTEMA ofrece las pantallas existentes según roles y scopes, conserva la propiedad del CLIENTE, muestra acceso no permitido a CONDUCTOR sin otro rol admitido y no ofrece login interactivo como SERVICIO.
- RNF-12.83.6.1: CUANDO una identidad tiene CLIENTE y OPERADOR, EL SISTEMA ofrece Mi cuenta / Operación conservando sub, roles y scopes, sin exigir perfil propio para usar Operación.
- RNF-12.83.7: EL SISTEMA conserva firma HS256 y evaluación en un proceso de desarrollo separado; el proceso real no registra rutas de suplantación, control de M6, consulta directa de base ni comandos Docker.
- RNF-12.83.8: EL SISTEMA incluye en el realm de desarrollo un usuario de ejemplo con CLIENTE y OPERADOR, sub UUID fijo y los scopes de M2 que solicite la app, para probar el selector con una identidad real.
- RNF-12.83.9: MIENTRAS el modo es real, EL SISTEMA permite en form-action de su CSP únicamente self y el origen público configurado de Keycloak, conserva las demás restricciones y permite completar en Chrome el POST de login y su redirección; en desarrollo mantiene form-action self.
- RNF-13.83.1: SI Keycloak no responde en acceso o renovación, ENTONCES EL SISTEMA agota un plazo configurado, informa el problema y ofrece recuperación sin sustituir la identidad por una simulada.
- RNF-14.83.1: EL SISTEMA conserva X-Request-Id en el proxy y los errores y no comparte el historial técnico entre sesiones.
- RNF-15.83.2: EL SISTEMA conserva en las vistas de acceso, primer perfil, selector y reingreso controles de 44 por 44 píxeles, contraste 4,5:1, foco visible, teclado, errores asociados y respeto de prefers-reduced-motion.
- RNF-15.83.3: EL SISTEMA representa carga, cancelación, rechazo, error y recuperación de sesión y primer perfil sin romper las vistas existentes entre 360 y 1440 píxeles ni descartar formularios ante una falla recuperable.
- RNF-19.83.1: EL SISTEMA excluye tokens, cookies, contraseñas y códigos de autorización de logs, almacenamiento del navegador y diagnóstico y muestra Authorization enmascarado.
- RNF-20.83.1: EL SISTEMA documenta modos, comandos, versiones, usuarios, precarga M6, perfil del puente, variables y pruebas verificadas de sesión; el rediseño documental de PRODUCT.md y DESIGN.md corresponde al issue de interfaz.

## Contrato y dependencias

- El proxy conserva las 20 operaciones de contrato/openapi.yml, sin agregar rutas a M2. Las pantallas existentes siguen consumiéndolas; esta spec cambia identidad y sesión, no sus reglas de negocio.
- El primer ingreso consume obtenerCliente y crearCliente. La prueba real usa además obtenerEstadoCuenta, actualizarCliente, listarHistorialViajes, calificarConductor y operaciones de bloqueos para comprobar permisos.
- Keycloak: cliente público m2-front y realm de la 080, con clientes:read, clientes:write y clientes.estado:read según operación. La 083 añade solo un usuario de desarrollo de doble rol y las direcciones exactas de prueba necesarias.
- M6: M2 consume GET /trips y GET /trips/{tripId}. La precarga ocurre dentro del simulador antes de atender, sin exponer su canal de control en modo real ni precargar la base de M2.
- Depende de 071, 072, 080 y el contrato de scopes de #79. M6 real y la integración #81 quedan fuera.
- Cambia la sesión simulada de RF-2.1.5 a RF-2.1.7 y RNF-12.6, RNF-12.7 y RNF-12.9 de la 071 solo en modo real; desarrollo conserva esos comportamientos.
- Reemplaza para el puente el disparador de RNF-04.8 de la 072: ya no basta panel para publicar la base; el uso local del panel requiere habilitar explícitamente el perfil del puente. Se actualizan comandos y pruebas de consistencia en la implementación de #83, sin editar otra carpeta de spec desde esta rama.

## Casos límite

- Callback cancelado, repetido, expirado, con state o nonce inválidos o desde otro navegador: no abre sesión.
- 401, 403 y 503 al consultar perfil no crean un perfil nuevo.
- Dos pestañas crean perfil: 201 o recuperación del existente tras 409, sin duplicados.
- Doble rol: inicia en Mi cuenta, puede abrir Operación sin perfil propio y no cambia identidad.
- Sesión vencida: formulario visible para copiar antes de redirigir; sin almacenamiento persistente ni reenvío.
- Logout concurrente con refresh: el refresh no recrea la sesión invalidada.
- M6 caído: conserva los errores y reintentos de las pantallas existentes, sin bloquear el resto de la cuenta.
- Precarga apagada: simulador vacío como antes. UUID inválido configurado: no arranca e informa el nombre de variable sin imprimir su contenido.
- Precarga repetida: mismos IDs. No crea calificaciones ni perfiles M2 y no incluye viajes ajenos en el historial propio.
- CSP en Chrome: permitir solo el destino público exacto de Keycloak; no relajar default-src, frame-ancestors, script-src ni style-src para resolver el login.
- Arranque con panel o real: bd-puente ausente sin perfil explícito; la base no publica puertos.
- La maqueta no habilita fechas o precios inexistentes: calificado no equivale a conocer un puntaje.

## Fuera de alcance

- Rediseño bordó y marfil de todas las pantallas, Inicio nuevo, composición final, temas y revisión visual completa: issue de interfaz.
- Entrega visual integral, documentación final de producto y recorrido completo de todas las funciones rediseñadas: issue de entrega.
- Registro, recuperación y revocación de credenciales, HTTPS, límite de pedidos y despliegue público.
- Modificar contrato/, src/, migraciones/ o la validación JWT de M2.
- Imagen M6 real, mapas, reservas, pagos, saldos y búsqueda de clientes por nombre.
- Inicio interactivo de SERVICIO o nuevos permisos para probar la app.
- Dependencias nuevas sin aprobación.

## Criterios de finalización

- Cliente de ejemplo completa login real, consulta o crea su perfil propio y cierra sesión con M2 en jwks.
- Un usuario de doble rol del realm recorre los dos espacios sin modificar identidad; operador puede bloquear y cliente no.
- Chrome completa el POST de login y redirección con la CSP real y sin violaciones.
- El entorno de prueba arranca con viajes propios de cliente1 y cliente2 y permite comprobar historial y calificación sin herramientas de evaluación.
- bd-puente no arranca con panel o real salvo perfil explícito; su comando de desarrollo se documenta y prueba.
- Tokens solo en servidor, aislamiento de sesiones y rutas de desarrollo, renovación y recuperación comprobados.
- npm test, lint, build, panel:build, navegador de sesión con Keycloak real, contrato:test y spec-check pasan antes de marcar implementada.
- Los issues de interfaz y entrega conservan el alcance retirado; no se presenta el rediseño como implementado.

## Decisiones

- Acuerdo de DRAZEN y confirmación de @sandobaitt en el PR #118: bordó y marfil; su implementación se lleva al issue de interfaz.
- Evaluación en proceso y espacio separados reemplaza el criterio de una sola app con igual protagonismo de cliente y evaluador de la spec 071 y de panel/PRODUCT.md. La separación de rutas y modo es de sesión; el rediseño de ambos espacios es de interfaz.
- #83 conserva sesión, compose real y entorno de navegador (antiguas T31 y T33). Interfaz y entrega se separan en dos issues, con textos en esta carpeta para su publicación.
- Tokens en servidor con cookie opaca; usuarios de ejemplo sin registro; SERVICIO sin login.
- Selector para doble rol y aviso/copia antes de reingreso confirmados por DRAZEN.
- Incorporar precarga del simulador por variable y usuario de doble rol para que las pruebas de sesión sean reproducibles, conforme a la revisión.
- Mantener la numeración 83.x de los requisitos para evitar colisiones, como pidió el integrador.

## Dudas abiertas

Ninguna decisión funcional pendiente. La publicación de los dos issues y el adjunto compartido de la maqueta quedan como pasos de revisión, indicados en sus documentos.
