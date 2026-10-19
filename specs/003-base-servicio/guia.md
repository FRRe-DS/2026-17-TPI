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

### T3 — Armar los errores problem+json · commit `003/T3`
- Qué cambió:
  - [src/errores.ts](../../src/errores.ts), que no importa nada:
    - `Problema`: un error que ya sabe qué respuesta le corresponde (`codigo`, `type`, `title`, `detail` y `encabezados`). Sin `type` propio es genérico (`about:blank`); con uno, es un error de negocio del contrato. Su `message` es el `detail`, que se escribe sin datos internos porque puede llegar al log.
    - Las subclases que lanzan los demás componentes: `NoAutenticado` (401, con `WWW-Authenticate: Bearer`), `SinPermiso` (403), `Conflicto` (409), `ModuloNoDisponible` (503, nombra el módulo), `BaseNoDisponible` (503) y `Deteniendose` (503). Se suman tres que la tabla de Lógica 6 también pide y que T7, T8 y T12 tienen que lanzar: `NoEncontrado` (404), `MetodoNoPermitido` (405, arma `Allow` con los métodos que recibe, sea una lista o un conjunto) y `SolicitudIlegible` (400).
    - `aProblema(error, ruta)` devuelve `{ codigo, cuerpo, encabezados }`. El cuerpo tiene `type`, `title`, `status`, `detail` e `instance`: la ruta sin la query string, o ninguna si no se pasa `ruta` (la solicitud no se pudo leer). Los encabezados son `Content-Type: application/problem+json` y los del error.
  - Además de los `Problema`, `aProblema` reconoce:
    - por su `code`: `FST_ERR_CTP_INVALID_JSON_BODY` y `FST_ERR_CTP_EMPTY_JSON_BODY` (400), `FST_ERR_BAD_URL` y `FST_ERR_MAX_PARAM_LENGTH` (400, no el 414 de Fastify), `FST_ERR_CTP_BODY_TOO_LARGE` (413), `FST_ERR_CTP_INVALID_MEDIA_TYPE` (415), `ERR_HTTP_REQUEST_TIMEOUT` (408) y `HPE_HEADER_OVERFLOW` (431); y 400 para `FST_ERR_CTP_INVALID_CONTENT_LENGTH` y para cualquier otro `HPE_*`, los errores del analizador HTTP de Node;
    - los errores de validación de Fastify (`error.validation`, la lista de errores de Ajv, y `error.validationContext`, que dice si fallaron el cuerpo, la ruta, la query string o los encabezados): 400 con un `detail` en español que nombra el primer campo con problemas, por ejemplo «Falta el campo nombre en el cuerpo» o «El parámetro id de la ruta no tiene el formato uuid»;
    - todo lo demás, y cualquier cosa que no sea un objeto, es un 500 «Ocurrió un error interno» (RNF-03.3).
- Por qué así:
  - Los textos de la tabla de Lógica 6 viven en un solo lugar. El manejador de errores (T7), los hooks (T8, T15), `frameworkErrors` y `clientErrorHandler` (T12) y `consultar()` (T19) no arman cuerpos: lanzan o pasan el error que tienen y `aProblema` decide la respuesta. Descartado: que cada uno arme su problem+json, porque los textos se irían desviando de la tabla.
  - Los errores de Fastify y de Node se traducen en vez de envolverse en un `Problema`: así una URL mal codificada no cuesta una traza de pila. Los códigos se buscan en un `Map`, porque en un objeto `constructor` o `toString` encontrarían algo.
  - El `detail` de validación dice el campo y la regla, nunca el valor que mandó quien llama (puede ser un dato personal) ni la lista de valores permitidos. Mira solo el primer error de Ajv, porque el plan lo corre con `allErrors: false`. Las reglas con mensaje propio son las que usa el borrador del contrato v1 (`type`, `required`, `format`, `enum`, `const`, `pattern`, `additionalProperties`, `minLength`, `maxLength`, `minimum`, `maximum`, `uniqueItems`, `minProperties`); las demás dicen «no es válido». Si el contrato suma otra, es una línea en `regla()`.
  - `aProblema` no conoce los errores de pg: `consultar()` (T19) convierte el `23505` en `Conflicto` y la falta de base en `BaseNoDisponible`. Uno que llegue sin convertir da 500 y no filtra la restricción ni los datos (RNF-08.1, probado).
- Cómo se conecta:
  - Todavía no la llama nadie. La usan después el manejador de errores y el 404 (T7), los 405 (T8), `frameworkErrors` y `clientErrorHandler` (T12), `verificarToken` y `autorizar` (T13, T15), `consultar()` (T19), el hook de parada (T23) y el cliente de módulos (T25).
  - `Problema` y sus subclases son lo único que otro archivo tiene que importar para lanzar un error de la API.
