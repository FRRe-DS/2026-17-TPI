# ADR 009 — Acuerdo de consorcio sobre M1 (Identidad y Acceso)

Fecha: 2026-10-20 · Estado: propuesta
Issue: #9

## Contexto
M1 (Identidad y Acceso) no tiene grupo asignado: lo hacen todos los grupos o se acuerda en el consorcio. Cada módulo necesita validar quién llama y con qué rol (RF-1.3, RF-1.4, RNF-12). Hoy M2 ya valida tokens JWT firmados con HS256 y una clave simétrica por entorno (ADR 003, spec 003), con emisor (`iss`), audiencia (`aud`) y campo de roles configurables. El `sub` del token identifica a quien llama (persona o servicio); cómo se relaciona con el `clienteId` de M2 lo define la spec del perfil (#4).

Este ADR propone al consorcio el formato del token y el mecanismo de validación, para que todos los módulos compartan las mismas convenciones y un token sirva en cualquiera.

## Decisión

### Formato del token
- **Tipo:** JWT (RFC 7519), firmado con **HS256** (HMAC-SHA256) como algoritmo único aceptado en TP1.
- **Encabezado:** `{ "alg": "HS256", "typ": "JWT" }`.
- **Claims del payload:**
  - **Obligatorios para M2 (validación criptográfica y de identidad):** `sub`, `iss`, `aud` y `exp`.
  - **Obligatorio para autorización:** `roles`. Sin este claim el token es válido, pero carece de roles y M2 responderá `403 Prohibido` en cualquier operación protegida.
  - **Opcionales:** `iat` y `nbf`. RNF-12.2 no exige `iat` (un token sin `iat` es aceptado). Si `nbf` está presente, se valida con 30 s de tolerancia de reloj.

| Claim | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `sub` | `string` (no vacío) | Sí | Identificador único de quien llama. Para usuarios, cómo se relaciona con el cliente lo define la spec del perfil (#4). Para servicios (rol `SERVICIO`), identifica al módulo que llama (ej. `m9-reservas`). |
| `iss` | `string` | Sí | Emisor del token. Se propone el valor `m1-identidad` para todo el consorcio. Todos los módulos lo validan contra su configuración. |
| `aud` | `string` o `string[]` | Sí | Audiencia del token. Puede ser un texto (audiencia única o compartida) o una lista de textos. Cada módulo receptor exige que su propia audiencia esté incluida. |
| `exp` | `number` | Sí | Momento de expiración (Unix timestamp en segundos, NumericDate RFC 7519). Todo token debe vencer. Se valida con 30 s de tolerancia de reloj. |
| `roles` | `string[]` | Sí | Lista de roles. Los conocidos por M2 son `CLIENTE`, `CONDUCTOR`, `OPERADOR` y `SERVICIO`. Cada módulo puede reconocer otros. |
| `iat` | `number` | No | Momento de emisión (Unix timestamp en segundos, NumericDate RFC 7519). Opcional para M2. |
| `nbf` | `number` | No | No válido antes de (Unix timestamp en segundos, NumericDate RFC 7519). Si está presente, se valida con 30 s de tolerancia de reloj. |

- **Valores concretos de emisor y audiencia propuestos para el consorcio:**
  - `iss`: `m1-identidad`
  - `aud`: Audiencias individuales por módulo: `m2-clientes`, `m5-facturacion`, `m8-notificaciones`, `m9-reservas`, etc. (o la audiencia compartida `plataforma-movilidad`).
  - **El caso de M9 (llamadas a múltiples módulos):** Cuando M9 (Reservas) necesita llamar a M2, M5 y M8 con el mismo token, emite una lista en la audiencia: `aud: ["m2-clientes", "m5-facturacion", "m8-notificaciones"]`. M2 ya acepta `aud` como texto o lista y valida que su audiencia (`m2-clientes`) esté incluida; cada módulo receptor valida análogamente la suya.
- **El campo de roles** se llama `roles` por defecto, pero cada módulo puede configurar otro nombre con una variable de entorno (en M2: `M2_CAMPO_ROLES`).

### Firma y validación
- **En TP1:** clave simétrica compartida para todo el consorcio (mínimo 32 caracteres). Al usar HS256, un token generado por un módulo (por ejemplo, M9 llamando a M2) solo valida si ambos comparten exactamente la misma clave. Esta clave de desarrollo debe distribuirse fuera del repositorio por un canal seguro (RNF-19), nunca versionada en git ni en archivos de ejemplo públicos.
- **Cuando M1 exista:** se propone migrar a validación por clave pública asimétrica (RS256 o ES256). M1 publicaría un endpoint JWKS (`GET /.well-known/jwks.json`) con las claves públicas de firma, y los módulos validarían sin conocer la clave privada. Pasar a JWKS requiere un cambio en M2, con su spec, cuando M1 exista (sin decidir ahora si es una spec nueva o un cambio de la 003), ya que implica consultar a M1 con timeout y reintentos (RNF-13), seleccionar la clave pública por `kid` y aceptar el nuevo algoritmo criptográfico.
- **Algoritmo:** solo se acepta HS256 en TP1. Un token con otro algoritmo (incluyendo `none`, o RS256/ES256 antes de implementar JWKS) se rechaza con 401.
- **Tolerancia de reloj:** 30 segundos en `exp` y `nbf` (RNF-12.2), para compensar desfases de reloj entre servicios.

### Rol SERVICIO
- Un módulo que llama a otro autenticándose como servicio (no en nombre de un usuario) usa un token con rol `SERVICIO`.
- En este caso, el `sub` identifica al módulo llamante (ej. `m9-reservas`).
- M1 tiene que poder emitir estos tokens. Mientras M1 no exista, los módulos que llaman a otros (como M9) los firman con la clave simétrica compartida del consorcio.
- El rol `SERVICIO` se limita a las operaciones que lo necesitan: en M2, solo `obtenerEstadoCuenta` (RF-2.6, para M5 y M9).

### Identificador de quien llama (`sub`)
- El `sub` del token identifica a quien realiza la llamada.
- **Para usuarios finales:** la relación entre el `sub` de M1 y el `clienteId` de M2 la establece M2 internamente según la spec del perfil (#4). Se propone que el `sub` sea un UUID (v4 o v7) para evitar colisiones entre módulos, pero se acepta cualquier formato de texto no vacío.
- **Para llamadas entre servicios (rol `SERVICIO`):** el `sub` no es un usuario ni un UUID, sino el identificador del módulo emisor (por ejemplo, `m9-reservas`).

### Variables de entorno (configuración interna en M2)
Los nombres de las variables de entorno son de configuración interna de cada módulo y no forman parte del acuerdo del consorcio. Se documentan aquí como referencia de «así lo configura M2» (y se sugiere como patrón si a otros módulos les resulta cómodo):

| Variable en M2 | Obligatoria | Por defecto | Descripción |
|---|---|---|---|
| `M2_CLAVE_TOKENS` | sí | — | Clave simétrica compartida del consorcio para firma/validación (≥ 32 caracteres) |
| `M2_EMISOR_TOKENS` | sí | — | Valor esperado de `iss` (`m1-identidad`) |
| `M2_AUDIENCIA_TOKENS` | sí | — | Valor esperado de `aud` (`m2-clientes`) |
| `M2_CAMPO_ROLES` | no | `roles` | Nombre del claim con los roles |

## Alternativas descartadas
- **Validación por introspección síncrona contra M1 en cada request:** agrega latencia y acoplamiento; si M1 se cae, todo el consorcio se cae. La validación local con firma evita ese punto de falla.
- **Consultar la base de datos de M1 directamente:** viola RNF-05 (datos propios) y la constitución 2 (datos de otros módulos solo por su API).
- **RS256 o ES256 desde el inicio:** requiere gestión de claves asimétricas, JWKS y rotación, que suman complejidad sin aportar valor mientras no haya un M1 real. HS256 con clave por entorno es lo más simple para TP1.
- **Token opaco (no JWT):** obliga a consultar a M1 por cada request para saber quién llama y qué puede hacer. JWT permite validación local.
- **Roles en un claim estándar (`scope` o `realm_access`):** `scope` tiene semántica OAuth2 que no aplica; `realm_access` es específico de Keycloak. Un claim propio `roles` es más claro y portable.

## Consecuencias
- M2 ya implementa lo propuesto para TP1: acepta `aud` como texto o lista (validando que contenga `m2-clientes`), no exige `iat`, y valida `exp`, `sub`, `iss`, `aud` con HS256 y 30 s de tolerancia de reloj.
- **Riesgo de seguridad en TP1 con HS256:** Al usar una clave simétrica compartida para todo el consorcio, cualquier módulo que tenga la clave puede firmar cualquier token con cualquier `sub` y atribuirse cualquier rol (incluyendo roles administrativos o de servicio). El requisito RF-1.4 pide validar «sin compartir contraseñas ni datos internos», lo cual en rigor solo se cumple completamente con JWKS y claves asimétricas (donde la clave privada reside únicamente en M1). El uso de HS256 con clave simétrica compartida es una simplificación técnica aceptada para el TP1 mientras no exista M1.
- La clave compartida de desarrollo debe circular fuera del repositorio (RNF-19) y cargarse por variables de entorno locales, nunca en commits ni archivos públicos.
- **Migración a JWKS:** Cuando M1 exista y publique JWKS, migrar a validación con clave pública requiere un cambio en M2, con su spec, cuando M1 exista (sin decidir ahora si es una spec nueva o un cambio de la 003). Ese cambio deberá implementar la consulta al endpoint JWKS con timeout y reintentos (RNF-13), la selección de la clave por `kid` y el soporte del nuevo algoritmo criptográfico (RS256 o ES256).
- Los tests de M2 siguen generando tokens con HS256 y la clave del entorno de pruebas mientras no se implemente dicha spec.
- El contrato de dependencia de M1 (`contrato/dependencias/m1.yml`) documenta lo que M2 necesita de M1 y sirve como propuesta para el consorcio.
