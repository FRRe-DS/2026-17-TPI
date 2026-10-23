# Spec 003 — Base del servicio

Estado: implementada
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
- Otros módulos que llamen a M2: según el contrato v1 (ADR 001), M5 y M9, que consultan el estado de cuenta con el rol SERVICIO.

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
  - 400: la solicitud no se puede leer como HTTP, la ruta de la URL está mal codificada, un parámetro de la ruta supera los 100 caracteres, el cuerpo no es JSON válido, o los datos no cumplen el esquema de la operación (en este último caso, el `detail` nombra el campo con problemas);
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
- RNF-03.4: EL SISTEMA expone solo las operaciones de `contrato/openapi.yml`, `GET /health` incluida.
- RNF-03.5: SI una solicitud tiene más de un problema, ENTONCES EL SISTEMA responde por el primero de este orden:
  1. la solicitud no se puede leer, la ruta de su URL está mal codificada o un parámetro de la ruta es demasiado largo (400, 408 o 431);
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
  - Si la señal llega mientras arranca, antes de aceptar solicitudes, deja de arrancar y sale con código 0, sin dejar ninguna migración a medias.

### Datos
- RNF-05.1: EL SISTEMA guarda sus datos solo en su propia base de datos, y el esquema solo cambia mediante migraciones versionadas en el repositorio.
- RNF-05.2: CUANDO arranca, EL SISTEMA aplica en orden las migraciones pendientes antes de aceptar solicitudes, sin repetir las ya aplicadas y una sola vez cada una, aunque dos procesos arranquen al mismo tiempo.
- RNF-05.3: SI la base no responde al arrancar, una migración falla o las migraciones no terminan en 60 segundos, ENTONCES EL SISTEMA no arranca: termina con un código distinto de 0, registra el motivo sin mostrar la contraseña de la base y no deja ninguna migración a medias.

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
  - un tiempo no es un entero entre 1 y 2147483647;
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
- RNF-12.1: EL SISTEMA exige un token en el encabezado `Authorization: Bearer` en todas las operaciones, salvo las que el contrato declare públicas, como `GET /health`.
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
- RNF-14.8: SI una solicitud recibe 503 porque la base de datos u otro módulo no está disponible, ENTONCES EL SISTEMA registra la causa (qué falló al consultar la base, o en el último intento al otro módulo) en una línea con el identificador de correlación de esa solicitud, sin lo que prohíbe RNF-19.1.

### CI, privacidad y documentación
- RNF-17.1: CUANDO se abre o actualiza un pull request hacia `main`, EL SISTEMA ejecuta en CI el build, el lint del código, las pruebas unitarias y de integración y la prueba de contrato, sin omitir ninguno.
- RNF-17.2: SI alguno de esos pasos falla, ENTONCES EL SISTEMA impide mergear el PR (la regla «Protección de main» ya exige esos checks).
- RNF-19.1: EL SISTEMA nunca escribe en los logs el token, el encabezado `Authorization`, la clave de firma ni la contraseña de la base.
- RNF-19.2: EL SISTEMA no registra en los logs los cuerpos de las solicitudes ni de las respuestas, las query strings ni otros encabezados que el de correlación.
- RNF-20.1: EL SISTEMA incluye en el repositorio un README que explica qué hace el servicio, cómo levantarlo, cómo correr las pruebas, cómo generar un token de prueba y qué variables usa, con un diagrama del servicio, su base de datos y los módulos con los que habla.

