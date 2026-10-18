# Tareas 003 — Base del servicio

Spec: [spec.md](spec.md) · Plan: [plan.md](plan.md) · Issue: #3

Tareas de 20-30 minutos, en orden de dependencia. Cada una empieza por sus pruebas en rojo y sigue el plan: el cómo está en la sección que nombra.

Cómo se implementan (lo decidió el integrador el 2026-10-18):
- Un PR de implementación por bloque, cada uno desde su rama (`impl/003-bloque-a`, `impl/003-bloque-b`, …). Cuando A esté en `main`, B, C y D pueden avanzar en paralelo; E va al final.
- En los PR de A a D, la validación cubre solo los requisitos de las tareas del bloque, y la spec sigue «aprobada». La validación completa (Visión general de la guía, Estado «implementada» y commit `003/V`) va en el PR del bloque E.
- T4, T5, T7, T14, T16, T18 y T20 son delicadas (contrato, orden interno de Fastify, concurrencia y red) y van con el modelo más capaz: Opus en Claude Code. Las demás, con Sonnet.

## Bloque A — Proyecto, contrato, errores y logs
Depende de: nada.

- [ ] **T1. Crear el proyecto: `package.json` con las versiones exactas y los scripts del plan, `package-lock.json`, configuración de TypeScript, ESLint y Vitest, y `.gitignore` (plan, Versiones a fijar).** RNF-01.1
  - Hecho cuando: `npm ci`, `npm run build`, `npm run lint` y `npm test` pasan; `pruebas/unitarias/consistencia.test.ts` comprueba que ninguna dependencia de `package.json` usa rangos (`^` o `~`); `src/generado/contrato.ts` se genera solo, y `git status` no muestra `src/generado/` ni `dist/`.
- [ ] **T2. Leer y validar la configuración del entorno: `cargarConfig` y `cargarConfigTokens` (plan, Lógica 1).** RNF-06.1, RNF-06.2
  - Hecho cuando: `pruebas/unitarias/config.test.ts` cubre los valores por defecto, cada valor inválido, cada variable obligatoria que falta y una variable vacía, y ningún mensaje de error contiene el valor recibido.
- [ ] **T3. Armar los errores problem+json: `Problema` y `aProblema` (plan, Lógica 6).** RNF-03.1, RNF-03.2, RNF-03.3
  - Hecho cuando: `pruebas/unitarias/problemas.test.ts` comprueba cada fila de la tabla de Lógica 6: código, `type`, `title` y `detail` en español, `status` igual al código, `instance` sin query string, `Allow` en el 405 y `WWW-Authenticate: Bearer` en el 401; el 500 no trae el mensaje original.
- [ ] **T4. Cargar el contrato y compilar sus esquemas con Ajv 2020: `cargarContrato` y `src/contrato/validacion.ts` (plan, Lógica 7).** RNF-03.2
  - Hecho cuando: `pruebas/unitarias/validacion.test.ts`, con `pruebas/ayudas/contrato-prueba.yml`, compila un esquema por `$ref` al contrato, rechaza un `uuid` y una fecha inválidos, convierte tipos en parámetros, query string y encabezados pero no en el cuerpo, y acepta `example` en un esquema; el contrato de `main`, que solo tiene `info`, carga sin error.
- [ ] **T5. Registrar las operaciones del contrato que tienen manejador: `listarOperaciones`, `registrarOperaciones` y un primer `construirApp` (plan, Contrato).** RNF-03.2, RNF-03.4, RNF-07.2
  - Hecho cuando: `pruebas/http/operaciones.test.ts`, con el contrato de prueba, comprueba que solo responden las operaciones con manejador (las demás dan 404), que una ruta con `{param}` funciona y que un dato inválido da 400 con el campo en el `detail`; `pruebas/unitarias/contrato-test.test.ts` comprueba `listarOperaciones` con un contrato sin operaciones, con pendientes y con implementadas.
