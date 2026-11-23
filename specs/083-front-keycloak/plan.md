# Plan — Spec 083: sesión real del frontend

## Alcance y arquitectura

#83 implementa sesión en servidor, adaptación funcional de las vistas existentes, primer perfil, permisos, recuperación, compose real y entorno de pruebas con Keycloak. El rediseño integral y la entrega completa se trasladan a los issues propuestos en issue-interfaz.md e issue-entrega.md. La partición sigue el comentario de @sandobaitt en PR #118.

Se conserva React, Vite, CSS Modules y Fastify del panel. En modo real el servidor completa OIDC y reenvía a M2 solo el access token de cada sesión. El navegador permanece en el mismo origen; no se agrega CORS ni se modifica contrato/, src/ o migraciones/. Se usan crypto, fetch y jose ya instalado, sin nuevas dependencias.

Modo real y demostración son procesos configurados por separado, con instancias M2 separadas cuando se ejecutan a la vez: M2 jwks para la app real y M2 HS256 para desarrollo. La app real no registra rutas de suplantación, Docker, base, control de M6 o Demostración. Una cookie o un enlace no pueden cambiar el modo del proceso.

La decisión de sesión se registra en docs/adr/083-front-sesion-servidor.md. La separación de evaluación reemplaza el criterio de una sola app de la 071; su rediseño final pertenece a interfaz. Las vistas de negocio existentes se reutilizan: esta spec no las vuelve a diseñar.

## Contrato y rutas internas

El proxy mantiene las 20 operaciones existentes de M2 y sus errores. El alta inicial usa obtenerCliente y crearCliente; los recorridos de permisos usan perfil, estado, bloqueos y calificaciones ya disponibles. La lógica de negocio de las specs 004 a 008 no cambia.

| Ruta del frontend | Resultado |
|---|---|
| POST /auth/iniciar | Origen propio, transacción vinculada al navegador y 303 a Keycloak |
| GET /auth/retorno | Validación OIDC, cookie nueva y redirección a URL local limpia |
| GET /auth/sesion | Identidad mínima o 401, sin tokens y con Cache-Control: no-store |
| POST /auth/cerrar | Invalida primero la sesión local y prepara el cierre remoto |
| GET /auth/salida | Verifica state de cierre y vuelve al acceso |
| /api/v1/clientes y descendientes | Proxy autenticado; sin identidad elegida desde el navegador |

Estas rutas pertenecen al servidor del frontend y no alteran el OpenAPI público de M2. Los errores del frontend usan application/problem+json y X-Request-Id: /panel/errores/sesion-requerida (401), /panel/errores/retorno-invalido (400), /panel/errores/identidad-no-admitida (403), /panel/errores/identidad-no-disponible (503 con Retry-After). Los errores de M2 pasan sin reemplazarlos por éxitos.

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

### CSP y redirección de login

La política actual de panel/servidor/estaticos.ts permite form-action 'self'. Convertir registrarEncabezadosDeSeguridad en una política construida desde el modo y la configuración validada.

- En desarrollo conservar la política actual.
- En modo oidc, form-action permite 'self' y exactamente new URL(PANEL_OIDC_EMISOR).origin, el origen público de Keycloak, nunca la URL interna de Docker.
- No usar comodines, unsafe-inline ni relajar default-src, base-uri, object-src o frame-ancestors. Mantener recursos y llamadas del navegador en self; el código OIDC corre en servidor.
- Una prueba HTTP comprueba los encabezados en ambos modos, que un origen no configurado no se añade y que la configuración rechaza emisores con credenciales.
- La prueba Chrome pulsa el botón real de acceso, envía POST /auth/iniciar, atraviesa su 303 y el formulario de Keycloak y vuelve a la app. Captura securitypolicyviolation y errores de consola: debe completar sin violaciones CSP. No se sustituye el POST por goto directo a Keycloak porque ocultaría el defecto señalado por revisión.

### Precarga del M6 simulado

