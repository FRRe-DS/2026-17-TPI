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

### T2 — Leer y validar la configuración del entorno · commit `003/T2`
- Qué cambió:
  - [src/config.ts](../../src/config.ts): `cargarConfig(env)` lee las diez variables de Lógica 1 y devuelve `{ config }` o `{ errores }`. `cargarConfigTokens(env)` hace lo mismo solo con las de los tokens (clave, emisor, audiencia y campo de roles) y no mira el resto.
  - Cada campo de `Config` se llama como su variable sin `M2_`, en camelCase: `M2_URL_BD` → `urlBd`, `M2_TIEMPO_BD_MS` → `tiempoBdMs`, `M2_ENCABEZADO_CORRELACION` → `encabezadoCorrelacion`. Así los nombra el plan en `migrar({ urlBd, tiempoBdMs })` y en `crearClienteModulo({ encabezadoCorrelacion })`.
  - Cada error es `{ variable, motivo }`: el nombre de la variable y por qué falla («no es un entero entre 1 y 65535», «es obligatoria y no tiene valor»). Nunca el valor.
- Por qué así:
  - RNF-06.2 pide nombrar cada variable con problemas, no solo la primera. `crearLector` las lee de a una, junta los errores y recién al final decide si devuelve la configuración o los errores. Mientras tanto, una variable que falla devuelve un valor de relleno (su valor por defecto, o `''` si es obligatoria); esa configuración a medias nunca sale de `src/config.ts`.
  - El error no lleva el valor porque puede ser un secreto: la clave de los tokens, o la contraseña de la base dentro de `M2_URL_BD` (RNF-06.2, RNF-19.1).
  - Una variable vacía cuenta como no definida (plan, Lógica 1): la opcional usa su valor por defecto y la obligatoria da error. Una con solo espacios no está vacía, y se valida como cualquier otra.
  - Los enteros son solo dígitos decimales: `-1`, `80.5`, `1e3`, `0x50` y `8082 ` (con espacio) son inválidos.
  - El nombre del encabezado se valida con `http.validateHeaderName` de Node, la misma regla que usa Node al escribir el encabezado en la respuesta: no hay una lista propia de caracteres que pueda quedar distinta.
  - `cargarConfig` recibe `env` como parámetro y nunca lee `process.env`: es una función pura y se prueba sin tocar el entorno.
  - Descartado: una librería de validación (zod, envalid). Son diez variables, y sería una dependencia nueva, que AGENTS.md pide aprobar antes.
- Cómo se conecta:
  - Todavía no la llama nadie. La usan después `construirApp` (T6, recibe `config`), `verificarToken` y `generarToken` (T13), el comando de tokens (T14, con `cargarConfigTokens`), `crearPool` y `migrar` (T17 a T19), `arrancar` (T22: llama a `cargarConfig`, registra el nombre de cada variable con error y sale con 1) y el cliente de módulos (T24 y T25).
  - `Config` incluye a `ConfigTokens`: una función que pida `ConfigTokens` acepta también la `Config` completa.
- Tests:
  - [pruebas/unitarias/config.test.ts](../../pruebas/unitarias/config.test.ts), 72 pruebas: los valores por defecto y todos definidos; los bordes válidos de cada regla (puerto 1 y 65535, reintentos 0 y 5, clave de 32 caracteres); 31 valores inválidos, cada uno informado solo y con el nombre de su variable; las cuatro obligatorias ausentes y vacías; las opcionales vacías, que toman su valor por defecto (también el encabezado, que vacío sería un nombre inválido); varios errores juntos; y `cargarConfigTokens` (no pide la base ni mira variables ajenas, aunque sean inválidas).
  - Ningún error repite el valor: cada variable inválida se prueba con un valor centinela y se busca que ni él, ni la clave, ni la contraseña de la base aparezcan en el texto del error.
  - Rojo primero: sin `src/config.ts` la prueba no cargaba («Cannot find module»). Ya en verde, se rompió el código a propósito de 11 maneras (que el error repita el valor, que una variable vacía cuente como definida, que `cargarConfigTokens` pida la base, que el puerto admita 65536, que la clave admita 31 caracteres, entre otras) y cada una hizo fallar al menos una prueba.
  - Comprobado además, con Node v24.15.0: `npm run lint`, `npm run build` y `tsc -p tsconfig.json` (este último también tipa `pruebas/`) pasan.
- Para mirar con atención:
  - Un tiempo enorme es válido y rompe sin avisar. La spec dice solo «entero mayor que 0», pero desde 2³¹ ms (unos 24,9 días) `setTimeout` y `AbortSignal.timeout` de Node disparan a los pocos milisegundos, con un `TimeoutOverflowWarning` (probado con Node v24.15.0). Con `M2_TIEMPO_BD_MS=3000000000`, toda consulta daría 503 al instante. Ponerle un tope cambia RNF-06.2: va por `/sdd-change`, en una rama `spec/`.
  - `config.encabezadoCorrelacion` guarda el nombre como se escribió (por ejemplo `X-Request-Id`), pero Node entrega los encabezados de la solicitud en minúscula: quien lo lea (T9) tiene que buscarlo en minúscula.
  - De la URL de la base solo se comprueba que sea `postgres://` o `postgresql://` y que se pueda leer como URL. Que tenga host, usuario o base, y que responda, lo descubre `migrar` al arrancar (RNF-05.3).
  - Los nombres de las variables están escritos en este archivo y se repiten en `ejemplo.env` (T26), en `docker-compose.yml` y en la tabla del README (T31): si uno cambia, cambian todos.
