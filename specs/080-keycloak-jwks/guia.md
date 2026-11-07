# Guía — Spec 080 M2 valida tokens de Keycloak (JWKS y scope) y compose con Keycloak

## Tareas

### T1 — Configuración del modo de tokens · commit `080/T1`
- Qué cambió: `src/config.ts:cargarConfig` lee dos variables nuevas, `M2_MODO_TOKENS` y `M2_URL_JWKS`, y `Config` suma `modoTokens` (`'hs256' | 'jwks'`, tipo `ModoTokens`) y `urlJwks` (`string | undefined`). `ejemplo.env` las documenta, cada una con su comentario y la forma `VARIABLE=${VARIABLE:-valor}`. `pruebas/ayudas/app.ts:CONFIG` usa `hs256`.
- Por qué así: RNF-06.7 (un único modo por configuración, `hs256` por defecto) y RNF-06.9 (con un modo desconocido, o en `jwks` sin URL, M2 no arranca y el error nombra la variable sin repetir el valor). `M2_CLAVE_TOKENS` sigue obligatoria en los dos modos porque con ella M2 firma el token que presenta ante M6 (ADR 080, `tokenDeServicio`). El comando de tokens (`cargarConfigTokens`) no cambia y no mira ninguna de las dos.
- Cómo se conecta: todavía no se usa. Nada lee `modoTokens` ni `urlJwks`: el verificador de la T2 y el arranque de la T3 en adelante. Con el valor por defecto (`hs256`) el servicio se comporta como antes (RNF-12.15).
- Tests: `pruebas/unitarias/config.test.ts` (los dos `toEqual` de valores traen los campos nuevos; los bordes de cada regla; el bloque «modo de los tokens» con los dos modos, la URL que falta o está vacía, el modo desconocido, la clave obligatoria en ambos y el comando de tokens que no los mira; ni el modo ni la URL se repiten en el error). `pruebas/unitarias/ejemplo-env.test.ts` (las dos variables están, con comentario, y el ejemplo da `hs256`).
- Para mirar con atención:
  - **Decisión mía donde el plan no decía:** `M2_URL_JWKS` se valida siempre que está definida, también en `hs256`. El plan dice «opcional si no» y no aclara si se valida. Así un error de tipeo (o una URL con usuario y contraseña, que llegaría al log) no queda dormido hasta que alguien cambie de modo. Si se prefiere ignorarla en `hs256`, es una línea en `cargarConfig` y dos pruebas.
  - Un modo inválido vuelve a `hs256` para seguir leyendo, así que el error es uno solo y no se suma el de la URL.
  - La URL por defecto de `ejemplo.env` apunta a Keycloak (`http://keycloak:8080/…`) y no puede quedar vacía porque `ejemplo-env.test.ts` rechaza valores por defecto vacíos. En `hs256` no se usa.
  - Comparación del modo: exacta y en minúsculas (`JWKS` o `hs256 ` dan error).
