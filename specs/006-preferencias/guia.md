# Guía — Spec 006 Preferencias

## Visión general

El cliente puede consultar y reemplazar sus preferencias de vehículo, comunicación y accesibilidad.
GET devuelve tres listas vacías si todavía no configuró nada, sin escribir en la base; PUT guarda un conjunto completo.
OPERADOR puede consultar a otros clientes, pero únicamente CLIENTE puede guardar lo propio.

**Recorrido de una petición.**
1. `src/operaciones/index.ts` asocia los dos manejadores; `registrarOperaciones` toma rutas, esquemas y roles de OpenAPI.
2. `src/auth/permisos.ts:registrarPermisos` verifica token y rol, y el validador contractual rechaza cuerpos inválidos.
3. `src/preferencias/operaciones.ts` extrae identidad, roles, clienteId y cuerpo; no escribe valores en logs.
4. `src/preferencias/servicio.ts` comprueba rol efectivo y propiedad antes de consultar, y normaliza el UUID.
5. `src/preferencias/repositorio.ts` lee con LEFT JOIN o reemplaza con UPSERT; `modelo.ts:aPreferencias` arma la respuesta.

**Mapa.**
| Archivo | Responsabilidad | Requisitos |
|---|---|---|
| `migraciones/1792868607098_preferencias.sql` | PK/FK, valores admitidos y función inmutable sin repetidos | RF-2.3.3, RNF-05, RNF-08 |
| `src/preferencias/modelo.ts` | Tipos del contrato, copias y predeterminados | RF-2.3.1, RF-2.3.2 |
| `src/preferencias/repositorio.ts` | Consulta, reemplazo completo y 404 sin perfil | RF-2.3, RF-2.3.1, RF-2.3.2, RF-2.3.5 |
| `src/preferencias/servicio.ts` | Rol efectivo, propiedad y normalización | RF-2.3.4, RF-2.3.4.1 |
| `src/preferencias/operaciones.ts`, `src/operaciones/index.ts` | GET/PUT y registro en orden contractual | RNF-03, RNF-19 |
| `pruebas/{unitarias,http,integracion}/preferencias*.test.ts` | Modelo, validación, permisos, privacidad y concurrencia | RNF-07, RNF-08, RNF-19 |

**Decisiones clave.** Una fila por perfil, protegida por PK; cada PUT asigna las cuatro columnas en una sola sentencia.
Se descartó fusionar listas o actualizarlas por separado: permitiría conservar datos omitidos o mezclar solicitudes concurrentes.
Observaciones omitidas se eliminan; una cadena vacía se conserva. No se necesita Idempotency-Key para PUT.
La ausencia de perfil se distingue dentro de la propia consulta; no se hace una lectura adicional para comprobarlo.
La propiedad usa la regla de la 004: CLIENTE+OPERADOR lee ajeno, pero no lo guarda porque PUT solo admite CLIENTE.
Los detalles y alternativas están en `plan.md` y en las entradas T1 a T5 de abajo.

**Conceptos.** UPSERT combina INSERT y UPDATE ante una misma clave; no es un PATCH.
Rol efectivo es la intersección entre roles del token y de la operación. GET sin preferencias no crea una fila.

**Cómo probarlo uno mismo.** Ejemplos comprobados el 2026-10-24 contra el compose, con datos ficticios:
```bash
docker compose up -d --build --wait
CLI=$(node -p "require('node:crypto').randomUUID()"); B=http://localhost:8082/api/v1/clientes
token() { docker compose exec -T m2 node dist/herramientas/token.js --sub "$1" --roles "$2"; }
TC=$(token "$CLI" CLIENTE); TM=$(token operador-ficticio CLIENTE,OPERADOR)
curl -i -X POST "$B" -H "Authorization: Bearer $TC" -H "Idempotency-Key: guia-006-$CLI" -H 'Content-Type: application/json' \
  -d '{"nombre":"Ana","apellido":"Ejemplo","telefono":"+5493624000000"}' # 201
curl -i "$B/$CLI/preferencias" -H "Authorization: Bearer $TC" # 200: tres listas vacías
curl -i -X PUT "$B/$CLI/preferencias" -H "Authorization: Bearer $TC" -H 'Content-Type: application/json' \
  -d '{"tiposVehiculo":["AUTO"],"canales":["PUSH"],"accesibilidad":["ANIMAL_DE_ASISTENCIA"],"observacionesAccesibilidad":"Ejemplo ficticio de la guia 006"}' # 200; repetido, 200 igual
curl -i "$B/$CLI/preferencias" -H "Authorization: Bearer $TM" # 200: lectura ajena como OPERADOR
curl -i -X PUT "$B/$CLI/preferencias" -H "Authorization: Bearer $TM" -H 'Content-Type: application/json' \
  -d '{"tiposVehiculo":[],"canales":[],"accesibilidad":[]}' # 403; con TC, 200 y elimina observaciones
npm test && npm run contrato:test
```

