# Guía — Spec 083 Sesión real del frontend

## Estado de trabajo

T1 a T5 implementadas y validadas en `impl/083-front-keycloak`. T6 a T26 siguen pendientes y la spec conserva el estado aprobada. Se puede iniciar autorización y validar tokens en el servidor; completar el retorno y abrir la sesión real todavía está pendiente.

## Tareas

### T1 — Separar configuración real y de desarrollo y validar orígenes · commit `083/T1`

- Qué cambió: `panel/servidor/config.ts:cargarConfigPanel` devuelve una unión discriminada por `modoAuth`. Desarrollo conserva sus valores y credenciales anteriores. OIDC exige origen público y bases pública e interna del realm; no lee ni devuelve claves HS256, base, Docker o control M6 heredados.
- Por qué así: RNF-06.83.1. Las herramientas de desarrollo reciben `ConfigPanelDesarrollo` explícitamente y no pueden recibir una configuración OIDC por error de tipos.
- Retornos: se derivan exclusivamente del origen validado, como `/auth/retorno` y `/auth/salida`. El origen es exacto y HTTPS, o HTTP solo en localhost/127.0.0.1/::1. Se rechazan credenciales, comodines, rutas y parámetros. Las bases de Keycloak no admiten credenciales, query ni fragmento y deben corresponder al mismo camino de realm; la dirección interna puede usar HTTP entre contenedores.
- Configuración adicional: cliente `m2-front` por defecto, plazo de identidad de 2000 ms y etiqueta de M6 simulado activada. Los valores se validan sin repetir su contenido en errores. Los ejemplos del entorno real corresponden a T20 y su documentación a T25.
- Cómo se conecta: T1 cerró temporalmente el arranque OIDC. T4 reemplaza esa protección por una rama real que registra salud, archivos estáticos e inicio de autorización; conserva cerradas las operaciones de cuenta y las herramientas de evaluación.
- Tests: `pruebas/panel/unitarias/config-oidc.test.ts` comprueba configuración mínima, ausencia de secretos heredados, retornos propios, URLs inválidas, plazo y modo. `config.test.ts` y `tokens.test.ts` conservan la regresión de desarrollo. `pruebas/panel/http/arranque.test.ts` verifica que OIDC no abra el servidor de desarrollo mientras falta implementar sesión.

### T2 — Almacenes acotados de sesiones y transacciones · commit `083/T2`

- Qué cambió: `panel/servidor/auth/almacen.ts` implementa el almacenamiento común con hasta 1000 registros por instancia. Genera identificadores de 32 bytes aleatorios y guarda solo su SHA256 como clave; copia los datos al entrar y salir para evitar cambios por referencias compartidas.
- `auth/sesiones.ts:crearAlmacenSesiones` guarda identidad, permisos, credenciales y versión inicial. Vence por el primero de estos límites: ocho horas absolutas, treinta minutos sin actividad explícita o vencimiento del refresh token de Keycloak. La consulta no extiende la inactividad. Un access token vencido conserva la sesión para la renovación posterior de T7; el almacén no decide reenviar esa credencial a M2.
- `auth/transacciones.ts:crearAlmacenTransacciones` conserva transacciones de ingreso y salida durante cinco minutos. Genera state y vínculo independientes; guarda el hash del vínculo y lo compara en tiempo constante antes de consumir. Un navegador con otro vínculo no obtiene los datos ni elimina la transacción del propietario. El consumo es síncrono y único; si vence durante la comprobación, tampoco se devuelve.
- Por qué así: RNF-12.83.2 y el plan de datos de sesión. No se crean tablas ni se reutiliza Redis. La capacidad agotada devuelve un error tipado de mensaje fijo, sin expulsar entradas activas ni incluir datos personales o credenciales.
- Limpieza: al acceder se eliminan registros vencidos y se revisan también cada minuto. El temporizador no mantiene vivo el proceso; `cerrar` lo cancela, borra datos y rechaza nuevas admisiones. `cantidad` informa los registros retenidos sin disparar limpieza, para comprobar también la limpieza sin solicitudes.
- Cómo se conecta: son módulos internos del servidor. Las cookies de T3 utilizan estos almacenes y T4 conecta las transacciones y su cierre al servidor. Las tareas siguientes conectarán las sesiones; sus errores internos deberán traducirse al problema HTTP correspondiente.
- Tests: `pruebas/panel/unitarias/almacenes-auth.test.ts`, 24 casos con reloj controlado: identificadores y desconocidos, aislamiento, límites exactos, sondeo sin actividad, tope absoluto, vencimiento de Keycloak, logout, copias defensivas, consumo único, capacidad y recuperación de espacio, limpieza periódica y cierre idempotente de temporizadores.
- Límites: memoria de un solo proceso; reiniciar requiere reingreso y no permite compartir sesión entre réplicas. Son límites aceptados en el plan; los datos se borran al cerrar y no se persisten. Renovación concurrente, diagnóstico por sesión y acceso real corresponden a tareas posteriores.