## Contrato y dependencias
- Operaciones del contrato que cubre: `GET /health` (`verificarSalud`, pública). Las demás operaciones del contrato v1 (#1, ADR 001) llegan con las specs #4 a #8; mientras tanto, la prueba de contrato las informa como pendientes (RNF-07.2).
- `GET /health` fue una excepción temporal fuera del contrato (ADR de la base), que terminó al mergearse el contrato v1: el contrato la declara sin token, en inglés y fuera de `/api/v1/`, y el servicio la registra desde él, como cualquier otra operación.
- Operaciones de otros módulos que consume: ninguna todavía. El cliente para otros módulos se prueba contra un servidor de prueba, y los mocks de M1 y M6 se suman cuando #2 publique sus contratos.
- Acuerdos:
  - Contrato v1 (#1, ADR 001), mergeado: coincide con esta spec en los errores problem+json (con `about:blank` y los `title` en español de los genéricos, «Sin permiso» en el 403 y sin lista de errores por campo en los 400), `GET /health`, `X-Request-Id`, el rol SERVICIO y los 2 s de espera por intento a otro módulo.
  - Token (#9): el ADR 009, todavía en propuesta, le propone al consorcio el formato que esta spec ya usa: HS256 con una clave por entorno, con emisor, audiencia y campo de roles configurables. `sub` identifica a quien llama; cómo se relaciona con el cliente de M2 lo define la spec del perfil (#4). Si el acuerdo final dice otra cosa, se ajusta con /sdd-change.

## Casos límite
- **Token con varios roles:** alcanza con que uno esté permitido para la operación.
- **Token con roles desconocidos o en minúsculas** (`cliente`): se ignoran. Si no queda ninguno conocido, 403.
- **Token sin `exp`, vencido o con `nbf` en el futuro:** 401, con 30 s de tolerancia de reloj.
- **Token firmado con otro algoritmo o sin firma (`alg: none`):** 401.
- **`GET /health` con un token, válido o no:** 200; el token se ignora.
- **Ruta registrada sin declarar si es pública y qué roles admite** (un olvido al programarla): nunca queda abierta. El servicio no arranca con una ruta así, y si alguna escapa a ese control, pide token con cualquier rol conocido, como una operación cuyo contrato no nombra roles (RNF-12.1 y RNF-12.3).
- **Ruta inexistente:** 404 en problem+json, con o sin token.
- **Método que la ruta no tiene** (`POST /health`, `OPTIONS /health`, `TRACE /health` o cualquier otro que Node reconozca): 405 en problem+json con `Allow: GET`, con o sin token.
- **`HEAD` a una ruta que no lo tiene:** 405 con `Allow`, sin cuerpo.
- **`CONNECT`:** Node cierra la conexión sin responder.
- **Solicitud que no se puede leer** (HTTP mal formado, encabezados de más de 16 KiB, o que no termina de llegar a tiempo): 400, 431 o 408 en problem+json, sin `instance`, con un `X-Request-Id` nuevo, y la conexión se cierra. Su línea de log va sin método ni ruta.
- **Pedido HTTP/1.1 sin `Host`:** lo responde Node antes que el servicio, con 400 sin cuerpo, sin `X-Request-Id` y sin línea de log (ver Decisiones).
- **`Expect` desconocido** (`Expect: algo`): se ignora, y la solicitud sigue como cualquier otra.
- **El cliente corta la conexión a mitad del cuerpo, o manda un cuerpo `chunked` mal formado:** no queda como error interno en el log. Si la conexión sigue abierta, recibe el 400 de una solicitud que no se pudo leer.
- **El cliente ya se fue cuando el servicio falla por un corte de su propia conexión con la base o con otro módulo:** es un error del servicio, no un corte del cliente, también si la solicitud no tiene cuerpo o si su cuerpo todavía no terminó de llegar. Sigue el camino de cualquier error: uno no previsto da 500 y deja su línea de error en el log (RNF-03.3), aunque la respuesta ya no llegue a nadie.
- **Ruta mal codificada** (`/clientes/%zz`) **o parámetro de ruta de más de 100 caracteres:** 400 en problem+json.
- **Query string mal codificada** (`?nombre=%zz`): no da 400 por sí sola. El valor llega como está escrito, y lo valida el esquema de la operación.
- **Solicitud que llega durante la parada** por una conexión ya abierta: 503, antes que cualquier otro error.
- **Solicitud sin token y con un cuerpo inválido:** 401, por el orden de RNF-03.5.
- **La base se cae con el servicio corriendo:** `GET /health` y las operaciones que consultan la base responden 503 en 2 s como máximo. Cuando la base vuelve, responden normalmente sin reiniciar el servicio.
- **Muchas solicitudes reciben 503 por la misma caída:** cada una deja en el log su línea con la causa y su propio identificador (RNF-14.8).
- **La base no responde al arrancar, una migración falla o las migraciones no terminan en 60 s:** el servicio no arranca, y `docker compose up --wait` termina con error en menos de 2 minutos, con el motivo en `docker compose logs`.
- **La base corta la conexión en medio de una migración** (por ejemplo, porque se reinicia): es una migración que falla. El servicio no arranca, y el motivo queda en el log como una línea JSON más (RNF-05.3 y RNF-14.5).
- **Un tiempo de espera de más de 2147483647 ms:** el servicio no arranca y nombra la variable, sin mostrar su valor.
- **Dos procesos aplican las migraciones a la vez:** cada migración se aplica una sola vez; el segundo espera al primero, dentro de sus 60 s.
- **Migración mergeada después de otra con fecha más nueva:** se aplica igual, también en una base que ya tiene la más nueva.
- **`X-Request-Id` ausente, vacío, repetido, de más de 128 caracteres o con otros caracteres:** el servicio genera un UUID, y el valor recibido no llega a los logs.
- **Otro módulo responde 5xx, no contesta o devuelve algo que no es JSON:** es falta de disponibilidad. Si la llamada es GET, se reintenta una vez; al final, 503.
- **Otro módulo responde 4xx:** no se reintenta. Qué contesta M2 lo decide la spec de cada operación.
- **Llamada a otro módulo que no es GET:** nunca se reintenta. En TP1, M2 solo lee de otros módulos; las escrituras y su idempotencia llegan con RNF-09, en TP2.
- **Un error interno trae el token o la contraseña de la base en su mensaje:** el log guarda el error sin esos datos (RNF-19.1 manda sobre RNF-03.3).
- **Contrato sin operaciones:** la prueba de contrato corre, informa que no hay operaciones y termina bien.
- **Contrato con operaciones todavía no implementadas:** quedan como pendientes y no hacen fallar la prueba (RNF-07.2).
- **Dos PR verdes que juntos rompen `main`:** lo detecta el CI que corre sobre `main` después de cada merge. No se exige que la rama esté al día con `main`, para no frenar al grupo.
- **Parada del contenedor con solicitudes en curso:** el servicio las termina antes de salir. Si alguna no terminó a los 8 s, la corta, lo registra en el log y sale igual con código 0, en menos de 10 s.
- **Señal de parada mientras el servicio arranca** (por ejemplo, mientras espera el bloqueo de las migraciones de otro proceso): deja de arrancar, lo registra en el log y sale con código 0. La migración que estaba en curso no queda a medias: la base la deshace.

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
- `npm run build`, `npm run lint`, `npm test` y `npm run contrato:test` pasan en local y en CI. Los jobs `build-test` y `contract-test` ya no muestran avisos de «se omite», y el job `contrato` hace el lint del contrato v1.
- Las pruebas de autenticación usan una ruta que existe solo en el código de las pruebas, con tokens del comando de RNF-12.5 o armados por las pruebas, y cubren:
  - cada motivo de 401 de RNF-12.2, con `WWW-Authenticate: Bearer`;
  - 403 por rol no permitido y por token sin roles conocidos;
  - acceso permitido con uno y con varios roles, en el que la ruta recibe el `sub` y los roles del token.
- Las pruebas de errores cubren:
  - cada código de RNF-03.2, con `type: about:blank`, `title` y `detail` en español e `instance` sin query string (salvo en las solicitudes que no se pueden leer), y el 405 con `Allow`;
  - el orden de RNF-03.5;
  - un error no previsto, que responde 500 sin el mensaje interno y deja el error en el log;
  - un duplicado en una tabla que crean solo las pruebas, que responde 409 sin el nombre de la restricción.
- Toda respuesta, también las de error, trae `X-Request-Id`. Uno válido recibido se respeta, y uno inválido se reemplaza por un UUID. El mismo valor aparece en la línea de log de la solicitud y, si respondió 503 por la base o por otro módulo, en la línea con la causa. Ninguna línea de log contiene el token, `Authorization`, la clave, la contraseña de la base, cuerpos ni query strings.
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
  - 405 para todo método que Node reconoce, también los que el framework no trae por defecto, como `PROPFIND`.
  - Parada: 503 a lo que llega mientras se detiene, y a los 8 s se corta lo que siga en curso. Sale igual con código 0: el límite de 10 s manda, y otro código haría parecer una falla una parada pedida.
  - Migraciones: un plazo de 60 s para toda la fase, y se aplican aunque se mergeen fuera del orden de sus fechas, porque #4 a #8 van en paralelo.
  - Un `sub` vacío o que no es texto da 401; una operación sin roles en el contrato admite cualquier rol conocido; un nombre de encabezado de correlación inválido impide arrancar.
- **Cambio del 2026-10-20**, con lo que apareció al implementar los bloques A y B:
  - Los tiempos tienen un tope de 2147483647 ms (2³¹ − 1). Desde 2³¹ ms, unos 24,9 días, los temporizadores de Node disparan casi al instante, y con un tiempo así toda consulta daría 503. Es un límite de la plataforma y no una política: cualquier tiempo razonable sigue valiendo. El responsable delegó la decisión el 2026-10-19.
  - Un pedido HTTP/1.1 sin `Host` queda como excepción de RNF-03.1, RNF-14.4 y RNF-14.6: lo responde Node con el 400 que pide el RFC 9112. Ningún cliente HTTP real omite `Host`, y apagar esa validación de Node obligaría a reimplementarla. Un `Expect` desconocido, en cambio, se ignora, como permite el RFC 9110: así Node no responde un 417 fuera de problem+json. Lo decidió el responsable el 2026-10-19.
  - Que el cliente corte a mitad del cuerpo es un problema de la solicitud, no un error interno, y no se registra como tal (RNF-03.3). Un corte de la base o de otro módulo sigue siendo un error del servicio. Lo decidió el responsable el 2026-10-19.
  - «URL mal codificada» (RNF-03.2 y RNF-03.5) es la ruta. En la query string, lo que no se puede decodificar llega como está escrito, y el esquema de cada parámetro ya valida su valor: un número, una fecha o un UUID mal escritos dan 400. Lo decidió el responsable el 2026-10-20.
  - De la base, se oculta en los logs la contraseña (RNF-05.3 y RNF-19.1). El usuario no es secreto: va en la URL de ejemplo, y ocultar un nombre corto como `m2`, que es también el de la base, desfiguraría los mensajes. Lo decidió el responsable el 2026-10-20.
- **Segundo cambio del 2026-10-20**, con lo que encontró la revisión independiente del bloque F. Lo aprobó el responsable el 2026-10-20:
  - Cuenta como corte del cliente solo el que corta su propia solicitud mientras llega. Una solicitud sin cuerpo no la lee nadie, y Node la da por cortada en cuanto el cliente se va, aunque haya llegado entera. Con el criterio del bloque F, un corte de la base o de otro módulo que coincidía con eso se tomaba como del cliente y no quedaba en el log, contra la decisión del 2026-10-19 (RNF-03.3).
  - Una ruta sin permisos declarados nunca queda abierta. Desde el bloque F, el servicio no arranca con una así, pero ese control solo ve las rutas que se registran después de él. Como segunda capa, una ruta sin permisos pide token como cualquier operación protegida: los bloques que siguen suman rutas, y un olvido no puede abrir ninguna (RNF-12.1).
- **Cambio del 2026-10-22**, con lo que encontraron el bloque C y su revisión independiente, ya con el contrato v1 en `main`. Lo aprobó el responsable el 2026-10-22:
  - Termina la excepción de `GET /health`: el contrato v1 la declara (`verificarSalud`, sin token), y el servicio la registra solo desde el contrato. Conservar el registro a mano como reserva dejaría una ruta fuera del contrato si un contrato no la tuviera, contra la constitución 1, y las pruebas armarían una app distinta del servicio real.
  - Una señal de parada durante el arranque corta el arranque y sale con código 0, igual que la parada del servicio andando: es una parada pedida, y otro código la haría parecer una falla. No hay solicitudes que esperar, y la base deshace la migración que estuviera en curso. Antes salía con 143 (130 con SIGINT), el código que Node da por defecto.
  - La causa de un 503 por la base o por otro módulo queda en el log con el identificador de la solicitud (RNF-14.8). Antes, la de la base quedaba en una línea sin identificador, que con varias solicitudes a la vez no se podía unir con ninguna, y la de otro módulo no quedaba en ningún lado.

## Dudas abiertas
Ninguna. Lo que depende de terceros quedó como supuesto en «Contrato y dependencias».