- [ ] **T6. Responder los errores genéricos: 404 antes de leer el cuerpo, 413, 415, 400 por JSON roto o vacío y 500 (plan, Lógica 6 y ciclo de una solicitud).** RNF-03.1, RNF-03.2, RNF-03.3
  - Hecho cuando: `pruebas/http/errores.test.ts` obtiene cada uno en problem+json con `instance` sin query string; una ruta inexistente con un cuerpo de más de 1 MiB sigue dando 404, y el 500 no muestra el mensaje interno.
- [ ] **T7. Responder 405 con `Allow` a los métodos que la ruta no tiene, `HEAD`, `OPTIONS`, `TRACE` y `QUERY` incluidos (plan, Lógica 8).** RNF-03.2
  - Hecho cuando: `pruebas/http/errores.test.ts` obtiene 405 en problem+json, con `Allow` igual a los métodos de la ruta, para cada método que falta; un cuerpo de más de 1 MiB con un método que falta sigue dando 405, y una ruta inexistente sigue dando 404.
- [ ] **T8. Tomar o generar el identificador de correlación y devolverlo en cada respuesta (plan, Lógica 2).** RNF-14.3, RNF-14.4
  - Hecho cuando: `pruebas/unitarias/correlacion.test.ts` cubre el id válido, ausente, vacío, de 129 caracteres, repetido y con otros caracteres; `pruebas/http/correlacion-logs.test.ts` comprueba que el encabezado vuelve en respuestas buenas y de error, respetado o reemplazado por un UUID.
- [ ] **T9. Quitar los secretos de los logs y registrar completos los errores internos (plan, Lógica 9).** RNF-19.1, RNF-03.3
  - Hecho cuando: `pruebas/unitarias/secretos.test.ts` comprueba `limpiarSecretos` con la clave, la contraseña de la base y el token; en `pruebas/http/correlacion-logs.test.ts`, un 500 provocado por un error cuyo mensaje trae la clave y el token deja el error en el log, con su id de correlación y sin esos datos.
- [ ] **T10. Registrar una línea JSON por solicitud, sin cuerpos, query strings ni otros encabezados (plan, Lógica 10).** RNF-14.5, RNF-14.6, RNF-19.2
  - Hecho cuando: `pruebas/http/correlacion-logs.test.ts` comprueba que cada solicitud deja una línea JSON con `idCorrelacion`, `metodo`, `ruta`, `estado` y `duracionMs`, y que ninguna línea contiene el valor de `Authorization`, cuerpos, query strings ni el id inválido recibido.

## Bloque B — Autenticación y orden de los errores
Depende de: bloque A.

- [ ] **T11. Validar tokens y generarlos para las pruebas: `verificarToken` y `generarToken` (plan, Lógica 3 y 5).** RNF-12.2, RNF-12.4
  - Hecho cuando: `pruebas/unitarias/tokens.test.ts` cubre cada motivo de 401 de RNF-12.2 con tokens armados por la prueba (otra clave, otro algoritmo, `alg: none`, sin `exp`, vencido, `nbf` futuro, dentro y fuera de los 30 s de tolerancia, sin `sub`, otro `iss` u otra `aud`, roles que no son una lista), el filtro de roles conocidos y la ida y vuelta de `generarToken`; ningún `detail` contiene el token.
- [ ] **T12. Comando de desarrollo que genera un token: `src/herramientas/token.ts` (plan, Lógica 5).** RNF-12.5
  - Hecho cuando: `pruebas/unitarias/tokens.test.ts` invoca el comando con `--sub`, `--roles CLIENTE,OPERADOR` y `--vence 60`, y `verificarToken` acepta lo que imprime, con ese `sub`, esos roles y ese vencimiento; sin `--vence`, el token vence en 3600 s; sin la clave configurada, el comando termina con un código distinto de 0 y nombra la variable.
- [ ] **T13. Exigir token y rol en las operaciones protegidas: hook de permisos y `autorizar` (plan, Lógica 4).** RNF-12.1, RNF-12.3, RNF-12.4
  - Hecho cuando: `pruebas/unitarias/permisos.test.ts` y `pruebas/http/autenticacion.test.ts`, con el contrato de prueba, comprueban que cada 401 lleva `WWW-Authenticate: Bearer`, que un rol no permitido o un token sin roles conocidos da 403, que con uno o con varios roles se accede y el manejador recibe `sub` y roles, y que una operación con `security: []` no pide token.
