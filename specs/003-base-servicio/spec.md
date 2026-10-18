# Spec 003 — Base del servicio

Estado: aprobada
Issue: #3
Etapa: TP1
Responsable: @sandobaitt (con @Colomufa y @garciamorenaa)

## Contexto y objetivo
M2 todavía no tiene código. Esta spec construye el esqueleto sobre el que se apoyan todas las demás (#4 a #8):
- el servicio y su base de datos corren en contenedores;
- la configuración llega por entorno;
- hay un endpoint de salud y logs con identificador de correlación;
- se simula la identidad de M1, hay errores con un formato único y un cliente HTTP para llamar a otros módulos sin quedar colgado;
- hay pruebas, y CI las ejecuta.

No agrega funcionalidad de negocio. El stack está justificado en `docs/adr/003-stack.md` (RNF-01), y la cátedra lo aprobó.

Hace falta ahora por tres motivos: las specs de negocio dependen de ella, CI todavía omite build, lint, pruebas y pruebas de contrato porque no hay proyecto, y conviene que estas convenciones se definan una sola vez y no en cada spec.

## Usuarios
- Integrantes del grupo, que desarrollan y prueban el módulo.
- Equipo integrador del consorcio, que levanta y diagnostica los módulos.
- Otros módulos que llamen a M2: según el enunciado, M5 y M9. Lo confirmará el contrato v1 (#1).

## Historias de usuario
- HU-1. Como integrante del grupo, quiero levantar el servicio y su base con un solo comando para desarrollar y probar sin configurar nada a mano.
- HU-2. Como integrante del grupo, quiero generar un token de prueba para cualquier rol para probar operaciones protegidas sin depender de M1.
- HU-3. Como equipo integrador, quiero consultar la salud del servicio para saber si está listo y si su base responde.
- HU-4. Como quien diagnostica una falla, quiero seguir una solicitud por su identificador en los logs para encontrar dónde falló.
- HU-5. Como módulo que consume M2, quiero que todos los errores tengan el mismo formato para tratarlos igual en todas las operaciones.

## Requisitos funcionales
Ninguno: esta spec no agrega funcionalidad de negocio. Los RF-2.x llegan con las specs #4 a #8.

## Requisitos no funcionales

### Stack y límites del módulo
- RNF-01.1: EL SISTEMA usa el lenguaje, el framework y la base de datos que justifica el ADR del stack (`docs/adr/003-stack.md`).
- RNF-02.1: EL SISTEMA se levanta y se prueba sin que otros módulos estén corriendo: lo que necesita de ellos lo pide por sus APIs y, en las pruebas, a servidores simulados.

### Errores y contrato
- RNF-03.1: SI una solicitud termina en error (código 4xx o 5xx), ENTONCES EL SISTEMA responde con `Content-Type: application/problem+json` y un cuerpo con `type`, `title`, `status` (igual al código HTTP), `detail` e `instance` (la ruta de la solicitud, sin la query string), con `title` y `detail` en español.
  - La respuesta a un `HEAD` va sin cuerpo, porque HTTP no lo permite.
  - Si la solicitud no se pudo leer, el cuerpo va sin `instance`.
- RNF-03.2: EL SISTEMA usa `type: "about:blank"` en los errores genéricos, que son los que no tienen un `type` propio en el contrato, con estos códigos:
  - 400: la solicitud no se puede leer como HTTP, la URL está mal codificada, un parámetro de la ruta supera los 100 caracteres, el cuerpo no es JSON válido, o los datos no cumplen el esquema de la operación (en este último caso, el `detail` nombra el campo con problemas);
  - 401: falta autenticación válida (RNF-12.2);
  - 403: falta permiso (RNF-12.3);
  - 404: no hay una operación expuesta con esa ruta;
  - 405: la ruta existe, pero no con ese método; la respuesta trae el encabezado `Allow` con los métodos de la ruta;
  - 408: la solicitud no terminó de llegar a tiempo;
  - 409: la operación choca con datos que ya existen (RNF-08.1);
  - 413: el cuerpo supera 1 MiB;
  - 415: el cuerpo trae un `Content-Type` que no es `application/json`;
  - 431: los encabezados de la solicitud superan 16 KiB;
  - 500: error interno (RNF-03.3);
  - 503: la base de datos u otro módulo no está disponible (RNF-13.3 y RNF-14.2), o el servicio se está deteniendo (RNF-04.5).
- RNF-03.3: SI ocurre un error no previsto, ENTONCES EL SISTEMA responde 500 sin mensajes internos, trazas de pila ni consultas a la base, y registra el error completo en el log con el identificador de correlación, quitando lo que prohíbe RNF-19.1.
- RNF-03.4: EL SISTEMA expone solo las operaciones de `contrato/openapi.yml` y, como excepción temporal registrada en un ADR, `GET /health`.
- RNF-03.5: SI una solicitud tiene más de un problema, ENTONCES EL SISTEMA responde por el primero de este orden:
  1. la solicitud no se puede leer, su URL está mal codificada o un parámetro de la ruta es demasiado largo (400, 408 o 431);
  2. el servicio se está deteniendo (503);
  3. 404 o 405;
  4. 401;
  5. 403;
  6. 413 o 415;
  7. 400 por el cuerpo o los datos.

### Contenedores
- RNF-04.1: EL SISTEMA usa solo imágenes OCI con versión exacta (la versión completa del producto, como `node:24.22.0-trixie-slim` o `postgres:18.6`; nunca `latest` ni solo la versión mayor): la base de la imagen del servicio, la de la base de datos y la que levantan las pruebas de integración, que es la misma que la de docker compose.
- RNF-04.2: EL SISTEMA instala las dependencias de la imagen del servicio exactamente según el archivo de bloqueo.
- RNF-04.3: EL SISTEMA etiqueta la imagen del servicio con la versión declarada en el proyecto (0.1.0 al cerrar esta spec).
- RNF-04.4: CUANDO se ejecuta `docker compose up -d --build --wait` en un clon limpio, sin crear ni editar archivos, EL SISTEMA levanta el servicio y su base de datos con la configuración de ejemplo, y el comando termina recién cuando los dos están sanos.
- RNF-04.5: CUANDO el servicio recibe la señal de parada, EL SISTEMA deja de aceptar solicitudes nuevas, espera a que terminen las que están en curso, cierra la conexión a la base y sale con código 0, todo en menos de 10 segundos.
  - Una solicitud que llega durante la parada por una conexión ya abierta recibe 503.
  - Una solicitud que no terminó a los 8 segundos de la señal se corta y queda registrada en el log.

### Datos
- RNF-05.1: EL SISTEMA guarda sus datos solo en su propia base de datos, y el esquema solo cambia mediante migraciones versionadas en el repositorio.
- RNF-05.2: CUANDO arranca, EL SISTEMA aplica en orden las migraciones pendientes antes de aceptar solicitudes, sin repetir las ya aplicadas y una sola vez cada una, aunque dos procesos arranquen al mismo tiempo.
- RNF-05.3: SI la base no responde al arrancar, una migración falla o las migraciones no terminan en 60 segundos, ENTONCES EL SISTEMA no arranca: termina con un código distinto de 0, registra el motivo sin mostrar credenciales y no deja ninguna migración a medias.

### Configuración
- RNF-06.1: EL SISTEMA toma su configuración de estas variables de entorno, y usa el valor por defecto cuando una opcional no está definida:

| Qué configura | Obligatoria | Por defecto |
|---|---|---|
| Conexión a la base (URL con usuario y contraseña) | sí | — |
| Puerto de escucha | no | 8082 |
| Clave de los tokens (firma y validación) | sí | — |
| Emisor esperado de los tokens (`iss`) | sí | — |
| Audiencia esperada de los tokens (`aud`) | sí | — |
| Campo del token con los roles | no | `roles` |
| Tiempo máximo de espera a la base, en ms | no | 2000 |
| Tiempo máximo por intento a otro módulo, en ms | no | 2000 |
| Reintentos de una lectura a otro módulo | no | 1 |
| Nombre del encabezado de correlación | no | `X-Request-Id` |

Las URLs de otros módulos se suman con la spec que los use por primera vez.

- RNF-06.2: SI al arrancar falta una variable obligatoria o alguna tiene un valor inválido, ENTONCES EL SISTEMA no arranca, termina con un código distinto de 0 y registra el nombre de cada variable con problemas, sin mostrar su valor. Un valor es inválido si:
  - el puerto no es un entero entre 1 y 65535;
  - un tiempo no es un entero mayor que 0;
  - los reintentos no son un entero entre 0 y 5;
  - la conexión a la base no es una URL `postgres://` o `postgresql://`;
  - la clave tiene menos de 32 caracteres;
  - el nombre del encabezado de correlación no es un nombre de encabezado HTTP válido.
- RNF-06.3: EL SISTEMA incluye en el repositorio un archivo de ejemplo documentado, con todas las variables y valores que sirven solo para desarrollo; docker compose lo usa por defecto, y una variable definida en el entorno tiene prioridad sobre el ejemplo.

### Pruebas y concurrencia
- RNF-07.1: EL SISTEMA tiene pruebas unitarias y de integración que corren con `npm test`; las de integración usan una base de datos real en un contenedor que se crea y se descarta en cada corrida.
- RNF-07.2: SI el contrato tiene operaciones que el servicio todavía no implementa, ENTONCES EL SISTEMA las informa como pendientes en la prueba de contrato y no falla por ellas; con el contrato sin operaciones, la prueba termina bien e informa que no hay nada para probar.
- RNF-08.1: SI una escritura choca con una restricción única de la base, ENTONCES EL SISTEMA responde 409 en problem+json, sin exponer el nombre de la restricción ni la consulta.

### Autenticación y autorización
- RNF-12.1: EL SISTEMA exige un token en el encabezado `Authorization: Bearer` en todas las operaciones, salvo `GET /health` y las que el contrato declare públicas.
- RNF-12.2: SI una operación protegida recibe un token que no es válido, ENTONCES EL SISTEMA responde 401 en problem+json, con el encabezado `WWW-Authenticate: Bearer` y un `detail` que dice el motivo sin repetir el token. Un token no es válido si:
  - falta o está mal formado;
  - no está firmado con HS256 y la clave configurada (por ejemplo, usa otro algoritmo o no tiene firma);
  - no tiene `exp`, ya venció o tiene `nbf` en el futuro, con 30 segundos de tolerancia de reloj;
  - no tiene `sub`, o lo tiene vacío o con algo que no es texto;
  - su `iss` o su `aud` no son los configurados;
  - el campo de roles existe pero no es una lista de textos.
- RNF-12.3: SI el token es válido pero ninguno de sus roles conocidos está permitido para la operación, ENTONCES EL SISTEMA responde 403 en problem+json.
  - Los roles conocidos son CLIENTE, CONDUCTOR, OPERADOR y SERVICIO (otro módulo que llama a M2), escritos exactamente así; los demás se ignoran.
  - Un token sin el campo de roles, o con la lista vacía, no tiene ninguno.
  - Una operación cuyo contrato no nombra roles admite cualquiera de los roles conocidos.
- RNF-12.4: EL SISTEMA identifica a quien llama por el `sub` del token y sus roles por el campo configurado.
- RNF-12.5: EL SISTEMA incluye un comando de desarrollo que genera un token firmado con la clave, el emisor y la audiencia configurados, con el `sub` y los roles (uno o varios) que se le indiquen y un vencimiento en segundos (3600 por defecto).

### Llamadas a otros módulos
- RNF-13.1: CUANDO el servicio llama a otro módulo, EL SISTEMA corta cada intento si la respuesta completa no llegó en el tiempo configurado (2 s por defecto).
- RNF-13.2: SI un intento de una llamada GET falla por falta de disponibilidad (sin respuesta a tiempo, conexión rechazada o cortada, un código 5xx o una respuesta que no es JSON cuando se espera JSON), ENTONCES EL SISTEMA lo reintenta hasta la cantidad configurada (1 por defecto) tras una pausa de 200 ms; las llamadas con otros métodos no se reintentan.
- RNF-13.3: SI el otro módulo sigue sin estar disponible después de los intentos permitidos, ENTONCES EL SISTEMA responde 503 en problem+json, nombra en `detail` el módulo que falló y no espera en total más que la suma de los intentos y las pausas (4,2 s con los valores por defecto).

### Salud, logs y correlación
- RNF-14.1: CUANDO recibe `GET /health`, EL SISTEMA comprueba que la base de datos responde y contesta 200 con `{"estado": "ok"}`, sin pedir token e ignorando el que venga.
- RNF-14.2: SI la base de datos no responde dentro del tiempo configurado (2 s por defecto), ENTONCES EL SISTEMA contesta 503 en problem+json, tanto en `GET /health` como en cualquier operación que la consulte, sin esperar más que ese tiempo.
- RNF-14.3: CUANDO llega una solicitud, EL SISTEMA usa como identificador de correlación el valor del encabezado configurado (`X-Request-Id` por defecto) si tiene de 1 a 128 caracteres de letras, números, `.`, `_` y `-`; si no viene o no cumple, genera un UUID nuevo.
- RNF-14.4: EL SISTEMA devuelve el identificador de correlación en el mismo encabezado de cada respuesta, también en las de error.
- RNF-14.5: EL SISTEMA escribe sus logs en JSON, en la salida estándar, una línea por evento.
- RNF-14.6: CUANDO termina una solicitud, EL SISTEMA registra una línea con el identificador de correlación, el método, la ruta sin query string, el código de respuesta y la duración en milisegundos.
- RNF-14.7: CUANDO el servicio llama a otro módulo, EL SISTEMA envía el identificador de correlación de la solicitud en curso, en el mismo encabezado.

### CI, privacidad y documentación
- RNF-17.1: CUANDO se abre o actualiza un pull request hacia `main`, EL SISTEMA ejecuta en CI el build, el lint del código, las pruebas unitarias y de integración y la prueba de contrato, sin omitir ninguno.
- RNF-17.2: SI alguno de esos pasos falla, ENTONCES EL SISTEMA impide mergear el PR (la regla «Protección de main» ya exige esos checks).
- RNF-19.1: EL SISTEMA nunca escribe en los logs el token, el encabezado `Authorization`, la clave de firma ni las credenciales de la base.
- RNF-19.2: EL SISTEMA no registra en los logs los cuerpos de las solicitudes ni de las respuestas, las query strings ni otros encabezados que el de correlación.
- RNF-20.1: EL SISTEMA incluye en el repositorio un README que explica qué hace el servicio, cómo levantarlo, cómo correr las pruebas, cómo generar un token de prueba y qué variables usa, con un diagrama del servicio, su base de datos y los módulos con los que habla.

## Contrato y dependencias
- Operaciones del contrato que cubre: ninguna. `contrato/openapi.yml` solo tiene `info`, y sus operaciones llegan con el contrato v1 (#1).
- Excepción temporal, `GET /health`:
  - Queda fuera del contrato como ruta operativa. Por eso va en inglés y fuera de `/api/v1/`: la constitución 7 deja los términos técnicos en inglés.
  - Choca con la constitución 1 («nada se expone fuera de él»). El plan la registra en un ADR, y aprobar el PR de esta spec es la aceptación del grupo.
  - Termina cuando se mergea el contrato v1 (#1). Si el contrato incluye la ruta, pasa a ser una operación más. Si la nombra distinto o no la incluye, el servicio se ajusta al contrato con /sdd-change.
- Operaciones de otros módulos que consume: ninguna todavía. El cliente para otros módulos se prueba contra un servidor de prueba, y los mocks de M1 y M6 se suman cuando #2 publique sus contratos.
- Supuestos mientras no haya acuerdos. Si un acuerdo dice otra cosa, se ajusta con /sdd-change:
  - Token (#9): HS256 con una clave por entorno, con emisor, audiencia y campo de roles configurables. `sub` identifica a la persona en M1; cómo se relaciona con el cliente de M2 lo define la spec del perfil (#4).
  - Convenciones que el borrador del contrato v1 (#1, PR #16) propone al Grupo 1, que implementa el mismo módulo, y al consorcio: errores problem+json con `about:blank` para los genéricos, `GET /health`, `X-Request-Id`, rol SERVICIO, puerto 8082 y 2 s de espera entre módulos. El borrador todavía difiere de esta spec en tres puntos, a corregir en el PR #16: responde 400 a un `X-Request-Id` inválido (acá se reemplaza, RNF-14.3), sus `title` están en inglés (acá, en español, RNF-03.1) y no lista el 405 entre los genéricos (RNF-03.2).

## Casos límite
- **Token con varios roles:** alcanza con que uno esté permitido para la operación.
- **Token con roles desconocidos o en minúsculas** (`cliente`): se ignoran. Si no queda ninguno conocido, 403.
- **Token sin `exp`, vencido o con `nbf` en el futuro:** 401, con 30 s de tolerancia de reloj.
- **Token firmado con otro algoritmo o sin firma (`alg: none`):** 401.
- **`GET /health` con un token, válido o no:** 200; el token se ignora.
- **Ruta inexistente:** 404 en problem+json, con o sin token.
- **Método que la ruta no tiene** (`POST /health`, `OPTIONS /health`, `TRACE /health` o cualquier otro que Node reconozca): 405 en problem+json con `Allow: GET`, con o sin token.
- **`HEAD` a una ruta que no lo tiene:** 405 con `Allow`, sin cuerpo.
- **`CONNECT`:** Node cierra la conexión sin responder.
- **Solicitud que no se puede leer** (HTTP mal formado, encabezados de más de 16 KiB, o que no termina de llegar a tiempo): 400, 431 o 408 en problem+json, sin `instance`, con un `X-Request-Id` nuevo, y la conexión se cierra. Su línea de log va sin método ni ruta.
- **URL mal codificada o parámetro de ruta de más de 100 caracteres:** 400 en problem+json.
- **Solicitud que llega durante la parada** por una conexión ya abierta: 503, antes que cualquier otro error.
- **Solicitud sin token y con un cuerpo inválido:** 401, por el orden de RNF-03.5.
- **La base se cae con el servicio corriendo:** `GET /health` y las operaciones que consultan la base responden 503 en 2 s como máximo. Cuando la base vuelve, responden normalmente sin reiniciar el servicio.
- **La base no responde al arrancar, una migración falla o las migraciones no terminan en 60 s:** el servicio no arranca, y `docker compose up --wait` termina con error en menos de 2 minutos, con el motivo en `docker compose logs`.
- **Dos procesos aplican las migraciones a la vez:** cada migración se aplica una sola vez; el segundo espera al primero, dentro de sus 60 s.
- **Migración mergeada después de otra con fecha más nueva:** se aplica igual, también en una base que ya tiene la más nueva.
- **`X-Request-Id` ausente, vacío, repetido, de más de 128 caracteres o con otros caracteres:** el servicio genera un UUID, y el valor recibido no llega a los logs.
- **Otro módulo responde 5xx, no contesta o devuelve algo que no es JSON:** es falta de disponibilidad. Si la llamada es GET, se reintenta una vez; al final, 503.
- **Otro módulo responde 4xx:** no se reintenta. Qué contesta M2 lo decide la spec de cada operación.
- **Llamada a otro módulo que no es GET:** nunca se reintenta. En TP1, M2 solo lee de otros módulos; las escrituras y su idempotencia llegan con RNF-09, en TP2.
- **Un error interno trae el token o la contraseña de la base en su mensaje:** el log guarda el error sin esos datos (RNF-19.1 manda sobre RNF-03.3).
- **Contrato sin operaciones (como hoy):** la prueba de contrato corre, informa que no hay operaciones y termina bien.
- **Contrato con operaciones todavía no implementadas:** quedan como pendientes y no hacen fallar la prueba (RNF-07.2).
- **Dos PR verdes que juntos rompen `main`:** lo detecta el CI que corre sobre `main` después de cada merge. No se exige que la rama esté al día con `main`, para no frenar al grupo.
- **Parada del contenedor con solicitudes en curso:** el servicio las termina antes de salir. Si alguna no terminó a los 8 s, la corta, lo registra en el log y sale igual con código 0, en menos de 10 s.

## Fuera de alcance
- Operaciones de negocio (perfil, direcciones, preferencias, historial y calificación): specs #4 a #8.
- Mocks de M1 y M6 en docker compose: llegan cuando #2 publique sus contratos.
- M1 real, validación con JWKS o clave pública y revocación de tokens: #9 y RF-1.5. Si #9 elige JWKS, se suma con /sdd-change.
- Cómo emite M1 los tokens con rol SERVICIO y qué credencial manda M2 cuando llama a otro módulo: #9 y #2. Mientras tanto, M2 no envía credenciales a otros módulos.
- HTTPS, CORS, límites de tasa y controles de vulnerabilidades web: RNF-12, en TP2-TP3.
- `Idempotency-Key` y escrituras a otros módulos: RNF-09, en TP2.
- Configuración de entornos publicados, con claves y contraseñas reales: TP3. Los valores del ejemplo sirven solo para desarrollo.
- Publicación de imágenes en un registro: RNF-17, recomendada en TP2-TP3.
- Mensajería, caché, métricas y trazas distribuidas.

## Criterios de finalización
- `docker compose up -d --build --wait` levanta el servicio y la base desde un clon limpio, sin crear ni editar archivos, y `GET /health` responde 200 con `{"estado": "ok"}`.
- Con la base detenida, `GET /health` responde 503 en problem+json en no más de 2 segundos de espera a la base. Al volver la base, responde 200 sin reiniciar el servicio.
- `npm run build`, `npm run lint`, `npm test` y `npm run contrato:test` pasan en local y en CI. Los jobs `build-test` y `contract-test` ya no muestran avisos de «se omite»; el job `contrato` sigue omitiendo el lint del contrato hasta #1.
- Las pruebas de autenticación usan una ruta que existe solo en el código de las pruebas, con tokens del comando de RNF-12.5 o armados por las pruebas, y cubren:
  - cada motivo de 401 de RNF-12.2, con `WWW-Authenticate: Bearer`;
  - 403 por rol no permitido y por token sin roles conocidos;
  - acceso permitido con uno y con varios roles, en el que la ruta recibe el `sub` y los roles del token.
- Las pruebas de errores cubren:
  - cada código de RNF-03.2, con `type: about:blank`, `title` y `detail` en español e `instance` sin query string (salvo en las solicitudes que no se pueden leer), y el 405 con `Allow`;
  - el orden de RNF-03.5;
  - un error no previsto, que responde 500 sin el mensaje interno y deja el error en el log;
  - un duplicado en una tabla que crean solo las pruebas, que responde 409 sin el nombre de la restricción.
- Toda respuesta, también las de error, trae `X-Request-Id`. Uno válido recibido se respeta, y uno inválido se reemplaza por un UUID. El mismo valor aparece en la línea de log de la solicitud. Ninguna línea de log contiene el token, `Authorization`, la clave, la contraseña de la base, cuerpos ni query strings.
- El cliente para otros módulos, probado contra un servidor de prueba:
  - corta a los 2 s aunque los encabezados lleguen antes;
  - reintenta una vez solo en GET, ante un 5xx o sin respuesta, y nunca ante un 4xx;
  - termina en 503 nombrando el módulo, en no más de 4,2 s;
  - envía el `X-Request-Id` de la solicitud.
- Arrancar sin una variable obligatoria, o con un valor inválido, termina con un código distinto de 0 y nombra cada variable sin su valor. Con la base caída, el servicio tampoco arranca.
- Hay una migración inicial, sin tablas de negocio. Aplicar las migraciones dos veces, o desde dos procesos a la vez, la deja aplicada una sola vez.
- Las imágenes usan versiones exactas, también la de las pruebas, y la del servicio lleva la etiqueta 0.1.0. `docker compose stop` detiene el servicio en menos de 10 s, con código 0.
- El README explica cómo levantar el servicio, cómo probarlo, cómo generar un token y cómo configurarlo, nombra el stack de `docs/adr/003-stack.md` e incluye el diagrama de componentes.

## Decisiones
Se tomaron al clarificar, el 2026-10-15: el responsable delegó la resolución, y cada una se puede discutir en el PR de spec.
- **Valores de desarrollo en el repositorio.** El archivo de ejemplo trae una clave y una contraseña que solo sirven en desarrollo, y docker compose las usa por defecto. Así un clon limpio y CI levantan todo con un comando, y el repositorio no guarda nada que proteja un entorno real.
- **Tiempos y reintentos con valor por defecto** (2 s y 1 reintento): se ajustan con el consorcio sin tocar código.
- **Tokens HS256 con una sola clave de 32 caracteres o más**, el mínimo que pide el estándar para HS256. Es lo más simple mientras no exista M1. Cualquier otro algoritmo se rechaza, para que nadie pueda armar un token sin la clave.
- **Todo token tiene que vencer**, con 30 s de tolerancia por relojes desfasados.
- **Más errores genéricos:** se suman 409 (duplicados, RNF-08), 413 y 415, y el 400 cubre también los datos que no cumplen el esquema. Todos usan `about:blank`. Un error con `type` propio en el contrato no es genérico: el borrador del contrato v1 (PR #16) lo usa en algunos 409 y 422 y en el 503 de M6, y lo define la spec de cada operación (2026-10-18).
- **405 con `Allow` para un método que la ruta no tiene, y 404 solo para la ruta que no existe**, `HEAD` y `OPTIONS` incluidos (2026-10-18; antes era 404 para todo). La prueba de contrato espera 405 por defecto, RFC 9110 lo pide, y AGENTS.md prohíbe desactivar un chequeo para que pase CI. No expone nada nuevo: los métodos de cada ruta ya están en el contrato.
- **Orden de los errores** (404 o 405, 401, 403, cuerpo, datos): un cuerpo nunca se procesa sin autenticar.
- **Logs sin datos personales:** sin cuerpos ni query strings, y `instance` también va sin query string. Ante un error interno, el log guarda el detalle completo menos los secretos (manda RNF-19.1).
- **La base también tiene tiempo máximo en las operaciones** (2 s, como la salud), porque la constitución 5 lo pide para toda llamada externa.
- **Migraciones al arrancar**, antes de aceptar solicitudes. Si la base no responde o una migración falla, el servicio no arranca: es más fácil de diagnosticar que un servicio a medias.
- **Cliente para otros módulos:**
  - Los 2 s cuentan hasta la respuesta completa.
  - Cuentan como falta de disponibilidad un 5xx, la falta de respuesta y una respuesta que no es JSON. Es la propuesta de la duda abierta, ampliada.
  - Un 4xx no se reintenta.
  - Con los valores por defecto, M2 espera como mucho 4,2 s.
- **`X-Request-Id` inválido:** se acepta la propuesta de la duda abierta (hasta 128 caracteres de letras, números, `.`, `_` y `-`; si no cumple, un UUID nuevo).
- **La prueba de contrato prueba solo lo implementado**, para que el contrato v1 no bloquee todos los PR mientras se hacen #4 a #8.
- **Se suman RNF-01, RNF-02 y RNF-08**, que son de TP1, y un diagrama en el README (RNF-20).
- **Supuestos mientras no haya acuerdos:** el token HS256 y las convenciones que se proponen para el contrato v1, rol SERVICIO incluido. Están en «Contrato y dependencias», y si un acuerdo dice otra cosa, se ajusta con /sdd-change. El stack (`docs/adr/003-stack.md`) dejó de ser supuesto: la cátedra lo aprobó, según informó el integrador el 2026-10-18.
- **Quedan para #9 y #2:** JWKS, credenciales de servicio y qué credencial manda M2 a otros módulos. Dependen de acuerdos que todavía no existen.
- **Ramas al día con `main`:** no se exige. El CI sobre `main` detecta si dos PR rompen algo al juntarse.
- **Revisión independiente del 2026-10-18, antes del PR de spec:**
  - Los errores que el framework responde antes de leer la solicitud (HTTP mal formado, encabezados demasiado grandes, solicitud que no termina de llegar, URL mal codificada o parámetro de ruta largo) también van en problem+json. Se suman 408 y 431 a los genéricos, y el parámetro largo da 400 y no 414, que el contrato no documenta.
  - 405 para todo método que Node reconoce, también los que el framework no trae por defecto, como `TRACE`.
  - Parada: 503 a lo que llega mientras se detiene, y a los 8 s se corta lo que siga en curso. Sale igual con código 0: el límite de 10 s manda, y otro código haría parecer una falla una parada pedida.
  - Migraciones: un plazo de 60 s para toda la fase, y se aplican aunque se mergeen fuera del orden de sus fechas, porque #4 a #8 van en paralelo.
  - Un `sub` vacío o que no es texto da 401; una operación sin roles en el contrato admite cualquier rol conocido; un nombre de encabezado de correlación inválido impide arrancar.

## Dudas abiertas
Ninguna. Lo que depende de terceros quedó como supuesto en «Contrato y dependencias».
