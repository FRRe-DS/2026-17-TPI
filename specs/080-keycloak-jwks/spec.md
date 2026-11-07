# Spec 080 — M2 valida tokens de Keycloak (JWKS y scope) y compose con Keycloak

Estado: aprobada
Issue: #80
Etapa: TP2
Responsable: @sandobaitt

## Contexto y objetivo
Hoy M2 valida un JWT HS256 con una clave que comparte quien firma (`M2_CLAVE_TOKENS`, ADR 009). Con esa clave, cualquiera que la tenga puede firmar un token con cualquier rol: el propio ADR 009 lo anota como riesgo y RF-1.4 pide validar «sin compartir contraseñas ni datos internos». La cátedra dijo en clase que Keycloak es opcional y cómo se usa: el backend obtiene la clave pública al arrancar (JWKS), comprueba con ella cada token y, en cada operación, mira el campo `scope`. El grupo decidió implementarlo (2026-11-07), y para la entrega final la cátedra pide cinco piezas: Keycloak, su base, el backend, su base y el frontend.

El objetivo es que M2 valide tokens emitidos por Keycloak sin conocer ninguna clave privada, que exija el scope de cada operación además de lo que ya exige, y que Keycloak se levante con compose. El modo actual se mantiene para desarrollo: las pruebas, `scripts/demo.mjs` y el panel siguen como están.

Se comprobó el 2026-11-07, levantando el realm publicado por la cátedra (`FRRe-DS/2026-TPI/keycloak`, commit `6dfdd40`, Keycloak 23.0.6) y pidiendo tokens reales, que un token de ese realm no pasaría las reglas de M2:
- No trae `aud`, y M2 exige la audiencia `m2-clientes`.
- Trae `scope: "conductores:write conductores:read"` en todos los grupos. `clientes:read` y `clientes:write` están definidos en el realm, pero ningún cliente los tiene asignados: pedir `clientes:read` da `invalid_scope`.
- Trae `roles: ["clientes-be", "clientes-be"]` en los grupos 1 y 17, y el rol `*-be` de su módulo en los demás. No hay roles `CLIENTE`, `OPERADOR` ni `SERVICIO`.
- Solo tiene las cuentas de servicio de cada grupo y un `test-user` sin esos roles: no hay usuarios de cliente ni de operador.

Lo que sí sirve de ese realm: los tokens son RS256 con `kid`, los roles van en un campo `roles` de primer nivel (el que M2 ya lee por defecto) y el `scope` es un texto separado por espacios.

## Usuarios
- Evaluador de la cátedra: ve a M2 validando tokens reales de Keycloak y levanta las piezas con compose.
- Integrante del grupo: sigue trabajando con el modo de desarrollo y prueba el modo Keycloak cuando lo necesita.
- Módulos que consultan a M2 (M5, M9): se presentan con una cuenta de servicio.
- Cliente y operador: se identifican con su usuario de Keycloak.

## Historias de usuario
- HU-1. Como evaluador, quiero que M2 compruebe los tokens con la clave pública de Keycloak, para que nadie pueda atribuirse un rol sin pasar por Keycloak (RF-1.4, RF-1.6, RNF-12).
- HU-2. Como evaluador, quiero que cada operación exija su scope además del rol, para ver aplicado lo que declara el contrato.
- HU-3. Como integrante del grupo, quiero levantar Keycloak y su base con un comando y un realm ya cargado, para probar sin configurar nada a mano (RNF-04).
- HU-4. Como integrante del grupo, quiero que el modo de desarrollo siga funcionando, para que las pruebas y el panel no dependan de Keycloak (RNF-06, RNF-07).
- HU-5. Como cliente, quiero que lo propio de M2 no se caiga por un corte breve de Keycloak, si mi token ya se puede comprobar (RNF-13).

## Requisitos funcionales
(Ninguno: M2 no agrega operaciones. Cambia cómo autentica y autoriza las que ya tiene, y eso es RNF-12.)

