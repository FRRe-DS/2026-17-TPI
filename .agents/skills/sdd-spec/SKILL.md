---
name: sdd-spec
description: SDD paso 1 - redacta la spec de un issue. Usar solo cuando el usuario lo pida indicando el issue o la carpeta NNN-slug.
---
Entrada: la carpeta de la spec (NNN-slug, NNN = número del issue) e, opcionalmente, una idea inicial. Si falta la carpeta, pídela.

NO escribas código. Solo puedes crear o modificar archivos dentro de specs/NNN-slug/.

1. Comprueba que estás en la rama spec/NNN-slug; si no existe, créala desde main actualizado (git fetch origin, git switch -c spec/NNN-slug origin/main).
2. Lee el issue (gh issue view N; si no hay gh, pide su texto), los RF de la cátedra que cita, contrato/openapi.yml, docs/constitution.md y la skill sdd.
3. Hazme preguntas de UNA en UNA para eliminar ambigüedades: casos límite, errores, qué queda fuera, qué pasa si una dependencia no responde. Máximo 6.
4. Genera specs/NNN-slug/spec.md con la plantilla de la skill sdd y "Estado: borrador".
5. Corre node scripts/spec-check.mjs y corrige lo que marque.
6. Dime qué quedó en "Dudas abiertas". Siguiente paso: sdd-clarify.
