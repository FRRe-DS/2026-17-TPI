# 150 · `demo.mjs --dejar-m6` deja el M6 simulado arriba

Issue #150 · rama `fix/150-demo-dejar-m6`

## Qué pasaba
`node scripts/demo.mjs --dejar-m6` prometía no borrar el M6 simulado al terminar, pero al final no quedaba nada. El contenedor `m6-simulado` se lanza con `docker run --rm`, y la sección 8 lo detiene con `docker stop` para mostrar M6 caído. Con `--rm`, detenerlo también lo borra.

## Qué cambió
- `scripts/demo.mjs`: `levantarM6` recuerda el cliente de la demostración. Al terminar, con `--dejar-m6`, `dejarM6Arriba` mira si `m6-simulado` sigue corriendo; si no, lo vuelve a levantar con ese cliente. Después dice cómo borrarlo. Sin la opción, todo sigue como antes: lo borra.
- Si la demostración se corta antes de levantar el simulado, no hay cliente y no se levanta nada.
- El comentario de cabecera del script y `docs/probar-m2.md` dicen ahora lo que hace la opción.

Nada cambia en `src/`, `contrato/`, `pruebas/` ni en las specs.

## Por qué así
- **Volver a levantarlo al final, y no dejar de borrarlo en la sección 8:** la sección 8 tiene que mostrar M6 caído de verdad, con la conexión rechazada. Pausar el contenedor o sacarlo de la red cambiaría lo que ve M2 (esperas hasta el tiempo máximo, o un nombre que no resuelve) y lo que muestra la demostración.
- **Quitar `--rm` tampoco alcanzaba:** el contenedor quedaría detenido y no arriba, que es lo que pide la opción.
- **Con el mismo cliente:** el simulado responde viajes según el cliente que recibe al arrancar, así que con otro cliente no serviría para seguir probando los datos que dejó la demostración.
- **El M6 del panel sigue la regla de antes:** si el de la demostración queda arriba, el del panel queda detenido para no repetir el alias `m6`, y el script dice cómo volver a usarlo.

## Cómo se verifica
Con el compose por defecto levantado (`docker compose up -d --build --wait`):

| Situación | Resultado |
|---|---|
| `node scripts/demo.mjs --dejar-m6` | 61 pasos en orden; al final «El M6 simulado queda arriba (contenedor m6-simulado, cliente …)»; `docker ps` lo muestra `Up` |
| Después, `fetch` a `http://m6:3006/trips` desde el contenedor de M2 | `200` |
| `node scripts/demo.mjs` sin la opción | 61 pasos en orden; no queda ningún contenedor `m6-simulado` |

`npm test`, `npm run lint` y `node scripts/spec-check.mjs` en verde.
