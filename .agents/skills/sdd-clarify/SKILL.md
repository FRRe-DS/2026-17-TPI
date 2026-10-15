---
name: sdd-clarify
description: SDD paso 2 - revisa una spec como QA exigente, sin resolver nada. Usar solo cuando el usuario lo pida indicando la spec.
---
Entrada: la carpeta de la spec (NNN-slug).

Revisa specs/NNN-slug/spec.md con la skill sdd y lista, numerado:
1. Requisitos que no se pueden verificar o no están en EARS.
2. Contradicciones entre requisitos.
3. Casos límite no cubiertos (concurrencia, duplicados, dependencias caídas, permisos por rol).
4. Conflictos con contrato/openapi.yml o con docs/constitution.md.
5. RNF de la etapa que deberían aparecer y no están.

Solo detecta: no propongas soluciones ni modifiques archivos. Cuando yo responda, actualiza la spec y vuelve a correr spec-check.
