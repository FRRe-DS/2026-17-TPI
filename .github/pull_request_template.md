## Tipo
- [ ] Spec (`spec/NNN-…`): solo `specs/NNN-…/` y su ADR
- [ ] Implementación (`impl/NNN-…`)
- [ ] Cambio chico (`fix/NNN-…`)
- [ ] Contrato (`contrato/NNN-…`)

Issue: #N · Carpeta: `specs/NNN-…/`

## Resumen
<2-4 líneas: qué y por qué.>

## Si es spec
- Requisitos: RF-…, RNF-…
- Dudas resueltas y decisiones (ADR si corresponde):
- Impacto en el contrato: ninguno | issue de contrato #…
- [ ] spec, plan y tareas completos · [ ] `spec-check` en verde · [ ] sin `[NECESITA ACLARACIÓN]`

## Si es implementación
- Tareas: T1 … Tn (commits `NNN/Tn`)
- Validación requisito por requisito (informe de sdd-validate):
- [ ] tests en verde · [ ] tests de contrato en verde · [ ] guía con entradas de tareas y visión general
- [ ] sin cambios en `contrato/` · [ ] sin secretos ni datos sensibles en código o logs

## Para revisar con atención
<Lo no obvio, riesgos, decisiones que el agente tomó por su cuenta.>

## Herramienta
<Claude Code / Codex / otra, y modelo.>
