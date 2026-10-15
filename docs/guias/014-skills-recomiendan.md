# 014 · Skills que recomiendan y gh con --json

Issue #14 · rama `fix/014-skills-recomiendan`

## Qué cambió
- `.agents/skills/sdd-clarify/SKILL.md`: ya no solo detecta, sino que recomienda cómo resolver cada punto, en lenguaje simple y numerado de corrido.
  - Las decisiones van primero, como máximo 8; las que no entran quedan como `[NECESITA ACLARACIÓN]`.
  - Lo que depende de un tercero se propone como supuesto. Un conflicto con el contrato va por contrato-cambio.
  - Con la respuesta, actualiza la spec, limpia `## Dudas abiertas` y anota en `## Decisiones` cada decisión y cada supuesto aceptado.
- `.claude/skills/sdd-clarify/SKILL.md`: la descripción del comando avisa que ahora también aplica lo que se acepta.
- `.agents/skills/sdd/SKILL.md`: la plantilla de spec suma la sección opcional `## Decisiones`. Dos reglas nuevas: preguntar con una recomendación, y anotar en spec.md lo que la persona delega al escribir o aclarar la spec (lo que es de cómo construir va a plan.md, y en una rama impl hay que parar).
- `.agents/skills/sdd-spec/SKILL.md`: las preguntas llevan una recomendación, y el issue se lee con `gh issue view N --json …`.
- `.agents/skills/explicar-pr/SKILL.md`: el PR y el issue se leen con `--json`. Se suma `commits`, que el paso 4 necesita.

## Por qué
- Con la spec 003, `sdd-clarify` devolvió unos 40 hallazgos sin recomendación, y quien tenía que contestarlos no podía decidir la mayoría. Al grupo le sirve más una recomendación que pueda aceptar o cambiar.
- El gh 2.45 que instala Ubuntu falla en `gh issue view N` y `gh pr view N` sin `--json` ("Projects (classic) is being deprecated"). Con `--json` funcionan; está probado con esa versión.

## Cómo se conecta
- AGENTS.md sigue igual: el agente no resuelve una duda por su cuenta. Un supuesto aceptado o una decisión delegada son decisiones de la persona, y quedan escritas en la spec.
- `.claude/settings.json` ya permite `gh issue view *` y `gh pr view *`: el `--json` no pide permisos nuevos.

## Cómo se verifica
No hay tests, porque el proyecto todavía no tiene `package.json`.
- Con el gh 2.45, `gh issue view 3` falla, y `gh issue view 3 --json title,body,labels` funciona.
- spec-check acepta specs con `## Decisiones` y sin ella, en borrador y aprobadas. Solo falla si una decisión copia la marca `[NECESITA ACLARACIÓN]`; por eso la skill dice que no se copie.

## Qué mirar con atención
- La skill le deja más margen al agente. En cada PR de spec, quien revisa tiene que leer `## Decisiones`: ahí está lo que eligió o supuso el agente.
- El MANUAL (PR #13) dice "La decide el grupo, no el agente". Sigue siendo cierto, porque delegar también es una decisión del grupo.
