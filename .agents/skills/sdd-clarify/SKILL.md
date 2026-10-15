---
name: sdd-clarify
description: SDD paso 2 - revisa una spec como QA exigente, recomienda cómo resolver cada punto y aplica lo que la persona acepte. Usar solo cuando el usuario lo pida indicando la spec.
---
Entrada: la carpeta de la spec (NNN-slug).

1. Revisa specs/NNN-slug/spec.md con la skill sdd, frente a contrato/openapi.yml, docs/constitution.md, el issue (gh issue view N --json title,body,labels) y los RNF de la etapa. Busca:
   - las dudas que ya están en "## Dudas abiertas";
   - requisitos que no se pueden verificar o no están en EARS (uno por línea);
   - contradicciones entre requisitos;
   - casos límite no cubiertos (concurrencia, duplicados, dependencias caídas, permisos por rol);
   - conflictos con el contrato o la constitución;
   - RNF de la etapa que deberían aparecer y no están.
2. Todavía no modifiques archivos. Responde para alguien que recién empieza: lenguaje simple y cada término técnico explicado la primera vez que aparece. Numera todo de corrido, para que se pueda contestar por número.
   - En 3-5 líneas: qué tan lista está la spec y qué es lo más importante.
   - Las decisiones que cambian lo que se construye, de la más a la menos importante y como máximo 8. De cada una: qué pasa, por qué importa, tu recomendación y su motivo, en 2-4 líneas. Si hay más de 8, las demás quedan como [NECESITA ACLARACIÓN] para otra pasada: nunca pases una decisión a ajuste menor para entrar en el tope.
   - Los ajustes menores, los que no cambian lo que se construye (redacción, EARS, criterios que faltan), en una línea cada uno. Los aplicas como recomiendas, salvo que la persona diga otra cosa.
   - Lo que solo puede resolver un tercero (la cátedra, otro grupo, un acuerdo del consorcio que todavía no existe): un supuesto provisorio y qué pasa si después cambia. Un conflicto con contrato/openapi.yml no es un supuesto: muéstralo como decisión y propone contrato-cambio.
   - Al final, cómo contestar: "ok" acepta todo, "N: <otra cosa>" cambia un punto y "resolvé vos" delega todo.
3. Con la respuesta, actualiza spec.md: requisitos en EARS, casos límite, fuera de alcance, criterios de finalización, contrato y dependencias, y "## Dudas abiertas", de donde quitas lo resuelto. Anota cada decisión y cada supuesto aceptado en "## Decisiones", en una línea con qué se decidió y por qué, sin copiar la marca [NECESITA ACLARACIÓN]. Si la persona delega, usa tus recomendaciones: la decisión sigue siendo suya y queda escrita para el revisor del PR.
4. Corre node scripts/spec-check.mjs y resume en pocas líneas qué cambió. Si no quedan dudas abiertas, el siguiente paso es sdd-plan; si quedan, otra pasada de sdd-clarify.
