---
name: sdd-plan
description: SDD paso 3 - genera el plan técnico de una spec sin dudas abiertas. Usar solo cuando el usuario lo pida indicando la spec.
---
Entrada: la carpeta de la spec (NNN-slug).

Lee docs/constitution.md, AGENTS.md, contrato/openapi.yml y specs/NNN-slug/spec.md. Usa la skill sdd.
NO escribas código. Solo puedes crear o modificar archivos dentro de specs/NNN-slug/ y, si hace falta, un ADR en docs/adr/NNN-slug.md.

Si la spec tiene [NECESITA ACLARACIÓN], para y avísame. Si necesita algo que el contrato no tiene, para y propón contrato-cambio.

Genera specs/NNN-slug/plan.md con las secciones de la skill sdd (contrato, datos, lógica, integraciones, decisiones, pruebas), indicando qué requisito cubre cada parte. Corre spec-check.