## Requisitos no funcionales
- RNF-06.7: EL SISTEMA elige por configuración externa (`M2_MODO_TOKENS`) un único modo de validar tokens: `hs256`, que es el valor por defecto y se comporta como hasta ahora, o `jwks`.
- RNF-06.9: SI `M2_MODO_TOKENS` no es uno de esos dos valores, o el modo es `jwks` y falta la URL de las claves (`M2_URL_JWKS`), ENTONCES EL SISTEMA no arranca y nombra la variable sin repetir su valor.
- RNF-12.11: MIENTRAS el modo es `jwks`, EL SISTEMA acepta solo tokens firmados con RS256 por una clave publicada en `M2_URL_JWKS` y responde `401` con `WWW-Authenticate: Bearer` ante cualquier otro, incluidos los de algoritmo `none` y los HS256 firmados con `M2_CLAVE_TOKENS`.
- RNF-12.12: MIENTRAS el modo es `jwks`, EL SISTEMA aplica a emisor, audiencia, vencimiento, `nbf` y `sub` las mismas reglas y los mismos motivos de `401` de RNF-12.2, con `M2_EMISOR_TOKENS` y `M2_AUDIENCIA_TOKENS`, y lee los roles como dice RNF-12.4, sin importar que un rol venga repetido.
- RNF-12.13: MIENTRAS el modo es `jwks`, SI un token válido no trae en su campo `scope` el scope que el contrato declara para la operación, ENTONCES EL SISTEMA responde `403` en `application/problem+json` (`type: about:blank`, con un `detail` que habla del scope y no del rol), aunque el rol y la propiedad del recurso (`sub` = `clienteId`) sean correctos; un scope de escritura no da permiso de lectura, y una operación para la que el contrato no declara scope no exige ninguno.
- RNF-12.14: MIENTRAS el modo es `jwks`, SI el rol del token no está permitido para la operación, o un CLIENTE opera sobre otro `clienteId`, ENTONCES EL SISTEMA responde `403` igual que en el modo `hs256`, aunque el token traiga el scope correcto.
- RNF-12.15: MIENTRAS el modo es `hs256`, EL SISTEMA no exige `scope` y responde lo mismo que antes de esta spec.
- RNF-12.18: EL SISTEMA atiende `GET /health` sin pedir token en los dos modos.
- RNF-12.16: CUANDO llega un token con un `kid` que M2 no tiene, EL SISTEMA vuelve a pedir las claves, como mucho una vez cada 30 segundos desde la última vez que las obtuvo.
- RNF-12.19: SI el `kid` del token no está entre las claves que M2 tiene, y Keycloak las entregó sin él o todavía no corresponde volver a pedirlas (RNF-12.16), ENTONCES EL SISTEMA responde `401`.
- RNF-13.9: CUANDO M2 arranca en modo `jwks`, EL SISTEMA pide las claves a `M2_URL_JWKS` sin demorar el arranque.
- RNF-13.12: SI M2 arranca en modo `jwks` y no obtiene las claves, ENTONCES EL SISTEMA sigue funcionando, deja un aviso en el log y `GET /health` responde según su base, sin depender de Keycloak.
- RNF-13.10: MIENTRAS el modo es `jwks`, SI hace falta una clave que M2 no tiene, corresponde pedirla (RNF-12.16) y Keycloak no la entrega en `1 + M2_REINTENTOS_MODULOS` intentos de hasta `M2_TIEMPO_MODULOS_MS` cada uno, ENTONCES EL SISTEMA responde `503` genérico (`type: about:blank`) con `Retry-After` y no `401`, porque el token puede ser válido.
- RNF-13.11: MIENTRAS Keycloak no responde, CUANDO llega un token firmado con una clave que M2 ya obtuvo, EL SISTEMA lo valida y atiende la operación con normalidad.
- RNF-13.13: CUANDO Keycloak vuelve, EL SISTEMA obtiene las claves que le falten sin reiniciar.
- RNF-04.10: EL SISTEMA permite levantar Keycloak, en una versión fija y con su propia base PostgreSQL, mediante un perfil de compose `keycloak`, e importa el realm de desarrollo al crearse; sin ese perfil, `docker compose up -d --build --wait` levanta lo mismo que antes y M2 no lo necesita.
- RNF-05.6: EL SISTEMA guarda los datos de Keycloak en una base y un volumen propios, separados de los de M2.
- RNF-06.8: EL SISTEMA versiona el realm de desarrollo solo con credenciales que no sirven fuera de una máquina de desarrollo, como `ejemplo.env`, y toma de la configuración externa la contraseña de administración de Keycloak y la de su base.
- RNF-12.17: EL SISTEMA incluye un realm de desarrollo importable, derivado del `ds-2026-realm` de la cátedra (mismo nombre, mismos clientes `grupo-NN`), que además emite tokens con audiencia `m2-clientes`, trae los roles `CLIENTE`, `OPERADOR`, `SERVICIO` y `CONDUCTOR` en el campo `roles`, los scopes `clientes:read` y `clientes:write`, al menos un usuario de ejemplo por rol de persona (`CLIENTE`, `OPERADOR`, `CONDUCTOR`) con un `id` fijo, y cuentas de servicio con rol `SERVICIO` para M5 y M9.
- RNF-07.12: CUANDO se corren las pruebas sin Keycloak (`npm test`), EL SISTEMA comprueba cada requisito de validación y scope con claves generadas por la prueba y un JWKS propio de la prueba, en los dos modos, y sin necesitar una imagen de Keycloak.
- RNF-07.13: CUANDO se corre la prueba con Keycloak real, EL SISTEMA levanta el perfil `keycloak` con M2 en modo `jwks` y comprueba con tokens pedidos a Keycloak que: un usuario CLIENTE crea y lee su perfil; un CLIENTE no lee el de otro (`403`); un OPERADOR registra un bloqueo; una cuenta de servicio de M5 lee el estado de cuenta y no el perfil (`403`); un token alterado, uno HS256 o un ID token da `401`; con Keycloak detenido se cumplen RNF-13.10 a RNF-13.13; y, una vez que el contrato declare los scopes (#79), un token sin el scope da `403`.
- RNF-20.5: EL SISTEMA documenta en `docs/probar-m2.md` cómo levantar el perfil `keycloak`, pedir un token y probar una operación, con comandos comprobados, y en un ADR la decisión que reemplaza al ADR 009.

## Contrato y dependencias
- Operaciones del contrato que cubre: las 19 protegidas de `contrato/openapi.yml`, sin agregar ni cambiar ninguna. `verificarSalud` sigue pública. Los códigos ya están declarados: `401`, `403` y `503` figuran en las 19.
- El scope de cada operación lo declara el contrato, y el nuestro todavía no: lo agrega la rama `contrato/079-…` (#79). M2 lo lee del contrato, así que el código de RNF-12.13 se puede hacer y probar antes con un contrato de prueba, y empieza a aplicarse en las operaciones reales cuando se mergee #79, sin tocar `src/`. Lo esperado, según el contrato de la cátedra (commit `360caad`, corrigiendo el tipeo `cleintes`): `clientes:read` en cada operación de lectura y `clientes:write` en cada una de escritura.
- Para que el contrato diga lo mismo que M2, #79 tiene que escribir rol y scope en el mismo renglón de `security`: en OpenAPI, dos renglones son alternativas («rol o scope»), como en el contrato de la cátedra. Si el contrato final los deja en dos renglones, M2 no abre de más, porque sigue pidiendo los dos, pero contradice al contrato, que manda: se para y se le pregunta a @sandobaitt.
- Operaciones de otros módulos que consume:
  - Keycloak, JWKS (`GET /realms/{realm}/protocol/openid-connect/certs`): con timeout y reintentos; si no responde, RNF-13.9 a RNF-13.13. No se llama en cada solicitud: las claves se guardan en memoria.
  - El pedido de tokens (`/protocol/openid-connect/token`) no lo hace M2, sino quien llama.

## Casos límite
- **Emisor según desde dónde se mira.** Keycloak arma el `iss` con el host del pedido: se comprobó que da `http://keycloak:8080/…` o `http://127.0.0.1:18080/…` según quién pregunta. El emisor se fija en Keycloak a uno solo, y M2 baja las claves por la red de compose con otra URL: por eso `M2_EMISOR_TOKENS` y `M2_URL_JWKS` son variables separadas.
- **El JWKS trae más de una clave.** Keycloak publica también una de cifrado (`use: enc`, RSA-OAEP): solo cuenta la de firma.
- **Rol repetido.** Keycloak repite el rol por cada scope que lo mapea (`["clientes-be", "clientes-be"]`): no cambia nada.
- **`kid` inventado.** Con Keycloak andando, muchos tokens con `kid` distintos no se convierten en muchos pedidos (RNF-12.16). Si Keycloak rota su clave, un token nuevo que llega dentro de los 30 s de la última obtención recibe `401` hasta que pase ese plazo.
- **`kid` inventado durante un corte.** Los 30 s corren desde la última vez que M2 obtuvo las claves, y un pedido fallido no los reinicia. Dentro de ese plazo, el token recibe `401` sin ningún pedido. Pasado, cada tanda de solicitudes hace hasta `1 + M2_REINTENTOS_MODULOS` pedidos y recibe `503`: solo se juntan las simultáneas. Costo aceptado para TP2: alguien sin credenciales puede sumarle carga a un Keycloak que se está recuperando.
- **Muchas solicitudes juntas sin claves.** Se hace un solo pedido a Keycloak, y todas esperan ese.
- **Campo `scope` vacío o ausente.** Cuenta como un token sin scopes, y Keycloak lo manda vacío (`""`) si no se pidió ninguno opcional. Si no es un texto, el token está mal formado y recibe `401`.
- **Token con otro algoritmo y Keycloak caído.** Recibe `401` y no `503`: para rechazarlo no hace falta ninguna clave.
- **Clave retirada de Keycloak.** M2 la sigue aceptando hasta que vea un `kid` nuevo o se reinicie: es el costo de seguir atendiendo con Keycloak caído (RNF-13.11).
- **Vida corta.** Los tokens de Keycloak duran 300 s por defecto, contra los 3600 del comando de desarrollo.
- **Token de servicio.** Su `sub` es un UUID de Keycloak, no el nombre del módulo como dice el contrato: M2 no lo usa para nada en `obtenerEstadoCuenta`, y el texto del contrato se ajusta en #79.
- **Perfil `keycloak` con M2 en modo `hs256`.** Son independientes: levantar el perfil no cambia el modo. Hay que pedirlo con `M2_MODO_TOKENS=jwks`.
- **Panel con M2 en modo `jwks`.** Sus pedidos reciben `401`, porque firma con HS256. No es un error: es lo que pide RNF-12.11 hasta la spec del inicio de sesión real (#83).

## Fuera de alcance
- El inicio de sesión real del panel y la UI nueva: van en el #83.
- Pedir a Keycloak el token con el que M2 llama a M6.
- M1 completo: registro, recuperación y revocación de credenciales (RF-1.1, RF-1.5).
- HTTPS, límite de pedidos y el resto de RNF-12 (otra spec).
- El cambio del contrato (#79).
- Aceptar los dos modos a la vez: un token se valida con uno solo.
- Que M2 acepte los tokens del realm de la cátedra tal como está publicado (ver Contexto). Lo encontrado se le avisó al Grupo 1 (FRRe-DS/2026-01-TPI#7); por decisión de @sandobaitt, por ahora no se le consulta a la cátedra.

## Criterios de finalización
- Con `M2_MODO_TOKENS=jwks` y el perfil `keycloak`, M2 atiende tokens reales de Keycloak y rechaza los demás, según RNF-12.11 a RNF-12.16 y RNF-12.19.
- Con Keycloak detenido, M2 sigue atendiendo los tokens que puede comprobar y responde `503` a los que no.
- Sin configurar nada, M2 se comporta como antes: `npm test`, `npm run contrato:test`, `scripts/demo.mjs` y el perfil `panel` pasan sin cambios.
- La prueba de RNF-07.13 corre en verde, incluido el escenario de scope una vez mergeado #79, y `docs/probar-m2.md` explica cómo repetirla.
- El ADR 080 reemplaza al ADR 009.
- `npm test` y `node scripts/spec-check.mjs` en verde.

## Decisiones
Aclaradas el 2026-11-07, por delegación de @sandobaitt (se aplicó la recomendación de cada una).
- **El inicio de sesión real del panel va aparte**, en el #83, junto con la UI nueva. Hoy el panel firma sus propios tokens HS256, y reemplazarlo es otro trabajo (redirección a Keycloak, sesión y las pantallas que firman en nombre de un rol) que agrandaría mucho esta spec. Consecuencia aceptada: hasta esa spec, el panel funciona solo con M2 en modo `hs256`, así que las cinco piezas se levantan pero el frontend no entra con Keycloak.
- **Se exigen rol y scope juntos** (RNF-12.13, RNF-12.14), para conservar «un cliente solo ve lo suyo». Alternativa descartada: rol o scope, que es lo que dicen los dos renglones de `security` del contrato de la cátedra; con eso, un token con solo `clientes:write` podría escribir el perfil de cualquier cliente. El código no espera al Grupo 1: solo el escenario de scope de la prueba real queda bloqueado hasta #79.
- **Realm propio, derivado del de la cátedra** (RNF-12.17): con el suyo ningún token pasa y no hay usuarios de cliente ni de operador. Mantiene el nombre y los clientes, para que migrar sea fácil si la cátedra lo corrige. Alternativa descartada: adaptar M2 a los tokens de la cátedra, que dejaría sin audiencia ni roles de persona a la validación.
- **El `sub` de un usuario sigue siendo su `clienteId`**, sin tablas nuevas: Keycloak usa UUID, que es lo que M2 ya exige, y los usuarios de ejemplo tienen un `id` fijo para que las pruebas sean repetibles.
- **Si Keycloak está caído, M2 arranca igual**, atiende los tokens cuya clave ya tiene y responde `503` a los que no puede comprobar (RNF-13.9 a RNF-13.13). Alternativa descartada: no arrancar sin Keycloak, porque un corte de Keycloak tumbaría a M2 entero y `/health` dejaría de responder.
- **El token con el que M2 llama a M6 no sale de Keycloak por ahora.** M2 lo sigue firmando con `M2_CLAVE_TOKENS`, que por eso sigue siendo obligatoria en los dos modos. El M6 real no valida firmas (spec 081), y pedirlo a Keycloak haría que el historial dependa de Keycloak. Queda como deuda en el ADR 080.
- **En modo `hs256` no se exige scope** (RNF-12.15). Es un modo de desarrollo, y exigirlo obligaría a cambiar el comando de tokens, la demo, el panel y las pruebas, sin ganar seguridad: quien tiene la clave firma el scope que quiera.
- **De dónde salen los roles:** de un campo `roles` de primer nivel, como lo mapea el realm de la cátedra. `M2_CAMPO_ROLES` alcanza; no hace falta leer rutas anidadas como `realm_access.roles`. Comprobado con tokens reales.
- **Emisor:** se fija en Keycloak y M2 baja las claves por otra URL (ver Casos límite). Alternativa descartada: que M2 descubra todo desde el emisor, que no funciona si el emisor es `localhost`, porque dentro del contenedor `localhost` es M2. Comprobado con tokens reales.

Supuesto provisorio: el Grupo 1 todavía no contestó (FRRe-DS/2026-01-TPI#7). Si decide algo distinto sobre roles y scopes, o la cátedra corrige su realm, el cambio va por `sdd-change` de esta spec.

## Dudas abiertas
Ninguna.
