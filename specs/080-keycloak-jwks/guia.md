# Guía — Spec 080 M2 valida tokens de Keycloak (JWKS y scope) y compose con Keycloak

## Tareas

### T1 — Configuración del modo de tokens · commit `080/T1`
- Qué cambió: `src/config.ts:cargarConfig` lee dos variables nuevas, `M2_MODO_TOKENS` y `M2_URL_JWKS`, y `Config` suma `modoTokens` (`'hs256' | 'jwks'`, tipo `ModoTokens`) y `urlJwks` (`string | undefined`). `ejemplo.env` las documenta, cada una con su comentario y la forma `VARIABLE=${VARIABLE:-valor}`. `pruebas/ayudas/app.ts:CONFIG` usa `hs256`.
- Por qué así: RNF-06.7 (un único modo por configuración, `hs256` por defecto) y RNF-06.9 (con un modo desconocido, o en `jwks` sin URL, M2 no arranca y el error nombra la variable sin repetir el valor). `M2_CLAVE_TOKENS` sigue obligatoria en los dos modos porque con ella M2 firma el token que presenta ante M6 (ADR 080, `tokenDeServicio`). El comando de tokens (`cargarConfigTokens`) no cambia y no mira ninguna de las dos.
- Cómo se conecta: todavía no se usa. Nada lee `modoTokens` ni `urlJwks`: los lee el verificador de la T2, que se conecta a la app en la T6. Con el valor por defecto (`hs256`) el servicio se comporta como antes (RNF-12.15).
- Tests: `pruebas/unitarias/config.test.ts` (los dos `toEqual` de valores traen los campos nuevos; los bordes de cada regla; el bloque «modo de los tokens» con los dos modos, la URL que falta o está vacía, el modo desconocido, la clave obligatoria en ambos y el comando de tokens que no los mira; ni el modo ni la URL se repiten en el error). `pruebas/unitarias/ejemplo-env.test.ts` (las dos variables están, con comentario, y el ejemplo da `hs256`).
- Para mirar con atención:
  - **Decisión mía donde el plan no decía:** `M2_URL_JWKS` se valida siempre que está definida, también en `hs256`. El plan dice «opcional si no» y no aclara si se valida. Así un error de tipeo (o una URL con usuario y contraseña, que llegaría al log) no queda dormido hasta que alguien cambie de modo. Si se prefiere ignorarla en `hs256`, es una línea en `cargarConfig` y dos pruebas.
  - Un modo inválido vuelve a `hs256` para seguir leyendo, así que el error es uno solo y no se suma el de la URL.
  - La URL por defecto de `ejemplo.env` apunta a Keycloak (`http://keycloak:8080/…`) y no puede quedar vacía porque `ejemplo-env.test.ts` rechaza valores por defecto vacíos. En `hs256` no se usa.
  - Comparación del modo: exacta y en minúsculas (`JWKS` o `hs256 ` dan error).

