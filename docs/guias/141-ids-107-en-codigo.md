# 141 · IDs de la spec 107 renumerados en el código

Issue #141 · rama `fix/141-ids-107-en-codigo`

## Qué pasaba
La spec 071 (front, 2026-10-27) y la 107 (caché del estado de cuenta con Redis, 2026-11-14) usaban RF-2.6.5, RF-2.6.6 y RF-2.6.7 para requisitos distintos. Un comentario o una prueba que citaba «RF-2.6.6» podía hablar de la vista del operador o de la invalidación de la caché, y la trazabilidad entre spec, código y pruebas se perdía.

## Qué cambió
- La 107, que llegó después, se renumera sumando 3: RF-2.6.5 → RF-2.6.8, RF-2.6.6 → RF-2.6.9, RF-2.6.7 → RF-2.6.10 y RF-2.6.8 → RF-2.6.11, con sus sub-ID (RF-2.6.5.3 → RF-2.6.8.3, etc.). La spec, el plan, las tareas y la guía de la 107 cambian en su PR de spec (`spec/107-redis-estado-cuenta-cambio-ids`).
- Acá, lo mismo en los comentarios de `src/` (`app.ts`, `cache/redis.ts`, `cache/estado-cuenta.ts`, `clientes/servicio.ts`) y en los comentarios y nombres de las pruebas de la caché (`pruebas/unitarias/`, `pruebas/http/`, `pruebas/integracion/`): 55 menciones en 11 archivos.
- `panel/` y `pruebas/panel/` no cambian: sus RF-2.6.5 a RF-2.6.7 son los de la 071, que conservan su número.

No cambia ningún comportamiento: solo comentarios y textos de `describe`/`it`.

## Por qué así
- **Se renumera la 107 y no la 071:** la 071 tenía esos ID primero.
- **Sumando 3 y no solo los repetidos:** RF-2.6.8 ya era de la 107; correr todo el bloque mantiene el orden de los requisitos y deja RF-2.6.8 a RF-2.6.11 contiguos.
- **Un reemplazo en un solo paso:** cada ID se calcula desde el original, así RF-2.6.5 no pasa a RF-2.6.8 y después a RF-2.6.11.

## Cómo se verifica
- `grep -rnE "RF-2\.6\.[5-7]([^0-9]|$)" src pruebas --include=*.ts | grep -v pruebas/panel` no encuentra nada.
- Cada línea cambiada difiere de la anterior solo en el número de ID.
- `npm run lint`, `npm run build`, `npm test` y `node scripts/spec-check.mjs` en verde.
