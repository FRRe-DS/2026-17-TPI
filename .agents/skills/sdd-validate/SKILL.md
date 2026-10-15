---
name: sdd-validate
description: SDD paso 6 - valida una spec implementada requisito por requisito antes de su PR. Usar solo cuando el usuario lo pida; mejor en una sesión nueva.
---
Entrada: la carpeta de la spec (NNN-slug).

1. Ejecuta npm test y npm run contrato:test.
2. Recorre spec.md requisito por requisito: qué test lo cubre y su resultado. Los que no tienen test automático, verifícalos contra http://localhost:8082 (curl) y muestra la evidencia.
3. Comprueba criterios de finalización, constitución y que no hay cambios fuera de alcance (git diff origin/main...HEAD --stat).
4. Veredicto: VALIDADO o CAMBIOS NECESARIOS, con lista (archivo:línea, qué incumple, qué se espera). NO arregles nada.
5. Solo si es VALIDADO: escribe la "Visión general" al inicio de specs/NNN-slug/guia.md, cambia "Estado:" a implementada, haz el commit "NNN/V: validación" y guarda el informe (requisito → test → resultado) para la descripción del PR.
