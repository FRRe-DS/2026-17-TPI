# Spec 125 — Token de servicio de M2 ante M6 obtenido de Keycloak

Estado: aprobada
Issue: #125
Etapa: TP3
Responsable: @sandobaitt

## Contexto y objetivo
M2 consulta a M6 en dos funcionalidades: el historial de viajes (RF-2.4, spec 007) y la verificación del viaje antes de calificar al conductor (RF-2.5.13, spec 008). En cada llamada se presenta con un token de servicio que hoy firma él mismo con HS256 y la clave compartida del consorcio (RF-2.4.11, ADR 009).

El Grupo 12 avisó en FRRe-DS/2026-12-TPI#9 (2026-11-25) que su M6 va a aceptar solo tokens RS256 emitidos por Keycloak y validados con el JWKS del emisor, por el mismo motivo que nuestro ADR 080: con una clave compartida, cualquiera que la tenga puede firmar un token con cualquier rol. Cuando ese cambio llegue, el token que firma M2 va a recibir `401`, y el historial y la calificación dejan de funcionar contra el M6 real.

El objetivo es que M2 obtenga su token de servicio de Keycloak, que hace de M1 (ADR 080), con el flujo de credenciales de cliente (`client_credentials`) y el cliente `grupo-17`, y lo reutilice mientras sea válido. Mientras no se configure Keycloak, M2 sigue firmando el token HS256 de hoy, para que el desarrollo, el perfil `panel` y las pruebas que no levantan Keycloak sigan funcionando.

Esta spec precisa RF-2.4.11 de la spec 007, que la 008 reutiliza. No cambia el contrato de M2 ni el de M6: `contrato/dependencias/m6.yml` declara un `bearerAuth` «emitido por M1», y Keycloak es M1.

## Usuarios
- CLIENTE y OPERADOR: consultan el historial y califican viajes; no ven el token, pero dependen de que M6 lo acepte.
- M6 (Grupo 12): recibe el token de M2 y lo valida contra el JWKS del emisor que tiene configurado.
- Quien opera M2: configura la URL de Keycloak y las credenciales de `grupo-17`, y diagnostica por los logs si falla la obtención del token.

## Historias de usuario
- HU-1. Como cliente, quiero seguir viendo mi historial y calificando viajes cuando M6 exige tokens de Keycloak, para que el cambio del otro grupo no me deje sin esas funciones.
- HU-2. Como quien opera M2, quiero que el secreto de `grupo-17` se configure por entorno y nunca aparezca en los logs, para no exponer una credencial del módulo.
- HU-3. Como quien opera M2, quiero que una caída de Keycloak dé una respuesta clara y diagnosticable, para no confundirla con una caída de M6 ni con un error del cliente.
- HU-4. Como integrante del grupo, quiero seguir levantando M2 sin Keycloak para desarrollar y probar, para no depender de Keycloak en cada prueba.

## Requisitos funcionales
- RF-2.4.11.1: MIENTRAS estén configuradas la URL de tokens de Keycloak, el identificador de cliente y su secreto, EL SISTEMA envía a M6 en `Authorization: Bearer` un token de acceso que obtiene de Keycloak con el flujo `client_credentials`, en lugar del token HS256 de RF-2.4.11.
- RF-2.4.11.2: MIENTRAS no esté configurada ninguna de esas tres variables, EL SISTEMA firma el token de servicio como define RF-2.4.11 de la spec 007.
- RF-2.4.11.3: SI está configurada solo una parte de esas tres variables, o la URL de tokens no es una URL `http` o `https` válida, ENTONCES EL SISTEMA no arranca e informa qué variable falta o es inválida, sin mostrar el valor del secreto.
- RF-2.4.11.4: CUANDO M2 necesita un token para llamar a M6 y tiene guardado uno obtenido de Keycloak al que le quedan 30 segundos o más de vida, según el `expires_in` informado por Keycloak, EL SISTEMA lo reutiliza sin pedir otro.
- RF-2.4.11.5: CUANDO M2 necesita un token y no tiene uno guardado, o al guardado le quedan menos de 30 segundos, EL SISTEMA pide uno nuevo a Keycloak, y si mientras tanto otros pedidos necesitan un token, esperan ese mismo resultado en lugar de pedir otro.
- RF-2.4.11.6: SI Keycloak no responde a tiempo, no es alcanzable, responde un `5xx` o una respuesta sin `access_token` o sin un `expires_in` entero positivo, ENTONCES EL SISTEMA, tras un solo reintento, responde `503` genérico (`type: about:blank`) en `application/problem+json` con `detail` «Keycloak no está disponible» y la cabecera `Retry-After` de RF-2.4.6, y no llama a M6.
- RF-2.4.11.7: SI Keycloak rechaza el pedido de token con un `4xx` (por ejemplo, credenciales de cliente inválidas), ENTONCES EL SISTEMA no reintenta, responde `500` en `application/problem+json` sin datos de Keycloak y registra la causa, porque es un error de configuración de M2 y no del cliente.
- RF-2.4.11.8: SI M6 responde `401` a una llamada hecha con un token reutilizado, es decir, tomado de la memoria y no pedido a Keycloak durante esa misma operación, ENTONCES EL SISTEMA lo descarta, obtiene uno nuevo de Keycloak y repite la llamada una sola vez; si la repetición vuelve a recibir `401`, o si el `401` llegó con un token recién obtenido, responde `500` como define RF-2.4.7.
- RF-2.4.11.9: EL SISTEMA usa el mismo token de servicio y las mismas reglas en las dos llamadas a M6, la del historial (`GET /trips`, RF-2.4) y la de la verificación del viaje al calificar (`GET /trips/{tripId}`, RF-2.5.13), y nunca reenvía a M6 el token de quien llamó a M2.
- RF-2.4.11.10: EL SISTEMA no verifica la firma ni el contenido del token que entrega Keycloak: solo lee `expires_in` de la respuesta y lo envía a M6, que es quien lo valida.

