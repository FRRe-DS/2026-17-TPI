# Spec 006 — Preferencias

Estado: aprobada
Issue: #6
Etapa: TP1
Responsable: @DrazenPavicich

## Contexto y objetivo
M2 debe conservar las preferencias del cliente sobre tipos de vehículo, canales de comunicación y necesidades de accesibilidad. El contrato v1 ya fija los enumerados acordados con los módulos interesados. La consulta siempre devuelve un objeto completo, incluso si el cliente nunca guardó preferencias, y el guardado reemplaza el conjunto completo de forma idempotente.

Esta spec cubre RF-2.3 del issue #6 y depende del perfil de la spec #4.

## Usuarios
- Cliente autenticado, que consulta y reemplaza sus propias preferencias.
- Operador, que puede consultar las preferencias para asistir al cliente sin modificarlas.

## Historias de usuario
- HU-1. Como cliente, quiero guardar qué vehículos acepto para que la plataforma conozca mis opciones.
- HU-2. Como cliente, quiero indicar por qué canales acepto avisos y mis necesidades de accesibilidad.
- HU-3. Como cliente, quiero obtener valores previsibles antes de configurar nada.
- HU-4. Como operador, quiero consultar las preferencias de un cliente para asistirlo.

## Requisitos funcionales
- RF-2.3: CUANDO un CLIENTE reemplaza las preferencias de su propio perfil con listas válidas de vehículos, canales y accesibilidad, EL SISTEMA guarda el conjunto completo y responde `200` con el mismo estado persistido.
- RF-2.3.1: CUANDO una persona con un rol admitido consulta las preferencias de un cliente existente, EL SISTEMA responde `200` con tipos de vehículo, canales, accesibilidad y las observaciones presentes.
- RF-2.3.2: CUANDO un cliente existente todavía no guardó preferencias, EL SISTEMA responde `200` con el conjunto predeterminado acordado, sin crear efectos observables adicionales.
- RF-2.3.3: EL SISTEMA acepta únicamente `AUTO` y `MOTO` como tipos de vehículo; `EMAIL`, `SMS` y `PUSH` como canales; y `SILLA_DE_RUEDAS`, `ASISTENCIA_VISUAL`, `ASISTENCIA_AUDITIVA` y `ANIMAL_DE_ASISTENCIA` como necesidades de accesibilidad, sin elementos repetidos.
- RF-2.3.4: SI CLIENTE es el único rol del token que admite la operación y su `sub` no coincide con `clienteId`, ENTONCES EL SISTEMA responde `403`.
- RF-2.3.4.1: EL SISTEMA permite a OPERADOR consultar preferencias y no permite a SERVICIO acceder a estas operaciones, según el contrato.
- RF-2.3.5: SI el perfil del `clienteId` no existe, ENTONCES EL SISTEMA responde `404` tanto al consultar como al guardar preferencias.

## Requisitos no funcionales
- RNF-03: EL SISTEMA implementa exactamente `obtenerPreferencias` y `guardarPreferencias`, sus esquemas, permisos, códigos y errores `application/problem+json` de `contrato/openapi.yml`.
- RNF-05: EL SISTEMA guarda las preferencias solo en la base propia de M2 mediante una migración versionada, sin consultar bases ni servicios de M3, M5 o M8.
- RNF-07: EL SISTEMA verifica las reglas con pruebas unitarias, HTTP, integración sobre PostgreSQL real y pruebas de contrato.
- RNF-08: SI dos guardados concurrentes actualizan las preferencias del mismo cliente, ENTONCES EL SISTEMA conserva un objeto completo correspondiente a una de las solicitudes, nunca una mezcla ni filas duplicadas.
- RNF-19: EL SISTEMA no registra observaciones de accesibilidad, cuerpos, tokens ni preferencias en los logs.
- RNF-20: EL SISTEMA documenta en la guía los valores, predeterminados, permisos y forma de probar la funcionalidad.

## Contrato y dependencias
- Operaciones que cubre: `GET /api/v1/clientes/{clienteId}/preferencias (obtenerPreferencias)` y `PUT /api/v1/clientes/{clienteId}/preferencias (guardarPreferencias)`.
- Depende de la spec #4: el perfil debe existir o ambas operaciones responden `404`.
- Los enumerados son los publicados en `contrato/openapi.yml`, fuente de verdad superior al issue. Implementarlos no requiere llamadas a M3, M5 ni M8.
- La propiedad se exige cuando CLIENTE es el único rol del token admitido por la operación. Por eso un token CLIENTE+OPERADOR puede consultar las preferencias de otro cliente, pero no guardarlas; SERVICIO no está habilitado.

## Casos límite
- Cada una de las tres listas puede estar vacía: vehículos vacíos significa cualquiera; canales vacíos, ningún aviso opcional; accesibilidad vacía, ninguna necesidad indicada.
- Un valor fuera del enumerado, un elemento repetido, un campo obligatorio ausente, un campo extra o observaciones de más de 255 caracteres responde `400`.
- El PUT reemplaza, no fusiona: una lista omitida responde `400` y una lista vacía elimina todas las selecciones anteriores de esa categoría.
- Repetir el mismo PUT devuelve `200` y deja el mismo estado, sin necesitar `Idempotency-Key`.
- Dos PUT concurrentes son atómicos: gana uno completo según el orden de confirmación; nunca se combinan listas de ambas solicitudes.
- El contrato no acepta `null` para observaciones: puede reemplazarse u omitirse en el cuerpo completo, pero no enviarse como nulo.
- Consultar valores predeterminados no crea una fila; guardar luego reemplaza esos valores normalmente.

## Fuera de alcance
- Usar las preferencias para asignar vehículos, enviar notificaciones o elegir proveedores.
- Validar disponibilidad real de AUTO/MOTO o de medios de comunicación.
- Agregar valores a los enumerados sin un cambio de contrato.
- Historial o auditoría de cambios de preferencias.
- Permitir que M3, M5 o M8 modifiquen preferencias.

## Criterios de finalización
- Las dos operaciones figuran como implementadas y pasan la prueba de contrato.
- Las pruebas cubren predeterminados, reemplazo completo, enumerados, listas vacías, concurrencia, propiedad, permisos y perfil inexistente.
- `npm test`, `npm run lint`, `npm run build`, `npm run contrato:test` y `node scripts/spec-check.mjs` terminan en verde.
- La migración es reversible y la guía muestra ejemplos reproducibles sin datos sensibles.

## Decisiones
- Se guarda una sola fila por cliente y el PUT usa UPSERT atómico; no existe una fila por elemento ni actualización parcial.
- Los enumerados se toman literalmente del contrato v1 y se protegen también en la base para impedir estados imposibles fuera de la API.
- La consulta de predeterminados no escribe en la base, para que un GET no tenga efectos laterales.
- Si todavía no existe una fila, las preferencias predeterminadas son `tiposVehiculo: []`, `canales: []`, `accesibilidad: []` y no incluyen `observacionesAccesibilidad`; coincide con la semántica que el contrato asigna a cada lista vacía.
- Se informará al Grupo 1 esta decisión de valores predeterminados, porque el contrato exige devolverlos pero no los enumera.

## Dudas abiertas
Ninguna.
