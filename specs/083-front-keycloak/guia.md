# Guía — Spec 083 Sesión real del frontend

## Estado de trabajo

T1, T2 y T3 implementadas y validadas en `impl/083-front-keycloak`. T4 a T26 siguen pendientes y la spec conserva el estado aprobada. El inicio de sesión real todavía no está implementado.

## Tareas

### T1 — Separar configuración real y de desarrollo y validar orígenes · commit `083/T1`

- Qué cambió: `panel/servidor/config.ts:cargarConfigPanel` devuelve una unión discriminada por `modoAuth`. Desarrollo conserva sus valores y credenciales anteriores. OIDC exige origen público y bases pública e interna del realm; no lee ni devuelve claves HS256, base, Docker o control M6 heredados.
- Por qué así: RNF-06.83.1. Las herramientas de desarrollo reciben `ConfigPanelDesarrollo` explícitamente y no pueden recibir una configuración OIDC por error de tipos.
- Retornos: se derivan exclusivamente del origen validado, como `/auth/retorno` y `/auth/salida`. El origen es exacto y HTTPS, o HTTP solo en localhost/127.0.0.1/::1. Se rechazan credenciales, comodines, rutas y parámetros. Las bases de Keycloak no admiten credenciales, query ni fragmento y deben corresponder al mismo camino de realm; la dirección interna puede usar HTTP entre contenedores.
- Configuración adicional: cliente `m2-front` por defecto, plazo de identidad de 2000 ms y etiqueta de M6 simulado activada. Los valores se validan sin repetir su contenido en errores. Los ejemplos del entorno real corresponden a T20 y su documentación a T25.
- Cómo se conecta: `app.ts` y `arranque.ts` rechazan por ahora el modo OIDC antes de registrar herramientas o abrir puertos, hasta conectar las rutas de sesión. Esta protección temporal se reemplaza al conectar el servidor OIDC. No hay acceso real ni sustitución por una identidad simulada.
- Tests: `pruebas/panel/unitarias/config-oidc.test.ts` comprueba configuración mínima, ausencia de secretos heredados, retornos propios, URLs inválidas, plazo y modo. `config.test.ts` y `tokens.test.ts` conservan la regresión de desarrollo. `pruebas/panel/http/arranque.test.ts` verifica que OIDC no abra el servidor de desarrollo mientras falta implementar sesión.

### T2 — Almacenes acotados de sesiones y transacciones · commit `083/T2`

- Qué cambió: `panel/servidor/auth/almacen.ts` implementa el almacenamiento común con hasta 1000 registros por instancia. Genera identificadores de 32 bytes aleatorios y guarda solo su SHA256 como clave; copia los datos al entrar y salir para evitar cambios por referencias compartidas.
- `auth/sesiones.ts:crearAlmacenSesiones` guarda identidad, permisos, credenciales y versión inicial. Vence por el primero de estos límites: ocho horas absolutas, treinta minutos sin actividad explícita o vencimiento del refresh token de Keycloak. La consulta no extiende la inactividad. Un access token vencido conserva la sesión para la renovación posterior de T7; el almacén no decide reenviar esa credencial a M2.
- `auth/transacciones.ts:crearAlmacenTransacciones` conserva transacciones de ingreso y salida durante cinco minutos. Genera state y vínculo independientes; guarda el hash del vínculo y lo compara en tiempo constante antes de consumir. Un navegador con otro vínculo no obtiene los datos ni elimina la transacción del propietario. El consumo es síncrono y único; si vence durante la comprobación, tampoco se devuelve.
- Por qué así: RNF-12.83.2 y el plan de datos de sesión. No se crean tablas ni se reutiliza Redis. La capacidad agotada devuelve un error tipado de mensaje fijo, sin expulsar entradas activas ni incluir datos personales o credenciales.
- Limpieza: al acceder se eliminan registros vencidos y se revisan también cada minuto. El temporizador no mantiene vivo el proceso; `cerrar` lo cancela, borra datos y rechaza nuevas admisiones. `cantidad` informa los registros retenidos sin disparar limpieza, para comprobar también la limpieza sin solicitudes.
- Cómo se conecta: son módulos internos del servidor. Las cookies de T3 utilizan estos almacenes; las tareas de sesión conectarán las rutas y su cierre al ciclo de vida del servidor. Los errores internos deberán traducirse al problema HTTP correspondiente al conectar las rutas.
- Tests: `pruebas/panel/unitarias/almacenes-auth.test.ts`, 24 casos con reloj controlado: identificadores y desconocidos, aislamiento, límites exactos, sondeo sin actividad, tope absoluto, vencimiento de Keycloak, logout, copias defensivas, consumo único, capacidad y recuperación de espacio, limpieza periódica y cierre idempotente de temporizadores.
- Límites: memoria de un solo proceso; reiniciar requiere reingreso y no permite compartir sesión entre réplicas. Son límites aceptados en el plan; los datos se borran al cerrar y no se persisten. Renovación concurrente, diagnóstico por sesión y acceso real corresponden a tareas posteriores.

