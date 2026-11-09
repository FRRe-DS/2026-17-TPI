# ADR 079 — Scopes de la cátedra en el contrato de M2

Fecha: 2026-11-08 · Estado: aceptada (2026-11-09)
Issue: #79

## Contexto
El 2026-11-03 la cátedra agregó scopes al contrato de M2 en `FRRe-DS/2026-TPI` (commit `360caad`): un esquema `OAuth2Bearer` (*client credentials*) y un renglón de scope en cada operación. Ese cambio tiene tres problemas:
- Los scopes dicen `cleintes:read` y `cleintes:write`, y el `security` global mezcla esa forma con `clientes:write`.
- La `tokenUrl` (`/realms/ds-2026-realm/oauth2/token`) no existe en Keycloak: el endpoint es `/protocol/openid-connect/token`.
- El scope va en un renglón aparte del rol. En OpenAPI, dos renglones son alternativas: un token con solo `clientes:write` podría escribir el perfil de cualquier cliente, sin el rol CLIENTE y sin `sub == clienteId`.

El ADR 080 decidió que Keycloak hace de M1 y que, en modo `jwks`, M2 exige rol y scope juntos, leyendo los scopes del contrato. Con el contrato actual (copia de `61465e9`, sin scopes) M2 no exige ninguno.

El Grupo 1 respondió en FRRe-DS/2026-01-TPI#7 (2026-11-07): rol y scope en el mismo renglón; el profesor confirmó que `cleintes` fue un error y que los scopes los definen los dos grupos; un solo PR a la cátedra con el tipeo, la `tokenUrl` y los renglones. Propuso `clientes.estado:read` para el estado de cuenta y un cliente público con PKCE para el frontend. El Grupo 17 contestó el 2026-11-08: arma el PR y el Grupo 1 lo aprueba; bloqueos con `clientes:write` + OPERADOR.

## Decisión
- **Rol y scope en el mismo renglón** de `security` en las 19 operaciones con token: el token tiene que traer los dos.
- **Scopes:** `clientes:read` en las lecturas y `clientes:write` en las escrituras, como puso la cátedra, incluidas las de bloqueos (solo OPERADOR). `obtenerEstadoCuenta` pide `clientes.estado:read` y no `clientes:read`: M5 y M9 leen si un cliente está bloqueado y nada más de M2 (RNF-19). El `security` global pide rol (`bearerAuth: []`) y los dos scopes generales; no lo usa ninguna operación, porque todas declaran el suyo.
- **`OAuth2Bearer`** con dos flujos: `clientCredentials` para los módulos y `authorizationCode` (con PKCE, cliente `m2-front`) para las personas, con las URL de Keycloak `/protocol/openid-connect/token` y `/auth`.
- **Textos al día con el ADR 080:** el token lo emite M1 (Keycloak); el `sub` de SERVICIO es la cuenta de servicio del módulo; `SinPermiso` incluye el scope que falta; `ServicioNoDisponible` y el `503` genérico incluyen el caso en que M2 no puede obtener la clave del token.
- **`GET /health` sigue sin token** (`security: []`).
- **`contrato/ORIGEN`** apuntó a `61465e9` con la diferencia anotada mientras el PR conjunto no entraba a la cátedra. Entró el 2026-11-09: ahora apunta a `3429788` y el archivo es copia exacta.
- **Dependencias:** `m1.yml` y su fila del README pasan a Keycloak. `m6.yml`, `m6-propuesta.md` y el ADR 057 registran que el PR #9 se mergeó sin cambios (`69e9481`) y que hay una versión posterior (`35b3c4d`) sin extraer.

## Alternativas descartadas
- **Copiar `360caad` tal cual:** perpetúa el tipeo y una `tokenUrl` que no anda, y los renglones separados abren las operaciones a un token sin rol.
- **Solo scopes, sin roles:** un cliente y un operador serían iguales, y «un cliente solo ve lo suyo» se pierde (ADR 080).
- **Un scope propio para los bloqueos (`clientes.bloqueos:write`):** el rol OPERADOR ya los restringe y ningún módulo bloquea (ADR 080).
- **Extraer ahora la versión `35b3c4d` de M6:** cambia estados, roles, correlación y errores, y obliga a cambiar el M6 simulado y el cliente de M2. Es código y va en un cambio aparte; el M6 real que se prueba (spec 081) todavía no la sigue.

## Consecuencias
- Es compatible: agrega un esquema y scopes, sin cambiar rutas, roles ni respuestas.
- En modo `jwks`, M2 empieza a exigir los scopes que el contrato declara. El realm de desarrollo ya los tiene (ADR 080), y `pruebas/unitarias/realm.test.ts` comprueba que declare todos los del contrato. Destraba la T18 de la spec 080 (escenario de scope).
- En modo `hs256` no cambia nada: esa identidad no trae scopes y no se exigen.
- Publicado el 2026-11-09: el Grupo 1 aprobó el PR FRRe-DS/2026-TPI#18 y se mergeó (merge `4028cb5`; último commit que toca el archivo: `3429788`). `contrato/openapi.yml` es copia exacta del de la cátedra y `contrato/ORIGEN` registra ese commit.
- Pendiente aparte: extraer la versión `35b3c4d` de M6 y alinear el M6 simulado y el cliente.
