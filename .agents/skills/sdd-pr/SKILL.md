---
name: sdd-pr
description: Prepara y abre el pull request de una spec, una implementación, un cambio chico o un cambio de contrato. Usar solo cuando el usuario lo pida.
---
Entrada: la rama actual (spec/, impl/, fix/ o contrato/NNN-slug). Si estás en main, para.

1. Integra main: git fetch origin && git rebase origin/main. Si hay conflictos, para y avísame.
2. Corre node scripts/spec-check.mjs --rama <rama> --base origin/main. Si falla, para.
3. Según el tipo:
   - spec: "Estado: aprobada" en spec.md (cámbialo ahora si no quedan dudas abiertas), y plan.md y tasks.md presentes.
   - impl: npm test y npm run contrato:test en verde, y el informe de sdd-validate disponible. Si no lo está, para y propón sdd-validate.
   - fix: npm test en verde y guía en docs/guias/NNN-slug.md.
   - contrato: npx --yes @redocly/cli@2.62.1 lint contrato/openapi.yml en verde y ADR presente.
4. Redacta la descripción con .github/pull_request_template.md, con datos reales. No marques casillas que no verificaste.
5. Muéstrame título ("Spec NNN: …", "Impl NNN: …", "Fix NNN: …" o "Contrato NNN: …") y descripción. Con mi aprobación: git push -u origin <rama> y gh pr create --base main --title "<título>" --body-file <archivo>. Si no hay gh, dame el texto para pegar en GitHub.
6. Dame el enlace del PR y vacía EN-CURSO.local.md si no queda nada pendiente.
