---
name: sdd-tasks
description: SDD paso 4 - divide el plan de una spec en tareas pequeñas y verificables. Usar solo cuando el usuario lo pida indicando la spec.
---
Entrada: la carpeta de la spec (NNN-slug).

A partir de spec.md y plan.md, genera specs/NNN-slug/tasks.md con el formato de la skill sdd: tareas de 20-30 minutos, en orden de dependencia, desde T1, cada una con sus requisitos y una línea "Hecho cuando:" verificable. Si salen más de 10, propone dividir la spec.

NO escribas código. Corre spec-check. Siguiente paso: sdd-pr (PR de spec).
