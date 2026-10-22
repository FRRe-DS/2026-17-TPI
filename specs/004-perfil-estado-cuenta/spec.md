# Spec 004 — Perfil y estado de cuenta

Estado: aprobada
Issue: #4
Etapa: TP1
Responsable: @polettolucciano

## Contexto y objetivo
M2 necesita asociar los datos propios del cliente con la identidad emitida por M1, permitir que el cliente mantenga su perfil y exponer si puede operar. El estado de cuenta se calcula a partir de bloqueos administrativos: el historial se conserva, un bloqueo puede vencer o ser levantado y M5/M9 pueden consultar únicamente si el cliente está habilitado.

Esta spec cubre RF-2.1 y RF-2.6 del issue #4. Depende de la base del servicio (#3) y del contrato M2 v1 (#1), ya publicado en `contrato/openapi.yml`.

## Usuarios
- Cliente autenticado, que crea, consulta y actualiza su propio perfil y consulta su estado de cuenta.
- Operador, que consulta perfiles, administra bloqueos y revisa su historial.
- M5 y M9, que consultan el estado de cuenta con rol SERVICIO para decidir si el cliente puede operar.

## Historias de usuario
- HU-1. Como cliente, quiero crear y mantener mi perfil para usar la plataforma con mis datos actuales.
- HU-2. Como cliente, quiero conocer mi estado de cuenta para saber si puedo solicitar o reservar viajes.
- HU-3. Como operador, quiero bloquear o rehabilitar una cuenta conservando el historial para aplicar y auditar medidas administrativas.
- HU-4. Como módulo autorizado, quiero consultar el estado de cuenta para impedir operaciones de un cliente bloqueado.

## Requisitos funcionales
- RF-2.1: CUANDO un usuario con rol CLIENTE y un `sub` UUID sin perfil envía nombre, apellido y teléfono válidos, EL SISTEMA crea un único perfil cuyo `clienteId` es ese `sub`, responde `201`, devuelve el perfil y una cabecera `Location`.
- RF-2.1.1: CUANDO una persona con un rol admitido consulta un perfil existente, EL SISTEMA responde `200` con el perfil.
- RF-2.1.1.1: SI CLIENTE es el único rol del token que admite la operación y su `sub` no coincide con `clienteId`, ENTONCES EL SISTEMA responde `403`.
- RF-2.1.2: CUANDO un CLIENTE propietario envía uno o más campos válidos a su perfil, EL SISTEMA actualiza solo esos campos, responde `200` y conserva los demás.
- RF-2.1.2.1: SI CLIENTE es el único rol del token que admite la operación y su `sub` no coincide con `clienteId` al actualizar, ENTONCES EL SISTEMA responde `403`.
- RF-2.1.3: SI se intenta crear un segundo perfil para el mismo `clienteId`, ENTONCES EL SISTEMA responde `409` sin duplicarlo.
- RF-2.1.3.1: SI no existe el perfil pedido para consultar o actualizar, ENTONCES EL SISTEMA responde `404`.
- RF-2.6: CUANDO un CLIENTE consulta su cuenta, un OPERADOR consulta una cuenta o un SERVICIO consulta una cuenta existente, EL SISTEMA responde `200` con `ACTIVO` si no tiene bloqueos vigentes o `BLOQUEADO` si tiene al menos uno, e incluye todos los bloqueos vigentes.
- RF-2.6.1: CUANDO un OPERADOR registra un bloqueo con motivo y fin opcional válidos para un cliente existente, EL SISTEMA conserva el `sub` del operador, crea el bloqueo, responde `201` y devuelve una cabecera `Location`.
- RF-2.6.2: CUANDO un OPERADOR lista los bloqueos de un cliente existente, EL SISTEMA devuelve una página ordenada del más nuevo al más antiguo y permite filtrar por vigencia; CUANDO consulta un bloqueo del cliente, EL SISTEMA devuelve ese bloqueo.
- RF-2.6.3: CUANDO un OPERADOR levanta un bloqueo vigente con un motivo válido, EL SISTEMA registra quién, cuándo y por qué lo levantó sin borrar el registro y responde `200`.
- RF-2.6.3.1: SI el bloqueo ya está levantado o vencido, ENTONCES EL SISTEMA responde `409` sin modificarlo.
- RF-2.6.4: MIENTRAS un bloqueo no esté levantado y no haya alcanzado su fecha `hasta`, EL SISTEMA lo considera vigente; un bloqueo sin `hasta` permanece vigente hasta que un OPERADOR lo levanta.

## Requisitos no funcionales
- RNF-03: EL SISTEMA implementa exactamente las operaciones, esquemas, códigos y errores `application/problem+json` de `contrato/openapi.yml` para perfil, estado de cuenta y bloqueos.
- RNF-05: EL SISTEMA guarda perfiles, bloqueos e idempotencia solo en la base propia de M2 mediante migraciones versionadas, sin consultar la base de M1, M5 ni M9.
- RNF-07: EL SISTEMA verifica las reglas de esta spec con pruebas unitarias, HTTP, integración sobre PostgreSQL real y pruebas de contrato.
- RNF-08: SI dos solicitudes concurrentes intentan crear el mismo perfil o repetir un alta con la misma clave de idempotencia, ENTONCES EL SISTEMA garantiza en la base un solo efecto y devuelve la respuesta prevista por el contrato.
- RNF-19: EL SISTEMA no registra datos del perfil, motivos de bloqueo, cuerpos, tokens ni claves de idempotencia en los logs.
- RNF-20: EL SISTEMA documenta en la guía las operaciones, reglas de vigencia, permisos y forma de probar esta funcionalidad.

