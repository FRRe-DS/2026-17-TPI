# Guía Técnica: Regeneración de Índices locales en Windows (Issue #52)

## Qué pasaba
Tras la incorporación de la regla global `.gitattributes` (#26) en la rama principal, se detectó una "trampa de Windows" en el entorno de desarrollo local. Los archivos que ya habían sido indexados previamente en discos duros Windows conservaban de forma persistente sus finales de línea en formato `CRLF` en la memoria caché oculta de Git. Esto provocaba que los validadores locales (`spec-check`) continuaran arrojando fallas de codificación a pesar de la existencia de la regla de normalización.

## Cómo se arregló
Para solucionar esta inconsistencia de infraestructura y forzar la paridad con entornos Linux, se purgó por completo el índice de la memoria caché local mediante el comando:
`git rm --cached -r -q .`

Posteriormente, se forzó la regeneración obligatoria de todos los archivos del espacio de trabajo aplicando la regla nativa de Git mediante el comando:
`git reset --hard`

## Validación de Entorno Limpio (Prueba del README)
De acuerdo a las exigencias del issue, se procedió a auditar el manual de bienvenida (`README.md`) ejecutando una instalación limpia desde cero en el entorno de desarrollo local:
1. Se inicializó de forma exitosa el motor de base de datos PostgreSQL mediante `docker compose up -d --build --wait`.
2. Se ejecutó la suite completa de control de calidad integrando las pruebas del equipo mediante `npm test`.

Todo anduvo perfecto: pasaron las 2734 pruebas en verde al 100%.
