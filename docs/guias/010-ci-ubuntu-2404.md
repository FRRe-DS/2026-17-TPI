# 010 · CI fijo en Ubuntu 24.04

Issue #10 · rama `fix/010-ci-ubuntu-2404`

## Qué cambió
`.github/workflows/ci.yml`: los cinco jobs (`specs`, `contrato`, `build-test`, `contract-test` y `auditoria-main`) pasan de `runs-on: ubuntu-latest` a `runs-on: ubuntu-24.04`. Ningún paso cambia.

## Por qué
GitHub mueve la etiqueta `ubuntu-latest` de Ubuntu 24.04 a 26.04 de a poco, entre el 19 de octubre y el 19 de noviembre de 2026 (https://github.com/actions/runner-images/issues/14748). Mientras dura la transición, dos corridas del mismo commit pueden caer en imágenes distintas, y un fallo puede venir de la imagen y no del código. Con la versión fija, la imagen cambia solo cuando lo decide el grupo.

## Cómo se conecta
- Hasta el 19 de octubre, `ubuntu-latest` era Ubuntu 24.04: el CI sigue en la imagen con la que ya corría.
- La regla "Protección de main" exige los checks por nombre de job, no por imagen, así que no hay que tocarla.

## Cómo se verifica
No hay tests propios: lo verifica el CI del PR. Los checks `specs`, `contrato`, `build-test` y `contract-test` tienen que pasar, y el paso "Set up job" de cada uno tiene que mostrar la imagen `ubuntu-24.04`. `auditoria-main` corre recién al mergear.

## Qué mirar con atención
- Que no quede ningún `ubuntu-latest` en `.github/workflows/`, tampoco en workflows que se agreguen después.
- Pasar a Ubuntu 26.04 es un cambio aparte: las cinco líneas juntas, con el CI en verde.
