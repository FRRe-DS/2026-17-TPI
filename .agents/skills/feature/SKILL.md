---
name: feature
description: Cambio chico sin requisitos nuevos (corrección, configuración, refactor local) con plan previo. Usar solo cuando el usuario lo pida indicando el issue.
---
Entrada: el issue (NNN-slug) y el cambio pedido.

Si el cambio agrega o modifica un requisito, para: va por sdd-spec o sdd-change.

1. Trabaja en la rama fix/NNN-slug creada desde main.
2. Antes de tocar nada, prepárame un plan: qué archivos cambian y cómo, casos límite, cómo se verifica. Espera mi aprobación.
3. Implementa, corre npm test y haz el commit "NNN: <descripción>".
4. Escribe docs/guias/NNN-slug.md (15-30 líneas): qué cambió (archivo:función), por qué, cómo se conecta, qué prueban los tests y qué mirar con atención. Es un mapa: no copies código.
5. Siguiente paso: sdd-pr.
