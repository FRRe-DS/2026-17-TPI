# 042 · MANUAL.md: Gemini en Antigravity puede construir

Issue #42 · rama `fix/042-manual-antigravity`

## Qué cambió
`MANUAL.md`, dos lugares:
- La línea 3 dice «uses Claude Code, Codex o Antigravity», y no solo los dos primeros.
- La sección «Antigravity (para entender, no para construir)» pasa a «Antigravity (con Gemini)». Explica que lee `AGENTS.md` y las skills de `.agents/skills/`, que se le pide cada skill por su nombre, que no tiene hooks (se le pide leer `EN-CURSO.local.md`) y que hay que revisar que su terminal use Node 24. La regla `@explicador` queda como modo aparte, de solo lectura, con la indicación de no activarla para construir.

Nada más cambia: ni `AGENTS.md`, ni las skills, ni la regla `@explicador`, ni el código.

## Por qué
El 22 de octubre el integrador habilitó que quien use Gemini en Antigravity construya con él, como con Claude Code o Codex, para repartir las tareas según el modelo de cada persona (Gemini 3.8 Flash, ChatGPT y Claude). El manual decía lo contrario, y quien lo leyera iba a creer que no podía tomar tareas.

`AGENTS.md` no hizo falta tocarlo: ya dice que sus reglas valen para cualquier agente, y nombra a Antigravity. El límite estaba solo en el manual.

## Cómo se conecta
- Es la misma configuración de Codex (`AGENTS.md` y `.agents/skills/`), sin hooks ni subagentes que dependan de Claude Code. Por eso el manual repite lo del hook de inicio: hay que pedirle que lea `EN-CURSO.local.md`.
- La indicación de revisar `node -v` sale de la trampa de Node 20 de `AGENTS.md`. Antigravity arranca con un PATH mínimo, y en una máquina del grupo no leía `~/.bashrc`, así que `nvm alias default 24` no alcanzaba.
- `.agents/rules/explicador.md` tiene `trigger: manual`: solo se aplica cuando la persona la nombra, así que no interfiere con construir.

## Cómo se verifica
- `git diff` muestra solo `MANUAL.md` y esta guía.
- `node scripts/spec-check.mjs --rama fix/042-manual-antigravity --base origin/main` y `npm test` pasan.
- No se probó con Antigravity. Que lea `AGENTS.md` y las skills sale de guías de terceros, no de la documentación de Google: [guía de AGENTS.md y reglas](https://thepromptshelf.dev/blog/google-antigravity-agents-md-rules-guide-2026) y [codelab de skills de Google](https://codelabs.developers.google.com/getting-started-with-antigravity-skills?hl=en).

## Qué mirar con atención
- Quien construya primero con Gemini en Antigravity tiene que confirmar tres cosas: que el IDE lee `AGENTS.md` (las guías dicen que desde la versión 1.20.5), que encuentra las skills y que `node -v` da v24 en la terminal del agente. Si alguna falla, se corrige el manual en otro fix.
- El manual no dice qué modelo usar para cada tarea: ese reparto está en cada `tasks.md` (las tareas delicadas) y no cambia.
