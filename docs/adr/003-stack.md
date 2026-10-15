# ADR 003 — Stack del servicio M2 Clientes

Fecha: 2026-10-15 · Estado: propuesta
Issue: #3

## Contexto
RNF-01 deja lenguaje y framework a elección del grupo, con aprobación de la cátedra y justificación técnica. M2 expone una API REST definida por un contrato OpenAPI 3.1 compartido con el Grupo 1, tiene base propia (RNF-05), corre en contenedores (RNF-04) y necesita tests unitarios y de integración con base real desde TP1 (RNF-07). En clase se trabajó con TypeScript y Vitest. El grupo construye con agentes (Claude Code, Codex, Antigravity) y necesita entender lo construido a nivel principiante.

## Decisión
- TypeScript 6.0.x sobre Node.js 24 LTS; npm con `package-lock.json` versionado.
- Fastify 5: validación con JSON Schema y logs JSON con pino incluidos.
- PostgreSQL 18 (imagen oficial `postgres:18.6`), con `pg` y migraciones con node-pg-migrate. SQL explícito, sin ORM.
- Vitest para unitarias e integración; Testcontainers (`@testcontainers/postgresql`) levanta un Postgres real por corrida.
- Contrato: tipos generados desde `contrato/openapi.yml` con openapi-typescript; los requests se validan con los schemas del contrato. Lint con Redocly CLI 2.62.1; pruebas del servicio contra el contrato con Schemathesis 4.31.1 (imagen Docker).
- Mocks de dependencias: Prism (`stoplight/prism:5.15.10`) en docker compose.
- M1 simulado: JWT validado con jose, con clave o JWKS por entorno.
- Lint: ESLint 10 con typescript-eslint 8.
- Versiones verificadas el 2026-10-15. La spec base las fija exactas en `package.json`, `Dockerfile` y `docker-compose.yml`.

## Alternativas descartadas
- Java 21 + Spring Boot: trae integrados problem+json, JWT, logs estructurados y Flyway, y coincide con la filmina DS-02. A cambio, build y arranque más lentos, más código de ceremonia, y no es el lenguaje que practicó el grupo.
- TypeScript 7 (el `latest` de npm): typescript-eslint 8 solo admite TypeScript menor que 6.1.
- Un ORM (Prisma, Drizzle): esconde las restricciones únicas que sostienen RNF-08 y RNF-09; el SQL explícito las deja a la vista.

## Consecuencias
- Hay que armar lo que Spring trae hecho: manejador de errores problem+json, correlación en logs y cliente HTTP con timeout. Lo hace la spec base.
- Node 24 en cada máquina: Node 20 está fuera de soporte desde abril de 2026.
- Testcontainers necesita Docker accesible sin sudo, en cada máquina y en CI.
- Fastify valida por defecto con ajv en draft-07, y los schemas de OpenAPI 3.1 son JSON Schema 2020-12: la spec base configura ajv para 2020-12 o limita el contrato a lo compatible.
- La imagen `postgres:18` guarda los datos en `/var/lib/postgresql/18/docker`: el volumen se monta en `/var/lib/postgresql`.
- Puerto propuesto: 8082 (convención 8080 + número de módulo, a proponer al consorcio).