### T3 — Cookies y solicitudes vinculadas al origen público · commit `083/T3`

- Qué cambió: `panel/servidor/auth/cookies.ts:crearCookiesAuth` emite y lee las cookies `m2_sesion` y `m2_transaccion`, ambas HttpOnly, SameSite=Lax, Path=/ y sin Domain. Usa Secure según el origen público validado, sin confiar en encabezados reenviados. Las vidas máximas de navegador son ocho horas y cinco minutos; el almacén del servidor puede vencer antes la sesión.
- Identidad: `emitirSesion` genera siempre una entrada nueva en el almacén y no acepta un identificador elegido por el navegador. `leerSesion` solo reconoce una cookie válida cuyo identificador exista en el almacén; no usa query, cuerpo, Authorization ni encabezados de desarrollo. Las cookies duplicadas, codificadas o mal formadas se rechazan. Ninguna cookie contiene tokens, roles ni datos personales.
- Vínculo: la cookie de transacción contiene únicamente el vínculo aleatorio generado por T2; el retorno necesita también el state y consume la transacción del servidor una sola vez. Sin cookie, con otra cookie o con cookies repetidas no se obtienen los datos ni se consume la transacción del propietario.
- Borrado: se emite una cookie vacía con Max-Age=0, fecha de expiración pasada y los mismos atributos. Fastify acumula los Set-Cookie individuales, por lo que se pueden emitir o borrar ambas cookies juntas. Borrar la cookie no invalida por sí solo el registro: T9 invalidará primero la sesión del servidor.
- Origen: `panel/servidor/seguridad.ts:registrarSeguridad` conserva el modo de desarrollo por puerto y añade un modo por origen público. Exige Host propio en todas las rutas y Origin exacto en métodos que cambian datos, antes de leer el cuerpo. No reemplaza esos encabezados con Referer o X-Forwarded-Host/Proto, no habilita CORS y permite los retornos GET sin Origin.
- Tests: `pruebas/panel/http/cookies-auth.test.ts` contiene 40 pruebas HTTP sobre Fastify y los almacenes reales en memoria: atributos HTTP/HTTPS/IPv6, borrado, cookies simultáneas, identificadores nuevos y desconocidos, duplicados, aislamiento de transacción y rechazo de solicitudes ajenas incluso en rutas inexistentes. Sus rutas son ayudas de prueba, sin validación OIDC simulada en producción.
- Cómo se conecta: son herramientas internas preparadas para las rutas de T4 y T6. El arranque real sigue cerrado hasta conectar el flujo OIDC. La validación de identidad y la invalidación de la sesión previa al completar login se hacen en T5/T6; no se presentan como implementadas por estas pruebas de transporte.

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

## Siguiente tarea

T4: iniciar autorización OIDC por POST propio, crear state/nonce/verifier y redirigir con 303 a Keycloak. Preparar la CSP por modo con form-action limitado a self y al origen público de Keycloak; no abrir aún rutas privilegiadas de desarrollo en modo real.
