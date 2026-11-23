# Plan — Spec 083: frontend con sesión real y nueva interfaz

Estado: propuesta para revisión; no habilita implementación.

## Arquitectura y límites

Se conserva React, Vite, CSS Modules y el servidor Fastify del panel. En modo real, este servidor actúa como intermediario de la sesión: el navegador solo usa su propio origen, el servidor mantiene los tokens y reenvía a M2 el access token de cada sesión. La autenticación no requiere CORS en M2 ni cambios en src/, contrato/ o migraciones/. Se propone no agregar dependencias: crypto y fetch de Node, jose ya fijado en package.json, componentes y utilidades existentes. Si durante la implementación surge una necesidad distinta, se consulta antes de instalar.

La separación es por proceso y configuración, no por una casilla que habilite el modo de desarrollo desde la app real. El proceso real no registra control de M6, comandos Docker, consulta directa de base ni demostraciones con roles inventados. Otro proceso, en un entorno de compose de desarrollo independiente, conserva las herramientas existentes y la firma HS256. No se usa un panel HS256 contra la misma instancia M2 configurada en jwks.

La decisión de sesión se propone en docs/adr/083-front-sesion-servidor.md. El diseño aprobado es Ciudad editorial: bordó y marfil, orientación a tareas, contenido real y herramientas de evaluación separadas. Las fechas de viajes y puntajes de la maqueta no forman parte del contrato consumido por defecto.

## Contrato y superficies

| Área | Operaciones existentes | Implementación prevista |
|---|---|---|
| Acceso y primer perfil | obtenerCliente, crearCliente | Fuente de sesión real, acceso y completar-perfil |
| Inicio y perfil | obtenerCliente, actualizarCliente, obtenerEstadoCuenta, listarHistorialViajes | Inicio con cargas independientes y perfil existente adaptado |
| Direcciones | listarDirecciones, crearDireccion, obtenerDireccion, actualizarDireccion, eliminarDireccion | Reutilizar lógica y rehacer presentación |
| Preferencias | obtenerPreferencias, guardarPreferencias | Grupos con significado de selecciones vacías |
| Viajes y calificar | listarHistorialViajes, calificarConductor | Listado paginado, confirmaciones y errores de dominio |
| Calificaciones | listarCalificaciones, obtenerCalificacion | Listado y detalle con datos propios |
| Estado y operador | obtenerEstadoCuenta, obtenerCliente, listarBloqueos, crearBloqueo, obtenerBloqueo, levantarBloqueo | Consulta por UUID y gestión de bloqueos |
| Salud | verificarSalud | Salud pública, sin dependencia de sesión ni M6 |

Las siguientes rutas son internas del frontend; no se agregan al contrato público de M2:

| Ruta propuesta | Comportamiento |
|---|---|
| POST /auth/iniciar | Exige origen propio, crea transacción y devuelve 303 al acceso de Keycloak |
| GET /auth/retorno | Comprueba correlación, intercambia código, valida tokens y redirige a una URL local limpia |
| GET /auth/sesion | 200 con identidad mínima o 401; nunca devuelve tokens; Cache-Control: no-store |
| POST /auth/cerrar | Invalida sesión, limpia cookie y prepara cierre remoto; exige origen propio |
| GET /auth/salida | Comprueba state de cierre y devuelve al acceso sin credenciales en URL |
| /api/v1/clientes y descendientes | Proxy con cookie en modo real o identidad simulada solo en desarrollo |

Los errores de autenticación del frontend usan application/problem+json, X-Request-Id y types internos: /panel/errores/sesion-requerida (401), /panel/errores/retorno-invalido (400), /panel/errores/identidad-no-admitida (403), /panel/errores/identidad-no-disponible (503 con Retry-After). Los errores de M2 mantienen su cuerpo y código. Una pantalla de app explica el error sin imprimir el código de autorización ni el error remoto crudo.

## Datos y sesión

No hay migraciones ni tablas nuevas. La primera versión es un proceso local del frontend con almacenes de sesión y transacciones en memoria. Reiniciarlo requiere reingreso. No se comparte su memoria con Redis de estado-cuenta: Redis conserva únicamente su función existente.

