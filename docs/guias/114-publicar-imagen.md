# 114 — Publicación de imagen Docker en GHCR

## Qué cambia
Se incorpora el workflow `.github/workflows/publicar.yml` para construir la imagen Docker del servicio M2 y publicarla en GitHub Container Registry (`ghcr.io/frre-ds/2026-17-tpi`).

## Cuándo se ejecuta
- **Automático:** en cada `push` a `main` y al crear tags con formato `v*`.
- **Manual:** desde la pestaña **Actions → Publicar imagen en GHCR → Run workflow**.

## Etiquetas generadas
- `sha-<commit>`: identifica de forma unívoca la versión exacta para trazabilidad en pruebas de carga.
- `latest`: apunta siempre al último commit en `main`.
- `<tag>`: cuando se dispara por un tag `v*`.

## Decisiones y seguridad
- Se mantiene separado de `ci.yml` (siguiendo el mismo criterio que `integracion-m6.yml`) para no afectar los checks obligatorios de la protección de `main`.
- Autentica contra `ghcr.io` usando el `GITHUB_TOKEN` temporal de Actions con permisos mínimos (`contents: read` y `packages: write`), sin secretos adicionales.
- **Visibilidad del paquete:** tras la primera publicación, un administrador de `FRRe-DS` debe marcar el paquete como público en GHCR para descargar la imagen sin credenciales desde entornos de medición.

## Cómo probarlo
1. Mergear el PR en `main` o disparar manualmente el workflow desde la pestaña **Actions**.
2. Verificar en la pestaña **Packages** del repositorio que aparezca la imagen `ghcr.io/frre-ds/2026-17-tpi` con las etiquetas `latest` y `sha-<commit>`.
3. Comprobar la descarga local (una vez público el paquete):
   ```bash
   docker pull ghcr.io/frre-ds/2026-17-tpi:latest