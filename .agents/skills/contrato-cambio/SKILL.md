---
name: contrato-cambio
description: Prepara una propuesta de cambio al contrato OpenAPI del módulo (ADR, diff y mensaje para los otros grupos). Usar cuando una spec necesita algo que el contrato no tiene, o cuando el usuario lo pida.
---
Entrada: el issue del cambio de contrato (NNN-slug) y qué se necesita.

Solo se modifica contrato/ en la rama contrato/NNN-slug.
1. Describe el cambio: operación o esquema, por qué (spec y requisito que lo necesitan) y si es compatible (agrega campos u operaciones opcionales) o incompatible (renombra, quita o cambia significado: nueva versión de ruta).
2. Redacta el ADR en docs/adr/NNN-slug.md con la plantilla de docs/adr/000-plantilla.md.
3. Aplica el diff a contrato/openapi.yml y corre npx --yes @redocly/cli@2.62.1 lint contrato/openapi.yml.
4. Redacta el mensaje para el Grupo 1 y, si afecta a consumidores, para ellos: qué cambia, por qué, desde qué versión.
5. No abras PR al repositorio de la cátedra: lo hace el responsable de contrato cuando el grupo par acepte. Actualiza contrato/ORIGEN cuando el cambio esté publicado allí.