- Identificador de sesión: 32 bytes aleatorios; se guarda un hash como clave del almacén, con sub, roles, scopes, nombre, tokens, vencimientos y versión de sesión.
- Cookie propuesta m2_sesion: HttpOnly, SameSite=Lax, Path=/, sin Domain; Secure cuando el origen es HTTPS. HTTP solo se admite en loopback del entorno local. No se registra la cookie.
- Transacciones: state, nonce, PKCE verifier, retorno local y vinculación a una cookie HttpOnly de transacción; vencen en 5 minutos y se consumen una sola vez. Un state conocido sin la cookie vinculada se rechaza.
- Sesiones: máximo 8 horas absolutas y 30 minutos sin actividad de API autenticada, sin superar el límite que imponga Keycloak. El sondeo de /auth/sesion no extiende la inactividad.
- Límites: hasta 1000 sesiones y 1000 transacciones activas; limpieza al acceder y periódica; al alcanzar el límite se rechaza una nueva admisión con error controlado, sin expulsar silenciosamente sesiones activas. Los temporizadores se cierran al apagar.
- Registros de diagnóstico: separados por sesión, acotados a 100 entradas; se eliminan con logout y cambio de usuario. En modo real no guardan cuerpos de solicitudes ni respuestas, solo metadatos y errores sanitizados. El detalle amplio de desarrollo permanece en su proceso aislado.
- El borrador de un formulario vive solo en su componente React. No se escribe en localStorage, sessionStorage, IndexedDB ni cookies.

## Configuración e integraciones

### Configuración propuesta

Se extenderá cargarConfigPanel con una unión por modo, para que el modo real no exija ni cargue clave HS256, URL de base ni acceso Docker. Los valores nuevos se documentarán en los ejemplos, sin leer ni modificar .env.

| Variable propuesta | Uso |
|---|---|
| PANEL_MODO_AUTH | desarrollo por compatibilidad; oidc en el entorno real explícito |
| PANEL_ORIGEN_PUBLICO | Origen exacto autorizado para cookies, CSRF y retornos |
| PANEL_OIDC_EMISOR | Emisor público exacto del realm |
| PANEL_OIDC_URL_INTERNA | Base del mismo realm accesible desde el contenedor para token y JWKS |
| PANEL_OIDC_CLIENTE | m2-front |
| PANEL_TIEMPO_IDENTIDAD_MS | 2000 por operación HTTP completa, valor positivo validado |
| PANEL_M6_SIMULADO | Sí en los ejemplos de esta entrega; informa la etiqueta, no habilita control |

Los endpoints se derivan del realm configurado de Keycloak y quedan en una lista cerrada. La URL pública sirve a las redirecciones del navegador; la interna sirve al servidor. El issuer validado sigue siendo el público: no se cambia por el nombre de Docker. Host, protocolo, credenciales embebidas y retornos se validan al arrancar; no se admiten destinos aportados por el usuario. Los scopes solicitados son openid y los tres scopes de M2; no se agrega profile hasta comprobar que el realm lo admite. El nombre visible se obtiene del perfil M2, con un fallback mínimo para operador.

### Inicio y validación

1. Al pulsar Iniciar sesión, POST al mismo origen. Comprobar Host y Origin; crear state, nonce y verifier con crypto, challenge SHA-256 base64url y transacción vinculada al navegador.
2. Redirigir al endpoint público de autorización con response_type=code, client_id=m2-front, redirect_uri exacta, PKCE S256, state, nonce y scopes. Guardar solo un destino local permitido, no una URL arbitraria.
3. En /auth/retorno, exigir transacción vigente vinculada, parámetros únicos y state correcto; consumirla antes del intercambio. Error o cancelación de Keycloak no crean sesión.
4. Intercambiar el código mediante POST al endpoint interno de token, sin secreto, con verifier y la misma redirect_uri. Sin reintento automático del POST: un timeout puede significar que el código ya fue consumido.
5. Con jose, verificar firma RS256 y claims del ID token: issuer público, aud=m2-front, exp, iat, sub, nonce y azp cuando corresponda. Verificar por separado el access token: firma, issuer, aud=m2-clientes, exp, sub coherente y tipo de access token del realm; no usar el ID token como credencial de M2.
6. Extraer roles conocidos y scopes del access token validado. Crear sesión con un identificador nuevo, sin reutilizar el aportado antes de autenticar. Invalidar la sesión previa del mismo navegador, limpiar sus diagnósticos y redirigir a una URL limpia.

Las claves se obtienen por JWKS desde el servidor, con timeout, un reintento GET a los 200 ms y un solo refresco compartido de claves en curso. Los errores no exponen respuestas de Keycloak ni parámetros sensibles. El cliente OIDC se inicializa sin bloquear la salud estática del frontend; una dependencia caída afecta al acceso, no al proceso completo.

### Renovación y proxy

