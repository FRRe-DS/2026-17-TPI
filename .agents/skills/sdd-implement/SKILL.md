---
name: sdd-implement
description: SDD paso 5 - implementa UNA tarea de una spec aprobada, con tests primero. Usar solo cuando el usuario lo pida indicando la spec y la tarea.
---
Entrada: la carpeta de la spec (NNN-slug) y la tarea (Tn). Si falta alguna, pídela.

Antes de empezar: la spec debe estar "aprobada" en main. Trabaja en la rama impl/NNN-slug; si no existe, créala desde main actualizado. Si la spec no está aprobada, para.

Implementa SOLO la tarea Tn de specs/NNN-slug/tasks.md, siguiendo plan.md, contrato/openapi.yml, docs/constitution.md, AGENTS.md y la skill sdd.

1. Tests primero; comprueba que fallan.
2. Código hasta que pasen. Respeta el contrato: rutas, códigos, esquemas y errores problem+json.
3. Ejecuta npm test y muéstrame el resultado.
4. Añade la entrada de Tn en specs/NNN-slug/guia.md con la plantilla de la skill sdd (créalo si no existe). Escríbela con lo que ya sabes de esta tarea: no releas nada.
5. Marca Tn en tasks.md y haz el commit "NNN/Tn: <descripción>".
6. Actualiza EN-CURSO.local.md con el siguiente paso, o vacíalo si no queda nada.

Si la tarea o el plan son incorrectos o imposibles, para y explícalo: no improvises otra solución. No empieces la siguiente tarea.
