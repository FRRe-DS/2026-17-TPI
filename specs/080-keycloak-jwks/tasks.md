# Tareas — Spec 080 M2 valida tokens de Keycloak (JWKS y scope) y compose con Keycloak

Orden de dependencia, en tres tramos. Cada tarea es un commit `080/Tn: …`, con las pruebas primero. Al terminar cada tramo hay algo que se puede ver funcionando: A, M2 validando tokens RS256 y exigiendo scopes, con claves de prueba; B, Keycloak levantado con compose y M2 atendiendo sus tokens; C, documentación y el escenario de scope. Son más de 10 tareas, y @sandobaitt decidió no dividir la spec (2026-11-07): es una sola entrega.

**Cómo se cierra.** Solo T18 espera a otro: a que se mergee #79, que depende del Grupo 1. Si #79 no se mergeó al terminar T17, el PR «Impl 080» lleva T1 a T17, con la validación de lo hecho y `Estado: aprobada`. T18 va después en otra rama, `impl/080-escenario-scope`, desde `main` actualizado, y recién ahí la spec pasa a `implementada`, con la «Visión general» de la guía. Si #79 llega antes, T18 va en la misma rama.

## Tramo A — M2, sin Keycloak real

- [x] **T1. Configuración del modo de tokens.** RNF-06.7, RNF-06.9
  - Hecho cuando: `pruebas/unitarias/config.test.ts` comprueba que sin variables el modo es `hs256`, que acepta `hs256` y `jwks`, que otro valor da un error que nombra `M2_MODO_TOKENS` sin repetir el valor, que en modo `jwks`, si falta `M2_URL_JWKS`, da un error que la nombra, que esa URL cumple la regla `urlHttp` (con usuario y contraseña se rechaza), y que `M2_CLAVE_TOKENS` sigue obligatoria en los dos modos; `ejemplo.env` tiene las dos variables, cada una con su comentario arriba y la forma `VARIABLE=${VARIABLE:-valor}`, y `pruebas/unitarias/ejemplo-env.test.ts` las acepta; `CONFIG` de `pruebas/ayudas/app.ts` usa `hs256`.

- [x] **T2. Validar tokens RS256 con un JWKS.** RNF-12.11, RNF-12.12, RNF-07.12
  - Hecho cuando: `pruebas/unitarias/tokens-jwks.test.ts`, con una clave generada por la prueba y un JWKS servido por `servidor-modulo.ts`, comprueba que un token RS256 válido devuelve `sub`, roles y scopes; que un rol repetido no cambia nada; que el JWKS con una clave `enc` además de la de firma no molesta; que da `401` con el motivo de RNF-12.2 por vencido, por `nbf`, por emisor, por audiencia, por firma de otra clave y por `sub` inválido; que da `401` con alg `none` y con un HS256 firmado con `M2_CLAVE_TOKENS`, sin hacer ningún pedido al JWKS; y que `scope` vacío o ausente da una lista vacía y uno que no es texto da `401`.

- [x] **T3. `kid` desconocido.** RNF-12.16, RNF-12.19, RNF-07.12
  - Hecho cuando: `pruebas/unitarias/tokens-jwks.test.ts` comprueba que un `kid` desconocido pide las claves de nuevo y, si no aparece, da `401`, sin otro pedido dentro de los 30 s; que pasados los 30 s (con el reloj falso de Vitest) se vuelve a pedir; y que, si el JWKS publica una clave nueva, un token con ese `kid` se acepta sin reiniciar.

- [x] **T4. Keycloak caído, sin claves.** RNF-13.10, RNF-07.12
  - Hecho cuando: `pruebas/unitarias/claves-jwks.test.ts` comprueba que un JWKS colgado corta en `tiempoModulosMs` por intento y hace `1 + reintentosModulos` intentos, con 200 ms de pausa solo entre intentos; que uno con `5xx` o con un documento inválido da `ModuloNoDisponible` con `Retry-After` y la causa; que diez solicitudes juntas sin claves hacen un solo pedido por intento; y que `precargar` nunca lanza y devuelve el motivo.

- [x] **T5. Keycloak caído, con claves guardadas.** RNF-13.10, RNF-13.11, RNF-13.13, RNF-07.12
  - Hecho cuando: `pruebas/unitarias/claves-jwks.test.ts` comprueba que con la clave ya obtenida un JWKS caído no impide validar, también pasados los 10 minutos del valor por defecto de `jose` (con el reloj falso de Vitest); que cuando el JWKS vuelve se obtienen las claves faltantes; y que, con el JWKS caído, un `kid` inventado da `401` sin ningún pedido dentro de los 30 s de la última obtención, y `503` con `1 + reintentosModulos` pedidos pasado ese plazo.

