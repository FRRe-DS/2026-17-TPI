---
name: sdd-change
description: Cambio de requisitos sobre una spec ya mergeada - primero la spec, luego el plan y las tareas. Usar solo cuando el usuario lo pida.
---
Entrada: la carpeta de la spec (NNN-slug) y el cambio pedido.

NO toques código. Usa la skill sdd.
1. Trabaja en una rama spec/NNN-<slug>-cambio creada desde main.
2. Actualiza spec.md: requisito nuevo o modificado en EARS, sus casos límite y lo que queda fuera.
3. Muéstrame el diff y espera mi aprobación.
4. Actualiza plan.md y añade tareas nuevas al final de tasks.md (sin renumerar las hechas). "Estado: aprobada".
5. Corre spec-check. Siguiente paso: sdd-pr.