## Requisitos no funcionales
- RNF-06: EL SISTEMA lee de variables de entorno la URL de tokens de Keycloak, el identificador de cliente y su secreto; el código no trae un valor por defecto para el secreto, y el valor de desarrollo de `grupo-17` aparece solo en los archivos de ejemplo de entorno.
- RNF-07: EL SISTEMA verifica estas reglas con pruebas unitarias, pruebas de integración contra un Keycloak real en contenedor y un M6 simulado que valida los tokens RS256 con el JWKS de ese Keycloak y sigue aceptando el token HS256 de RF-2.4.11.2.
- RNF-07.15: CUANDO corre la prueba de integración distribuida de la spec 081, EL SISTEMA la ejecuta contra un commit del M6 real del Grupo 12 que exige RS256, configurado para validar con nuestro Keycloak, con M2 obteniendo su token por `client_credentials`, y obtiene de M6 una respuesta distinta de `401` y `403`; SI M6 rechaza el token, ENTONCES la prueba falla y muestra el código y el `code` de error de M6. Reemplaza a RNF-07.11 de la spec 081.
- RNF-12: EL SISTEMA se presenta ante M6 con un token firmado por Keycloak con su clave privada, que M6 verifica con la clave pública del emisor, sin compartir ninguna clave con M6.
- RNF-13: CUANDO M2 pide un token a Keycloak, EL SISTEMA corta cada intento al tiempo máximo por intento de RNF-13.1 (spec 003) y reintenta una sola vez tras la pausa de RNF-13.2 ante una falta de disponibilidad, aunque el pedido sea un `POST`, porque no cambia nada en Keycloak; el tiempo total de una operación no supera la suma de los intentos y pausas del pedido de token más los de la llamada a M6, y la repetición de RF-2.4.11.8 suma como máximo un pedido de token y una llamada a M6 más (16,8 s en el peor caso con los valores por defecto).
- RNF-14.14: CUANDO M2 arranca, EL SISTEMA registra una línea que dice si se presenta ante M6 con un token de Keycloak o con el token HS256, sin la URL completa con credenciales ni el secreto.
- RNF-14.15: CUANDO termina un pedido de token a Keycloak, EL SISTEMA registra una línea con el identificador de correlación de la solicitud, el servicio llamado, el código que respondió (o que no respondió), la cantidad de intentos y la duración en milisegundos; CUANDO reutiliza un token guardado, no registra un pedido.
- RNF-19: EL SISTEMA guarda el token obtenido de Keycloak solo en la memoria del proceso, nunca en la base, en Redis, en los logs, en las respuestas ni en las URLs, y tampoco escribe el secreto del cliente en ninguno de esos lugares.
- RNF-20: EL SISTEMA trae las variables de Keycloak para el token de servicio en `ejemplo-keycloak.env` y `ejemplo-front-keycloak.env`, y no en el entorno por defecto ni en el perfil `panel`, que siguen con HS256; documenta en `docs/probar-m2.md` las variables nuevas, cómo levantar M2 con Keycloak para llamar a M6 y cómo comprobar que M6 acepta el token, y en un ADR la decisión que reemplaza al ADR 009 para el token de servicio.

