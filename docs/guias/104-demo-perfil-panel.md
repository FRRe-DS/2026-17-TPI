# 104 · La demostración con el perfil `panel` levantado

Issue #104 · rama `fix/104-demo-perfil-panel`

## Qué pasaba
`node scripts/demo.mjs` terminaba con pasos en rojo si el servicio se había levantado con `docker compose --profile panel up -d --build --wait`. La demostración levanta su propio M6 simulado (contenedor `m6-simulado`) con el alias de red `m6`, y el perfil `panel` ya tiene un servicio de compose llamado `m6` en la misma red. M2 llama a `http://m6:3006` y Docker le contestaba con cualquiera de los dos. Según a cuál resolviera, fallaban 2 pasos (los de «M6 caído»: el del panel seguía arriba y no había `503`) o 13 (el M6 del panel no conoce los viajes de la demostración).

## Qué cambió
- `scripts/demo.mjs`, `apartarM6DelPanel`: antes de levantar su M6, mira si el servicio `m6` de compose está corriendo y, si lo está, lo detiene (`docker compose stop m6`) y lo avisa en una línea.
- `scripts/demo.mjs`, `restaurar` y `dejarComoEstaba`: al terminar borra el M6 de la demostración y vuelve a arrancar el del panel (`docker compose start m6`), solo si lo había detenido. Corre una sola vez aunque la pidan a la vez el final de la demostración y una interrupción.
- `scripts/demo.mjs`, manejo de `SIGINT` y `SIGTERM`: Ctrl+C no pasa por el `finally`, así que la restauración también se hace al interrumpir.
- `docs/probar-m2.md`, secciones 1 y 6: cuenta que la demostración detiene el M6 del panel mientras corre y qué hacer si quedó detenido.

Nada cambia en `src/`, `contrato/`, `migraciones/`, `docker-compose.yml` ni en las pruebas.

## Por qué así
M2 lee la dirección de M6 al arrancar, así que no se puede apuntarlo a otro nombre sin recrear el contenedor. Detener el M6 del panel deja un solo dueño del nombre `m6` mientras dura la demostración (unos segundos) y no cambia nada para quien no usa el panel. Se usa `stop` y `start`, no `up`, para volver a arrancar el mismo contenedor sin reconstruirlo.

## Cómo se verifica
Con M2 en el puerto 8090 (`M2_PUERTO=8090`), porque el 8082 estaba ocupado en la máquina de prueba:

| Situación | Resultado |
|---|---|
| Perfil `panel` levantado, antes del cambio | 13 de 51 pasos en rojo |
| Perfil `panel` levantado, dos corridas seguidas | `Todo en orden: 51 pasos comprobados.` las dos; el servicio `m6` vuelve a estar arriba y no queda `m6-simulado` |
| `node scripts/panel-humo.mjs` después de la demostración | las 6 comprobaciones en verde |
| Interrupción con `SIGINT` a la mitad | termina con código 130 y el `m6` del panel vuelve a estar arriba |
| Compose sin perfil | 51 pasos en verde, sin mensajes sobre el panel |

`npx eslint scripts/demo.mjs`, `npm test`, `npm run lint`, `npm run build` y `node scripts/spec-check.mjs` en verde. La demostración no corre en CI.

## Qué mirar con atención
- El M6 del panel guarda en memoria su modo (normal, lento, caído) y los viajes de ejemplo. Al volver a arrancar quedan como en el arranque.
- Mientras corre la demostración, el panel abierto en el navegador muestra que M6 no responde.
- Con `--dejar-m6`, si la demostración se corta antes de la sección 8 y `m6-simulado` sigue arriba, el M6 del panel queda detenido a propósito y el script imprime el comando para volver a usarlo.
- Si se mata el proceso con `kill -9`, no hay restauración: `docker rm -f m6-simulado` y `docker compose start m6`.