- [ ] **T14. Respetar el orden de los errores cuando una solicitud tiene varios problemas (plan, ciclo de una solicitud).** RNF-03.5
  - Hecho cuando: `pruebas/http/precedencia.test.ts` comprueba: ruta inexistente, con o sin token → 404; método que la ruta no tiene, con o sin token → 405; sin token y con cuerpo inválido → 401; rol no permitido y cuerpo inválido → 403; con token válido, un cuerpo de más de 1 MiB → 413 y uno de otro tipo → 415, antes que el 400 por datos.

## Bloque C — Base de datos, salud, arranque y parada
Depende de: bloque A (T15 y T16, solo de T1 y T2).

- [ ] **T15. Levantar `postgres:18.6` en las pruebas y aplicar la migración inicial con `migrar()` (plan, Datos).** RNF-05.1, RNF-07.1
  - Hecho cuando: `npm test` crea un único contenedor `postgres:18.6` por corrida y lo descarta al terminar; `pruebas/integracion/migraciones.test.ts` comprueba que `migrar()` aplica la migración inicial y la anota en `migraciones_aplicadas`, y que una segunda corrida no aplica nada.
- [ ] **T16. Migraciones seguras: dos procesos a la vez, una migración que falla y una base que no responde (plan, Datos).** RNF-05.2, RNF-05.3
  - Hecho cuando: `pruebas/integracion/migraciones.test.ts` comprueba que, con dos corridas a la vez, cada migración se aplica una sola vez; que una migración que falla no deja cambios y devuelve el error; y que, con una base que no responde, `migrar()` falla en 2 s más un margen.
- [ ] **T17. Consultar la base con tiempo máximo y clasificar sus errores: `crearPool` y `consultar()` (plan, Datos).** RNF-08.1, RNF-14.2
  - Hecho cuando: `pruebas/integracion/duplicados.test.ts` comprueba que el segundo alta sobre una tabla que crea la prueba da 409 sin el nombre de la restricción, y que una consulta más lenta que el tiempo de base (con `pg_sleep`) da 503 en ese tiempo más un margen.
- [ ] **T18. `GET /health`: 200 con la base arriba, 503 en 2 s con la base caída y 200 de nuevo cuando vuelve (plan, Contrato y Lógica 6).** RNF-14.1, RNF-14.2, RNF-03.4
  - Hecho cuando: `pruebas/integracion/salud.test.ts`, con el proxy TCP de prueba, comprueba 200 con `{"estado": "ok"}`, también con un token inválido; 503 en problem+json en 2 s más un margen con la base colgada, también en una operación de prueba que consulta la base; 503 con la conexión rechazada; 200 cuando la base vuelve, sin reiniciar; `POST /health` → 405 con `Allow: GET`; y que `/health` se registra desde el contrato si tiene `verificarSalud`, y a mano si no.
- [ ] **T19. Arrancar en orden: configuración, migraciones y recién después escuchar, con `arrancar` y `src/servidor.ts` (plan, Lógica 11).** RNF-05.2, RNF-05.3, RNF-06.2, RNF-19.1
  - Hecho cuando: `pruebas/integracion/arranque.test.ts` comprueba que, sin una variable obligatoria, se llama a `salir(1)` y el log nombra la variable sin su valor; que, con la base caída, se llama a `salir(1)` y el log da el motivo sin credenciales; y que en un arranque normal el servicio escucha recién después de migrar y registra en el log las operaciones implementadas y pendientes.
- [ ] **T20. Detenerse en orden ante SIGTERM o SIGINT: `detener()` (plan, Lógica 12).** RNF-04.5
  - Hecho cuando: `pruebas/integracion/parada.test.ts` comprueba que una solicitud en curso termina, que una conexión nueva se rechaza, que una solicitud que llega durante el cierre recibe 503 en problem+json, que el pool se cierra y que `salir(0)` llega antes de 10 s.

## Bloque D — Cliente para otros módulos
Depende de: bloque A (del código, usa solo lo de T3).

