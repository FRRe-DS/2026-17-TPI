# 146 · La plantilla de PR cierra el issue al mergear

Issue #146 · rama `fix/146-plantilla-pr-closes`

## Qué pasaba
La plantilla de PR pedía solo `Issue: #N`. GitHub no cierra un issue por esa línea, así que varios quedaron abiertos con el trabajo ya mergeado y hubo que cerrarlos a mano.

## Qué cambió
- `.github/pull_request_template.md`: debajo de `Issue: #N` suma la línea `Closes #N` y un comentario que dice cuándo dejarla. En una PR de implementación, de cambio chico o de contrato, se deja y GitHub cierra el issue al mergear. En una PR de spec, se borra.
- `.agents/skills/sdd-pr/SKILL.md`, paso 4: la misma regla, para que el agente que redacta la descripción con la plantilla la cumpla. `.claude/skills/sdd-pr/` solo remite a ese archivo y no cambia.

Nada cambia en `src/`, `contrato/`, `pruebas/` ni en las specs.

## Por qué así
- **La PR de spec no cierra el issue:** con el flujo del grupo, el mismo issue (NNN) lleva primero la spec y después la implementación. Si la PR de spec lo cerrara, el issue quedaría cerrado mientras falta todo el código.
- **`Closes` y no `Fixes` o `Resolves`:** las tres funcionan igual en GitHub. `Closes` sirve para cualquier tipo de cambio, no solo para arreglos.
- **Un comentario HTML y no otra sección:** no se ve en la PR publicada y queda al lado de la línea que explica.

## Cómo se verifica
- La próxima PR de implementación, cambio chico o contrato que deje `Closes #N` cierra su issue al mergear, y el issue muestra la PR que lo cerró.
- `npm test` y `node scripts/spec-check.mjs` en verde.
