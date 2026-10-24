# Validación 006 — Preferencias

Fecha: 2026-10-24. Rama: `impl/006-preferencias`. Base: `origin/main` (`d561870`).
Veredicto de los requisitos de esta spec: **VALIDADO**.

## Comandos ejecutados

| Verificación | Resultado |
|---|---|
| `npm test` | 2734 pruebas aprobadas, 36 archivos; unitarias, HTTP, módulos e integración con PostgreSQL 18.6 real |
| `npm run lint` | Sin errores |
| `npm run build` | Sin errores |
| `docker compose up -d --build --wait` | Imagen reconstruida, servicio y base saludables; migraciones aplicadas |
| `npm run contrato:test` | Exit 0; 3003 casos aprobados, 30 omitidos; 16 operaciones probadas de 20 totales |
| Redocly 2.62.1, lint OpenAPI | Exit 0; tres advertencias previas (licencia, respuesta 4xx de health, componente sin uso) |
| `node scripts/spec-check.mjs --rama impl/006-preferencias --base origin/main` | OK; avisos previos de cantidad de tareas en 003 y 004 |
| `git diff --check` | Sin errores |

Schemathesis 4.31.1 aprobó examples, coverage, fuzzing y stateful. Semilla: `274589879635787323399205099117253580872`.
Las dos operaciones de preferencias aparecen implementadas, no pendientes.
No se relajaron los chequeos ni se alteró el contrato o la configuración de Schemathesis.

## Requisito → evidencia → resultado

| Requisito | Evidencia | Resultado |
|---|---|---|
| RF-2.3 | `pruebas/integracion/preferencias.test.ts`, reemplazo/repetición T3; `preferencias-http.test.ts`, GET/PUT con listas vacías y observaciones omitidas; curl real | PASS |
| RF-2.3.1 | Integración: consulta guardada con/sin observaciones, incluido texto vacío; unitarias de mapeo; GET persistido por curl | PASS |
| RF-2.3.2 | Unitarias: copias independientes; integración de repositorio y HTTP: predeterminados sin fila ni escritura; curl GET inicial | PASS |
| RF-2.3.3 | Unitarias: enums contra OpenAPI; integración T1: checks en INSERT/UPDATE; HTTP: desconocidos y repetidos 400 | PASS |
| RF-2.3.4 | Nueve casos unitarios de identidad y propiedad, con roles repetidos/UUID normalizados; HTTP CLIENTE ajeno y token mixto en PUT 403 | PASS |
| RF-2.3.4.1 | Unitarias y HTTP: OPERADOR lee, no guarda; SERVICIO/CONDUCTOR rechazados; curl mixto GET 200 y PUT 403 | PASS |
| RF-2.3.5 | Repositorio, servicio y HTTP: sin perfil, GET/PUT 404 sin crear fila; curl con UUID inexistente | PASS |
| RNF-03 | Registro de los dos operationId y orden contractual; HTTP problem+json, 200/400/401/403/404/405; Schemathesis y Redocly | PASS |
| RNF-05 | Migración versionada, PK/FK y Down/Up sobre PostgreSQL real; inspección: SQL propio sin llamadas a M3/M5/M8 | PASS |
| RNF-07 | Unitarias, HTTP, integración y contrato ejecutados, todos aprobados | PASS |
| RNF-08 | T1: PK; T3: ocho corridas de cinco escrituras simultáneas por variante (fila nueva/existente); HTTP concurrente: respuestas completas y una fila | PASS |
| RNF-19 | Pruebas con logs capturados: sin enumerados, observaciones centinela ni JWT; U+0000 da 400 sin cambiar el estado; SQL parametrizado | PASS |
| RNF-20 | Guía con mapa, decisiones, entradas T1–T6, conceptos, preguntas y ejemplos curl ejecutados | PASS |

## Evidencia HTTP manual

Contra `http://localhost:8082`, con perfiles y datos ficticios:
- Alta de perfil: 201. GET sin preferencias: 200 con tres listas vacías.
- PUT completo y repetido: 200 con el mismo objeto. GET posterior devuelve lo persistido.
- OPERADOR y CLIENTE+OPERADOR de otro sujeto: GET 200. PUT mixto ajeno: 403.
- SERVICIO: GET 403. Enum inválido: 400 y el estado anterior permanece.
- PUT con tres listas vacías y sin observaciones: 200 y elimina las observaciones anteriores.
- GET sin perfil: 404 problem+json. GET sin token: 401 problem+json.

Los tokens se obtuvieron del comando de desarrollo del contenedor y no se imprimieron ni guardaron en este informe.
Los comandos reproducibles están en `guia.md`.

## Alcance, constitución y límites de la evidencia

- Rutas, esquemas y códigos conservan OpenAPI. `contrato/`, `package.json` y lockfile no tienen cambios.
- Única funcionalidad nueva: preferencias; los cambios en pruebas de perfiles/arranque/salud son el orden de reversión de la FK y el reconocimiento de los nuevos manejadores.
- Persistencia propia, integridad y concurrencia en PostgreSQL; no hay integraciones, secretos nuevos ni dependencias añadidas. Dominio/documentación en español.
- Schemathesis advierte 404 frecuentes en nueve operaciones por ids aleatorios y rechazos frecuentes de datos generados en `crearBloqueo`. No equivale a cobertura de todos los flujos; el 200 de preferencias y su persistencia están cubiertos con ids conocidos en integración y curl.
- Auditoría adicional `npm audit --omit=dev`: una dependencia transitiva (`fast-uri`) con severidad moderada y corrección disponible. Es heredada de las versiones de `origin/main`; requiere actualización/revisión separada del lockfile. No se ejecutó `npm audit fix`.
- Chequeo TypeScript ampliado `npx tsc --noEmit`: errores preexistentes de mocks incompletos de `BaseDeDatos` en `pruebas/integracion/salud.test.ts` (faltan `tiempoBdMs`/`connect`). El build de producción sí pasa y no hay errores reportados en preferencias. No es uno de los comandos de aprobación exigidos por esta spec; se registra para seguimiento del integrador.
- La validación confirma los requisitos enumerados bajo estas pruebas; no afirma ausencia absoluta de errores ni constituye un despliegue en producción.