- Tests:
  - [pruebas/unitarias/problemas.test.ts](../../pruebas/unitarias/problemas.test.ts), 143 pruebas:
    - una por cada origen de la tabla, con código, `type`, `title`, `detail`, `status`, `instance` sin query string (y sin `instance` si no hay ruta) y los encabezados `Allow`, `WWW-Authenticate` y `Content-Type`; que los errores de otras capas no repitan su mensaje original;
    - los `Problema` con `type` propio; el 500 con valores raros (`null`, un texto, un símbolo, `constructor` como código) y con un error de pg sin convertir;
    - 45 de validación, 37 de ellas con un esquema compilado por un Ajv real, una por regla y lugar (cuerpo, ruta, query string y encabezados), con campos anidados y elementos de listas.
  - Rojo primero: sin `src/errores.ts` la prueba no cargaba («Cannot find module»). Ya en verde, se rompió el código a propósito de 33 maneras (que `instance` conserve la query string, que el 500 o un error de otra capa repitan su mensaje, que `constructor` encuentre un código, que falte `WWW-Authenticate`, que el parámetro largo dé 414, que el JSON Pointer se decodifique al revés, entre otras) y cada una hizo fallar al menos una prueba. La primera versión no detectaba lo último: se agregó el caso `a~1b`.
  - Comprobado además, con Node v24.15.0: `npm test` (233 pruebas), `npm run lint`, `npm run build` y `tsc -p tsconfig.json` pasan, y `node scripts/spec-check.mjs` da OK. Con una app Fastify real y descartable se respondieron con `aProblema` 15 solicitudes (campo faltante, tipo, formato, JSON roto y vacío, `text/plain`, cuerpo grande, URL mal codificada, parámetro de 101 caracteres, entre otras) y todas dieron el problem+json esperado.
- Para mirar con atención:
  - Fastify agrega `; charset=utf-8` al `Content-Type` cuando envía el objeto (probado: `application/problem+json; charset=utf-8`). Las pruebas HTTP de T7 en adelante tienen que comparar con `startsWith` o `toContain`, no con igualdad.
  - `clientErrorHandler` (T12) tiene que pasarle `new SolicitudIlegible()` a `aProblema` para «el resto» de los errores de cliente de Node (los que no son `ECONNRESET` ni `HPE_*`), porque un error desconocido da 500. Los códigos de Node (`HPE_HEADER_OVERFLOW`, `HPE_INVALID_METHOD`, `HPE_INVALID_CONTENT_LENGTH` y `ERR_HTTP_REQUEST_TIMEOUT`) se verificaron con Node v24.15.0.
  - `FST_ERR_CTP_INVALID_CONTENT_LENGTH` y cualquier `HPE_*` que no sea el desborde de encabezados se tratan como «HTTP que no se puede leer» (400), aunque la tabla no los nombra: un 500 para un error de quien llama contradiría RNF-03.2.
  - `instance` es la ruta tal como llegó (con sus `%xx`), sin la query string; para una URL mal codificada repite la ruta mala. Un campo de más con un nombre larguísimo vuelve entero en el `detail` (como mucho 1 MiB, el tope del cuerpo).
  - Para T4: con `module: nodenext`, `import Ajv2020 from 'ajv/dist/2020.js'` y `import addFormats from 'ajv-formats'` no se pueden construir ni invocar para TypeScript; hay que usar el `.default` de cada uno (existe en ejecución), como en `problemas.test.ts`. Y conviene no pasar `strict: true`: con Ajv por defecto compilan un `required` en una rama de `allOf` sin `type: object`, un `required` sin `properties` y una unión de tipos que no sea con `null` (`strictTypes` solo avisa en el log), pero con `strict: true` ninguno de los tres compila (probado con Ajv 8.20.0).