**Preguntas de comprobación.**
1. ¿Cómo distingue el LEFT JOIN entre perfil inexistente y perfil sin preferencias?
2. ¿Qué ocurre con las observaciones si un PUT no las envía? ¿Y si manda una cadena vacía?
3. ¿Por qué CLIENTE+OPERADOR consulta ajeno pero no lo modifica?
4. ¿Qué garantiza que dos PUT simultáneos no mezclen listas ni creen dos filas?

## Tareas

### T1 — Migración uno-a-uno y restricciones · commit `006/T1`
- Qué cambió: `migraciones/1792868607098_preferencias.sql` crea `preferencias_cliente`, con PK/FK sobre `cliente_id`, borrado en cascada, tres listas vacías por defecto y observaciones opcionales de hasta 255 caracteres.
- Por qué así: una fila representa el conjunto completo (RF-2.3, RNF-08). La PK ya indexa la FK. Los checks `<@` limitan enumerados; `arreglo_sin_repetidos(text[])`, SQL `IMMUTABLE`, compara cardinalidad y elementos distintos. También rechaza elementos nulos: `count(DISTINCT)` no los cuenta.
- Cómo se conecta: `migrar()` descubre el archivo sin cambiar el arranque. `DEPENDIENTES` en `pruebas/integracion/clientes.test.ts` incluye preferencias para revertirla antes de la tabla de perfiles.
- Tests: `pruebas/integracion/preferencias.test.ts` cubre PK/FK, volatilidad de la función, listas vacías, enumerados completos, nulos, desconocidos, repetidos, límites, actualización inválida, cascada y reversión/reaplicación. Rojo: 20 pruebas fallaron sin migración. Verde: `npm test`, 2672 pruebas en 33 archivos; lint, build y spec-check correctos (2026-10-24).
- Para mirar con atención: la función se borra después de la tabla en Down. No contiene subconsultas dentro de un CHECK; la subconsulta está dentro de la función inmutable, como pide el plan.

### T2 — Modelo y consulta sin efectos laterales · commit `006/T2`
- Qué cambió: `src/preferencias/modelo.ts` toma los tipos del contrato generado y expone enumerados, `aPreferencias()` y `preferenciasPredeterminadas()`. `src/preferencias/repositorio.ts:obtenerPreferencias()` consulta perfil y preferencias con LEFT JOIN.
- Por qué así: una sola sentencia distingue 404 sin perfil de 200 sin fila de preferencias, sin una segunda consulta ni INSERT en GET (RF-2.3.1, RF-2.3.2, RF-2.3.5). Las listas se copian por respuesta; las observaciones nulas se omiten y las vacías se conservan.
- Cómo se conecta: recibe `Consultar`, igual que los repositorios de la 004/005; T4 lo conecta con el pool y la identidad.
- Tests: `pruebas/unitarias/preferencias.test.ts` verifica copias, mapeo y enumerados contra OpenAPI; las nuevas pruebas de integración verifican predeterminados sin escritura, 404 y filas con/sin observaciones. Rojo: módulo inexistente. Verde: `npm test`, 2682 pruebas en 34 archivos; lint y build correctos (2026-10-24).
- Para mirar con atención: no se reutiliza un objeto predeterminado global mutable. El id del lado derecho del JOIN indica si existe la fila, sin confundir listas vacías guardadas con ausencia de preferencias.

### T3 — UPSERT atómico y concurrencia · commit `006/T3`
- Qué cambió: `src/preferencias/repositorio.ts:guardarPreferencias()` usa INSERT … SELECT desde el perfil, ON CONFLICT sobre la PK y RETURNING de las cuatro columnas.
- Por qué así: PUT reemplaza todo; no lee para fusionar ni actualiza por separado las listas (RF-2.3, RNF-08). PostgreSQL serializa los conflictos sobre la misma clave. Observaciones omitidas pasan a NULL y desaparecen de la respuesta; listas vacías borran las selecciones anteriores.
- Cómo se conecta: usa `Consultar` como la lectura y conserva el límite/clasificación de errores del pool. La comprobación de perfil se hace en la propia sentencia en vez de una lectura separada: sin perfil no hay INSERT y se devuelve `NoEncontrado`, evitando un 500 por FK.
- Tests: cuatro pruebas de integración nuevas, primero rojas por función inexistente. Cubren repetición, reemplazo total, ausencia de perfil y dos variantes concurrentes, cada una con ocho corridas de cinco escrituras simultáneas: cada respuesta coincide con su solicitud, el estado final es uno de los objetos completos y hay una fila. `npm test`: 2686 pruebas en 34 archivos, en verde (2026-10-24).
- Para mirar con atención: no requiere Idempotency-Key; la semántica idempotente sale de reemplazar el recurso completo. El orden efectivo lo determina la base, no el orden de llegada de las promesas.

