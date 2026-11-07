# Guía — Spec 081 Integración distribuida de M2 con el M6 real del Grupo 12

## Visión general

_Se escribe al validar la spec (`081/V`)._

## Tareas

### T1 — Perfil `m6-real` de compose · commit `081/T1`
- Qué cambió: `docker-compose.yml` suma `m6-real` (el M6 del Grupo 12, construido desde su repositorio al commit fijo) y `m6-real-bd` (su Postgres 16.15), los dos solo con `--profile m6-real`. `ejemplo.env` documenta `M6_REAL_PUERTO`, `M6_REAL_COMMIT` y las credenciales de la base de M6. `panel/servidor/entorno-ejemplo.ts` deja de tomar las variables `M6_REAL_*` como si fueran de M2.
- Por qué así: RNF-04.9 pide el entorno reproducible con un comando; RNF-06.6 pide que lo único que cambie en M2 sea `M2_URL_M6`. Por eso `m2` no tiene `depends_on` de `m6-real`: tiene que arrancar aunque M6 no esté (RNF-13). Puertos solo en `127.0.0.1`, porque M6 corre con sus atajos de demo.
- Cómo se conecta: M2 ve a M6 por la red de compose como `http://m6-real:3006`. El M6 simulado del perfil `panel` sigue siendo otro servicio (`m6`) y no se mezcla.
- Tests: `pruebas/unitarias/consistencia.test.ts` (servicios y variables nuevos aceptados, y que sin el perfil no se crea nada de M6), `pruebas/unitarias/ejemplo-env.test.ts` y `pruebas/panel/unitarias/config.test.ts` (el filtro de `M6_REAL_*`).
- Para mirar con atención:
  - **La URL no lleva `/api/v1`.** El plan se escribió con `http://m6-real:3006/api/v1`, pero el M6 real sirve en `/trips`, igual que el contrato de la cátedra. El prefijo que usa M2 sale de `servers` de nuestro `contrato/dependencias/m6.yml`. Comprobado con M2: `M2_URL_M6=http://m6-real:3006` da `200` y con `/api/v1` da `500`. Se corrigieron `plan.md`, `tasks.md`, `docker-compose.yml` y `ejemplo.env`; la spec no cambia (RNF-06.6 sigue igual). Falta quitar `/api/v1` de `servers` en `m6.yml` y alinear el M6 simulado, que hoy sí lo usa (por eso el valor por defecto de `M2_URL_M6` conserva el prefijo): va en la rama `contrato/079-…`.
  - **Commit fijo.** Se fijó `7d3d5af9138d9b220f109798e9f615ca853d2bda`, con el que se probó. El 2026-11-07 la punta de `m6/base-de-datos` del Grupo 12 es `107d63c7ed0e854334d0b0578a4f6124264d045c`: no se adoptó sin probarla. Para probarla: `M6_REAL_COMMIT=107d63c… docker compose --profile m6-real up -d --build --wait`.
  - **Si M6 responde 404 al listar el historial, M2 contesta `500`, no `503`.** Es el comportamiento actual de M2 ante un código inesperado de M6; queda anotado para las tareas de errores de la 081.
