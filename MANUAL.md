# Manual del grupo — M2 Clientes

Cómo empezar a trabajar en este repo, uses Claude Code o Codex. Las reglas completas para los agentes están en `AGENTS.md`; este manual es para las personas.

## 1. Preparar tu máquina (una vez)

1. Clona el repo y activa el hook local:

   ```bash
   git clone https://github.com/FRRe-DS/2026-17-TPI.git
   cd 2026-17-TPI
   git config core.hooksPath .githooks
   ```

   El hook bloquea el push a `main` y revisa el nombre de la rama antes de cada push. Sin ese último comando, tu clon no lo tiene.
2. Node 24: `nvm install 24 && nvm alias default 24`. Node 20 ya no tiene soporte.
3. Docker con compose v2 y buildx, y tu usuario en el grupo `docker`: sin eso no corren los tests de integración (Testcontainers). En Ubuntu, con el paquete `docker.io`:

   ```bash
   sudo apt install docker-compose-v2 docker-buildx
   sudo usermod -aG docker $USER   # después cierra sesión y vuelve a entrar
   ```

4. `gh auth login`, para manejar issues y PR desde la terminal.

## 2. Configurar tu herramienta

### Claude Code
- Lee `CLAUDE.md`, que incluye `AGENTS.md`.
- La primera vez que corras `claude` en el repo, te pregunta por el servidor context7 de `.mcp.json`. Elige "Use this MCP server", que aprueba solo ese. No elijas "all future MCP servers": un servidor que alguien agregue después correría en tu máquina sin preguntarte.
- Las skills se usan como comandos: `/sdd-spec`, `/sdd-clarify`, `/sdd-plan`, `/sdd-tasks`, `/sdd-pr`, `/sdd-implement`, `/sdd-validate`, `/sdd-change`, `/sdd-status`, `/feature` y `/contrato-cambio`.
- Al arrancar, un hook le pasa a Claude lo que dice `EN-CURSO.local.md`.
- Hay dos subagentes: `reviewer`, para revisar antes de un PR, y `rapido`, para tareas mecánicas.

### Codex
- Lee `AGENTS.md` por su cuenta y encuentra las mismas skills en `.agents/skills/`. Las que cambian archivos no se activan solas: invócalas con `$sdd-spec`, `$sdd-plan`, etc., o elígelas en `/skills`.
- Context7 se configura en tu `~/.codex/config.toml`:

  ```toml
  [mcp_servers.context7]
  url = "https://mcp.context7.com/mcp"
  # opcional, con una clave gratis de context7.com (da más cupo):
  # bearer_token_env_var = "CONTEXT7_API_KEY"
  ```

- No tiene hooks. Al empezar, pídele "lee EN-CURSO.local.md si existe"; antes de cortar, pídele que lo actualice.
- No tiene subagentes: la revisión la hace quien aprueba el PR.

### Antigravity (para entender, no para construir)
La regla `@explicador` (`.agents/rules/explicador.md`) explica sin tocar nada, con las skills `explicar-spec`, `explicar-cambios`, `explicar-pr` y `mapa-proyecto`. Sirve para entender lo que hizo otro integrante o para preparar la revisión de un PR.

## 3. Cómo se trabaja

Todo cambio nace de un issue de GitHub; `NNN` es su número con tres dígitos (el issue 4 da `004`).

1. Elige un issue abierto, anótate en "Responsable" y avisa en el issue que lo tomas.
2. Crea la rama desde `main` actualizado (`git switch main && git pull`) y sigue la fila que corresponde:

| Qué | Rama | Skills, en orden | Commits | Título del PR |
|---|---|---|---|---|
| Funcionalidad: la spec | `spec/NNN-slug` | sdd-spec → sdd-clarify → sdd-plan → sdd-tasks → sdd-pr | — | `Spec NNN: …` |
| Funcionalidad: el código, con la spec ya mergeada | `impl/NNN-slug` | sdd-implement (una tarea por vez) → sdd-validate → sdd-pr | `NNN/Tn: …` y `NNN/V: …` | `Impl NNN: …` |
| Cambio chico, sin requisitos nuevos | `fix/NNN-slug` | feature → sdd-pr | `NNN: …` | `Fix NNN: …` |
| Contrato OpenAPI | `contrato/NNN-slug` | contrato-cambio → sdd-pr | — | `Contrato NNN: …` |

- Una spec por rama. No toques archivos de otra spec en curso sin avisar en su issue.
- Si a la spec le falta una decisión, el agente deja `[NECESITA ACLARACIÓN]`. La decide el grupo, no el agente.
- `sdd-implement` hace una tarea por vez: tests en rojo, código, tests en verde, entrada en la guía y commit. Después para y espera.
- Para saber en qué punto está una spec o el módulo: `sdd-status`.
- Antes de cada PR: `node scripts/spec-check.mjs --rama <rama> --base origin/main`. El hook también lo corre al pushear, y CI lo vuelve a correr en el PR.

## 4. Pull requests

`main` está protegida en GitHub:
- Nadie pushea a `main`: todo entra por PR.
- Para mergear hacen falta los checks `specs`, `contrato`, `build-test` y `contract-test` en verde, y todas las conversaciones del PR resueltas.
- También hace falta una aprobación. Los PR los aprueba el integrador (@sandobaitt), y los del integrador, el suplente (@agustinpagno).
- Si agregas commits después de la aprobación, se cae y hay que pedirla de nuevo.
- Se mergea con merge commit o con rebase. Squash está desactivado porque mezcla los commits de cada tarea. La rama se borra sola al mergear.
- El merge del PR de spec es la aprobación de la spec: antes de ese merge no se escribe código.

## 5. Reglas que no se negocian

Están en `AGENTS.md`, sección "Límites". Las más fáciles de olvidar:
- Pregunta antes de agregar dependencias, cambiar el esquema de la base o salirte de la spec activa.
- Configuración y secretos, siempre por variables de entorno. Nunca en el repo, en logs ni en URLs.
- Los datos de otros módulos se piden por su API o por su mock, nunca a su base.
- Nunca se desactivan tests ni checks para que pase CI, ni se reescribe historia ya pusheada.

## 6. Cortar y retomar

`EN-CURSO.local.md`, en la raíz, guarda tu trabajo a medias: rama, spec, tarea, siguiente paso exacto y decisiones que todavía no escribiste. No va a git: es solo tuyo. Pídele al agente que lo actualice antes de cortar y que lo lea al volver.