### T2 — Validar tokens RS256 con un JWKS · commit `080/T2`
- Qué cambió: `src/auth/tokens.ts:crearVerificador` devuelve `{ verificar }` según el modo. En `hs256` llama a `verificarToken`. En `jwks` valida con `algorithms: ['RS256']` y las claves de `src/auth/claves-jwks.ts:crearClaves`, y devuelve también `scopes` (`scopesDe`). `verificarToken` se comporta igual: solo se separó lo que comparten los dos modos (`tokenDe`, `reglasDe`, `validar`, `subDe`). `Identidad` suma `scopes?`. `motivoDe` recibe el motivo de la firma, que depende del modo.
- Por qué así: RNF-12.11 (solo RS256 de una clave publicada) y RNF-12.12 (mismas reglas y motivos que RNF-12.2). Solo RS256, y no «cualquier algoritmo de la clave», para que la clave compartida de M2 no se pueda usar como si fuera pública: es el ataque clásico de confusión de algoritmo.
- Cómo se conecta: todavía no se usa. `registrarPermisos` sigue llamando a `verificarToken` hasta la T6. Los `scopes` tampoco se usan hasta la T9, que suma `exigirScope`.
- Tests: `pruebas/unitarias/tokens-jwks.test.ts` (52 casos con un JWKS de `servidor-modulo.ts`), con `pruebas/ayudas/jwks.ts`, que arma claves y tokens RS256 con `node:crypto`, sin `jose`, para no depender del código que prueba. Se comprobó rompiendo el código a propósito: sin la lista de algoritmos, sumando HS256, sin las reglas de claims y sin deduplicar roles, las pruebas caen. `tokens.test.ts`, `permisos.test.ts` y `autenticacion.test.ts` no cambiaron y siguen en verde.
- Para mirar con atención:
  - **`claves-jwks.ts` es mínimo a propósito.** Hoy es `createRemoteJWKSet` con sus valores por defecto. Faltan el tiempo máximo por intento, los reintentos, `ModuloNoDisponible` y `cacheMaxAge` (T3 a T5). Hasta entonces, con Keycloak caído un `JWKSTimeout` daría `401` y un error de red `500`, en vez de `503`. No afecta a nadie porque el verificador no está conectado.
  - **El motivo del `kid` desconocido falta.** Hoy cae en «El token no es válido», y se suma en la T3.
  - **Decisión mía donde el plan no decía:** en `jwks` los roles se deduplican con un `Set`, y en `hs256` no, para no cambiar lo que devuelve (RNF-12.15). Así «un rol repetido no cambia nada» vale también para la identidad, no solo para `autorizar`.
  - **Texto del motivo de firma, también mío:** «El token no está firmado con RS256 y una clave del servicio de identidad». El plan solo pide separarlo por modo.
  - `scope` se parte solo por el espacio, como dice RFC 6749: un tab queda dentro del nombre y no coincide con ningún scope, así que no abre de más.

### T3 — `kid` desconocido · commit `080/T3`
- Qué cambió: `src/auth/tokens.ts:motivoDe` suma el motivo «El kid del token no está entre las claves del servicio de identidad» para `JWKSNoMatchingKey` y `JWKSMultipleMatchingKeys`. `src/auth/claves-jwks.ts:crearClaves` pasa `cooldownDuration: 30000` a `createRemoteJWKSet`.
- Por qué así: RNF-12.16 (un `kid` que M2 no tiene vuelve a pedir las claves, como mucho cada 30 s desde la última obtención) y RNF-12.19 (si sigue sin aparecer, o todavía no corresponde pedir, `401`). `jose` ya hace el reintento por `kid` y cuenta los 30 s desde la última obtención; se fija el valor para que no dependa del defecto de la biblioteca y quede escrito el porqué.
- Cómo se conecta: igual que la T2, todavía no está conectado a la app (T6). El `401` sale por el mismo camino que los demás motivos, con `WWW-Authenticate: Bearer`.
- Tests: `pruebas/unitarias/tokens-jwks.test.ts`, bloque «un kid desconocido», con `vi.useFakeTimers({ toFake: ['Date'] })` (jose cuenta con `Date.now()`; los temporizadores reales siguen andando para el servidor de la prueba). Cubre: el motivo sin repetir el `kid`; sin claves guardadas, un solo pedido; dentro de los 30 s, ningún pedido; el límite a 30 s menos 1 ms y a 30 s más 1 ms; los 30 s siguientes a un pedido que no encontró el `kid`; una clave nueva publicada se acepta sin reiniciar (y la vieja sigue valiendo); y el caso límite de la spec, un token con la clave nueva dentro de los 30 s da `401` hasta que pasa el plazo. Se comprobó rompiendo el código: con la espera en 0 caen 5 pruebas.
- Para mirar con atención:
  - **Decisión mía donde el plan no decía:** el texto del motivo, y que un token sin `kid` con varias claves de firma publicadas (`JWKSMultipleMatchingKeys`) use el mismo motivo. Para quien envía el token es lo mismo: no se sabe qué clave usar. Con una sola clave y sin `kid`, `jose` la usa y valida.
  - El motivo no repite el `kid` del token (RNF-12.2): es un texto fijo.
  - Un `kid` inventado con Keycloak caído y con claves guardadas, y sin ellas (`503`), es de la T5; el tiempo máximo y los reintentos, de la T4.