Antes de reenviar, si faltan menos de 30 segundos para expirar, renovar con una sola promesa por sesión. Guardar atómicamente tokens y versión tras validar respuesta e identidad. Si logout invalidó la sesión mientras renovaba, descartar el resultado y no recrear la sesión. No reintentar automáticamente el POST de refresh.

Un fallo transitorio con access token todavía válido permite usarlo hasta expirar. Si está vencido y no se pudo renovar, responder 503 de identidad sin enviar el pedido a M2; la UI permite copiar el formulario y elegir reingreso. Un refresh rechazado por sesión inválida invalida la sesión y responde 401. No se vuelve a enviar una escritura a M2 después de un 401 de M2; se informa y se solicita intervención, porque podría tener otros motivos y no se debe repetir el efecto.

El proxy real ignora y rechaza los encabezados de suplantación, no acepta Authorization suministrado por el navegador y usa exclusivamente el token de sesión. Preserva Idempotency-Key, tipos, bytes de cuerpo, códigos y encabezados permitidos. Conserva el timeout de M2 de 10 segundos; el presupuesto total del navegador incluye además los 2 segundos de posible renovación y margen (15 segundos propuestos). Cancelar la solicitud del navegador no significa revertir una escritura confirmada: al reintentar se conserva la clave del mismo cuerpo.

### Logout

POST propio invalida primero la sesión local y su cookie. Prepara una transacción de salida y redirige al endpoint público de cierre con client_id, post_logout_redirect_uri registrada y state. No se envía id_token_hint por URL ni se entrega un token al navegador. Keycloak puede pedir confirmación; el recorrido de navegador debe incluirla. El retorno valida state y limpia la transacción. Si el cierre remoto no se completa, se mantiene cerrada la sesión local y se explica que el cierre en Keycloak no está confirmado. No se promete detectar desde el servidor todos los cierres iniciados en otras aplicaciones; se detectan al renovar o vencer.

### M6 y compose

Crear ejemplo-front-keycloak.env y un override docker-compose.front.yml para el arranque real. Reutilizar las imágenes y servicios existentes; el frontend usa la imagen m2-panel:0.1.0 con nuevo modo oidc y se mantiene solo en loopback. El override elimina las variables de base/control que el frontend real no necesita; no monta socket Docker ni publica bd-puente. M2 sigue apuntando al M6 simulado mediante M2_URL_M6. No modificar su lógica de autenticación de salida.

Comando previsto a verificar: docker compose -f docker-compose.yml -f docker-compose.front.yml --env-file ejemplo-front-keycloak.env up -d --build --wait. Desarrollo conserva su comando actual en un proyecto independiente; se documentan puertos y volúmenes separados si se quieren usar ambos al mismo tiempo. La futura imagen M6 no se añade ni descarga en este trabajo.

## Lógica de experiencia y estructura de archivos

| Responsabilidad | Destinos previstos |
|---|---|
| Cliente OIDC y validación | panel/servidor/auth/oidc.ts, validacion.ts |
| Almacenes y renovación | panel/servidor/auth/sesiones.ts, transacciones.ts, renovacion.ts |
| Cookies y rutas de sesión | panel/servidor/auth/cookies.ts, rutas.ts |
| Selección por modo | panel/servidor/app.ts, config.ts, proxy.ts, seguridad.ts, pedidos.ts |
| Fuente de sesión real y estados | panel/cliente/src/fuentes/sesion-real.ts, fuente-de-sesion.ts |
| API de sesión y cliente M2 | panel/cliente/src/api/sesion.ts, m2.ts |
| Navegación por espacios | app.tsx, rutas.ts, logica/menu.ts, usar-ruta.ts |
| Acceso, primer perfil e inicio | pantallas/ingresar.tsx, completar-perfil.tsx, inicio.tsx |
| Formularios sin guardar | hooks/usar-cambios-pendientes.ts y diálogo de reingreso |
| Nuevo sistema visual | estilos/variables.css, base.css, componentes y CSS Modules existentes |
| Pantallas de cuenta y evaluación | pantallas existentes y marco separado para Evaluación en desarrollo |

La interfaz Sesion deja de depender de un único rol elegido: expone roles efectivos, scopes y espacio activo. En desarrollo se adapta la fuente anterior sin cambiar su propósito de pruebas. Cambiar espacio no cambia cookie, sub ni token. Mi cuenta es el destino inicial del doble rol; Operación sigue accesible aunque ese usuario aún no haya creado su propio perfil.