- [x] **T6. M2 usa el verificador según el modo.** RNF-12.11, RNF-12.15, RNF-12.18, RNF-07.12
  - Hecho cuando: `pruebas/http/autenticacion-jwks.test.ts` comprueba, con la app armada en modo `jwks`, que un token válido llega al manejador con su identidad; que sin token, o con uno inválido, responde `401` en `problem+json` con `WWW-Authenticate: Bearer`, sin repetir el token en el `detail`; que con el JWKS caído y sin claves responde `503` genérico (`type: about:blank`) con `Retry-After`; y que `GET /health` no pide token. `npm test` da en verde sin modificar `pruebas/http/autenticacion.test.ts`, `pruebas/unitarias/tokens.test.ts` ni `pruebas/unitarias/permisos.test.ts`, porque `registrarPermisos` sin tercer argumento sigue validando HS256.

- [x] **T7. Arranque con Keycloak caído.** RNF-13.9, RNF-13.12, RNF-07.12
  - Hecho cuando: `pruebas/integracion/arranque.test.ts` comprueba que en modo `jwks` con el JWKS caído `arrancar` no llama a `salir`, deja un `warn`, y `GET /health` responde `200` sin esperar a que terminen los reintentos; que con el JWKS colgado `detener` termina sin esperar a la precarga; que con el JWKS andando las claves quedan cargadas sin haber recibido ningún token; y que en modo `hs256` no se hace ningún pedido.

- [x] **T8. Separar roles y scopes en el contrato.** RNF-12.13, RNF-07.12
  - Hecho cuando: las pruebas comprueban, con `contratoCon`, que `permisosDe` trata como scopes los esquemas `oauth2` y `openIdConnect`, y como roles los demás y los no declarados; que un scope ya no se cuenta como rol, con rol y scope en el mismo renglón o en dos; que `[{ bearerAuth: [OPERADOR] }, { keycloak: [] }]` sigue pidiendo OPERADOR; que una lista vacía de roles sigue admitiendo cualquier rol conocido; y que `scopes` solo aparece si la operación declara alguno. `pruebas/http/operaciones.test.ts` pasa sin cambios.

- [x] **T9. Exigir el scope.** RNF-12.13, RNF-12.14, RNF-12.15, RNF-07.12
  - Hecho cuando: las pruebas comprueban, en modo `jwks`, que si falta el scope da `403` (`type: about:blank`, con un `detail` que habla del scope y no del rol) aunque el rol y el `sub` estén bien; que `clientes:write` no alcanza para una operación de `clientes:read`; que el rol equivocado da `403` aunque traiga el scope, y que un CLIENTE sobre otro `clienteId` da `403` aunque traiga el scope; que una operación sin scope declarado no exige ninguno; y que en modo `hs256` el scope no se mira. Con `contrato/openapi.yml` tal como está, ninguna operación real exige scope todavía.

## Tramo B — Keycloak real

- [x] **T10. Perfil `keycloak` de compose.** RNF-04.10, RNF-05.6, RNF-06.8
  - Hecho cuando: `docker compose --profile keycloak up -d --build --wait` deja sanos `m2`, `bd`, `keycloak` y `keycloak-bd`, con el realm importado desde `keycloak/ds-2026-realm-realm.json` (por ahora, copia de la cátedra sin agregados); pedir un token de `grupo-17` justo después de que compose termine no da `503`, o sea que el chequeo de salud no miente; `docker compose up -d --build --wait` no crea ningún servicio de Keycloak; `--profile panel` sigue igual; la base y el volumen de Keycloak son propios y `keycloak-bd` no publica puertos; `KEYCLOAK_BD_CLAVE=otra docker compose --profile keycloak config` muestra `otra` en `keycloak` y `keycloak-bd`, y `KEYCLOAK_ADMIN_CLAVE` hace lo mismo en `keycloak`; `pruebas/unitarias/consistencia.test.ts` acepta lo nuevo, con imágenes de versión exacta, y `ejemplo-keycloak.env` y `keycloak` figuran en los dos `.dockerignore` y en sus pruebas.

- [x] **T11. M2 en modo `jwks` con un archivo de entorno.** RNF-06.7, RNF-06.8
  - Hecho cuando: `docker compose --env-file ejemplo-keycloak.env up -d --build --wait` levanta el perfil sin nombrarlo y deja a M2 en modo `jwks`; sin el archivo, M2 queda en `hs256`; `KEYCLOAK_PUERTO` cambia el puerto publicado y el emisor a la vez (`docker compose --env-file ejemplo-keycloak.env config` muestra el mismo valor en `M2_EMISOR_TOKENS` y en `KC_HOSTNAME`); y un token de `grupo-17` da `401` por audiencia y no por emisor, porque el realm todavía no tiene los agregados.

