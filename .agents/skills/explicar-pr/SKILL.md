---
name: explicar-pr
description: Úsala cuando pida explicar o preparar la revisión de un pull request antes de aprobarlo.
---
Entrada: el número del PR.
1. gh pr view N --json title,body,headRefName,author,files,commits y gh pr diff N (sin --json, gh pr view falla con el gh 2.45 de Ubuntu; si no hay gh, git fetch y git diff main...origin/<rama>). No hagas checkout.
2. Identifica el tipo por la rama (spec, impl, fix, contrato) y lee la spec y el issue asociados (gh issue view N --json title,body,labels).
3. Si es spec: resume requisitos, casos límite y decisiones; señala requisitos no verificables, huecos frente al contrato y la constitución, y lo que falte de la etapa.
4. Si es implementación: recorre el diff por tarea (commits NNN/Tn); para cada requisito, dónde se implementa y qué test lo cubre; señala cambios fuera de la spec, riesgos de concurrencia, datos sensibles en logs y llamadas externas sin timeout.
5. Termina con una lista corta para el revisor: qué mirar sí o sí, preguntas para el autor y una recomendación (aprobar, pedir cambios) con su motivo. La decisión es mía.
