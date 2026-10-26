# Plan 007 — Historial resumido de viajes

Spec: [spec.md](spec.md) · Issue: #7 · Contrato: `contrato/openapi.yml` · Depende de: specs #3 y #4 · Contrato de M6: `contrato/dependencias/m6.yml` (ADR 057) · Token de servicio: ADR 009

## Resumen
No hay tabla nueva: el historial se arma en cada consulta con la respuesta de M6. Se agrega un módulo `src/historial/` con el servicio y la conversión de la respuesta de M6, se completa el cliente de módulos de la spec #3 con una credencial por intento y con el encabezado `Retry-After` del `503`, y se suma la configuración de M6. La credencial es un token de servicio que M2 firma en cada intento según el ADR 009 (cambio del #58). La autorización por rol y la propiedad son las de las specs #4 y #5.

## Estructura

| Archivo | Responsabilidad | Requisitos |
|---|---|---|
| `src/config.ts` | `M2_URL_M6` (obligatoria), `M2_AUDIENCIA_M6` (`m6-viajes` por defecto) y `M2_REINTENTAR_DESPUES_S` (5 por defecto). `M2_CREDENCIAL_M6`, de T1, se quita | RNF-06, RF-2.4.6, RF-2.4.11 |
| `src/auth/tokens.ts` | `tokenDeServicio`: firma el token de M2 ante otro módulo con la firma de `generarToken` | RF-2.4.11, RNF-19 |
| `src/modulos/cliente.ts` | Credencial opcional por intento (`Authorization: Bearer`, una función que da el token) y `Retry-After` en `ModuloNoDisponible` | RNF-06, RNF-13, RF-2.4.6, RF-2.4.11 |
| `src/errores.ts` | `ModuloNoDisponible` acepta `Retry-After`; nuevo `ErrorDeIntegracion` (500) | RF-2.4.6, RF-2.4.7 |
| `src/historial/modelo.ts` | Tipos, traducción de página y conversión de `TripSummary` a `ViajeResumen`, funciones puras; `conCalificado` agrega `calificado` a la página (spec #8) | RF-2.4.1, RF-2.4.2, RF-2.4.9, RF-2.4.10 |
| `src/historial/m6.ts` | Pedido `GET /trips` a M6 con el cliente de módulos y el token de servicio, y lectura de su respuesta | RF-2.4, RF-2.4.6, RF-2.4.7, RF-2.4.10, RF-2.4.11, RNF-13 |
| `src/historial/servicio.ts` | Propiedad, perfil y llamada a M6, en ese orden; después, una consulta a la base de M2 con los viajes calificados de la página (spec #8) | RF-2.4.1, RF-2.4.3 a RF-2.4.5 |
| `src/historial/operaciones.ts` | Manejador de `listarHistorialViajes` | RNF-03 |
| `src/app.ts` | `construirApp` crea el cliente de M6 desde la configuración y lo decora como `app.m6`; las pruebas lo apuntan a un M6 simulado con `urlM6` | RNF-06 |
| `src/operaciones/index.ts` | Registro por `operationId`, en el orden del contrato | RNF-03 |
| `ejemplo.env`, `docker-compose.yml`, `README.md` | Variables nuevas, con valores de desarrollo | RNF-06, RNF-20 |
| `pruebas/unitarias/historial.test.ts` | Conversión, traducción de páginas y descarte | RF-2.4.1, RF-2.4.2, RF-2.4.9, RF-2.4.10 |
| `pruebas/unitarias/tokens.test.ts` | Claims y firma del token de servicio | RF-2.4.11 |
| `pruebas/modulos/m6.test.ts` | Lectura de M6, fallas y token de servicio con un servidor HTTP simulado | RF-2.4.6, RF-2.4.7, RF-2.4.10, RF-2.4.11 |
| `pruebas/integracion/historial-http.test.ts` | Contrato, permisos, errores y logs por HTTP, con PostgreSQL y M6 simulado | RF-2.4 a RF-2.4.8, RNF-03, RNF-14, RNF-19 |
| `pruebas/integracion/historial.test.ts` | Perfil real en PostgreSQL, M6 simulado y logs | RF-2.4.3, RF-2.4.4, RNF-05, RNF-14, RNF-19 |
| `specs/007-historial/guia.md` | Mapa y uso | RNF-20 |

## Contrato
- Se implementa `listarHistorialViajes`: `GET /api/v1/clientes/{clienteId}/viajes`, roles `CLIENTE` y `OPERADOR`. La validación de `clienteId`, `page` y `size` sale del OpenAPI (`400` antes de entrar al manejador).
- Rol efectivo y propiedad como en la spec #5: `rolesEfectivos = rolesDelToken ∩ rolesDeLaOperacion`; solo si es exactamente `[CLIENTE]` se exige `sub = clienteId` (`exigirPropietario`, `403`).
- El `404` es el del perfil (`exigirPerfil`). El `503` por M6 lleva `Retry-After`; el `503` por la base de M2 no (el contrato lo declara solo para la dependencia).
- La respuesta es `PaginaViajes`. No se cambia el contrato de M2.

## Datos
Ninguno: M2 no guarda viajes (RNF-05). No hay migración ni cambio de esquema.

## Lógica

### Consulta
1. `exigirPropietario(identidad, clienteId, rolesDeLaOperacion)`; si falla, `403` sin tocar la base ni M6.
2. `exigirPerfil(pool, clienteId)`; si no existe, `404` sin llamar a M6.
3. Pedir a M6 `GET /trips?clientId={clienteId}&page={page+1}&pageSize={size}` con el identificador de correlación de la solicitud y el token de servicio.
4. Convertir la respuesta de M6 con las funciones puras de `modelo.ts` y devolver la página.

### Lectura de la respuesta de M6 (`m6.ts`)
```
respuesta = clienteM6.obtener(ruta, idCorrelacion)      # reintenta una vez y puede lanzar ModuloNoDisponible
si respuesta.estado >= 400: lanzar ErrorDeIntegracion   # 500; la causa lleva solo el código, nunca el cuerpo
cuerpo = respuesta.cuerpo
si no es objeto con items (arreglo) y total (entero >= 0), o items.length > size:
    lanzar ModuloNoDisponible('M6')                     # 503 con Retry-After, RF-2.4.10
devolver cuerpo
```

### Conversión (`modelo.ts`, puras)
```
aViajeResumen(viaje) = { viajeId: viaje.id, estado: viaje.state,
                         ...(viaje.driverId ? { conductorId: viaje.driverId } : {}) }
aPaginaViajes(cuerpoM6, clienteId, page, size):
    propios  = cuerpoM6.items filtrados por viaje.clientId == clienteId
    return { page, size, totalElementos: cuerpoM6.total,
             totalPaginas: ceil(cuerpoM6.total / size), items: propios.map(aViajeResumen) }
```
- `calificado` no sale de M6: después de armar la página, `servicio.ts` pregunta a la base de M2 cuáles de esos viajes calificó el cliente (una consulta por página, sin llamar de nuevo a M6; no se consulta si la página queda vacía) y `conCalificado(pagina, calificados)` lo agrega a cada viaje, `true` o `false`. Si la base falla, `503` genérico y no un historial sin el campo. La spec #8 (RF-2.5.14) lo define y lo implementa.
- Si algún viaje no es de `clienteId` (RF-2.4.9), se descarta y se registra un aviso sin identificadores (solo la cantidad y el identificador de correlación).
- Un elemento de `items` sin `id` o `state` en texto, o que no es un objeto, hace que toda la respuesta cuente como inválida (RF-2.4.10).
- `totalElementos` es el total de M6 aunque se hayan descartado viajes de otro cliente: el filtro de M6 es el que cuenta.

## Integraciones
- **M6**, `GET /trips` (lectura): un intento tarda como máximo `M2_TIEMPO_MODULOS_MS` (2 s), se reintenta una vez tras 200 ms y, si falla, `503` con `detail` «M6 no está disponible» y `Retry-After` (RNF-13.1 a RNF-13.3, ya implementados en `crearClienteModulo`).
- Un `4xx` de M6, incluido el `404`, no se reintenta y responde `500` (RF-2.4.7).
- La credencial va en `Authorization: Bearer` y es un token de servicio nuevo en cada intento (RF-2.4.11, ADR 009), firmado con `M2_CLAVE_TOKENS`:
  ```
  tokenDeServicio(config) = JWT HS256 { iss: emisorTokens, sub: 'm2-clientes', roles: ['SERVICIO'],
                                        aud: audienciaM6, iat: ahora, exp: ahora + 60 }
  ```
  El claim de roles se llama `roles`, el del acuerdo, aunque `M2_CAMPO_ROLES` cambie el que M2 lee. El cliente de módulos recibe una función que da el token y la llama en cada intento: un reintento lleva su propio token. El token no se registra y no aparece en `detail`, en la causa ni en los logs; la clave que lo firma ya está en `secretosDeConfig`. Si M6 rechaza el token, responde un `4xx`: `500` (RF-2.4.7).
- La URL base sale de `M2_URL_M6`; el servicio no arranca sin ella (RNF-06).

## Pruebas
- Unitarias: conversión con y sin `driverId`, estado sin traducir, traducción de páginas (`page + 1`), `totalPaginas`, descarte de viajes ajenos, respuesta inválida.
- Unitarias de tokens: el token de servicio verifica con la clave y trae `iss`, `sub` `m2-clientes`, `roles` `["SERVICIO"]`, `aud` de M6 y `exp` 60 s después de `iat`, aunque `M2_CAMPO_ROLES` sea otro.
- Módulos (servidor HTTP simulado de M6): `200`, página vacía, `5xx`, cuerpo que no es JSON, `4xx` (`400`, `401`, `403`, `404`), demora mayor al tiempo, total inválido e `items` de más; el `Authorization` llega solo con credencial configurada, cada intento con un token nuevo, y el token de servicio que recibe el M6 simulado verifica con la clave y la audiencia de M6.
- HTTP: `200`, `400` de `page`, `size` y `clienteId`, `401`, `403` (propietario, ajeno, CLIENTE+OPERADOR), `404` sin llamar a M6, `500`, `503` con `Retry-After`, problem+json.
- Integración: perfil real en PostgreSQL con M6 simulado; el `503` de la base no lleva `Retry-After`; ningún token, identificador de viaje ni de conductor aparece en los logs.
- Contrato: `listarHistorialViajes` deja de figurar pendiente. En la prueba de contrato no hay M6, así que el `503` de M6 se acepta para esta operación en `schemathesis.toml`, como los `422` de las otras.

## Trazabilidad

| Requisito | Cobertura |
|---|---|
| RF-2.4, RF-2.4.1, RF-2.4.2 | `servicio.ts`, `m6.ts`, `modelo.ts`, pruebas unitarias, de módulos y HTTP |
| RF-2.4.3, RF-2.4.4, RF-2.4.5 | `servicio.ts` (propiedad, perfil, M6 vacío), pruebas HTTP e integración |
| RF-2.4.6, RF-2.4.7 | `cliente.ts`, `errores.ts`, `m6.ts`, pruebas de módulos y HTTP |
| RF-2.4.8 | Validación del contrato y pruebas HTTP |
| RF-2.4.9, RF-2.4.10 | `modelo.ts`, `m6.ts`, pruebas unitarias y de módulos |
| RNF-03 | Registro por OpenAPI, pruebas HTTP y de contrato |
| RNF-05 | Sin tabla ni migración; M6 solo por su API |
| RF-2.4.11 | `tokens.ts` (`tokenDeServicio`), `cliente.ts`, `m6.ts`, pruebas unitarias de tokens y de módulos |
| RNF-06 | `config.ts`, `ejemplo.env`, `docker-compose.yml`, README |
| RNF-07 | Unitarias, módulos, HTTP, integración y contrato |
| RNF-13 | Cliente de módulos de la spec #3 y pruebas de módulos |
| RNF-14 | Correlación hacia M6 y causa en el log del `503` y del `500` |
| RNF-19 | Token de servicio y cuerpos fuera del log; pruebas de módulos y de logs en integración |
| RNF-20 | Guía por tarea y visión general al validar |

## Decisiones
- El cliente de M6 es el `ClienteModulo` de la spec #3, con una credencial opcional por intento; no se agrega librería ni cliente nuevo.
- El token de servicio se firma con `generarToken`, la misma firma HS256 que usa M2 para hacer de M1 en desarrollo, con el `sub`, la audiencia y el vencimiento del token de servicio. Alternativas descartadas: `M2_CREDENCIAL_M6` con un token fijo, implementada en T1 y T2 (vence, o no vence y viola el ADR 009), y guardar un token y renovarlo antes de que venza (más estado para ahorrar una firma HMAC por intento).
- `M2_AUDIENCIA_M6` vale `m6-viajes` por defecto, el supuesto de la spec, hasta que el Grupo 12 confirme qué audiencia valida.
- Una página cuyo desplazamiento (`page * size`) no es un entero seguro (el contrato no le pone máximo a `page`) no tiene viajes: se le pide a M6 la página 1, solo por el total, y se responde `200` con `items` vacío (RF-2.4.3), como el tope de las specs #4 y #5. Alternativa descartada: mandarle a M6 ese número, que sale como `1e+21` o pierde precisión y termina en `500` o `503`. (Revisión de la validación.)
- `M2_URL_M6` no admite usuario ni contraseña: `fetch` rechaza esa URL copiándola entera en su error, que llegaría al log (RNF-19). Un `id` o `driverId` de M6 que no es un UUID cuenta como respuesta con mala forma (`503`), porque el contrato de M2 los declara `format: uuid`. (Revisión de la validación.)
- La conversión de la respuesta de M6 se escribe a mano, con comprobaciones simples, sin validador nuevo: son tres campos. Alternativa descartada: una librería de esquemas, que es una dependencia nueva.
- `Retry-After` va por parámetro de `ModuloNoDisponible`, para que el `503` de otros módulos pueda omitirlo; el valor sale de `M2_REINTENTAR_DESPUES_S`.
- `ErrorDeIntegracion` es un `500` genérico (`about:blank`, título «Error interno»): el contrato no define un `type` propio para este caso. La causa lleva el código de M6 y nunca su cuerpo.
- En la prueba de contrato no se agrega un M6 simulado (Prism) al `docker-compose.yml`: sería una imagen nueva. Se acepta el `503` en `schemathesis.toml`. Se puede agregar más adelante si el grupo lo pide.
- No se agrega ADR ni dependencia.

## Dudas abiertas
Ninguna. Los supuestos con M6 y el Grupo 1 están en `## Decisiones` de la spec.
