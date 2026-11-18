# 053 · Tiempos máximos en contract-test y versión fija de Schemathesis

Issue #53 · rama `fix/053-tiempos-contract-test`

## Qué cambió
- `scripts/contrato-test.mjs:pedirToken`: agrega `timeout: 15000` (15 s) a la llamada de `execFile` que ejecuta `docker compose exec -T m2` para firmar el token de prueba.
- `.github/workflows/ci.yml`, job `contract-test`: declara `timeout-minutes: 15` para acotar la duración máxima del job en GitHub Actions.
- `pruebas/unitarias/consistencia.test.ts`: suma un bloque que comprueba con `imagenExacta` que la constante `SCHEMATHESIS` de `scripts/contrato-test.mjs` tiene versión `X.Y.Z` y que tanto `pedirToken` como el job `contract-test` declaran sus tiempos máximos.

## Por qué
Sin `timeout` en `execFile` ni `timeout-minutes` en el job `contract-test`, un contenedor colgado al pedir el token o durante la corrida de Schemathesis dejaba esperando a CI hasta el límite por defecto de GitHub Actions (6 horas). Además, la imagen de Schemathesis tenía versión fija en el script pero ninguna prueba unitaria impedía que pasara a `latest` o a un rango. El uso compartido de `ejemplo.env` entre `m2` y `bd` ya quedó cubierto en las specs previas.

## Cómo se conecta
- Si `pedirToken` supera los 15 s, `execFile` rechaza la promesa y `main` en `scripts/contrato-test.mjs` captura el error, muestra el mensaje de diagnóstico y devuelve código `1`.
- El nombre del job `contract-test` en `.github/workflows/ci.yml` no cambia, manteniendo la regla de protección de `main` (RNF-17.2).

## Qué prueban los tests
- `pruebas/unitarias/consistencia.test.ts`: verifica que `SCHEMATHESIS` en `scripts/contrato-test.mjs` cumple `imagenExacta`, que `pedirToken` incluye la opción `timeout` y que `ci.yml` define `timeout-minutes > 0` en `contract-test`.

## Qué mirar con atención
- Los 15 s de `pedirToken` alcanzan con margen porque el paso se ejecuta después de que `servicioResponde()` confirma un `200` en `/health`.
- Los 15 minutos del job `contract-test` cubren la descarga y compilación de imágenes, el arranque con `--wait`, la corrida de Schemathesis y la prueba de parada ordenada.