- [x] **T12. Realm: roles, scopes y cuentas de servicio.** RNF-12.17, RNF-06.8
  - Hecho cuando: el realm tiene los roles, `m2-token`, `clientes:read`, `clientes:write` y las cuentas de servicio de M5 y M9 del plan; `pruebas/unitarias/realm.test.ts` lo comprueba leyendo el JSON, incluido que todo scope declarado en el contrato exista en el realm y que la audiencia de `m2-token` no vaya al ID token; y, tras `down -v` y volver a levantar, un token de `grupo-13` trae `aud: m2-clientes`, `sub`, `roles` con `SERVICIO`, `scope: clientes:read` y el emisor de `M2_EMISOR_TOKENS`, y pedirle `clientes:write` da `invalid_scope`. Cualquier diferencia con lo comprobado al escribir el plan se anota en `guia.md`.

- [x] **T13. Realm: usuarios y cliente de desarrollo.** RNF-12.17, RNF-06.8
  - Hecho cuando: el realm tiene `m2-desarrollo` y los usuarios con `id` fijo del plan; `pruebas/unitarias/realm.test.ts` los comprueba; y, tras `down -v`, un token de `cliente1` trae `aud: m2-clientes`, `sub` igual a su `id` fijo y `roles: ["CLIENTE"]`; sin pedir scopes trae `scope: ""` y pidiéndolos trae `clientes:read clientes:write`; y un ID token de `cliente1` no trae `m2-clientes` en `aud`.

- [x] **T14. Prueba con Keycloak real: operaciones.** RNF-07.13, RNF-12.14
  - Hecho cuando: `npm run keycloak:test` levanta el entorno (proyecto `m2-keycloak`, puertos propios) y comprueba con tokens pedidos a Keycloak, los de persona con `clientes:read clientes:write`: `cliente1` crea su perfil (`201`, con `clienteId` igual a su `sub`) y lo lee; `cliente1` no lee el de `cliente2` (`403`); `operador1` registra un bloqueo (`201`); `grupo-13` lee el estado de cuenta (`200`) y no el perfil (`403`); un token alterado, uno del comando de tokens de M2 (HS256) y un ID token de `cliente1` dan `401`. Sin Docker termina en rojo con el motivo. `npm test` no corre esta prueba, y `pruebas/unitarias/consistencia.test.ts` conoce el proyecto nuevo.

- [x] **T15. Prueba con Keycloak real: Keycloak caído.** RNF-07.13, RNF-13.9, RNF-13.10, RNF-13.11, RNF-13.12, RNF-13.13
  - Hecho cuando: `npm run keycloak:test` comprueba además, con un token pedido justo antes de detener Keycloak, porque dura 300 s: con `docker compose stop keycloak`, ese token sigue dando `200`; con `restart m2` y Keycloak detenido, M2 arranca, `/health` da `200` y el token da `503` con `Retry-After`; con `start keycloak`, ese mismo pedido vuelve a dar `200` sin reiniciar M2.

- [ ] **T16. Job de CI.** RNF-07.13
  - Hecho cuando: el job `keycloak` de `ci.yml` corre `npm run keycloak:test` en cada PR, con los logs de compose si falla, y los nombres de los jobs que exige la protección de `main` no cambian.

## Tramo C — Documentación y scope real

- [ ] **T17. Documentación.** RNF-20.5
  - Hecho cuando: `docs/probar-m2.md` tiene una sección nueva que dice cómo levantar el perfil, pedir un token de persona y uno de servicio, y probar una operación, y aclara que hace falta `down -v` para aplicar cambios del realm, que el panel solo funciona en modo `hs256` hasta la spec de inicio de sesión (#83), y que un `M2_EMISOR_TOKENS` distinto del `KC_HOSTNAME` da `401`; cada comando se corrió tal como está escrito; `README.md` enlaza la sección; y `guia.md` anota como pendientes para la rama `contrato/079-…`: rol y scope en el mismo renglón de `security`, los textos de `ServicioNoDisponible`, de `SinPermiso`, del `503` de dependencia y del `sub` de servicio, y los de `contrato/dependencias/m1.yml` y `dependencias/README.md`.

- [ ] **T18. Escenario de scope con Keycloak real (bloqueada hasta el merge de #79).** RNF-12.13, RNF-07.13
  - Hecho cuando: con #79 mergeado y desde `main` actualizado, una prueba sin Keycloak recorre las 19 operaciones del contrato real y comprueba que cada lectura declara `clientes:read`, cada escritura `clientes:write`, y cada una los tiene en el mismo renglón que su rol; `npm run keycloak:test` comprueba además que un token de `cliente1` pedido sin scopes (`scope: ""`) da `403` al leer su perfil, que uno con solo `clientes:write` da `403` al leer y `200` al escribir, y que uno con solo `clientes:read` da `200` al leer y `403` al escribir; `pruebas/unitarias/realm.test.ts` sigue en verde con los scopes reales del contrato; y `npm run contrato:test` sigue en verde. Si #79 se demora, o decide otra cosa sobre roles y scopes (por ejemplo, deja dos renglones), se para y se pregunta: va por `sdd-change`.
