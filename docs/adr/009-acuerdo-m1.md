# ADR 009 — Acuerdo de consorcio sobre M1 (Identidad y Acceso)

Fecha: 2026-10-20 · Estado: propuesta
Issue: #9

## Contexto
M1 (Identidad y Acceso) no tiene grupo asignado: lo hacen todos los grupos o se acuerda en el consorcio. Cada módulo necesita validar quién llama y con qué rol (RF-1.3, RF-1.4, RNF-18). Hoy M2 ya valida tokens JWT firmados con HS256 y una clave simétrica por entorno (ADR 003, spec 003), con emisor (`iss`), audiencia (`aud`) y campo de roles configurables. El `sub` del token identifica a la persona que llama; cómo se relaciona con el `clienteId` de M2 lo define la spec del perfil (#4).

Este ADR propone al consorcio el formato del token y el mecanismo de validación, para que todos los módulos compartan las mismas convenciones y un token sirva en cualquiera.

## Decisión

### Formato del token
- **Tipo:** JWT (RFC 7519), firmado con **HS256** (HMAC-SHA256) como algoritmo único aceptado.
- **Encabezado:** `{ "alg": "HS256", "typ": "JWT" }`.
- **Claims obligatorios del payload:**

| Claim | Tipo | Descripción |
|---|---|---|
| `sub` | `string` (no vacío) | Identificador único de la persona en M1. Cada módulo decide cómo lo mapea a su dominio (en M2, es el `clienteId`). |
| `iss` | `string` | Emisor del token. Todos los módulos lo validan contra su configuración. |
| `aud` | `string` | Audiencia del token. Cada módulo puede tener su propia audiencia o compartir una del consorcio. |
| `iat` | `number` | Momento de emisión (Unix timestamp, segundos). |
| `exp` | `number` | Momento de expiración (Unix timestamp, segundos). Todo token debe vencer. |
| `roles` | `string[]` | Lista de roles. Los conocidos por M2 son `CLIENTE`, `CONDUCTOR`, `OPERADOR` y `SERVICIO`. Cada módulo puede reconocer otros. |

- **Claim opcional:** `nbf` (not before). Si está presente, se valida con 30 s de tolerancia de reloj.
- **El campo de roles** se llama `roles` por defecto, pero cada módulo puede configurar otro nombre con una variable de entorno (en M2: `M2_CAMPO_ROLES`).

### Firma y validación
- **En TP1:** clave simétrica compartida por entorno (`M2_CLAVE_TOKENS`, mínimo 32 caracteres). M1 no existe como servicio; cada módulo genera sus propios tokens para desarrollo y pruebas.
- **Cuando M1 exista:** se propone migrar a validación por clave pública. M1 publicaría un endpoint JWKS (`GET /.well-known/jwks.json`) con las claves públicas de firma, y los módulos validarían sin conocer la clave privada. Ese cambio es solo de configuración si el token mantiene el mismo formato.
- **Algoritmo:** solo se acepta HS256. Un token con otro algoritmo (incluyendo `none`) se rechaza con 401.
- **Tolerancia de reloj:** 30 segundos, para compensar relojes desfasados entre servicios.

### Rol SERVICIO
- Un módulo que llama a otro autenticándose como servicio (no en nombre de un usuario) usa un token con rol `SERVICIO`.
- M1 tiene que poder emitir estos tokens. Mientras M1 no exista, cada módulo los firma con su clave de desarrollo.
- El rol `SERVICIO` se limita a las operaciones que lo necesitan: en M2, solo `obtenerEstadoCuenta` (RF-2.6, para M5 y M9).

### Identificador del cliente (`clienteId`)
- El `sub` del token identifica a la persona en M1. La relación entre el `sub` y el `clienteId` de M2 la establece M2 internamente (spec #4).
- Se propone que el `sub` sea un UUID (v4 o v7) para evitar colisiones entre módulos, pero se acepta cualquier formato de texto no vacío.

### Variables de entorno que se proponen como convención del consorcio

| Variable | Obligatoria | Por defecto | Descripción |
|---|---|---|---|
| `M{n}_CLAVE_TOKENS` | sí | — | Clave simétrica para firma/validación (≥ 32 caracteres) |
| `M{n}_EMISOR_TOKENS` | sí | — | Valor esperado de `iss` |
| `M{n}_AUDIENCIA_TOKENS` | sí | — | Valor esperado de `aud` |
| `M{n}_CAMPO_ROLES` | no | `roles` | Nombre del claim con los roles |

(Donde `{n}` es el número de módulo.)

## Alternativas descartadas
- **Validación por introspección síncrona contra M1 en cada request:** agrega latencia y acoplamiento; si M1 se cae, todo el consorcio se cae. La validación local con firma evita ese punto de falla.
- **Consultar la base de datos de M1 directamente:** viola RNF-05 (datos propios) y la constitución 2 (datos de otros módulos solo por su API).
- **RS256 o ES256 desde el inicio:** requiere gestión de claves asimétricas, JWKS y rotación, que suman complejidad sin aportar valor mientras no haya un M1 real. HS256 con clave por entorno es lo más simple para TP1.
- **Token opaco (no JWT):** obliga a consultar a M1 por cada request para saber quién llama y qué puede hacer. JWT permite validación local.
- **Roles en un claim estándar (`scope` o `realm_access`):** `scope` tiene semántica OAuth2 que no aplica; `realm_access` es específico de Keycloak. Un claim propio `roles` es más claro y portable.

## Consecuencias
- M2 ya implementa todo lo decidido: no requiere cambios de código, solo de configuración si el consorcio elige valores distintos para emisor o audiencia.
- Cuando M1 exista y publique JWKS, cada módulo suma la URL del JWKS como variable de entorno y la librería jose (que M2 ya usa) pasa a validar con clave pública. Ese cambio se hace con `/sdd-change` y no necesita spec nueva.
- Si el consorcio elige otro algoritmo (RS256, ES256), M2 lo incorpora con `/sdd-change`.
- Los tests siguen generando tokens con HS256 y la clave del entorno de desarrollo, independientemente de cómo firme M1 en producción.
- El contrato de dependencia de M1 (`contrato/dependencias/m1.yml`) documenta lo que M2 necesita de M1 y sirve como propuesta para el consorcio.