Agregar M6_CLIENTES_PRECARGA a ConfigM6, como lista separada por comas de UUID; ausencia o cadena vacía significa no precargar. Validar toda la lista antes de abrir puertos, eliminar duplicados y no registrar valores de configuración en errores.

En panel/m6-simulado/arranque.ts, tras crearEstadoM6 y antes de api.abrir, ejecutar estado.cargarEjemplo por cada UUID. Se reutilizan idsDeEjemplo y derivarUuid de ids.ts: cargar dos veces conserva exactamente los mismos viajes, un COMPLETED y un IN_PROGRESS por cliente, más el escenario ajeno existente. No se crean perfiles ni calificaciones de M2 ni se necesita llamar al canal de control.

El ejemplo real activa la precarga para los IDs del realm:
- cliente1: c1e00000-0000-4000-8000-000000000001.
- cliente2: c1e00000-0000-4000-8000-000000000002.
- cliente-operador1: d0b00000-0000-4000-8000-000000000001.

La aplicación solo recibe viajes por M2 y conserva la etiqueta M6 simulado. La variable pertenece al simulador: no apunta a una imagen M6 real ni cambia el contrato. Pruebas unitarias y HTTP: lista vacía, UUID inválido, mayúsculas, duplicados, dos clientes sin viajes cruzados y arranque con precarga antes del primer GET. En navegador se entra como cliente1 y cliente2, se crea su perfil si falta y se comprueba que hay un viaje calificable sin usar /control.

### Usuario con doble rol

Agregar al realm de desarrollo cliente-operador1, con UUID fijo d0b00000-0000-4000-8000-000000000001 y realmRoles CLIENTE y OPERADOR. Cuenta habilitada y credenciales solo de ejemplo, siguiendo el formato de los usuarios actuales. No modificar cliente1, cliente2 ni operador1 para que las pruebas de un solo rol sigan siendo válidas.

Mantener el cliente m2-front público, PKCE S256, audiencias y scopes existentes. Los tokens del nuevo usuario deben contener ambos roles y únicamente los scopes solicitados. Actualizar pruebas de realm y ayudas tipadas sin imprimir su contraseña o token. Probar con login real, sin inyectar roles en sessionStorage. Tras crear el perfil propio, el selector cambia entre Mi cuenta y Operación sin cambiar sub, cookie o credencial; un usuario operador-only entra a Operación sin crear perfil.

### Compose y aislamiento de bd-puente

El cambio de infraestructura mínimo es parte de sesión, incluidas las antiguas T31 y T33. Reutilizar imagen m2-panel:0.1.0 y versiones base existentes; crear ejemplo-front-keycloak.env y docker-compose.front.yml para activar modo oidc, M2 jwks, Keycloak y M6 precargado.

Mover bd-puente del perfil panel al perfil exclusivo panel-bd en docker-compose.yml. El override real activa los perfiles front y keycloak para panel y m6; no activa panel-bd, no publica el puerto de control M6, no expone la base y no entrega al frontend URL_BD, clave HS256 ni permisos Docker.

Arranque real previsto a verificar:
docker compose -f docker-compose.yml -f docker-compose.front.yml --env-file ejemplo-front-keycloak.env up -d --build --wait
El ejemplo define COMPOSE_PROFILES=front,keycloak. Las cinco piezas principales se suman a Redis y M6 simulado.

El comando de desarrollo en contenedor sigue usando panel y llega a bd por la red interna, sin necesitar puente. El panel como proceso en la máquina necesita explícitamente panel,panel-bd para llegar por 127.0.0.1:5433. Actualizar README, docs/probar-m2.md y ayudas de prueba que levantaban solo m6 bd-puente. Esto reemplaza el disparador de RNF-04.8 de la 072, declarado en Decisiones de la 083, sin editar otra spec desde esta rama.

Verificar la configuración renderizada y contenedores efectivos: real y panel sin panel-bd no seleccionan bd-puente; bd no tiene ports; ningún 5433 está publicado; la ejecución opt-in panel,panel-bd publica solo loopback. Una prueba que mire solo el nombre del perfil no alcanza. No montar socket Docker en el frontend real.