### T3 — Cookies y solicitudes vinculadas al origen público · commit `083/T3`

- Qué cambió: `panel/servidor/auth/cookies.ts:crearCookiesAuth` emite y lee las cookies `m2_sesion` y `m2_transaccion`, ambas HttpOnly, SameSite=Lax, Path=/ y sin Domain. Usa Secure según el origen público validado, sin confiar en encabezados reenviados. Las vidas máximas de navegador son ocho horas y cinco minutos; el almacén del servidor puede vencer antes la sesión.
- Identidad: `emitirSesion` genera siempre una entrada nueva en el almacén y no acepta un identificador elegido por el navegador. `leerSesion` solo reconoce una cookie válida cuyo identificador exista en el almacén; no usa query, cuerpo, Authorization ni encabezados de desarrollo. Las cookies duplicadas, codificadas o mal formadas se rechazan. Ninguna cookie contiene tokens, roles ni datos personales.
- Vínculo: la cookie de transacción contiene únicamente el vínculo aleatorio generado por T2; el retorno necesita también el state y consume la transacción del servidor una sola vez. Sin cookie, con otra cookie o con cookies repetidas no se obtienen los datos ni se consume la transacción del propietario.
- Borrado: se emite una cookie vacía con Max-Age=0, fecha de expiración pasada y los mismos atributos. Fastify acumula los Set-Cookie individuales, por lo que se pueden emitir o borrar ambas cookies juntas. Borrar la cookie no invalida por sí solo el registro: T9 invalidará primero la sesión del servidor.
- Origen: `panel/servidor/seguridad.ts:registrarSeguridad` conserva el modo de desarrollo por puerto y añade un modo por origen público. Exige Host propio en todas las rutas y Origin exacto en métodos que cambian datos, antes de leer el cuerpo. No reemplaza esos encabezados con Referer o X-Forwarded-Host/Proto, no habilita CORS y permite los retornos GET sin Origin.
- Tests: `pruebas/panel/http/cookies-auth.test.ts` contiene 40 pruebas HTTP sobre Fastify y los almacenes reales en memoria: atributos HTTP/HTTPS/IPv6, borrado, cookies simultáneas, identificadores nuevos y desconocidos, duplicados, aislamiento de transacción y rechazo de solicitudes ajenas incluso en rutas inexistentes. Sus rutas son ayudas de prueba, sin validación OIDC simulada en producción.
- Cómo se conecta: T4 usa el vínculo de transacción al iniciar autorización. La validación de identidad y la invalidación de la sesión previa al completar login se hacen en T5/T6; no se presentan como implementadas por estas pruebas de transporte.

### T4 — Inicio de autorización y CSP real · commit `083/T4`

