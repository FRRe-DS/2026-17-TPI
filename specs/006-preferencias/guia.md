# Guía — Spec 006 Preferencias

## Tareas

### T1 — Migración uno-a-uno y restricciones · commit `006/T1`
- Qué cambió: `migraciones/1792868607098_preferencias.sql` crea `preferencias_cliente`, con PK/FK sobre `cliente_id`, borrado en cascada, tres listas vacías por defecto y observaciones opcionales de hasta 255 caracteres.
- Por qué así: una fila representa el conjunto completo (RF-2.3, RNF-08). La PK ya indexa la FK. Los checks `<@` limitan enumerados; `arreglo_sin_repetidos(text[])`, SQL `IMMUTABLE`, compara cardinalidad y elementos distintos. También rechaza elementos nulos: `count(DISTINCT)` no los cuenta.
- Cómo se conecta: `migrar()` descubre el archivo sin cambiar el arranque. `DEPENDIENTES` en `pruebas/integracion/clientes.test.ts` incluye preferencias para revertirla antes de la tabla de perfiles.
- Tests: `pruebas/integracion/preferencias.test.ts` cubre PK/FK, volatilidad de la función, listas vacías, enumerados completos, nulos, desconocidos, repetidos, límites, actualización inválida, cascada y reversión/reaplicación. Rojo: 20 pruebas fallaron sin migración. Verde: `npm test`, 2672 pruebas en 33 archivos; lint, build y spec-check correctos (2026-10-24).
- Para mirar con atención: la función se borra después de la tabla en Down. No contiene subconsultas dentro de un CHECK; la subconsulta está dentro de la función inmutable, como pide el plan.