## Cliente y archivos previstos

| Responsabilidad | Archivos previstos |
|---|---|
| OIDC, JWT, cookies y sesión | panel/servidor/auth/oidc.ts, validacion.ts, cookies.ts, sesiones.ts, transacciones.ts, renovacion.ts, rutas.ts |
| Configuración, CSP y selección por modo | panel/servidor/config.ts, app.ts, estaticos.ts, seguridad.ts |
| Proxy y diagnóstico por sesión | panel/servidor/proxy.ts, pedidos.ts |
| Sesión real y API | panel/cliente/src/fuentes/sesion-real.ts, fuente-de-sesion.ts, api/sesion.ts, api/m2.ts |
| Acceso, alta y selector mínimo | pantallas/ingresar.tsx, completar-perfil.tsx, app.tsx, rutas.ts, logica/menu.ts |
| Sesión expirada | aviso de reingreso y hook de formulario, conservando componentes existentes |
| Fixtures para probar | keycloak/ds-2026-realm-realm.json, panel/m6-simulado/arranque.ts y ayudas de pruebas |
| Entorno real | docker-compose.front.yml, ejemplo-front-keycloak.env y perfil panel-bd en compose base |

Sesion expone roles y scopes efectivos y un espacio activo. Mi cuenta usa sub; Operación admite UUID de cliente, sin mutar la identidad. No bloquear Operación por un perfil propio inexistente. No ofrecer SERVICIO como persona; CONDUCTOR sin otro rol obtiene un rechazo claro.

Primer ingreso: pedir perfil propio; 200 entra, 404 muestra completar-perfil y cualquier otro error conserva su causa. Crear perfil conserva la clave del mismo envío; ante 409 consulta el perfil existente. Si cambia el cuerpo después de una respuesta incierta, primero se comprueba si se creó, para no reutilizar indebidamente la clave con otro cuerpo.

Al detectar sesión vencida se mantiene el formulario React montado y enviar deshabilitado; se avisa y ofrece Copiar datos y Volver a ingresar. Si Clipboard falla, dejar texto seleccionable para copia manual. No persistir borradores ni reenviar una escritura tras login. No hay redirección automática que borre lo escrito antes de que la persona confirme.

## Decisiones y alternativas

- Tokens en servidor frente a navegador: elección confirmada; mantiene RNF-19.3 y proxy sin CORS.
- Memoria acotada frente a base o Redis nuevo: no se cambia esquema; reinicio requiere reingreso. Replicación queda fuera.
- Modos por proceso frente a un selector de suplantación: la app real no registra las rutas peligrosas.
- Sin dependencias nuevas; si hace falta biblioteca OIDC adicional se solicita autorización antes de incorporarla.
- Logout con client_id y confirmación frente a token en URL: no se entrega id_token_hint al navegador.
- Evaluación separada reemplaza la app única de la 071; la separación funcional se hace aquí, su rediseño en el issue de interfaz.
- La revisión dividió #83: sesión retiene compose y entorno de navegador, interfaz retiene diseño de pantallas y entrega retiene cierre visual integral. Los borradores preservan el alcance retirado y el origen de las tareas.

## Pruebas y validación

Por tarea: test en rojo, cambio acotado, test en verde, guía y commit cuando el entorno lo permita. Mantener las puertas existentes; no desactivar checks por ausencia de dependencias.

Unitarias y HTTP: vínculo de state al navegador, PKCE, nonce, claims, cookies, expiración, límites, refresh concurrente, logout durante refresh, errores sanitizados, proxy y aislamiento de registros. Añadir pruebas de la CSP por modo, realm con doble rol, precarga y composición sin puente.

Integración M2 con PostgreSQL por Testcontainers: perfil propio, alta simultánea y permisos por identidad. No precargar la base M2 mediante SQL: perfiles se crean a través de su API.