- Qué cambió: `panel/servidor/auth/rutas.ts:registrarInicioAuth` registra POST `/auth/iniciar`. Crea state, nonce y verifier aleatorios en el servidor, guarda una transacción de cinco minutos y responde 303 al endpoint público de autorización de Keycloak. Solo entrega el desafío PKCE S256, calculado según [RFC 7636](https://www.rfc-editor.org/rfc/rfc7636.html#section-4.2); el verifier permanece en la transacción.
- Parámetros: usa cliente y callback de la configuración validada, response_type=code y scopes openid, clientes:read, clientes:write y clientes.estado:read. Por ahora el único retorno permitido después de autenticar es `/`; las vistas de primer perfil y permisos decidirán el destino final. No acepta URLs externas, parámetros de query ni campos de identidad, credenciales o cliente elegidos desde el navegador.
- Formularios: parser acotado al plugin para application/x-www-form-urlencoded, cuerpo máximo de 1024 bytes y rechazo de claves duplicadas. También admite JSON válido o POST vacío. El POST de origen ajeno se rechaza antes de crear transacciones. Capacidad agotada devuelve 503 problem+json con Retry-After=5, sin cookie nueva ni expulsión de transacciones activas.
- CSP: `estaticos.ts:registrarEncabezadosDeSeguridad` conserva la política de desarrollo; OIDC amplía únicamente form-action con el origen público exacto de Keycloak. Conserva default-src, base-uri, object-src y frame-ancestors. Rechaza emisores con comodines o credenciales y no agrega el nombre interno del contenedor.
- Formularios nativos: Chrome confirmó que no-referrer convertía su Origin en null y causaba 403. En las páginas del modo real se usa Referrer-Policy=same-origin; las respuestas `/auth/` mantienen no-referrer. Así se conserva el Origin del POST propio y no sale Referer hacia identidad, sin aceptar Origin nulo. Es consistente con el [estándar Fetch](https://fetch.spec.whatwg.org/#append-a-request-origin-header). Desarrollo conserva no-referrer.
- Arranque: `app.ts` y `arranque.ts` permiten iniciar el modo real con salud, estáticos y autorización. Se crea el almacén de transacciones por proceso y se cierra con Fastify. La cuenta, el callback y la consulta de sesión siguen sin registrar hasta sus tareas; el modo real tampoco registra base, Docker, M6 de control o diagnóstico de desarrollo.
- Tests: `pruebas/panel/http/inicio-auth.test.ts`, 21 casos de parámetros, PKCE, secreto del verifier, aleatoriedad, retorno, formularios, capacidad, CSP, arranque y logs; `arranque.test.ts` comprueba el proceso real en un puerto propio. `pruebas/panel/navegador/inicio-auth.test.ts` prueba en Chrome un formulario nativo, POST propio, 303, CSP y ausencia de Referer, con un destino de identidad mínimo.
- Límites: T4 no pide contraseñas, intercambia códigos ni obtiene tokens. La verificación de firma y claims es T5 y el callback con plazos HTTP es T6. El login completo con Keycloak real y su interfaz se prueba en T23; la prueba de Chrome de esta tarea no lo sustituye.

### T5 — Validación separada de credenciales · commit `083/T5`

- Qué cambió: `panel/servidor/auth/validacion.ts:crearValidadorTokens` recibe configuración, proveedor de claves JWKS de jose y reloj. Verifica firma RS256, emisor público, audiencia, identidad no vacía, fechas enteras representables y vigencia. No admite otros algoritmos ni usa un secreto HS256. Rechaza tipos incompatibles del encabezado JWT.
- Identidad: `validarIdToken` exige audiencia del cliente del frontend sin audiencias ajenas, nonce exacto y azp del cliente si está presente. El tipo del payload puede ser ID u omitirse según OIDC; los tipos Bearer, Refresh y Offline no se admiten. Sigue las comprobaciones de [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation).
- Acceso: `validarAccessToken` exige audiencia m2-clientes, tipo Bearer del realm y el mismo sub que la identidad validada. `validarPar` verifica ambos por separado; si el ID token incluye at_hash, comprueba también su vínculo criptográfico con el access token concreto. Los roles y scopes provienen exclusivamente del access token firmado; descarta roles desconocidos y duplicados, rechaza formatos inválidos y no inventa permisos ausentes.
- Salida: solo devuelve identidad, fechas y permisos normalizados; no devuelve el JWT ni claims arbitrarios. `CredencialInvalida` e `IdentidadNoDisponible` distinguen rechazo de credencial de caída del proveedor de claves, con mensajes fijos y sin causa, tokens o respuestas remotas adjuntas.
- Tests: `pruebas/panel/unitarias/validacion-auth.test.ts`, 94 casos con claves RSA generadas y un JWKS local. Incluyen alteración, firma ajena, kid desconocido, algoritmos no permitidos antes de resolver claves, emisor, audiencias, nonce, azp, fechas, sub incoherente, tipos intercambiados, permisos, at_hash y fallas del proveedor. Los tokens se firman con las ayudas crypto existentes, independientemente del verificador jose.
- Cómo se conecta: T5 no registra rutas ni hace solicitudes de red. T6 conectará el proveedor JWKS remoto con sus plazos y reintento GET, el intercambio de código y la creación de sesión. La consulta de sesión y renovación siguen en sus tareas posteriores.

## Validación de T1 del 2026-11-23

- Rojo inicial de T1: 26 fallas de 29 casos nuevos antes de implementar la configuración. La comprobación posterior de configuración, tokens, arranque y proxy pasó sus 196 pruebas.
- Al validar toda la suite aparecieron ocho fallas previas de Windows y 43 pruebas que no ejecutaban por preparación fallida. Se reprodujeron en el commit original `29fc6ca`. La corrección se documenta aparte en [083-pruebas-windows](../../docs/guias/083-pruebas-windows.md) y se registra en su propio commit de validación.
- Tras instalar Docker y actualizar Node a 24.22.0: `npm test` pasa con 151 archivos y 5722 pruebas, sin omisiones ni errores de procesos. Incluye unitarias e integración con PostgreSQL real en Docker.
- `npm run build`, `npm run panel:build`, ESLint, `git diff --check` y `node scripts/spec-check.mjs --rama impl/083-front-keycloak --base origin/main` pasan.
- El entorno de desarrollo se conserva levantado: seis servicios sanos, panel en http://localhost:8083 y M2 en http://localhost:8082. `node scripts/panel-humo.mjs` pasó sus seis comprobaciones. No se realizó revisión visual en navegador ni se afirma que el login o el rediseño estén implementados.
- Comprobación adicional anterior: `npx tsc --noEmit` global tenía 42 diagnósticos, iguales a los del commit original en una comparación en memoria. Los builds de API y panel usan sus configuraciones propias y pasan; no se amplió T1 para modificar esas pruebas ajenas.

## Validación de T2 del 2026-11-23

- Rojo inicial: el archivo de pruebas no pudo importar los módulos, que todavía no existían.
- `npm test`: 152 archivos y 5746 pruebas pasan, sin omisiones ni errores, incluida integración con PostgreSQL real en Docker.
- `npm run build`, `npm run panel:build`, ESLint, `git diff --check` y `spec-check` pasan.
- No se modificaron dependencias, opciones de Vitest, contrato, servicio M2 ni migraciones. No se afirma que el login ya funcione ni se amplía el alcance a las rutas de T3 a T11.

## Validación de T3 del 2026-11-23

- Rojo inicial: faltaba el módulo de cookies. Las pruebas posteriores detectaron además la duplicación de Set-Cookie al acumular manualmente los valores que Fastify ya agrega; se corrigió la emisión sin relajar las expectativas.
- `npm test`: 153 archivos y 5786 pruebas pasan, sin omisiones ni errores, incluida integración con PostgreSQL en Docker.
- `npm run build`, `npm run panel:build`, ESLint, `git diff --check` y `spec-check` pasan. Las pruebas existentes de seguridad de desarrollo conservan sus resultados.
- No se agregaron dependencias ni se modificaron contrato, servicio M2 o migraciones. Los helpers no registran credenciales ni incluyen valores inválidos en los errores.

## Validación de T4 del 2026-11-23

- Rojo inicial: faltaba el módulo de rutas. Tras implementar el POST, sus 21 pruebas HTTP pasan.
- Regresión de navegador: se reprodujo en Chrome el 403 del formulario nativo y se corrigió la política de referencia sin relajar Origin ni CSP. `npx vitest run --project navegador pruebas/panel/navegador/inicio-auth.test.ts` pasa en Chrome instalado, sin descargar navegadores. Se cierran los recursos temporales también al fallar.
- `npm test`: 154 archivos y 5807 pruebas pasan, sin omisiones ni errores. La prueba de Chrome se ejecuta aparte de este comando.
- `npm run build`, `npm run panel:build`, ESLint, `git diff --check` y `spec-check` pasan. Sin dependencias nuevas ni cambios en contrato, M2 o migraciones.

## Validación de T5 del 2026-11-23

- Rojo inicial: la suite nueva falló al importar el módulo todavía inexistente. Tras implementarlo, pasan sus 94 casos con JWKS local.
- `npm test`: 155 archivos y 5901 pruebas pasan, sin omisiones ni errores, incluida integración con PostgreSQL en Docker.
- `npm run build`, `npm run panel:build`, ESLint, `git diff --check` y `spec-check` pasan. Persisten los avisos conocidos sobre cantidad de tareas y el commit heredado de portabilidad Windows.
- Sin dependencias nuevas ni cambios en contrato, M2, migraciones o rutas. Esta tarea valida credenciales; no afirma haber probado un login completo ni un JWKS remoto.

## Siguiente tarea

T6: completar el retorno OIDC, consumir la transacción vinculada al navegador, intercambiar el código y validar las credenciales antes de emitir una sesión nueva y redirigir a una URL limpia. Conectar JWKS remoto con timeout, reintento GET acotado y refresco compartido; no reintentar el POST de intercambio.

### T6 — Retorno y cliente OIDC · commit 083/T6
- auth/oidc.ts obtiene JWKS con límite de cuerpo, timeout completo, un reintento GET y carga compartida; intercambia códigos sin reintentar POST. auth/retorno.ts consume state vinculado una sola vez, valida tokens y crea cookie nueva, con URL limpia y errores fijos.
- Pruebas: retorno-auth.test.ts pasa sus cuatro casos de ingreso, repetición, navegador ajeno y retornos ambiguos. Compilación del servidor pasa. Las puertas globales se repiten en T26.


### T7 — Renovación atómica · commit 083/T7
- renovacion.ts comparte promesa por sesión y sesiones.ts actualiza con versión y sub coherente. Logout o expiración impiden recreación. Rechazo invalida; caída transitoria conserva solo acceso vigente. renovacion-auth.test.ts prueba concurrencia, versión, logout y clasificación; servidor compila.


### T8 — Consulta de sesión y fallas · commit 083/T8
- estado.ts expone sub, roles y scopes con no-store; no registra actividad ni entrega credenciales. Diferencia 401 de 503 y Retry-After. sesion-real.test.ts cubre consulta mínima y fallas de renovación. Compilación verificada.


### T9 — Salida local y remota · commit 083/T9
- salida.ts invalida antes de redirigir, borra cookie y vincula retorno a transacción única. Usa client_id y state, nunca id_token_hint. Fallar el cierre remoto deja la sesión local cerrada y muestra salida no confirmada. Prueba HTTP incluye retorno único y token ausente en URL; compilación pasa.


### T10 — Proxy con sesión · commit 083/T10
- proxy.ts conserva transporte y lista cerrada existentes; OIDC obtiene token solo de sesión renovada, rechaza Authorization y suplantación. Preserva bytes, idempotencia, respuesta y no reenvía tras 401. Registro real omite cuerpos y rutas personales. proxy-real.test.ts prueba estos invariantes; servidor compila.


### T11 — Diagnóstico aislado · commit 083/T11
- Cada sesión guarda hasta 50 metadatos de pedidos, sin cuerpos, query ni UUID de rutas. Se eliminan con ella y no prolongan actividad. /panel/pedidos exige cookie válida y solo devuelve su registro. Modo real no registra evaluación. proxy-real.test.ts comprueba dos sesiones y rutas ausentes; compilación pasa.


### T12 — Fuente real de sesión · commit 083/T12
- sesion-real.ts consulta exclusivamente /auth/sesion con plazo de 15 s, conserva solo sub/roles/scopes y distingue carga, sesión, 401 y dependencia caída. Suscripciones y petición compartida evitan cargas duplicadas. /panel/config expone solo modo y etiqueta M6. Prueba de estados pasa; cliente compila.


### T13 — Espacios y permisos · commit 083/T13
- permisos-reales.ts deriva espacios de roles verificados, controla rutas y scopes y rechaza herramientas reales o CONDUCTOR-only. Marco y menú admiten modo real sin evaluación. Las funciones no mutan identidad. Prueba cubre doble rol, acceso directo y scopes faltantes; cliente compila. Selector se conecta en T14.


### T14 — Acceso y aplicación real · commit 083/T14
- main.tsx carga dinámicamente el modo decidido por el servidor. app-real.tsx conecta sesión y pantallas sin suplantación ni herramientas; selector cambia espacio y mantiene sub. IngresarReal usa POST nativo; encabezado cierra por POST propio. Perfil sin fuente de control no ofrece carga de ejemplo. Prueba del formulario pasa; cliente compila. Chrome completo corresponde a T23/T24.


### T15 — Primer perfil por identidad · commit 083/T15
- consultarPerfilPropio distingue únicamente 404 de éxito y propaga 401/403/503. PuertaPerfil consulta sub firmado antes de Mi cuenta y no bloquea Operación por perfil inexistente. Prueba de cinco estados pasa y cliente compila. Alta se conecta en T16.


### T16 — Alta recuperable · commit 083/T16
- crearAltaPropia conserva clave por cuerpo y comparte envío; ante 409 consulta sub propio y ante cuerpo cambiado tras resultado incierto comprueba primero si existe. CompletarPerfil reutiliza campos y errores existentes, sin UUID inventado. Unitarias y prueba con M2/PostgreSQL real pasan: dos pestañas terminan con un perfil. Cliente compila.

