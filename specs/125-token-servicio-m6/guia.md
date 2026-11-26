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

### T2 — Token de servicio HS256 y paso por `m6.ts` · commit `125/T2`
- Qué cambió: `src/auth/token-servicio.ts` (nuevo) define `TokenServicio` (`modo`, `obtener(idCorrelacion)` → `{ token, reutilizado }`, `descartar(token)`) y `crearTokenServicioHs256`, que envuelve a `tokenDeServicio` de `src/auth/tokens.ts`; `crearTokenServicio` elige la implementación (por ahora solo HS256; Keycloak llega en T3). `src/modulos/cliente.ts`: `obtener` y `enviar` aceptan `{ credencial }` por llamada, que reemplaza a la fija en cada intento. `src/historial/m6.ts:crearM6` recibe un `TokenServicio` (por defecto, el que sale de la configuración) y sus dos consultas pasan por `pedirAM6`, que pide el token con el id de correlación de la operación. `src/app.ts` crea el token de servicio y se lo pasa.
- Por qué así: el plan separa cómo se obtiene el token de la política de M6. `reutilizado` existe para la renovación ante un `401` (T6, RF-2.4.11.8), que necesita saber qué token usó cada llamada: por eso la credencial pasa a ser por llamada y no fija del cliente.
- Cómo se conecta: el cliente de módulos sigue llamando a la credencial en cada intento y deja salir su error tal cual (sin llamar al módulo ni reintentar); con eso, un Keycloak caído en T3 no llega a M6. Sin opciones, el cliente se comporta como antes.
- Tests: `pruebas/unitarias/token-servicio.test.ts` (el HS256 es el de RF-2.4.11, nunca reutilizado, `descartar` no cambia nada, sin variables elige HS256); `pruebas/modulos/cliente.test.ts` (la credencial de la llamada reemplaza a la fija en GET, reintento y POST); `pruebas/modulos/m6.test.ts` (M6 recibe el token del servicio inyectado, pedido con el id de la operación). Las pruebas existentes del historial y la calificación siguen sin cambios.
- Para mirar con atención: `crearM6` arma su token de servicio por defecto para no tocar las pruebas que lo llaman con la configuración sola; en la app siempre se inyecta.