Pseudocódigo del acceso de cliente: si no hay sesión, mostrar acceso; si falta permiso de lectura, mostrar rechazo; pedir perfil propio; con 200 entrar; con 404 mostrar completar perfil; con otro error ofrecer recuperación. Crear conserva la clave mientras el cuerpo es el mismo; si se corrige el cuerpo después de un envío incierto, resolver primero si el perfil se creó antes de generar una clave nueva. Ante 409 consultar propio perfil.

Inicio pide perfil, cuenta y primera página de viajes por separado. La sección de viajes falla independientemente. No añade puntajes ni fechas de viaje si M2 no los entrega. Los componentes compartidos muestran tipo y detalle de error detrás de Detalles; no muestran tokens ni un curl con credenciales reales. La cuenta bloqueada permite seguir usando las operaciones de M2 que el contrato admite.

El aviso de sesión expirada se presenta sobre la pantalla actual, conserva el formulario montado y deshabilita enviar. Incluye Copiar datos y Volver a ingresar. Si Clipboard no funciona, deja texto seleccionable para copia manual. No limpia el contenido hasta que la persona abandona o cierra la sesión voluntariamente. Una navegación interna con cambios pide confirmación; beforeunload usa el aviso nativo del navegador, sin prometer un texto personalizado.

## Diseño y accesibilidad

- Paleta inicial de referencia: bordó #602639, marfil #F6F3EE, tinta #24232A, superficies blancas y acento cálido #E8C3A2. No son pares de contraste aprobados por sí mismos: cada combinación se verifica antes de cerrar tokens.
- Escritorio: menú lateral, nombre y espacio activo en encabezado, contenido con ancho de lectura; estado de cuenta y lista de viajes, sin filas de métricas inventadas. Móvil: menú compacto con foco contenido y devolución del foco al cerrarlo; acciones de 44 píxeles y formularios en una columna.
- Tipografía del sistema y recursos locales; CSS Modules sin estilos inline, sin recursos remotos ni fuentes nuevas. Tema oscuro con pares medidos; preferencia de tema puede persistirse porque no contiene datos personales.
- Identificadores completos copiables en detalles y truncados solo visualmente en filas. Motivos y textos máximos se envuelven; no se recortan datos de negocio en un tooltip como única forma de leerlos.
- Evaluación conserva resultados y pruebas existentes, pero usa navegación propia y la etiqueta de entorno de desarrollo. La franja técnica deja de ocupar siempre el pie de la app cotidiana.
- Actualizar PRODUCT.md, DESIGN.md, design.json y el brief de superficie al implementar: merge del sistema aprobado, conservando trazabilidad de la identidad anterior. Revisar maqueta contra campos reales y registrar sus diferencias, sin tratar imagen generada como resultado funcional.

## Decisiones y alternativas

1. Sesión en servidor frente a tokens en navegador: decisión confirmada por el usuario; conserva RNF-19.3, proxy y origen único.
2. Memoria acotada frente a tabla nueva o Redis compartido: entorno local de un proceso sin cambio de esquema; reinicio exige reingreso, replicación queda fuera de esta spec.
3. Modos por proceso frente a un selector de suplantación en la app real: conserva la demo sin habilitar controles privilegiados por rutas ocultas.
4. Sin keycloak-js ni librería nueva: no se ejecuta el protocolo en el navegador; jose existente valida JWT. Alternativa de una biblioteca OIDC de servidor requiere autorización si las comprobaciones previstas no pueden implementarse de forma acotada.
5. Logout con client_id y confirmación frente a id_token_hint en URL: cumple la restricción de no entregar tokens al navegador; se prueba el retorno real.
6. Sin autoenvío tras autenticación: evita ejecutar una intención anterior a un cambio de sesión o duplicar una operación incierta.
7. Mantener una spec 083 por trazabilidad del issue actual: se propone al grupo dividir ejecución en issues de sesión, experiencia visual y entrega si el tamaño dificulta revisar; no se crean issues ni se inventan números en este trabajo.

## Pruebas y validación

Pruebas primero por tarea, guía y commit solo cuando la rama y aprobación lo permitan. Reutilizar Vitest y los servidores JWKS de pruebas. Unitarias: state/nonce/PKCE, cookies, expiración, sesiones acotadas, JWT válidos e inválidos, refresh concurrente y logout durante refresh. HTTP: retorno inválido sin sesión, rechazo de origen, rutas no registradas por modo, suplantación por encabezados, separación de diagnósticos y ausencia de secretos incluso en errores.

