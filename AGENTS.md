# AGENTS.md — M2 Clientes · Grupo 17 · TPI Desarrollo de Software 2026

Servicio de clientes de la plataforma de movilidad urbana del TPI: perfil, preferencias, direcciones frecuentes, historial resumido de viajes (vía M6), calificación del conductor y estado de cuenta con bloqueos, que consultan otros módulos. Es uno de nueve módulos; los demás los construyen otros grupos. Estas reglas valen para cualquier agente (Claude Code, Codex, Antigravity u otro) y para las personas.

## Fuentes de verdad, en orden
1. `contrato/openapi.yml`: contrato del módulo acordado con el Grupo 1 y publicado en el repo de la cátedra.
2. `docs/constitution.md`: principios innegociables.
3. `specs/NNN-slug/`: qué se construye (spec), cómo (plan) y en qué pasos (tasks).
4. `docs/adr/`: decisiones tomadas y su porqué.
5. El código.
Si dos fuentes se contradicen, para y pregunta.

## Stack y comandos
- TypeScript 6.0 sobre Node.js 24 LTS, Fastify 5, PostgreSQL 18 en contenedor, migraciones con node-pg-migrate, tests con Vitest y Testcontainers. Detalle y versiones: `docs/adr/003-stack.md` y `package.json`.
- Levantar todo: `docker compose up -d --build --wait` (servicio, base de datos y mocks de dependencias)
- Tests: `npm test` · Lint: `npm run lint` · Build: `npm run build`
- Contrato: `npx --yes @redocly/cli@2.62.1 lint contrato/openapi.yml` (lint) · `npm run contrato:test` (servicio contra el contrato)
- Specs: `node scripts/spec-check.mjs` (lo mismo que corre CI)

## Etapa actual: TP1
- RNF vigentes: RNF-01 (stack justificado), RNF-02 (límites del módulo), RNF-03 (OpenAPI y errores consistentes), RNF-04 (imágenes OCI reproducibles), RNF-05 (base propia), RNF-06 (configuración externa), RNF-07 (unitarias e integración), RNF-08 (sin duplicados ante concurrencia), RNF-20 (documentación junto a la versión).
- Lo de etapas siguientes no se implementa sin una spec que lo pida.

## Flujo del grupo
- Todo cambio nace de un issue de GitHub. NNN = número del issue, con tres dígitos.
- Spec: rama `spec/NNN-slug`, solo `specs/NNN-slug/` (y su ADR si hay decisión). PR "Spec NNN: …". El merge es la aprobación.
- Implementación: rama `impl/NNN-slug` desde `main`, una tarea por commit `NNN/Tn: …`, validación `NNN/V: …`. PR "Impl NNN: …".
- Cambio chico sin requisito nuevo: rama `fix/NNN-slug`, commit `NNN: …`, guía en `docs/guias/NNN-slug.md`. PR "Fix NNN: …".
- Contrato: rama `contrato/NNN-slug`, con ADR. Nunca desde otra rama.
- Nadie pushea a `main`. Toda PR la aprueba el integrador (@sandobaitt); las suyas, el suplente (@agustinpagno). Antes de cada PR: `node scripts/spec-check.mjs --rama <rama> --base origin/main`.
- Una vez por clon: `git config core.hooksPath .githooks` (el hook bloquea el push a `main` y valida la rama).
- Una spec por rama. No toques archivos de otra spec en curso sin avisar en su issue.

## Specs (SDD)
- Requisitos con los ID de la cátedra (RF-2.x, RNF-xx); reglas propias con ID derivado (RF-2.5.1). En EARS.
- La spec dice QUÉ y POR QUÉ; el plan, CÓMO; las tareas, pasos de 20-30 minutos con "Hecho cuando:".
- Si falta una decisión: `[NECESITA ACLARACIÓN]` y preguntar. Nunca resolverla por tu cuenta.
- Reglas y plantillas completas: `.agents/skills/sdd/SKILL.md`.

## Implementación
- Una tarea por vez: tests primero (en rojo), código, tests en verde, entrada en `specs/NNN-slug/guia.md`, tarea marcada, commit. Después para.
- Respeta el contrato: rutas, códigos, esquemas y errores `application/problem+json`.
- Datos propios: solo la base de este módulo. Datos de otros módulos, por su API o su mock (RNF-05).
- Toda llamada a otro módulo: timeout, reintentos limitados y respuesta explícita si no contesta (RNF-13).
- Lo que no puede duplicarse se garantiza en la base (restricción única) y con idempotencia, no solo en código (RNF-08, RNF-09).
- Configuración y secretos por variables de entorno (RNF-06). Nada sensible en repo, logs, URLs ni QR (RNF-19).
- Logs estructurados con identificador de correlación (RNF-14).

## Traspaso entre sesiones
- `EN-CURSO.local.md` (raíz, no va a git) guarda tu trabajo a medias: rama, spec, tarea, siguiente paso exacto y decisiones aún no escritas. Si existe, léelo al empezar; actualízalo antes de cortar una sesión con trabajo a medias.
- Al compactar, conserva: spec y tarea activas, archivos modificados, comandos de test y su último resultado, decisiones aún no escritas.

## Límites
- ✅ Siempre: `npm test` y `spec-check` en verde antes de dar algo por terminado.
- ⚠️ Pregunta antes: dependencias nuevas, cambios de esquema de base, cualquier cambio fuera de la spec activa, `git push`, abrir PR o issues.
- 🚫 Nunca: editar `contrato/` fuera de una rama `contrato/`, pushear a `main`, desactivar tests o checks para que pase CI, leer `.env`, reescribir historia publicada.

## Trampas conocidas
- Node 20 está fuera de soporte: usar Node 24 (`nvm use 24`).
- `docker` sin sudo, y por lo tanto Testcontainers, exige estar en el grupo `docker`.
- En Windows, tras la incorporación de `.gitattributes` (`#26`), si los scripts locales (`spec-check) arrojan fallas persistentes de residuos de caché de finales de línea, se debe forzar la regeneración del índice local ejecutando de forma manual: git rm --cached -r -q . y posteriormente git reset --hard (#52).