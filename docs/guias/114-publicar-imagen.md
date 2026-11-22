# 114 · Publicación automática de la imagen de la API en GHCR

Issue #114 · rama `fix/114-publicar-imagen`

## Qué pasaba
El repositorio tenía `Dockerfile` y `ci.yml` funcionando, pero no publicaba la imagen compilada de la API en un registry. Para desplegar el módulo M2 en la nube y ejecutar las pruebas de carga era necesario construir la imagen manualmente en cada entorno en lugar de consumir un artefacto versionado.

## Qué cambió
- `.github/workflows/publicar.yml`: nuevo workflow independiente que corre en `ubuntu-24.04`, construye la imagen de la API a partir del `Dockerfile` de la raíz y la publica en GitHub Container Registry como `ghcr.io/frre-ds/2026-17-tpi-api`.
- Se dispara mediante `workflow_run` únicamente cuando el workflow de CI finaliza en verde (`success`) tras un `push` a `main` (evitando publicar desde PRs o forks), además de soportar tags `v*` y ejecución manual (`workflow_dispatch`).
- Los datos del evento (`head_sha` y `head_branch`) se pasan por variables de entorno (`env:`) al paso de resolución en lugar de interpolarlos directo en el script.
- Publica las etiquetas `sha-<7-caracteres>`, `main`, `latest` (y la etiqueta de versión si se dispara por tag `v*`).
- Todas las acciones quedaron fijadas a versiones exactas (`actions/checkout@v7.0.1`, `docker/login-action@v4.8.0`, `docker/metadata-action@v6.2.0` y `docker/build-push-action@v7.4.0`).

Nada cambia en `src/`, `contrato/`, `migraciones/`, `Dockerfile`, `docker-compose.yml` ni en `.github/workflows/ci.yml`.

## Por qué así
- Separar `publicar.yml` de `ci.yml` evita modificar los checks obligatorios de los PRs y aísla el permiso `packages: write` en un archivo dedicado.
- Usar `workflow_run` filtrado a `conclusion == 'success'` y `event == 'push'` asegura que nunca se publique una imagen cuyas pruebas fallaron ni código proveniente de un PR de un fork.
- La imagen pasó a llamarse `2026-17-tpi-api` (armada a partir de `${{ github.repository }}-api`) para mantener correspondencia directa con el nombre del repositorio en `FRRe-DS` y distinguir explícitamente la imagen de la API en caso de que más adelante se publique otro servicio (como el panel o un simulador).
- Autenticar contra GHCR con `GITHUB_TOKEN` evita crear y mantener secretos adicionales en el repositorio.
- Para el despliegue y las mediciones de carga se recomienda fijar la etiqueta inmutable `sha-<commit>` (en lugar de `latest`), de modo de saber exactamente qué versión se está midiendo; `latest` se sigue publicando por conveniencia.

## Cómo se verifica
- En el PR, `ci.yml` (`build-test` y `spec-check`) debe terminar en verde sin alteraciones.
- Una vez mergeado a `main` y finalizado el CI en verde, en la pestaña **Actions** debe ejecutarse **Publicar imagen en GHCR** y aparecer el paquete `2026-17-tpi-api` en la sección **Packages** del repositorio.
- Con el paquete en visibilidad pública, descargar la imagen fijando el `sha-` del commit:

```bash
docker pull ghcr.io/frre-ds/2026-17-tpi-api:sha-<7-caracteres>
```

## Qué mirar con atención
- En GitHub Actions, el trigger `workflow_run` solo se activa automáticamente una vez que `publicar.yml` está en la rama por defecto (`main`).
- Si en el futuro cambia el `name:` del workflow en `.github/workflows/ci.yml`, hay que actualizar el valor correspondiente en `on.workflow_run.workflows` de `publicar.yml`.
