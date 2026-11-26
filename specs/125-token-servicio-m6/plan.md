# Plan 125 — Token de servicio de M2 ante M6 obtenido de Keycloak

Spec: [spec.md](spec.md) · Issue: #125 · ADR: [125-token-servicio-keycloak](../../docs/adr/125-token-servicio-keycloak.md) · Contrato: `contrato/openapi.yml` y `contrato/dependencias/m6.yml` (sin cambios)

## Resumen
Un módulo nuevo, `src/auth/token-servicio.ts`, da el token con el que M2 se presenta ante M6. Tiene dos implementaciones con la misma forma: la de Keycloak, que pide el token por `client_credentials`, lo guarda en memoria hasta que le quedan 30 s y comparte un solo pedido entre los que esperan; y la de HS256, que firma el token de hoy (`tokenDeServicio`). `src/historial/m6.ts` deja de firmar por su cuenta: pide el token a ese módulo y, si M6 responde `401` a un token reutilizado, lo descarta y repite una vez. El cliente de módulos (`src/modulos/cliente.ts`) solo gana la posibilidad de recibir la credencial en cada llamada. El M6 simulado aprende a validar RS256 con el JWKS de Keycloak, y el compose y las pruebas con Keycloak lo levantan.

## Contrato
- Sin operaciones nuevas ni cambios de esquema. `listarHistorialViajes` y `calificarConductor` ya declaran el `500` y el `503` con `Retry-After` que usan RF-2.4.11.6 y RF-2.4.11.7. Ese `503` sale genérico (`type: about:blank`), como el contrato lo pide cuando M2 no puede obtener lo que necesita del servicio de identidad.
- `contrato/dependencias/m6.yml` declara `bearerAuth` «emitido por M1»; Keycloak es M1 (ADR 080), así que no cambia.

## Estructura

| Archivo | Responsabilidad | Requisitos |
|---|---|---|
| `src/config.ts` | `M2_URL_TOKENS_SERVICIO`, `M2_CLIENTE_SERVICIO`, `M2_SECRETO_SERVICIO`: las tres o ninguna, URL `http`/`https` | RF-2.4.11.1 a RF-2.4.11.3, RNF-06 |
| `src/logs.ts` | `secretosDeConfig` suma `M2_SECRETO_SERVICIO` a lo que el logger tacha | RNF-19 |
| `src/auth/token-servicio.ts` (nuevo) | `crearTokenServicio`: Keycloak (pedido, caché, pedido compartido, errores) o HS256 | RF-2.4.11.1, RF-2.4.11.2, RF-2.4.11.4 a RF-2.4.11.7, RF-2.4.11.10, RNF-13, RNF-14.15, RNF-19 |
| `src/modulos/cliente.ts` | `obtener` y `enviar` aceptan una credencial por llamada, además de la fija | RF-2.4.11.8 |
| `src/historial/m6.ts` | Usa el token de servicio; ante un `401` con token reutilizado, descarta y repite una vez | RF-2.4.11.8, RF-2.4.11.9 |
| `src/app.ts`, `src/arranque.ts` | Crea el token de servicio y lo pasa a `crearM6`; línea de arranque con el modo | RNF-14.14 |
| `ejemplo.env`, `ejemplo-keycloak.env`, `ejemplo-front-keycloak.env` | Variables vacías por defecto; con valor solo en los dos archivos de Keycloak | RNF-06, RNF-20 |
| `panel/servidor/config.ts`, `panel/m6-simulado/app-m6.ts` | El M6 simulado acepta, además del HS256, un RS256 del emisor de Keycloak validado con su JWKS | RNF-07 |
| `docker-compose.yml` | `m6` también en el perfil `keycloak`, con las variables del JWKS; `m6-real` con `AUTH_ISSUER` y `AUTH_JWKS_URI` y Keycloak en el perfil `m6-real` | RNF-07, RNF-07.15 |
| `pruebas/unitarias/config.test.ts` | Las tres variables, URL inválida, el secreto nunca en el mensaje | RF-2.4.11.3, RNF-06 |
| `pruebas/unitarias/token-servicio.test.ts` (nuevo) | Caché, margen de 30 s, pedido compartido, errores, línea de log, sin token ni secreto en el log | RF-2.4.11.4 a RF-2.4.11.7, RNF-13, RNF-14.15, RNF-19 |
| `pruebas/integracion/historial-http.test.ts`, `pruebas/integracion/calificaciones-http.test.ts` | El `401` de M6 con token reutilizado y con token nuevo, en las dos operaciones | RF-2.4.11.8, RF-2.4.11.9 |
| `pruebas/unitarias/m6-simulado.test.ts` | El simulado acepta RS256 del emisor correcto con `clientes-be` o `SERVICIO` y rechaza los demás | RNF-07 |
| `pruebas/keycloak/token-servicio.test.ts` (nuevo) | Keycloak real y M6 simulado: historial y calificación con el token de Keycloak; Keycloak caído da `503` | RNF-07, RNF-12 |
| `pruebas/distribuida/*` | El token de servicio sale de Keycloak; el M6 real del commit nuevo lo acepta | RNF-07.15 |
| `docs/probar-m2.md`, `README.md` | Variables nuevas y cómo comprobarlo | RNF-20 |
| `docs/adr/125-token-servicio-keycloak.md` | Reemplaza al ADR 009 para el token de servicio | RNF-20 |
| `specs/125-token-servicio-m6/guia.md` | Mapa y forma de probarlo | RNF-20 |