- [ ] **T21. Cliente para otros módulos: corte por tiempo, correlación y respuestas 4xx, con `crearClienteModulo` (plan, Integraciones).** RNF-13.1, RNF-14.7, RNF-02.1
  - Hecho cuando: `pruebas/modulos/cliente.test.ts`, contra el servidor de prueba, comprueba que cada intento se corta a tiempo aunque los encabezados lleguen antes, que la llamada lleva el id de la solicitud en curso en el encabezado de correlación, y que un 4xx vuelve con su código y su cuerpo, sin reintento.
- [ ] **T22. Reintentar las lecturas y responder 503 cuando el otro módulo no está disponible (plan, Integraciones).** RNF-13.2, RNF-13.3
  - Hecho cuando: `pruebas/modulos/cliente.test.ts` comprueba que un GET se reintenta una vez a los 200 ms ante un 5xx, una conexión rechazada, un corte o una respuesta que no es JSON; que un POST no se reintenta; que al final da 503 nombrando el módulo; y que, con los valores por defecto, todo termina en no más de 4,2 s.

## Bloque E — Contenedores, prueba de contrato, CI y README
Depende de: bloques B y C. Su PR cierra la spec, así que va después de D.

- [ ] **T23. Imagen del servicio: `Dockerfile` de dos etapas y `.dockerignore` (plan, Configuración, contenedores y CI).** RNF-04.1, RNF-04.2
  - Hecho cuando: `docker build -t m2-clientes:0.1.0 .` termina bien; `docker run --rm --entrypoint whoami m2-clientes:0.1.0` imprime `node`; y `pruebas/unitarias/consistencia.test.ts` comprueba que el `Dockerfile` usa imágenes con versión exacta, nunca `latest`, e instala con `npm ci`.
- [ ] **T24. `docker-compose.yml` con el servicio y su base, y `ejemplo.env` documentado (plan, Configuración, contenedores y CI).** RNF-04.1, RNF-04.3, RNF-04.4, RNF-06.3
  - Hecho cuando: desde un clon limpio, `docker compose up -d --build --wait` termina con los dos servicios sanos y `curl localhost:8082/health` da 200; `M2_PUERTO=9090 docker compose config` muestra 9090; con `M2_CLAVE_TOKENS=corta`, `docker compose up --wait` termina con error en menos de 2 minutos y el motivo está en `docker compose logs m2`; `ejemplo-env.test.ts` y `consistencia.test.ts` comprueban las variables del ejemplo, que la etiqueta de la imagen es la versión de `package.json` y que la imagen de la base es la misma que en las pruebas.
- [ ] **T25. Prueba de contrato de lo implementado: `scripts/contrato-test.mjs` (plan, Contrato).** RNF-07.2
  - Hecho cuando: con el contrato de `main`, `npm run contrato:test` informa que no hay operaciones implementadas y termina con 0; con un contrato de prueba que tiene operaciones sin manejador, las lista como pendientes y termina con 0; y con `pruebas/ayudas/contrato-salud.yml` y el servicio levantado, Schemathesis pasa todos sus chequeos sobre `verificarSalud`.
- [ ] **T26. CI sin pasos omitidos, con salud, prueba de contrato y parada (plan, Configuración, contenedores y CI).** RNF-17.1, RNF-17.2, RNF-04.5
  - Hecho cuando: en el PR, `build-test` y `contract-test` corren todos sus pasos sin avisos de «se omite» (el job `contrato` sigue omitiendo el lint hasta #1); el paso de parada comprueba menos de 10 s y código 0; y `gh api` muestra que la regla «Protección de main» sigue exigiendo los cuatro checks.
- [ ] **T27. README del servicio con diagrama (plan, Configuración, contenedores y CI).** RNF-20.1
  - Hecho cuando: el README explica qué hace el servicio y con qué stack, cómo levantarlo, cómo correr las pruebas, cómo generar un token y qué variables usa; incluye un diagrama Mermaid del servicio, su base y M1, M5, M6 y M9; y cada comando del README se probó tal cual está escrito.
