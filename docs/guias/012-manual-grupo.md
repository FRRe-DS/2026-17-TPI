# 012 · Manual del grupo

Issue #12 · rama `fix/012-manual-grupo`

## Qué cambió
- `MANUAL.md` (nuevo, en la raíz): guía para las personas. Explica cómo preparar la máquina, cómo configurar Claude Code, Codex o Antigravity, el flujo de issue a PR con sus skills, las reglas de los PR y cómo cortar y retomar.

## Por qué
`AGENTS.md` está escrito para los agentes. Hasta ahora, cómo arrancar (hook local, Node 24, Docker, context7 en Codex) solo lo sabía quien armó el arnés, y la mayoría del grupo usa Codex.

## Cómo se conecta
- No agrega reglas: resume las de `AGENTS.md`, las skills de `.agents/skills/` y la regla "Protección de main" de GitHub. Si el manual y `AGENTS.md` se contradicen, manda `AGENTS.md`.
- La sección de Codex se basa en su documentación actual: lee las skills de `.agents/skills/` y los servidores MCP de `~/.codex/config.toml`.

## Cómo se verifica
No hay tests: es documentación. Lo verifica quien la siga desde un clon nuevo. Lo más útil es que alguien que use Codex la recorra y avise qué falta.

## Qué mirar con atención
- Si cambian el flujo, las skills o la regla de `main`, hay que actualizar el manual en el mismo PR.
- Las reglas de PR del punto 4 tienen que coincidir con la regla configurada en GitHub (Settings → Rules).
