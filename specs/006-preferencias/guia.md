# Guía — Spec 006 Preferencias

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
- Para mirar con atención: la prueba de privacidad busca todos los enumerados, observaciones centinela y JWT completos. T6 sigue pendiente: Renzo debe ejecutar `npm run contrato:test`, completar la visión general con curl comprobados y abrir el PR; la spec conserva `Estado: aprobada` hasta esa validación.