## Datos
Ninguna tabla ni migración. El único estado nuevo es el token guardado en la memoria del proceso: `{ token, venceEn }`, uno por proceso, que se pierde al reiniciar (RNF-19). No va a la base ni a Redis.

## Configuración (RF-2.4.11.1 a RF-2.4.11.3, RNF-06)

| Variable | Por defecto | Regla |
|---|---|---|
| `M2_URL_TOKENS_SERVICIO` | ninguno | URL `http` o `https` sin usuario ni contraseña, la misma regla que `M2_URL_JWKS` |
| `M2_CLIENTE_SERVICIO` | ninguno | texto sin espacios al borde |
| `M2_SECRETO_SERVICIO` | ninguno | texto; nunca se repite en un error ni en el log |

- Las tres vacías: `tokenServicio: undefined` y M2 sigue con HS256 (RF-2.4.11.2).
- Algunas sí y otras no: un error por cada una que falta, «es obligatoria si se configura el token de servicio de Keycloak» (RF-2.4.11.3). La URL se valida siempre que está.
- En `ejemplo.env` van como `${VARIABLE:-}`, vacías; en `ejemplo-keycloak.env` y `ejemplo-front-keycloak.env`, con el valor de desarrollo: `http://keycloak:8080/realms/ds-2026-realm/protocol/openid-connect/token`, `grupo-17` y el secreto que ya trae `keycloak/ds-2026-realm-realm.json`.

## Lógica

### Token de servicio (`src/auth/token-servicio.ts`)
```
type TokenObtenido = { token: string; reutilizado: boolean }
type TokenServicio = {
  modo: 'keycloak' | 'hs256'
  obtener(idCorrelacion): Promise<TokenObtenido>
  descartar(token): void
}
```

**HS256** (sin las variables): `obtener` devuelve `{ token: await tokenDeServicio(config), reutilizado: false }` en cada llamada; `descartar` no hace nada. Es lo de hoy, sin cambios (RF-2.4.11.2).

**Keycloak**:
```
guardado: { token, venceEn } | undefined
enCurso: Promise<{ token, venceEn }> | undefined

obtener(id):
  si guardado y venceEn - ahora >= 30 s: devolver { guardado.token, reutilizado: true }      // RF-2.4.11.4
  si enCurso: r = await enCurso; devolver { r.token, reutilizado: false }                      // RF-2.4.11.5
  enCurso = pedir(id)
  try:
    r = await enCurso
    si r.venceEn - ahora >= 30 s: guardado = r      // un expires_in menor que 30 s se usa y no se guarda
    devolver { r.token, reutilizado: false }
  finally: enCurso = undefined                       // una falla no queda guardada: el siguiente vuelve a pedir

descartar(token): si guardado?.token === token: guardado = undefined
```
Los que esperan el mismo `enCurso` reciben el mismo token o el mismo error (Casos límite). `descartar` compara el token para no borrar uno más nuevo que guardó otro pedido mientras tanto.

