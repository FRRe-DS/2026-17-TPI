# Guía — Spec 125 Token de servicio de M2 ante M6 obtenido de Keycloak

## Visión general (se escribe al validar, 30-60 líneas)
Pendiente: se escribe al validar la spec.

## Tareas
### T1 — Configuración del token de servicio · commit `125/T1`
- Qué cambió: `src/config.ts:leerTokenServicio` lee `M2_URL_TOKENS_SERVICIO`, `M2_CLIENTE_SERVICIO` y `M2_SECRETO_SERVICIO` y deja `config.tokenServicio` (`ConfigTokenServicio`) o `undefined`. El lector suma `faltante`, para informar una variable que hace falta solo porque otra está definida. `src/logs.ts:secretosDeConfig` agrega el secreto a lo que se tacha del log. `ejemplo.env` trae las tres vacías, con su comentario.
- Por qué así: RF-2.4.11.1 a RF-2.4.11.3 piden las tres o ninguna; sin ninguna, M2 sigue con HS256. La URL usa la misma regla `urlHttp` que `M2_URL_JWKS` y `M2_URL_M6` (sin usuario ni contraseña, sin barra final), y se valida aunque falten las otras dos. Ningún error repite un valor, tampoco el del secreto (RNF-06.2, RNF-19).
- Cómo se conecta: `cargarConfig` agrega `tokenServicio` al final; `secretosDeConfig` ya lo recibe porque `app.ts` y `arranque.ts` le pasan la configuración entera. Todavía nadie usa `tokenServicio`: lo toma el token de servicio en T2 y T3.
- Tests: `pruebas/unitarias/config.test.ts` (bloque «token de servicio de Keycloak»: ninguna, vacías, las tres, cada combinación incompleta, URL inválida sin repetirla, cliente con espacios); `secretos.test.ts` (el secreto se tacha); `ejemplo-env.test.ts` (las tres están y son las únicas sin valor por defecto).
- Para mirar con atención: `ejemplo-env.test.ts` exigía un valor por defecto en toda variable; estas tres son la excepción explícita (`SIN_VALOR_POR_DEFECTO`), porque con valor activarían Keycloak en el entorno por defecto, que la spec deja en HS256.
