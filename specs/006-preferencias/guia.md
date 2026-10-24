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