Integración con M2 y PostgreSQL por Testcontainers: primer perfil concurrente, errores sin perder cuerpo, idempotencia, permisos reales y recuperación de dependencia. Para navegar con Keycloak real, agregar proyecto de Vitest front-keycloak y comando propuesto npm run front:keycloak que primero compile el panel. Entorno aislado con puertos permitidos por redirectUris o realm efímero derivado que cambie solo retornos para esos puertos; no desactivar PKCE, audience, roles o scopes para facilitar la prueba.

Recorrido Chrome: login de persona a través del formulario real de Keycloak, primer perfil, edición, dirección, preferencias, historial simulado, calificación, doble rol, operador y logout con confirmación. Pruebas de caída y renovación usando tiempos y servidor controlados; probar aviso y copia con formulario montado. Revisar 360, 768, 1280 y 1440 píxeles, ambos temas, foco, axe, textos máximos y estados vacío/error. Revisar almacenamiento y tráfico al origen del frontend para comprobar que no hay tokens; excluir de esta comprobación el formulario y cookies propias del proveedor Keycloak.

CI mantiene sus checks existentes, agrega el recorrido real al job de Keycloak o uno dedicado y no permite omitirlo silenciosamente si falta Chrome. Comandos de cierre: npm test, npm run lint, npm run build, npm run panel:build, npm run panel:navegador, npm run front:keycloak, npm run keycloak:test, contrato:test con servicio levantado y node scripts/spec-check.mjs. La lista es una puerta futura, no una afirmación de ejecución en este borrador.

## Trazabilidad

| Requisito | Parte del plan | Tareas |
|---|---|---|
| RF-2.1.83.1 | Inicio OIDC, acceso | T4, T6, T14 |
| RF-2.1.83.2 | Primer perfil | T15 |
| RF-2.1.83.3 | Alta idempotente | T16 |
| RF-2.1.83.4 | Inicio independiente | T21 |
| RF-2.1.83.5 | Perfil y cambios | T20, T22 |
| RF-2.2.83.1 | Direcciones | T23 |
| RF-2.3.83.1 | Preferencias | T24 |
| RF-2.4.83.1 | Viajes con campos reales | T25 |
| RF-2.4.83.2 | Error M6 por sección | T21, T25 |
| RF-2.5.83.1 | Envío de calificación | T26 |
| RF-2.5.83.2 | Errores de calificar | T26 |
| RF-2.5.83.3 | Listado y detalle | T27 |
| RF-2.6.83.1 | Estado | T28 |
| RF-2.6.83.2 | Operador | T29 |
| RNF-02.83.1 | Límites y proxy | T10, T31 |
| RNF-02.83.2 | Simulador y configuración | T25, T31 |
| RNF-03.83.1 | Error y diagnóstico | T10, T11, T19 |
| RNF-04.83.1 | Imagen y compose | T31 |
| RNF-06.83.1 | Configuración por modo | T1 |
| RNF-07.83.1 | Matriz de pruebas | T32, T33, T34, T35, T39 |
| RNF-12.83.1 | OIDC y JWT | T4, T5, T6 |
| RNF-12.83.2 | Sesiones y cookies | T2, T3 |
| RNF-12.83.3 | Proxy de sesión | T10 |
| RNF-12.83.4 | Renovación | T7, T8 |
| RNF-12.83.5 | Cierre local/remoto | T9 |
| RNF-12.83.6 | Navegación por permisos | T12, T13 |
| RNF-12.83.6.1 | Selector de espacio | T13 |
| RNF-12.83.4.1 | Copia antes de reingreso | T20 |
| RNF-12.83.7 | Aislamiento de evaluación | T11, T30, T31 |
| RNF-13.83.1 | Tiempo de Keycloak | T4, T7, T8 |
| RNF-14.83.1 | Correlación por sesión | T11 |
| RNF-15.83.1 | Sistema visual y navegación | T17, T18, T30 |
| RNF-15.83.2 | Accesibilidad | T17, T18, T36 |
| RNF-15.83.3 | Estados y formularios | T19, T20, T34, T35, T36 |
| RNF-19.83.1 | Sesión, logs y diagnóstico | T3, T6, T9, T11, T32 |
| RNF-20.83.1 | Guía y documentación | T37, T38, T39 |

## Referencias verificadas

- OpenID Connect Core 1.0, validación del ID token: https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation
- Keycloak, endpoints y cierre OIDC: https://www.keycloak.org/docs/latest/server_admin/index.html
- Contrato local de M2, spec 080 y realm local: fuentes del formato de identidad y de los scopes de esta app. Las páginas externas sustentan el protocolo, no sustituyen el contrato del grupo ni la prueba contra la versión fija de Keycloak.
