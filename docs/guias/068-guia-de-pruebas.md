# 068 · Guía de pruebas de M2 y script de demostración

Issue #68 · rama `fix/068-guia-de-pruebas`

## Qué cambió
- `docs/probar-m2.md` (nuevo): guía para quien evalúa el módulo y para el grupo. Tiene una prueba rápida de tres comandos, qué recorre la demostración por requisito (RF-2.1 a RF-2.6, seguridad y resiliencia), cómo probar a mano con tokens, la tabla de roles, las pruebas automáticas y qué prueba cada carpeta de `pruebas/`, el mapa del repositorio (dónde está cada funcionalidad, con su spec, su carpeta de `src/` y sus tablas), qué está simulado y qué no, y qué hacer si algo falla.
- `scripts/demo.mjs` (nuevo): recorre las 20 operaciones contra el servicio levantado con docker compose, en 51 pasos, y comprueba el estado HTTP y los campos que importan de cada respuesta. Levanta un M6 simulado en un contenedor, lo detiene en el último tramo para mostrar el `503`, y lo borra al terminar. Con `--detalle` imprime el `curl` equivalente; con `--dejar-m6` conserva el simulado.
- `README.md`: un párrafo que lleva a la guía y a la demostración, y `scripts/demo.mjs` en la lista del orden del repositorio.

Nada cambia en `src/`, `contrato/`, `migraciones/` ni en las pruebas.

## Por qué
El README explicaba cómo levantar el servicio y cómo probar las calificaciones con un M6 simulado, pero no había un recorrido que probara cada funcionalidad de punta a punta, ni un mapa de qué hay en cada lugar. Quien evalúa el módulo tenía que armar los `curl` leyendo el contrato, y quien llegaba al grupo tenía que deducir la estructura del código.

La demostración es un script de Node y no de shell: el repo ya exige Node 24 y los demás scripts son `.mjs`, y así corre igual en Windows. Usa `fetch`, el comando de tokens del contenedor y `docker`, sin dependencias nuevas. El M6 simulado reutiliza la técnica del README (un contenedor de la imagen del servicio con el alias de red `m6`), pero responde según el comienzo del id del viaje, para poder mostrar viaje en curso, ajeno e inexistente sin reconfigurarlo.

## Cómo se conecta
- La demostración usa solo la API pública del servicio y el comando `dist/herramientas/token.js`, como `scripts/contrato-test.mjs`. No es una prueba de CI: `npm run contrato:test` sigue siendo la que prueba contra el contrato.
- Las calificaciones y el historial dependen de la spec 008 (PR #67): sin ella, la sección 7 de la demostración falla.
- La guía enlaza `pruebas/unitarias/m6-simulado.test.ts` como la prueba de que el M6 simulado cumple `m6.yml`.

## Cómo se verifica
Con el servicio levantado desde esta rama (`docker compose up -d --build --wait`):

| Comando | Resultado |
|---|---|
| `node scripts/demo.mjs` (dos veces seguidas) | `Todo en orden: 51 pasos comprobados.` las dos, sin dejar el contenedor `m6-simulado` |
| `node scripts/demo.mjs --detalle` | agrega el `curl` y la respuesta de cada paso |
| `M2_PUERTO=8090 docker compose up -d --wait` y `M2_PUERTO=8090 node scripts/demo.mjs` | 51 pasos en verde en otro puerto |
| `M2_PUERTO=9999 node scripts/demo.mjs` | dice que el servicio no responde y termina con código 2 |
| Primera corrida, antes de ajustar dos comprobaciones (el total de una lista se llama `totalElementos`) | marcó 2 pasos con ✘ y terminó con código 1: el script sí detecta lo que no coincide |

`npx eslint scripts/demo.mjs`, `npm test`, `npm run lint`, `npm run build` y `node scripts/spec-check.mjs` en verde.

## Qué mirar con atención
- La demostración crea un cliente nuevo en cada corrida y deja sus datos en la base local: no es un problema, pero la base crece. `docker compose down -v` la borra.
- Los comentarios sobre los viajes del M6 simulado dependen del comienzo de su id (`2222…` en curso, `3333…` de otro cliente, `4444…` inexistente). Si cambia la forma en que M2 llama a M6 o el contrato de M6 (`contrato/dependencias/m6.yml`), hay que ajustar `CODIGO_M6` en el script.
- La guía afirma lo que se comprobó en esta fecha. Si cambian las operaciones o los roles, se actualiza junto con el contrato (RNF-20).