**pedir(id)**: hasta `1 + M2_REINTENTOS_MODULOS` intentos de hasta `M2_TIEMPO_MODULOS_MS` cada uno, con la pausa de 200 ms entre intentos (RNF-13):
- `POST` a la URL de tokens, cuerpo `application/x-www-form-urlencoded` con `grant_type=client_credentials`, y el cliente y el secreto en `Authorization: Basic` (RFC 6749, 2.3.1). `redirect: 'error'`, como el cliente de módulos.
- Respuesta `200` en JSON con `access_token` texto no vacío y `expires_in` entero positivo: `{ token, venceEn: ahora + expires_in * 1000 }`. No se lee ni verifica nada más del token (RF-2.4.11.10).
- `5xx`, corte por tiempo, error de red, `200` que no es JSON o sin esos campos: falla de disponibilidad, se reintenta. Agotados los intentos, `ModuloNoDisponible('Keycloak', { reintentarDespuesS })`, que sale como `503` genérico con `Retry-After` y `detail` «Keycloak no está disponible» (RF-2.4.11.6).
- `4xx`: sin reintento, `ErrorDeIntegracion` con causa «Keycloak respondió <código>» y sin el cuerpo (RF-2.4.11.7). Responde `500`.
- Al terminar, una línea con el mismo formato que la de las llamadas a M6: `idCorrelacion` (el del pedido que lo disparó), `modulo: 'Keycloak'`, `metodo`, `estado`, `intentos` y `duracionMs`. Ni la URL, ni encabezados, ni cuerpos (RNF-14.15, RNF-19).

Por qué no se usa `crearClienteModulo` para el pedido: manda JSON y no reintenta un `POST`. El pedido de token necesita un cuerpo de formulario y sí se reintenta, porque no cambia nada en Keycloak (spec, RNF-13). Se reutilizan `pausar` y `PAUSA_REINTENTO_MS` de `src/modulos/cliente.ts`.

### Llamada a M6 con renovación (`src/historial/m6.ts`, RF-2.4.11.8, RF-2.4.11.9)
```
pedirAM6(ruta, id):
  usado = undefined
  credencial = async () => { usado = await tokenServicio.obtener(id); return usado.token }
  r = await cliente.obtener(ruta, id, { credencial })
  si r.estado == 401 y usado?.reutilizado:
    tokenServicio.descartar(usado.token)
    r = await cliente.obtener(ruta, id, { credencial })
  devolver r
```
`listarViajes` y `obtenerViaje` usan `pedirAM6` y, después, siguen igual: un `401` que queda es un `4xx` y da `500` (RF-2.4.7, RF-2.5.6). `usado` guarda el token del último intento: si el cliente de módulos reintentó por un `5xx`, cuenta el del intento que recibió el `401`.

Si `obtener` lanza (Keycloak caído o rechazando), el cliente de módulos ya deja salir el error de la credencial tal cual, sin llamar al módulo ni reintentar (comentario de `ejecutar` en `src/modulos/cliente.ts`): da el `503` o el `500` de arriba y M6 no recibe nada (RF-2.4.11.6, RF-2.4.11.7).

### Cliente de módulos (`src/modulos/cliente.ts`)
`obtener(ruta, id, opciones?)` y `enviar(…, opciones?)` aceptan `{ credencial?: () => Promise<string> }`, que reemplaza a la fija para esa llamada. Sin opciones, todo sigue como hoy. Se llama en cada intento, como la fija.

### Arranque (RNF-14.14)
Después de `Operaciones del contrato`, una línea `{ tokenServicioM6: 'keycloak' | 'hs256' }` con el mensaje «Token de servicio ante M6». Sin la URL ni el cliente: alcanza con saber el modo, y así no hay nada que tachar.

## Integraciones
- **Keycloak** (endpoint de tokens): tiempo por intento `M2_TIEMPO_MODULOS_MS` (2 s), `M2_REINTENTOS_MODULOS` reintentos (1), pausa de 200 ms. Sin respuesta: `503` con `Retry-After` (`M2_REINTENTAR_DESPUES_S`). Rechazo: `500`. Ver Lógica.
- **M6**: igual que hoy (spec 007 y 008), más la renovación ante un `401`.
- **Peor caso** con los valores por defecto: token (4,2 s) + M6 (4,2 s) + token nuevo (4,2 s) + M6 (4,2 s) = 16,8 s (spec, RNF-13).