## Contrato y dependencias
- Operaciones del contrato que cubre: ninguna nueva. Cambia cómo M2 llama a M6 dentro de `listarHistorialViajes` y de `calificarConductor`, sin cambios en sus respuestas salvo el `503` y el `500` de RF-2.4.11.6 y RF-2.4.11.7, que ya declara el contrato.
- Operaciones de otros módulos que consume:
  - Keycloak (M1, realm `ds-2026-realm`): endpoint de tokens de OpenID Connect con `grant_type=client_credentials` y el cliente `grupo-17`. Si no responde: RF-2.4.11.6. Si rechaza las credenciales: RF-2.4.11.7.
  - M6: `GET /trips` y `GET /trips/{tripId}`, sin cambios salvo el token (RF-2.4.11.9). Si rechaza el token: RF-2.4.11.8.

## Casos límite
- Keycloak informa un `expires_in` menor que 30 segundos: el token se usa para esa llamada y no se guarda, así que la siguiente llamada pide otro (RF-2.4.11.4, RF-2.4.11.5).
- Diez pedidos al historial llegan juntos y no hay token guardado: M2 hace un solo pedido a Keycloak y los diez usan ese token (RF-2.4.11.5).
- El pedido de token compartido falla: todos los pedidos que lo esperaban reciben la misma respuesta (`503` o `500`), y el siguiente pedido vuelve a intentar.
- Keycloak tarda en el primer intento y responde en el reintento: vale el token del reintento.
- Keycloak responde `200` con un cuerpo que no es JSON o sin `access_token`: es falta de disponibilidad, `503` (RF-2.4.11.6).
- Keycloak cambia sus claves o revoca el token antes de que venza: M6 responde `401`, M2 pide otro y repite una vez (RF-2.4.11.8).
- M6 responde `403` con un token válido (por ejemplo, el rol del cliente `grupo-17` no lo autoriza): `500` sin repetir, como cualquier `4xx` (RF-2.4.7). No se pide otro token, porque uno nuevo tendría los mismos roles.
- M2 arranca con las tres variables y Keycloak está caído: M2 arranca igual y `GET /health` no cambia, porque el token se pide recién al llamar a M6 (RNF-14).
- M2 se reinicia: pierde el token guardado y pide otro en la primera llamada a M6.
- Varias réplicas de M2: cada una pide y guarda su propio token; no se comparte entre réplicas.
- M2 en modo `hs256` para los tokens que recibe y con Keycloak configurado para el token hacia M6: son independientes; el modo de spec 080 no decide cómo M2 se presenta ante M6.
- Keycloak entrega un token que M6 no acepta (por ejemplo, de otro emisor): M6 responde `401`, M2 pide otro y repite una vez; si vuelve el `401`, `500` (RF-2.4.11.8, RF-2.4.11.10).
- Dentro de Docker, el emisor (`iss`) del token es el que ve la máquina (`http://localhost:8080/realms/ds-2026-realm`) y las claves se bajan por la red interna (`keycloak:8080`): M6 compara el emisor con `AUTH_ISSUER` y baja las claves de `AUTH_JWKS_URI`, que son variables distintas.
- La identidad con la que M6 registra a M2 pasa de `m2-clientes` (`sub` del token HS256) a `grupo-17` (`azp` del token de Keycloak). M2 no lo controla ni lo comprueba.

## Fuera de alcance
- Corregir el texto de RF-2.4.11 y de «Fuera de alcance» en la spec 007, de RF-2.5.13 en la 008 y de RNF-07.11 en la 081 para que remitan a esta spec: va por `sdd-change` de cada una después de mergear esta.
- Cambiar cómo M2 valida los tokens que recibe (spec 080) o cómo lo llaman otros módulos.
- Una instancia de Keycloak compartida por el consorcio: no hay acuerdo, y para nuestras pruebas el M6 real valida contra nuestro Keycloak.
- Eliminar el modo HS256 del token hacia M6.
- Rotar el secreto de `grupo-17` o administrar el realm desde M2.
- Guardar el token en Redis o compartirlo entre réplicas.
- Pedir scopes o roles nuevos en Keycloak: M6 autoriza por rol, y la cuenta de servicio de `grupo-17` ya trae `clientes-be`.
- Llamadas de M2 a otros módulos distintos de M6.

## Criterios de finalización
- Con Keycloak configurado, el historial y la calificación funcionan contra el M6 simulado validando RS256, y dos consultas seguidas hacen un solo pedido de token.
- Sin las variables de Keycloak, M2 arranca y llama a M6 con el token HS256 de hoy, y las pruebas existentes siguen en verde.
- Con Keycloak detenido, el historial responde `503` con `Retry-After`, y con un secreto inválido, `500`, sin llamar a M6 en ninguno de los dos casos.
- Ni el token ni el secreto aparecen en los logs de una corrida de pruebas, y la línea de arranque dice con qué token se presenta M2 ante M6.
- Con `ejemplo-keycloak.env` y con `ejemplo-front-keycloak.env`, M2 se presenta ante M6 con el token de Keycloak; con el entorno por defecto y el perfil `panel`, con HS256.
- La prueba de integración con el M6 real (spec 081) pasa contra un commit del Grupo 12 que exige RS256.
- `npm test`, `npm run contrato:test` y `node scripts/spec-check.mjs` en verde.