Agregar proyecto Vitest front-keycloak y comando npm run front:keycloak que compila el panel y prepara un compose aislado con Keycloak real y M6 precargado, con puertos y volúmenes propios. Si se ajustan retornos en un realm efímero para los puertos de prueba, mantener PKCE, audiencias, roles y scopes; no volverlos permisivos.

Chrome de sesión prueba:
1. POST real de login y 303 bajo CSP; retorno limpio y sesión sin tokens en navegador.
2. cliente1 y cliente2 completan su perfil y encuentran sus viajes precargados; uno califica sin canal de control.
3. cliente-operador1 entra y alterna sus dos espacios; operador-only administra bloqueo; cliente-only no puede.
4. Refresh, sesión inválida, aviso/copia, rechazo y logout real con confirmación de Keycloak.
5. Las vistas mínimas nuevas funcionan a 360 y 1280 píxeles, teclado y foco, sin overflow; el recorrido visual completo 360/768/1280/1440 y ambos temas pasa al issue de entrega.

La antigua T34, que recorría todas las funciones rediseñadas, pertenece a entrega. La prueba de sesión anterior es un subconjunto suficiente y ejecutable para aprobar #83 antes del rediseño. CI incorpora el recorrido de sesión en el job de Keycloak o un job dedicado, sin omitirlo silenciosamente si falta Chrome.

Puerta de implementación: npm test, npm run lint, npm run build, npm run panel:build, npm run front:keycloak, npm run keycloak:test, contrato:test con servicio y node scripts/spec-check.mjs. Las pruebas son objetivos de la implementación, no resultados ya obtenidos por editar esta spec.

## Trazabilidad

| Requisito | Parte del plan | Tareas |
|---|---|---|
| RF-2.1.83.1 | Login real | T4, T6, T14 |
| RF-2.1.83.2 | Primer perfil | T15 |
| RF-2.1.83.3 | Alta idempotente | T16 |
| RNF-02.83.1 | Límites y proxy | T10, T21 |
| RNF-02.83.2 | M6 configurable | T18, T21 |
| RNF-02.83.3 | Precarga del simulador | T18, T24 |
| RNF-03.83.1 | Proxy y errores | T10, T11 |
| RNF-04.83.1 | Compose real | T21 |
| RNF-04.83.2 | Perfil exclusivo del puente | T20, T21 |
| RNF-06.83.1 | Configuración | T1, T18 |
| RNF-07.83.1 | Matriz de pruebas | T22, T23, T24, T25, T27 |
| RNF-12.83.1 | OIDC y JWT | T4, T5, T6 |
| RNF-12.83.2 | Almacenes y cookies | T2, T3 |
| RNF-12.83.3 | Proxy real | T10 |
| RNF-12.83.4 | Refresh | T7, T8 |
| RNF-12.83.4.1 | Aviso y copia | T19, T25 |
| RNF-12.83.5 | Logout | T9 |
| RNF-12.83.6 | Identidad y navegación | T12, T13 |
| RNF-12.83.6.1 | Selector de espacio | T13, T17, T25 |
| RNF-12.83.7 | Evaluación separada | T11, T21 |
| RNF-12.83.8 | Usuario doble rol | T17, T25 |
| RNF-12.83.9 | CSP por modo | T4, T24 |
| RNF-13.83.1 | Plazos Keycloak | T4, T7, T8 |
| RNF-14.83.1 | Registros por sesión | T11 |
| RNF-15.83.2 | Accesibilidad mínima | T14, T19, T25 |
| RNF-15.83.3 | Estados del acceso | T14, T15, T19, T25 |
| RNF-19.83.1 | Ausencia de secretos | T3, T6, T9, T11, T22 |
| RNF-20.83.1 | Documentación de sesión | T26, T27 |

## Referencias

- Revisión: https://github.com/FRRe-DS/2026-17-TPI/pull/118#issuecomment-7115292956
- OpenID Connect Core: https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation
- Keycloak: https://www.keycloak.org/docs/latest/server_admin/index.html
- Maqueta y pendientes de adjunto: maqueta.md.