### T4 — Rol efectivo, propiedad y permisos · commit `006/T4`
- Qué cambió: `src/preferencias/servicio.ts` expone lectura y guardado; reutiliza `autorizar()` y `exigirPropietario()` de las capas existentes, normaliza ids y delega al repositorio.
- Por qué así: roles admitidos y propiedad se resuelven antes de acceder a la base (RF-2.3.4, RF-2.3.4.1). Un token mixto lee como OPERADOR en GET, mientras PUT solo admite CLIENTE. No basta con tener CLIENTE entre varios roles para exigir propiedad en todas las lecturas.
- Cómo se conecta: T5 pasa los roles declarados por la ruta OpenAPI; no hay permisos nuevos ni una segunda regla de propiedad. El repositorio conserva el 404 sin perfil (RF-2.3.5).
- Tests: nueve casos unitarios de roles, dueño/ajeno, roles repetidos y UUID normalizados; dos de integración para lecturas reales y perfil inexistente sin escritura. Rojo: servicio inexistente. Verde: `npm test`, 2697 pruebas en 34 archivos; lint y build correctos (2026-10-24).
- Para mirar con atención: el servicio también llama `autorizar()`, de modo que OPERADOR en escritura y SERVICIO/CONDUCTOR se rechazan incluso al invocarlo directamente. La verificación ampliada `npx tsc --noEmit` encuentra errores preexistentes en los pools falsos de `pruebas/integracion/salud.test.ts`; no reporta errores en los archivos de preferencias. El build de producción pasa.

### T5 — Operaciones HTTP, validación y privacidad · commit `006/T5`
- Qué cambió: `src/preferencias/operaciones.ts` expone GET y PUT; `src/operaciones/index.ts` registra `obtenerPreferencias` y `guardarPreferencias` en el orden del contrato. Las listas fijas de `pruebas/integracion/arranque.test.ts` y `salud.test.ts` incluyen las dos operaciones.
- Por qué así: rutas, esquemas, validaciones y roles siguen saliendo de OpenAPI (RNF-03). Los manejadores solo extraen identidad, roles, ruta y cuerpo, y llaman al servicio; no registran valores del cuerpo (RNF-19).
- Cómo se conecta: la petición pasa por autenticación/rol, validación contractual, servicio (propiedad) y repositorio. GET/PUT devuelven 200 con el objeto completo; sin perfil, 404. PUT no necesita Idempotency-Key.
- Tests: `pruebas/http/preferencias.test.ts` cubre 401/403/400/405 sin base, campos ausentes/extra, enums, repetidos, nulos, observaciones e ids; `pruebas/integracion/preferencias-http.test.ts` cubre 200, predeterminados sin escritura, reemplazo/repetición, listas vacías, observaciones vacías/límite/Unicode, 404 problem+json, roles mixtos, concurrencia y logs sin valores ni JWT. U+0000 da 400 y conserva el conjunto previo. Rojo: faltaban los manejadores. Verde: `npm test`, 2734 pruebas en 36 archivos; lint, build, spec-check y diff-check correctos (2026-10-24).
- Para mirar con atención: la prueba de privacidad busca todos los enumerados, observaciones centinela y JWT completos. La validación contractual y la visión general se completaron en T6, por pedido de Lucciano.

### T6 — Contrato, regresión y documentación · commit `006/T6`
- Qué cambió: esta visión general, las preguntas y los ejemplos curl comprobados; `validacion.md` guarda la evidencia y la cobertura requisito por requisito. No cambió código ni configuración para hacer pasar las pruebas.
- Por qué así: las pruebas de contrato verifican las 16 operaciones implementadas, incluidas `obtenerPreferencias` y `guardarPreferencias`; los ejemplos y la integración cubren además el 200 con perfiles conocidos (RNF-07, RNF-20).
- Cómo se conecta: la imagen se reconstruyó desde esta rama con `docker compose up -d --build --wait`; el servicio y PostgreSQL quedaron saludables y aplicaron las migraciones.
- Tests: `npm test`, 2734 pruebas en 36 archivos; lint, build y spec-check correctos. `npm run contrato:test`: 3003 casos generados y aprobados, 30 omitidos por Schemathesis, 16/20 operaciones seleccionadas, fases examples/coverage/fuzzing/stateful en verde. Redocly valida OpenAPI con tres advertencias preexistentes. Se comprobaron con curl alta ficticia, predeterminados, reemplazo, repetición, persistencia, permisos, validación, borrado de selecciones/observaciones y 404/401 (2026-10-24).
- Para mirar con atención: Schemathesis advierte poco acceso a casos exitosos con ids aleatorios y muchos rechazos del alta de bloqueos; no desactivamos chequeos. El 200 de preferencias se verifica por integración y curl. Las corridas crearon datos ficticios en el volumen local del compose. Limitaciones ajenas a esta spec: auditoría moderada de `fast-uri` heredada del lockfile y errores de tipos de mocks previos en `salud.test.ts`; detalle en el informe.