## Entornos y M6 simulado (RNF-07, RNF-20)
- **M6 simulado**: dos variables nuevas, `M6_EMISOR_KEYCLOAK` y `M6_URL_JWKS_KEYCLOAK`, opcionales y las dos o ninguna. Con ellas, `verificarTokenDeServicio` acepta también un RS256 que `jose` valida con `createRemoteJWKSet(M6_URL_JWKS_KEYCLOAK)`, emisor `M6_EMISOR_KEYCLOAK`, sin exigir audiencia (como el M6 real), con `clientes-be` o `SERVICIO` en `roles`. El HS256 de hoy sigue igual. Cualquier otra cosa, `401`.
- **`docker-compose.yml`**: `m6` pasa a `profiles: [panel, keycloak]`, así `ejemplo-keycloak.env` también lo levanta y M2 lo encuentra en `http://m6:3006`. Sus variables de Keycloak salen de `${…:-}`: vacías en el perfil `panel`, con valor en los dos archivos de Keycloak (emisor `http://localhost:${KEYCLOAK_PUERTO}/realms/ds-2026-realm`, JWKS `http://keycloak:8080/…/certs`). `docker-compose.front.yml` ya sobrescribe el perfil de `m6` y no cambia.
- **Emisor dentro de Docker**: Keycloak firma con el emisor que fija `KC_HOSTNAME` (`localhost:${KEYCLOAK_PUERTO}`), aunque M2 le pida el token por `keycloak:8080`. Por eso el emisor y el JWKS van en variables separadas, en el simulado y en el M6 real (Casos límite de la spec).
- **M6 real** (`m6-real`): suma `AUTH_ISSUER` y `AUTH_JWKS_URI` con esos mismos dos valores, y el proyecto `m2-distribuida` levanta también Keycloak y su base. `M6_REAL_COMMIT` pasa al commit del Grupo 12 que exige RS256, el que esté mergeado en su rama de trabajo al hacer esa tarea (spec, Decisiones). Si su preparación de viajes (`ENABLE_DEMO_AUTH`) cambió en ese commit, se ajusta `pruebas/distribuida/ayudas/viajes.ts`.

## Decisiones
- **Un módulo de token de servicio con dos implementaciones**, elegidas al arrancar. Alternativa descartada: un `if` por llamada en `m6.ts`; mezcla la política de M6 con cómo se obtiene el token.
- **Pedido de token propio y no `crearClienteModulo`**: el formulario y el reintento del `POST` lo piden (Lógica). Alternativa descartada: generalizar el cliente de módulos con cuerpos de formulario y una opción para reintentar un `POST`; agrega dos opciones que solo usaría este pedido.
- **Credenciales en `Authorization: Basic`** y no en el cuerpo: es lo que recomienda el RFC 6749 y Keycloak acepta las dos. El encabezado nunca va al log (el cliente no registra encabezados).
- **La renovación ante el `401` vive en `m6.ts`** y no en el cliente de módulos: depende de saber si el token fue reutilizado, que es asunto del token de servicio, y el cliente de módulos sigue sin conocer a M6.
- **El M6 simulado valida RS256 de verdad**, con el JWKS de Keycloak, y no se conforma con cualquier Bearer: si no, la prueba con Keycloak no comprueba que el token sirva. Alternativa descartada: un simulado que acepte cualquier token en el perfil `keycloak`.
- **`m6` en el perfil `keycloak`** en lugar de sumar el perfil `panel` a `ejemplo-keycloak.env`: así no se levanta también el panel, que en ese entorno no sirve (firma HS256 y M2 está en `jwks`).
- ADR 125: reemplaza al ADR 009 para el token con el que M2 se presenta ante otros módulos; el ADR 009 ya estaba reemplazado por el 080 para los tokens que M2 recibe.

