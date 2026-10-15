---
name: explicar-spec
description: Úsala cuando pida explicar una spec o una tarea ya terminada, por número (por ejemplo 002 o 002/T3).
---
1. Lee specs/<NNN>-*/guia.md, spec.md, plan.md y las operaciones del contrato que cubre.
2. Para una tarea: git log --grep "<NNN>/<Tn>" y git show de ese commit.
   Para la spec completa: los commits que empiecen por "<NNN>/".
3. Explica: qué problema resuelve, el recorrido de una petición HTTP por el
   código (archivo:función en cada paso), las decisiones con su alternativa
   descartada y qué prueba cada test.
4. Marca cualquier diferencia entre la guía y el código.
5. Termina con las preguntas de comprobación de la guía y corrige mis respuestas.
