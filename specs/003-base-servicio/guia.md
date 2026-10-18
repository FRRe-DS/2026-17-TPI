# Guía — Spec 003 Base del servicio

## Visión general
Se escribe al validar la spec, en el PR del bloque E (ver el encabezado de [tasks.md](tasks.md)).

## Tareas

### T1 — Crear el proyecto · commit `003/T1`
- Qué cambió:
  - [package.json](../../package.json): nombre `m2-clientes`, versión `0.1.0`, módulos ES (`"type": "module"`), `engines.node` en `^24`, todas las dependencias de «Versiones a fijar» del plan con versión exacta (las que usa el servicio en `dependencies`; las de compilación, lint y pruebas en `devDependencies`) y los scripts `contrato:tipos`, `build`, `lint` y `test`. Los `prebuild`, `prelint` y `pretest` corren `contrato:tipos` solos, así que los tipos siempre están al día.
  - [package-lock.json](../../package-lock.json): fija también las dependencias de las dependencias. Es lo que instala `npm ci`, en CI y en el `Dockerfile` (T26).
  - [tsconfig.json](../../tsconfig.json) (editor, lint y pruebas; no emite) y [tsconfig.build.json](../../tsconfig.build.json) (solo `src/`, compila a `dist/`).
  - [eslint.config.mjs](../../eslint.config.mjs): typescript-eslint sobre los `.ts`, sin `dist/` ni `src/generado/`.
  - [vitest.config.ts](../../vitest.config.ts): busca `pruebas/**/*.test.ts`.
  - [.gitignore](../../.gitignore): suma `node_modules/`, `dist/` y `src/generado/`.
  - [AGENTS.md](../../AGENTS.md), «Trampas conocidas»: ya no dice que falta `package.json`; sigue diciendo que falta `docker-compose.yml` hasta el bloque E.
  - `src/generado/contrato.ts` no se escribe ni se versiona: lo genera openapi-typescript desde `contrato/openapi.yml`. Con el contrato de `main`, que solo tiene `info`, los tipos salen vacíos.
- Por qué así:
  - Versiones exactas (RNF-01.1): dos clones, CI y la imagen instalan lo mismo. Las versiones salen del plan, verificadas el 2026-10-18.
  - Están todas las dependencias del plan, aunque varias se usen más adelante. Así los bloques B, C y D, que avanzan en paralelo, no tocan `package.json` ni `package-lock.json` y no chocan al integrar.
  - `overrides` para openapi-typescript (plan, Decisiones): su última versión declara TypeScript 5 y npm no la instala junto a TypeScript 6.0.3. El override le hace usar el TypeScript del proyecto.
  - `module` y `moduleResolution` en `nodenext` con `"type": "module"`: en el código, los imports relativos llevan la extensión `.js` (por ejemplo `./config.js`), aunque el archivo sea `.ts`.
  - Los tipos se generan en cada build en vez de versionarlos, para que no queden viejos respecto del contrato.
- Cómo se conecta:
  - Es la base de T2 en adelante: todo `src/` y `pruebas/` nuevo cuelga de estas configuraciones.
  - Los scripts son los que corre el job `build-test` de CI (`npm ci`, `npm run build`, `npm run lint`, `npm test`). Con `package.json` presente, ese job deja de omitirse.
- Tests:
  - [pruebas/unitarias/consistencia.test.ts](../../pruebas/unitarias/consistencia.test.ts): ninguna dependencia de `dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies` ni `overrides` usa rangos ni etiquetas; solo versiones `X.Y.Z`. También prueba el detector (`esRango`) con `^`, `~`, `*`, `latest` y otros. T26 y T27 amplían este archivo con el `Dockerfile` y el compose.
  - Rojo primero: se instaló Vitest con el prefijo por defecto de npm y la prueba falló nombrando `vite: ^8.3.4` y `vitest: ^5.0.5`.
  - Comprobado además a mano, con Node v24.15.0: `npm ci`, `npm run build`, `npm run lint` y `npm test` pasan; ESLint detecta una violación puesta a propósito y no mira `src/generado/`; `git status` no muestra `src/generado/`, `dist/` ni `node_modules/`.
- Para mirar con atención:
  - Falta el script `contrato:test`: apunta a `scripts/contrato-test.mjs`, que llega con T5, y se agrega ahí.
  - `engines.node` es la única entrada con `^`, y no es una dependencia.
  - `npm install` avisa que `glob@10.5.0` está deprecado. Lo trae `@testcontainers/postgresql` (solo pruebas) y no entra a la imagen, que instala con `--omit=dev`.
  - ESLint solo revisa `.ts`. Revisar los `.mjs` (como `scripts/`) pide declarar sus globales (`process`, `console`), y el paquete `globals` sería una dependencia nueva sin aprobar. Se retoma con `scripts/contrato-test.mjs` (T5).
  - Ningún script tipa `pruebas/` (`tsc -p tsconfig.json`): se corrió a mano y pasa; el editor sí lo usa.
  - Vitest corre hoy un solo grupo de pruebas; T17 lo separa en `unitarias` e `integracion`.