### T4 — Cargar el contrato y compilar sus esquemas con Ajv 2020 · commit `003/T4`
- Qué cambió:
  - `src/contrato/cargar.ts`: `cargarContrato(ruta?)` lee `contrato/openapi.yml`, u otro archivo para el script de la prueba de contrato, y devuelve el documento como objeto (`Contrato`). Falla con un error que nombra el archivo y dice el motivo si el archivo falta, no es YAML válido, tiene una clave repetida, deja un aviso de YAML o no es un objeto. `RUTA_CONTRATO` es la ruta absoluta del contrato del repo.
  - `src/contrato/validacion.ts`: `crearCompilador(contrato)` devuelve el compilador para `app.setValidatorCompiler`. Arma dos instancias de Ajv 2020 con `ajv-formats` y el contrato cargado con el id `ID_CONTRATO` (`contrato`): una convierte tipos y atiende `params`, `querystring` y `headers`; la otra no convierte y atiende el cuerpo y cualquier parte desconocida.
  - `pruebas/ayudas/contrato-prueba.yml`: contrato de prueba con las convenciones del borrador v1 y una operación por cada caso que piden las pruebas del plan (T4, T6, T7, T8, T15, T16, T19, T21 y T23), para que los bloques B y C no tengan que editarlo a la vez. Pasa el lint de Redocly; solo quedan avisos de estilo (licencia y respuestas 4xx).
- Por qué así:
  - **El vocabulario suma los campos de primer nivel de OpenAPI 3.1** (`openapi`, `info`, `jsonSchemaDialect`, `servers`, `paths`, `webhooks`, `components`, `security` y `tags`) a las cuatro palabras de Lógica 7. Antes de resolver el primer `$ref` hacia adentro del contrato, Ajv compila el documento entero como esquema: con solo las cuatro del plan, todo `$ref` fallaba con «unknown keyword: "openapi"». Es el mismo principio del plan (que el modo estricto no rechace palabras de OpenAPI), aplicado a la raíz.
  - `coerceTypes: 'array'`, como el compilador por defecto de Fastify: además de convertir texto a número o booleano, pasa un valor solo a lista cuando el esquema pide una lista (`?etiquetas=a`).
  - Sin `removeAdditional`: un campo de más se rechaza con 400 en vez de borrarse en silencio, que es lo que espera la prueba de contrato (`negative_data_rejection`).
  - `logger: false`: Ajv no escribe avisos sueltos en la consola (RNF-14.5). Lo que el modo estricto rechaza, como una palabra o un formato desconocido, igual hace fallar la compilación. Sigue sin `strict: true` (ver T3).
  - Un aviso de YAML también corta la carga: el contrato no diría lo que parece decir. `parseDocument` junta errores y avisos en vez de escribirlos en la consola, como hace `parse`.
- Cómo se conecta: T6 (`registrarOperaciones`) carga el contrato con `cargarContrato`, le pasa `crearCompilador(contrato)` a `app.setValidatorCompiler` y arma los esquemas de cada ruta como `$ref` a `ID_CONTRATO`. Los errores de validación que deja Ajv son los que `aProblema` (T3) traduce a un 400 en español.
- Tests: `pruebas/unitarias/validacion.test.ts` (59).
  - Carga y compila el contrato de `main`, que solo tiene `info`, y cada falla de lectura nombra el archivo.
  - Compila un `$ref` a `components` y otro a un esquema definido dentro de `paths`, con el puntero escapado.
  - Rechaza un `uuid` y fechas inválidas, conoce los 11 formatos del plan y falla con uno desconocido.
  - Convierte tipos en `params`, `querystring` y `headers` (también detrás de un `$ref`), pero no en el cuerpo.
  - Acepta `example` y las demás palabras de OpenAPI, y falla con una palabra mal escrita.
  - Aplica los valores por defecto, informa un solo error, rechaza el campo de más, no escribe en la consola y deja errores que `aProblema` entiende.
  - Se comprobó además: 43 de 43 mutaciones del código detectadas; el borrador v1 se carga sin avisos y compila completo (28 esquemas de `components`, 39 parámetros y 8 cuerpos); con un Fastify real, cada parte de la solicitud se convierte o se rechaza como corresponde.
- Para mirar con atención:
  - Para T6: escapar cada segmento del puntero (`~` por `~0`, `/` por `~1` y después `encodeURIComponent`, que codifica `{` y `}`). Para un parámetro con `$ref`, buscar `name` e `in` en `components/parameters` y apuntar a su `/schema`. Copiar el `default` al lado del `$ref`, porque Ajv no aplica el que queda detrás. Pasar a minúscula los nombres de los encabezados, porque con un compilador propio Fastify no lo hace.
  - Una extensión `x-…` en la raíz del contrato o dentro de un esquema hace fallar el arranque en modo estricto: habría que sumarla al vocabulario. El borrador v1 no tiene ninguna.
  - `RUTA_CONTRATO` es relativa al módulo compilado: en la imagen (T26), `contrato/` tiene que quedar al lado de `dist/`.
  - Con `logger: false` tampoco se ven los avisos de `strictTypes`, como un `properties` sin `type: object`. El borrador v1 no genera ninguno.
