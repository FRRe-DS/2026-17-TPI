# 053 · Tiempos máximos en contract-test y versión fija de Schemathesis

Issue #53 · rama `fix/053-tiempos-contract-test`

## Qué pasaba
Ni el job `contract-test` de GitHub Actions ni la función `pedirToken` de `scripts/contrato-test.mjs` tenían un tiempo máximo: si el contenedor se colgaba al firmar el token o durante la corrida de Schemathesis, CI quedaba esperando hasta el límite por defecto de GitHub Actions (6 horas). Además, como parte de lo pedido de forma opcional en el issue, la imagen de Schemathesis en `scripts/contrato-test.mjs` tenía versión fija pero ninguna prueba unitaria impedía cambiarla a `latest` o a un rango.

## Qué cambió
- `scripts/contrato-test.mjs`, `pedirToken` y `main`: agrega `timeout: 15000` (15 s) al `execFile` que ejecuta `docker compose exec -T m2` para firmar el token de prueba. Si se vence el plazo (`error.killed`), el mensaje de error aclara `(no respondió en 15 s)` y devuelve código `1`.
- `.github/workflows/ci.yml`, job `contract-test`: declara `timeout-minutes: 15` debajo de `runs-on: ubuntu-24.04`.
- `pruebas/unitarias/consistencia.test.ts`: suma el bloque `scripts/contrato-test.mjs y job contract-test (RNF-04.1, RNF-07)`, que comprueba con `imagenExacta` la versión exacta de `SCHEMATHESIS`, verifica que `timeout:` esté declarado dentro del cuerpo de `async function pedirToken()` y confirma que `contract-test` define `timeout-minutes > 0`.

Nada cambia en `src/`, `contrato/`, `migraciones/` ni `docker-compose.yml` (el uso compartido de `ejemplo.env` entre `m2` y `bd` ya estaba cubierto en specs previas).

## Por qué así
- Acotar `pedirToken` en el script corta rápido un cuelgue puntual al pedir el token y da un mensaje claro al distinguir si el proceso murió por tiempo (`error.killed`).
- El `timeout-minutes: 15` del job resguarda el resto de la ejecución en CI (arranque de servicios y corrida de Schemathesis) sin cambiar el nombre del job `contract-test`, que exige la regla de protección de `main` (RNF-17.2).
- La comprobación de `timeout:` en `consistencia.test.ts` recorta primero el bloque de `async function pedirToken()` para evitar falsos positivos si aparece otro `timeout:` más abajo en el archivo.
- Se incluyó también la prueba de versión exacta de Schemathesis pedida como opcional en el issue porque compartía archivo y contexto con la verificación del script.

## Cómo se verifica
- `npm test`: corre `pruebas/unitarias/consistencia.test.ts`, que valida:
  - la versión exacta de la imagen de Schemathesis (`imagenExacta`),
  - la presencia de `timeout:` exclusivamente dentro de `pedirToken`,
  - `timeout-minutes > 0` en el job `contract-test` de `.github/workflows/ci.yml`.
- Prueba negativa manual sobre `pedirToken`: al quitar temporalmente `timeout: 15000` de `pedirToken` (incluso agregando otro `timeout` más abajo en el script), `consistencia.test.ts` falla; al restaurarlo vuelve a pasar.
- `npm run lint`, `npm run build` y `node scripts/spec-check.mjs` en verde.
- La corrida completa de `npm run contrato:test` (Schemathesis contra el servicio levantado) se valida en el job `contract-test` del PR en CI.

## Qué mirar con atención
- Los 15 s de `pedirToken` alcanzan con margen porque el paso se ejecuta después de que `servicioResponde()` confirma un `200` en `/health`.
- Los 15 minutos del job `contract-test` cubren la descarga y compilación de imágenes, el arranque con `--wait`, la corrida de Schemathesis y la prueba de parada ordenada.