## Pruebas
- **Unitarias** (`npm test`, sin Docker):
  - `config.test.ts`: las tres variables, cualquier combinación incompleta, URL con usuario o `ftp:`, y que el secreto no aparece en ningún mensaje.
  - `token-servicio.test.ts`, con `pruebas/ayudas/servidor-modulo.ts` haciendo de endpoint de tokens y un reloj falso de Vitest: reutiliza con 30 s o más; pide otro con menos; `expires_in` de 10 s se usa y no se guarda; diez pedidos juntos, un pedido a Keycloak; una falla compartida y el siguiente vuelve a pedir; `5xx` y corte se reintentan una vez y dan `503` genérico con `Retry-After`; `200` sin `access_token`, sin `expires_in`, con `expires_in` `0` o `"300"`, o que no es JSON, dan `503`; `401` y `400` dan `500` sin reintento; el pedido lleva `Basic` y el formulario; la línea de log tiene los campos y no tiene token, secreto ni URL; `descartar` no borra un token más nuevo.
  - `secretos.test.ts`: el secreto de servicio se tacha.
  - Arranque (`pruebas/integracion/arranque.test.ts`): la línea `tokenServicioM6` en los dos modos.
  - `ejemplo-env.test.ts`, `workflow-integracion-m6.test.ts` y `realm.test.ts`: las variables nuevas en los archivos de ejemplo, Keycloak en el workflow distribuido y la cuenta de servicio de `grupo-17` con `clientes-be` en `roles`.
- **HTTP con base real** (`pruebas/integracion/historial-http.test.ts` y `calificaciones-http.test.ts`, M2 con el M6 de `pruebas/ayudas/m6-simulado.ts` y un endpoint de tokens falso): en el historial y en la calificación, un `401` con token reutilizado pide otro y repite una vez (dos pedidos a M6, dos a Keycloak); un segundo `401` da `500`; un `401` con token recién pedido da `500` sin repetir; Keycloak caído da `503` y M6 no recibe pedidos; en modo HS256 todo sigue como hoy (las pruebas existentes de 007 y 008 sin cambios).
- **M6 simulado** (`pruebas/unitarias/m6-simulado.test.ts`, con `pruebas/ayudas/jwks.ts`): RS256 del emisor correcto con `clientes-be` o `SERVICIO`, `200`; otro emisor, otra clave, sin rol o vencido, `401`; sin las variables, un RS256 da `401` y el HS256 sigue andando.
- **Keycloak real** (`npm run keycloak:test`, proyecto `m2-keycloak` con `ejemplo-keycloak.env`): historial y calificación de un cliente con viajes precargados responden `200` con el token de `grupo-17`; el log de M2 tiene una sola línea `modulo: 'Keycloak'` para dos consultas seguidas y la línea de arranque dice `keycloak`; con Keycloak detenido (`caido.test.ts` ya sabe detenerlo) el historial da `503` con `Retry-After`. Corre en el job `keycloak` de CI, que ya existe.
- **Distribuida** (`npm run integracion:m6`): `token-servicio.test.ts` pide el token a Keycloak por `client_credentials` en lugar de firmarlo, y comprueba que el M6 real no da `401` ni `403` en `GET /trips` y `GET /trips/{tripId}` (RNF-07.15). El resto de la suite, igual.
- **Contrato** (`npm run contrato:test`): sin cambios; las respuestas son las mismas.

## Cobertura de requisitos

| Requisito | Dónde |
|---|---|
| RF-2.4.11.1 | Configuración; Token de servicio (Keycloak); `ejemplo-keycloak.env` |
| RF-2.4.11.2 | Configuración; Token de servicio (HS256) |
| RF-2.4.11.3 | Configuración |
| RF-2.4.11.4 | Token de servicio, `obtener` |
| RF-2.4.11.5 | Token de servicio, `enCurso` |
| RF-2.4.11.6 | Token de servicio, `pedir`; Llamada a M6 |
| RF-2.4.11.7 | Token de servicio, `pedir`; Llamada a M6 |
| RF-2.4.11.8 | Llamada a M6 con renovación; Cliente de módulos |
| RF-2.4.11.9 | Llamada a M6 con renovación (`listarViajes` y `obtenerViaje`) |
| RF-2.4.11.10 | Token de servicio, `pedir` |
| RNF-06 | Configuración; archivos de ejemplo |
| RNF-07 | Pruebas; M6 simulado |
| RNF-07.15 | Entornos (M6 real); Pruebas (distribuida) |
| RNF-12 | Token de servicio (Keycloak); M6 simulado valida RS256 |
| RNF-13 | Token de servicio, `pedir`; Integraciones |
| RNF-14.14 | Arranque |
| RNF-14.15 | Token de servicio, `pedir` |
| RNF-19 | Datos; `secretosDeConfig`; línea de log sin token ni secreto |
| RNF-20 | `docs/probar-m2.md`, `README.md`, ADR 125, guía |
