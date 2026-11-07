# ADR 080 — M2 valida tokens de Keycloak con clave pública

Fecha: 2026-11-07 · Estado: aceptada
Issue: #80 · Reemplaza a: ADR 009

## Contexto
El ADR 009 propuso al consorcio un JWT HS256 con una clave compartida, y dejó la migración a clave pública para cuando existiera M1. Ese ADR anota el riesgo: quien tiene la clave puede firmar cualquier token con cualquier rol, así que RF-1.4 («sin compartir contraseñas ni datos internos») no se cumple del todo.

M1 no tiene grupo asignado. En clase, la cátedra dijo que Keycloak es opcional y cómo se usa: el backend baja la clave pública (JWKS) al arrancar, comprueba la firma y mira el campo `scope` en cada operación. Para la entrega final pide cinco piezas: Keycloak, su base, el backend, su base y el frontend. El grupo decidió implementarlo el 2026-11-07.

La cátedra publicó su realm en `FRRe-DS/2026-TPI/keycloak` (commit `6dfdd40`, Keycloak 23.0.6) y agregó scopes al contrato de M2 (commit `360caad`). Se levantó ese realm y se pidieron tokens reales. Con lo que emite hoy, ningún token pasaría las reglas de M2:
- No trae `aud`.
- El `scope` de todos los grupos es `conductores:read conductores:write`. `clientes:read` y `clientes:write` están definidos, pero ningún cliente los tiene asignados: pedir `clientes:read` da `invalid_scope`.
- Los roles son `clientes-be`, `solicitud-be` y similares: no hay `CLIENTE`, `OPERADOR` ni `SERVICIO`.
- Solo tiene las cuentas de servicio de cada grupo y un `test-user` sin esos roles: no hay usuarios de cliente ni de operador.

El grupo le preguntó al Grupo 1 sobre roles y scopes, y le avisó lo encontrado en el realm (FRRe-DS/2026-01-TPI#7). Sin respuesta al escribir este ADR.

## Decisión
- **Keycloak hace de M1 para M2.** M2 valida localmente, con la clave pública, sin llamar a Keycloak en cada solicitud.
- **Dos modos, uno por vez, por configuración** (`M2_MODO_TOKENS`). `jwks` acepta solo RS256 de las claves de `M2_URL_JWKS`. `hs256` queda como modo de desarrollo y es el valor por defecto, y en él sigue valiendo el formato del ADR 009: las pruebas, la demo y el panel no cambian.
- **Rol y scope se exigen juntos en modo `jwks`.** El rol dice quién sos, y de ahí sale «un cliente solo ve lo suyo»; el scope dice qué puede hacer ese token. Los scopes se leen del contrato (#79). Por eso #79 tiene que escribirlos en el mismo renglón de `security`: en OpenAPI, dos renglones son alternativas («rol o scope»), y con eso un token con solo `clientes:write` podría escribir el perfil de cualquier cliente. Si el contrato final dejara dos renglones, M2 seguiría pidiendo los dos, pero contradiría al contrato, y se para a decidirlo. Esta es una propuesta del grupo, todavía sin acuerdo del Grupo 1.
- **Si Keycloak no responde, M2 sigue andando.** Arranca igual, atiende los tokens cuya clave ya tiene y responde `503` con `Retry-After` a los que no puede comprobar. Un token inválido sigue siendo `401`. Las claves guardadas no vencen por tiempo: se renuevan cuando aparece un `kid` desconocido, como mucho una vez cada 30 s.
- **Realm de desarrollo propio, derivado del de la cátedra.** Mismo nombre y mismos clientes `grupo-NN`; suma roles de M2, audiencia `m2-clientes`, los scopes en los clientes de M5 y M9, y usuarios de ejemplo. El `sub` del usuario sigue siendo el `clienteId`, sin tablas nuevas.
- **Keycloak 26.8.2 con su propia base PostgreSQL**, en el perfil de compose `keycloak`. El emisor se fija en Keycloak (`KC_HOSTNAME`) y M2 baja las claves por la red de compose, con otra URL.

## Alternativas descartadas
- **Usar el realm de la cátedra tal como está:** ningún token pasa, y no hay usuarios de cliente ni de operador. Adaptar M2 a esos tokens dejaría la validación sin audiencia ni roles de persona.
- **Aceptar los dos modos a la vez:** mantiene abierta la clave compartida, que es lo que se quiere cerrar, y da lugar a confusiones de algoritmo.
- **Solo scopes, sin roles:** un cliente y un operador serían iguales, y «un cliente solo ve lo suyo» se pierde.
- **No arrancar sin Keycloak:** un corte de Keycloak tumbaría a M2 entero, incluida su salud, contra RNF-13.
- **Preguntarle a Keycloak por cada token (introspección):** ya descartada en el ADR 009, por la latencia y el acoplamiento.
- **Keycloak 23.0.6, como la cátedra:** versión de principios de 2024; una spec de seguridad no debería partir de ahí.

## Consecuencias
- El riesgo del ADR 009 se cierra para lo que entra a M2 en modo `jwks`: nadie puede atribuirse un rol sin pasar por Keycloak.
- **Deuda: el token de M2 hacia M6 sigue firmado con `M2_CLAVE_TOKENS`,** que por eso sigue siendo obligatoria en los dos modos. El M6 real no valida firmas todavía (spec 081), y pedirlo a Keycloak haría que el historial dependa de Keycloak. Se revisa cuando M6 valide tokens.
- **Deuda: el panel firma HS256,** así que funciona solo con M2 en modo `hs256` hasta la spec de inicio de sesión real (#83). Las cinco piezas se levantan, pero el frontend todavía no entra con Keycloak.
- Una clave retirada de Keycloak se sigue aceptando hasta que M2 vea un `kid` nuevo o se reinicie: es el costo de seguir atendiendo con Keycloak caído.
- Durante un corte, pasados 30 s desde la última obtención de claves, un token con un `kid` inventado hace que M2 vuelva a llamar a Keycloak y responda `503`. Alguien sin credenciales puede sumarle carga a un Keycloak que se está recuperando. Se acepta para TP2, sin lógica adicional.
- Si otro módulo prueba M2 con el realm de la cátedra tal como está, recibe `401`. Por decisión de @sandobaitt, por ahora no se le consulta a la cátedra si lo va a corregir.
- `contrato/dependencias/m1.yml` y `dependencias/README.md` todavía describen una propuesta anterior, y los textos de `ServicioNoDisponible`, `SinPermiso` y el `503` de dependencia no dicen lo que hace M2. Se actualizan en la rama `contrato/079-…`, porque `contrato/` solo se toca ahí.
- Si el Grupo 1 o la cátedra deciden otra cosa sobre roles y scopes, el cambio va por `sdd-change` de la spec 080.