## Contrato y dependencias
- Operaciones del contrato que cubre: `POST /api/v1/clientes (crearCliente)`, `GET /api/v1/clientes/{clienteId} (obtenerCliente)`, `PATCH /api/v1/clientes/{clienteId} (actualizarCliente)`, `GET /api/v1/clientes/{clienteId}/estado-cuenta (obtenerEstadoCuenta)`, `GET /api/v1/clientes/{clienteId}/bloqueos (listarBloqueos)`, `POST /api/v1/clientes/{clienteId}/bloqueos (crearBloqueo)`, `GET /api/v1/clientes/{clienteId}/bloqueos/{bloqueoId} (obtenerBloqueo)` y `PATCH /api/v1/clientes/{clienteId}/bloqueos/{bloqueoId} (levantarBloqueo)`.
- Identidad: M1 emite el token; M2 usa su `sub` como `clienteId` para CLIENTE y como autor de la acción para OPERADOR. M2 no llama a M1 ni guarda datos de su base.
- M5 y M9 consumen `obtenerEstadoCuenta` con rol SERVICIO. Esta spec no llama a esos módulos ni conoce sus datos internos.
- Se calcula `rolesEfectivos = rolesDelToken ∩ rolesDeLaOperacion`. Solo se exige `sub = clienteId` cuando `rolesEfectivos` es exactamente `[CLIENTE]`: CLIENTE+OPERADOR puede consultar otro perfil o estado de cuenta, pero no actualizar otro perfil. SERVICIO solo puede usar `obtenerEstadoCuenta`.

## Casos límite
- Un `sub` de CLIENTE que no sea UUID no puede crear un perfil porque no representa un `clienteId` válido; la solicitud responde `400`.
- Dos creaciones simultáneas del mismo perfil producen un solo registro; una obtiene `201` y la otra `409`, salvo que ambas repitan la misma operación idempotente.
- Repetir un POST con la misma `Idempotency-Key` y el mismo cuerpo devuelve la respuesta original; reutilizarla con otro cuerpo responde `422`.
- Un `PATCH` vacío o con campos desconocidos responde `400` por el contrato y no cambia el perfil.
- Crear un bloqueo con `hasta` igual o anterior al instante de creación responde `422` con `type: /errores/bloqueo-vencido`.
- Un bloqueo con `hasta` igual o anterior al instante de consulta no está vigente, pero permanece en el historial.
- Puede haber varios bloqueos vigentes simultáneos; levantar uno no activa la cuenta si queda otro vigente.
- Un bloqueo vencido naturalmente no se considera levantado: conserva `levantadoEn`, `levantadoPor` y `motivoLevantamiento` ausentes, y levantarlo responde `409` con `type: /errores/bloqueo-no-vigente`.
- El filtro `vigente`, `page` y `size` usa los límites del contrato; una página fuera del total devuelve `items` vacío y los totales correctos.
- Un `bloqueoId` que existe para otro cliente se trata como no encontrado dentro del cliente pedido.
- Un OPERADOR no puede actualizar los datos del perfil porque el contrato reserva esa operación al CLIENTE.

## Fuera de alcance
- Alta, baja o autenticación de usuarios en M1.
- Borrado de perfiles o de bloqueos.
- Suspensiones automáticas por pagos, calificaciones o comportamiento.
- Notificaciones al cliente por un bloqueo.
- Funcionalidad de direcciones, preferencias, historial de viajes y calificaciones, cubierta por otras specs.

## Criterios de finalización
- Las ocho operaciones figuran como implementadas y pasan la prueba de contrato.
- Las pruebas demuestran permisos por rol y propiedad, idempotencia, concurrencia, paginación, vigencia, historial inmutable y transición del estado de cuenta.
- `npm test`, `npm run lint`, `npm run build`, `npm run contrato:test` y `node scripts/spec-check.mjs` terminan en verde.
- La migración sube y baja sin perder atomicidad, y la guía permite probar los flujos principales con ejemplos reproducibles.

## Decisiones
- El estado no se edita: se deriva al consultar a partir de los bloqueos vigentes, para evitar que un campo guardado contradiga el historial.
- Un bloqueo es vigente cuando no fue levantado y `hasta` es nulo o posterior al instante de consulta. La base, y no el reloj del cliente, decide ese instante.
- Los listados se ordenan de forma estable por `creadoEn` descendente y luego por identificador descendente.
- Los errores de dominio usan `type: /errores/perfil-ya-existe`, `type: /errores/idempotencia-reutilizada`, `type: /errores/bloqueo-ya-levantado`, `type: /errores/bloqueo-vencido` y `type: /errores/bloqueo-no-vigente`, nombres estables, relativos y específicos para que quien consume la API pueda distinguirlos.

## Dudas abiertas
Ninguna.
