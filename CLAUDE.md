@AGENTS.md

# Específico de Claude Code
- Comandos: `/sdd-spec`, `/sdd-clarify`, `/sdd-plan`, `/sdd-tasks`, `/sdd-pr`, `/sdd-implement`, `/sdd-validate`, `/sdd-change`, `/sdd-status`, `/feature`, `/contrato-cambio`. Cada uno sigue su skill de `.agents/skills/`.
- Tareas mecánicas: subagente `rapido`. Revisión independiente antes de un PR: subagente `reviewer`.
- Si un hook te avisa del umbral de contexto, sigue sus pasos y para.
- Herramientas MCP:
  - Context7 (`mcp__context7`): documentación al día de Fastify, Vitest, Testcontainers, node-pg-migrate y demás librerías del stack. Consúltalo antes de usar una API que no conozcas con certeza.
  - NotebookLM (solo si la persona lo instaló en su usuario): el cuaderno del grupo con el enunciado, las filminas y los contratos de otros módulos.