## Decisiones
- Spec nueva en lugar de `sdd-change` de las specs 007, 008 y 081: el cambio toca a las tres y es una pieza propia (obtener, guardar y renovar el token), así que se implementa y revisa en un solo lugar. Las otras tres se corrigen después con `sdd-change` chicos. Decidido por Lautaro el 2026-11-25. Alternativa descartada: tres `sdd-change` en paralelo, como con el #96.
- Conviven los dos tokens según la configuración (RF-2.4.11.1 y RF-2.4.11.2): con las variables de Keycloak, `client_credentials`; sin ellas, HS256. Así el desarrollo, el perfil `panel` y las pruebas que no levantan Keycloak siguen igual. Decidido por Lautaro el 2026-11-25. Alternativa descartada: solo Keycloak, que obliga a levantarlo en cada prueba que use M6.
- Las fallas de Keycloak se tratan igual que las de M6: falta de disponibilidad, `503` con un reintento; rechazo, `500` sin reintento. Ante un `401` de M6 con un token reutilizado, M2 pide otro y repite una vez. Decidido por Lautaro el 2026-11-25. Alternativa descartada: responder `500` ante cualquier `401`, que deja fallando todos los pedidos hasta que venza el token guardado si Keycloak cambia sus claves.
- El token se reutiliza hasta que le quedan 30 segundos, el mismo margen que la sesión del front (spec 083), y un solo pedido a Keycloak sirve a todos los que esperan. Decidido por Lautaro el 2026-11-25. Alternativa descartada: pedir uno nuevo en cada llamada, que suma una ida y vuelta a Keycloak a cada historial y calificación.
- La prueba contra el M6 real se actualiza en esta spec, con el commit que el Grupo 12 tenga mergeado en su rama de trabajo cuando se implemente esa tarea. Si todavía no lo mergearon, la tarea espera; no se implementa contra una rama suelta. Hasta entonces el CI no se rompe, porque el compose fija el commit del M6 real. Decidido por Lautaro el 2026-11-25.
- M6 valida contra nuestro Keycloak (`AUTH_ISSUER` y `AUTH_JWKS_URI` del M6 apuntando a él), según propuso el Grupo 12 en FRRe-DS/2026-12-TPI#9, porque no hay instancia compartida y un token de una instancia no vale en otra.
- Se acepta que M6 identifique a M2 como `grupo-17` (`azp`) y no como `m2-clientes`, y que lo autorice por el rol `clientes-be` que ya trae la cuenta de servicio, sin pedir el rol `SERVICIO` en el realm.
- Las variables de Keycloak para el token de servicio van en `ejemplo-keycloak.env` y `ejemplo-front-keycloak.env`, que ya levantan Keycloak; el entorno por defecto y el perfil `panel` siguen con HS256, para que el desarrollo diario no cambie y la entrega del front muestre el flujo real. Aceptado por Lautaro en la clarificación del 2026-11-25.
- Si Keycloak no entrega el token, el `503` es genérico (`type: about:blank`), como dice el contrato de M2 cuando M2 no puede obtener la clave del token y como hace la spec 080 (RNF-13.10); no hace falta cambiar el contrato. Aceptado en la clarificación del 2026-11-25.
- M2 no verifica el token que le da Keycloak (RF-2.4.11.10): lo valida M6, que es quien lo recibe, y verificarlo en M2 duplicaría la configuración del emisor sin proteger nada más. Aceptado en la clarificación del 2026-11-25.
- Se acepta el peor caso de 16,8 s con los valores por defecto (RNF-13): solo se da si M6 rechaza un token guardado, y recortarlo complica el código para un caso raro. Aceptado en la clarificación del 2026-11-25.
- Supuesto: el M6 del Grupo 12 acepta el rol `clientes-be` que nuestro realm pone en `roles` y lo mapea a `SYSTEM`. Si responde `403`, se agrega el rol `SERVICIO` a la cuenta de servicio de `grupo-17` en el realm, dentro de esta spec.
- Supuesto: el secreto de desarrollo de `grupo-17` ya está en el realm de la cátedra que tiene el repo (`keycloak/ds-2026-realm-realm.json`); ponerlo en los archivos de ejemplo no expone nada nuevo. Un despliegue real usa otro, por entorno (RNF-06).

## Dudas abiertas
Ninguna.
