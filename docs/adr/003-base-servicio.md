# ADR 003 — Base del servicio: salud fuera del contrato y operaciones desde el contrato

Fecha: 2026-10-18 · Estado: aceptada; la decisión 1 terminó el 2026-10-22 (ver «Actualización»)
Issue: #3

## Contexto
- La constitución 1 dice que nada se expone fuera de `contrato/openapi.yml`. Pero hasta que el contrato v1 se acuerde y se publique (#1), el de `main` solo tiene `info`. La base necesita `GET /health` para que docker compose sepa si el servicio está sano (RNF-04.4) y para el equipo integrador (RNF-14.1).
- Las specs #4 a #8 van a sumar operaciones del contrato. Si cada una escribe a mano su ruta y sus esquemas, el código se puede separar del contrato sin que nada falle. Además, la prueba de contrato tiene que saber qué operaciones ya existen, para no fallar por las pendientes (RNF-07.2).

## Decisión
1. **`GET /health`, excepción temporal.** Se expone fuera del contrato y sin token mientras el contrato v1 no esté mergeado.
   - El borrador del v1 (PR #16) ya la incluye como `verificarSalud`. Cuando se mergee, la ruta se registra desde el contrato y la excepción termina sin cambiar código.
   - Si el v1 la nombra distinto o no la incluye, el servicio se ajusta con /sdd-change.
   - Aprobar el PR de la spec 003 es la aceptación del grupo.
2. **Las operaciones se registran desde el contrato.** Al arrancar, el servicio lee `contrato/openapi.yml`. Por cada `operationId` que tiene manejador en `src/operaciones/index.ts`, registra la ruta con:
   - los esquemas del contrato para validar parámetros, encabezados y cuerpo (Ajv con JSON Schema 2020-12), salvo el encabezado de correlación, que se reemplaza si no es válido (RNF-14.3);
   - los roles de `security` para autorizar; una operación con `security: []` es pública, y una cuya seguridad no nombra roles admite cualquier rol conocido.

   Una operación sin manejador no se expone: responde 404 o 405. La prueba de contrato la informa como pendiente y Schemathesis prueba solo las que tienen manejador.
3. **Cada spec de negocio agrega manejadores, no rutas.** Implementar una operación es escribir su manejador y anotarlo con su `operationId`. La ruta, la validación y los permisos salen del contrato.

## Alternativas descartadas
- **Esperar al contrato v1 para tener la salud del servicio:** la base y CI quedarían frenadas hasta el acuerdo con el Grupo 1.
- **Rutas y esquemas escritos a mano en cada spec:** duplican el contrato y se pueden separar de él sin que falle nada.
- **Una librería que arme todas las rutas desde el contrato, como fastify-openapi-glue:** hace lo mismo, pero con reglas propias que el grupo tendría que aprender. El registro propio es corto y se puede leer.
- **Probar el contrato completo en CI:** con el v1 mergeado y sin implementar, todos los PR quedarían en rojo hasta terminar #8.

## Consecuencias
- Si el contrato tiene un esquema que Ajv no puede compilar, el servicio no arranca: el error se ve en el primer arranque o en CI.
- Las specs #4 a #8 escriben manejadores y sus pruebas. Si una operación necesita algo que el contrato no tiene, es un cambio de contrato (skill contrato-cambio).
- Cuando el v1 se mergee, `verificarSalud` pasa a ser una operación más y entra en la prueba de contrato.
- Mientras tanto, la prueba de contrato no prueba `/health`, porque el contrato de `main` no la tiene. La cubren las pruebas de integración, y el script de la prueba de contrato se prueba con un contrato de prueba que solo tiene `/health`.

## Actualización (2026-10-22)
- El contrato v1 se mergeó en `main` (ADR 001) y declara `GET /health` como `verificarSalud`, sin token (`security: []`). La ruta ya sale del contrato, así que la excepción de la decisión 1 terminó.
- El registro a mano de `/health`, que seguía en el código como reserva para un contrato sin esa ruta, se quita (cambio de la spec 003 del 2026-10-22). Con él, un contrato sin `/health` igual la expondría, contra la constitución 1, y las pruebas con contratos propios armarían una app distinta del servicio real.
- Las decisiones 2 y 3 siguen igual.
