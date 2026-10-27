# Plan — Spec 071 Front de M2: app de cliente y base del panel

Decisión de pila: ADR 071 (`docs/adr/071-front-panel.md`). Este plan dice cómo se construye lo que pide `spec.md`. No cambia `contrato/openapi.yml`, `src/` ni `migraciones/`.

## Estructura
Todo vive en `panel/`, con pruebas en `pruebas/panel/` (el repo ya separa las pruebas del código).

```
panel/
  Dockerfile  Dockerfile.dockerignore     dos destinos: `panel` y `m6-simulado`
  tsconfig.servidor.json  tsconfig.cliente.json  vite.config.ts
  servidor/    main, config, entorno-ejemplo, app, seguridad, tokens, proxy, pedidos, m6-control, estaticos
  m6-simulado/ main, config, estado, cuerpos, ids, app-m6 (API de m6.yml), app-control
  cliente/     React 19 + TypeScript, compilado por Vite a `panel/dist/cliente`
    index.html  estilos/ (variables globales)  fuentes/
    src/  main.tsx, app.tsx, rutas.ts (enrutador por #), sesion.tsx (contexto de sesión)
          fuentes/     sesion-simulada, viajes-simulados      ← los dos puntos de conexión (RNF-02.2)
          api/         m2, errores, panel
          logica/      funciones puras, sin React ni DOM
          hooks/       usar-carga, usar-accion, usar-cuenta-regresiva
          componentes/ boton-accion, dialogo-confirmar, formulario, aviso, estado-pantalla, … (cada uno con su CSS Module)
          pantallas/   una por vista (.tsx)
          generado/    tipos del contrato (no va a git)
pruebas/panel/  unitarias/  http/  integracion/  navegador/
scripts/panel-humo.mjs
```
Se agregan al repo: `docs/adr/071-front-panel.md`, secciones en `README.md`, `docs/probar-m2.md` y `ejemplo.env`, el perfil `panel` en `docker-compose.yml` y un job en `.github/workflows/ci.yml`.

## Contrato
El panel no implementa operaciones: consume las 20 de `contrato/openapi.yml` desde el navegador, a través de su servidor. Los tipos de pedido y respuesta se generan con `openapi-typescript` en `panel/cliente/src/generado/contrato.ts` (script `panel:tipos`), de modo que un cambio de contrato que afecte a una pantalla rompe la compilación (RNF-02.1, RNF-02.3).

| operationId | Pantalla (`panel/cliente/src/pantallas/`) | Requisitos |
|---|---|---|
| `verificarSalud` | `estado-m2` (aviso «M2 no responde» y chequeo del contenedor) | RNF-15.4, RNF-04.6 |
| `crearCliente` | `ingresar`, formulario «Entrar como cliente nuevo» | RF-2.1.5, RF-2.1.9 |
| `obtenerCliente`, `actualizarCliente` | `perfil` | RF-2.1.8, RF-2.1.9 |
| `listarDirecciones`, `crearDireccion`, `actualizarDireccion` | `direcciones` | RF-2.2.6 |
| `eliminarDireccion` | `direcciones` con diálogo de confirmación | RF-2.2.7 |
| `obtenerDireccion` | la edición de una dirección precarga con ella | RF-2.2.6 |
| `obtenerPreferencias`, `guardarPreferencias` | `preferencias` | RF-2.3.6 |
| `listarHistorialViajes` | `historial` | RF-2.4.12, RF-2.4.13 |
| `calificarConductor` | `calificar` | RF-2.5.15, RF-2.5.16 |
| `listarCalificaciones`, `obtenerCalificacion` | `calificaciones` | RF-2.5.17 |
| `obtenerEstadoCuenta` | `estado-cuenta` (cliente), `otro-modulo` (SERVICIO) | RF-2.6.5, RF-2.6.7 |
| `listarBloqueos`, `crearBloqueo`, `obtenerBloqueo`, `levantarBloqueo` | `operador` | RF-2.6.6 |

Rutas propias del servidor del panel (no son de M2 ni del contrato):

| Ruta | Para qué | Requisitos |
|---|---|---|
| `GET /salud-panel` | chequeo de salud del contenedor | RNF-04.6 |
| `/api/v1/clientes…`, `GET /health` | reenvío a M2 con token firmado | RNF-12.6, RNF-14.9 |
| `GET /panel/pedidos` | últimos 50 pedidos del detalle técnico | RNF-14.9 |
| `GET /panel/m6/estado`, `PUT /panel/m6/modo`, `POST /panel/m6/clientes/{clienteId}/ejemplo` | reenvío al canal de control del M6 simulado | RNF-13.5, RF-2.1.10 |

## Datos
No hay base ni migraciones: el panel no guarda nada de M2.
- **Navegador**: `localStorage["m2panel.clientes"]` guarda hasta 10 `{ id, nombre }` (RF-2.1.6); `sessionStorage["m2panel.sesion"]` guarda `{ rol, sub, clienteId }` (RNF-12.9). Nunca claves ni tokens (RNF-19.3). Todo acceso va en `try/catch`: sin almacenamiento, el panel funciona sin recordar.
- **M6 simulado**: estado en memoria (`modo` y mapa de viajes). Se pierde al reiniciar; «Cargar ejemplo» lo repone (RF-2.1.10, RF-2.1.11).
- **Configuración** (RNF-06.4): variables nuevas en `ejemplo.env`, todas con valor por defecto, ninguna obligatoria nueva. Las de los tokens son las `M2_*` que ya existen.

| Variable | Defecto | Quién la lee |
|---|---|---|
| `PANEL_PUERTO` | `8083` | panel (y compose, que lo publica en `127.0.0.1`) |
| `PANEL_ESCUCHA` | `127.0.0.1` (en el contenedor, `0.0.0.0`) | panel |
| `PANEL_URL_M2` | `http://localhost:8082` (en el contenedor, `http://m2:8082`) | panel |
| `PANEL_URL_M2_PUBLICA` | `http://localhost:8082` | panel, para el `curl` del detalle técnico |
| `PANEL_URL_M6_CONTROL` | `http://localhost:3007` (en el contenedor, `http://m6:3007`) | panel |
| `M6_PUERTO` / `M6_PUERTO_CONTROL` | `3006` / `3007` | M6 simulado |
| `M6_RETARDO_LENTO_MS` | `5000` (mayor que `M2_TIEMPO_MODULOS_MS`) | M6 simulado |
| `M2_CLAVE_TOKENS`, `M2_EMISOR_TOKENS`, `M2_AUDIENCIA_TOKENS`, `M2_CAMPO_ROLES`, `M2_AUDIENCIA_M6` | los de `ejemplo.env` | panel y M6 simulado |

Como `ejemplo.env` usa la forma `VARIABLE=${VARIABLE:-valor}` que Node no expande, `npm run panel` carga esos valores por defecto con `entorno-ejemplo.ts` (solo lee `ejemplo.env`, nunca `.env`) y una variable ya definida manda sobre el ejemplo. En el contenedor los define compose.

## Lógica
Todo lo que decide algo es una función pura en `panel/cliente/src/logica/` o `panel/servidor/`, para probarla sin navegador ni red.

**Seguridad de las acciones (RNF-12.8)** — `seguridad.ts`, un `onRequest` de Fastify para todas las rutas:
```
permitidos = { "localhost:P", "127.0.0.1:P", "[::1]:P" }
si Host no está en permitidos: 403 problem+json
si método no es GET/HEAD/OPTIONS y (Origin falta o Origin != "http://" + Host): 403 problem+json
sin cabeceras CORS en ninguna respuesta
```

**Token por pedido (RNF-12.6, RNF-19.3)** — `tokens.ts`, con `jose` (HS256, mismo formato que el ADR 009):
```
firmar(sub, roles):
  sub: texto 1..128; roles: subconjunto no vacío de {CLIENTE, OPERADOR, SERVICIO, CONDUCTOR} (si no: 400)
  JWT { [campoRoles]: roles, iss, aud, sub, iat: ahora, exp: ahora + 300 s } firmado con la clave
```
La clave y los tokens viven solo en el proceso del panel. El navegador manda `X-Panel-Rol` y `X-Panel-Sub` (identidad de prueba, sin secreto).

**Reenvío (RNF-03.6, RNF-14.9, RNF-15.4, RNF-19.3)** — `proxy.ts`:
```
ruta válida si coincide con ^/(api/v1/clientes(/|\?|$)|health$) y no tiene "..", "//" ni "@"
cuerpo hasta 1 MiB, pasado tal cual (sin parsear)
requestId = X-Request-Id del pedido, o "panel-" + uuid
encabezados que se reenvían: accept, content-type, idempotency-key, + authorization (firmado) + x-request-id
fetch(PANEL_URL_M2 + ruta, timeout 10 s)
  respuesta: devolver código, cuerpo y estos encabezados: content-type, location, retry-after, allow, x-request-id
  sin respuesta (tiempo agotado o conexión rechazada): 504 problem+json
       { type: "/panel/errores/m2-no-responde", title: "M2 no responde", status: 504 }
registrar en el buffer: { requestId, hora, método, ruta, cuerpo, código, duraciónMs }
logs: una línea JSON por pedido con requestId, método, ruta con plantilla, código y duración; sin tokens, sin cuerpos
```

**Detalle técnico (RNF-14.9)** — `pedidos.ts`: buffer circular de 50; `curlEquivalente(pedido)` arma `curl -X M -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: …" -d '…' URL_PUBLICA+ruta`; en pantalla el encabezado `Authorization` se muestra como `Bearer ••••`.

**Calificar sin duplicar (RF-2.5.15)** — `logica/clave-idempotencia.ts` y el formulario:
```
al abrir el formulario: clave = uuid()
enviar: deshabilitar el botón; POST con la clave; al volver, habilitar
  éxito (201) o cierre del formulario: descartar la clave
  error o tiempo agotado: conservar la clave; «Reintentar» envía el mismo cuerpo con la misma clave
```
El mismo patrón sirve para `crearCliente` (RF-2.1.5), `crearDireccion` y `crearBloqueo`.

**Mensajes de calificación (RF-2.5.16)** — `logica/mensajes.ts`: tabla (estado, `type`) → texto: `404` «viaje no encontrado»; `409` + `/errores/calificacion-duplicada` «ya lo calificaste»; `422` + `/errores/viaje-no-completado` «el viaje todavía no está completado»; `422` + `/errores/idempotencia-reutilizada`; `503` → cuenta regresiva. Cualquier otro error se muestra con RNF-03.6 (código, `type`, `title`, `detail`).

**Cuenta regresiva (RF-2.4.13)** — `logica/cuenta-regresiva.ts` (la cuenta) y el hook `usar-cuenta-regresiva` (el temporizador): lee `Retry-After` (segundos, 1 a 3600), cuenta hacia atrás cada segundo, se detiene al llegar a 0 o al salir de la pantalla; «Reintentar» está siempre habilitado.

**Cambios del perfil (RF-2.1.8)** — `logica/cambios.ts`: compara lo escrito con el perfil cargado y manda solo los campos distintos; si no hay ninguno, no llama a M2.

**Clientes recordados (RF-2.1.6, RF-2.1.7)** — `logica/recordados.ts`: `agregar(lista, cliente)` pone el nuevo primero, quita repetidos por id y corta en 10; `quitar(lista, id)`; `leer(texto)` descarta lo que no tenga la forma `{ id: uuid, nombre: texto }`.

**Cargar ejemplo (RF-2.1.10, RF-2.1.11)** — `logica/ejemplo.ts`:
```
pasos, en orden, cada uno informado en pantalla:
  3 × crearDireccion (1 FAVORITA y 2 RECIENTE) con Idempotency-Key "ejemplo-dir-{n}-{clienteId}"
  guardarPreferencias con valores de ejemplo (PUT, idempotente por naturaleza)
  POST /panel/m6/clientes/{clienteId}/ejemplo
repetir no duplica: mismas claves y mismo cuerpo devuelven la respuesta original; el M6 usa ids fijos por cliente
si el paso de M6 falla: se informa que los viajes no se registraron, lo demás queda hecho y se puede reintentar
```

**Estados de pantalla (RNF-15, RNF-15.2, RNF-15.4)** — el hook `usar-carga` lleva toda carga por `cargando → listo | vacio | error`, y `componentes/estado-pantalla` los dibuja; el error trae «Reintentar», que repite el mismo pedido. El cliente `api/m2.ts` corta a los 10 s con `AbortSignal.timeout` y trata el `504` del panel como «M2 no responde». Las acciones usan el hook `usar-accion` y `componentes/boton-accion`: deshabilita y muestra espera mientras dura; si termina bien, avisa en una región `aria-live`; si falla, muestra el error y «Reintentar». «Eliminar» y las acciones destructivas usan `<dialog>` de confirmación y «Cancelar» no llama a M2 (RF-2.2.7). Las pantallas no usan `dangerouslySetInnerHTML` (regla de ESLint, `no-restricted-syntax`): el texto siempre sale escapado.

**M6 simulado** — `panel/m6-simulado/estado.ts`:
```
estado: { modo: normal | lento | caido, viajes: Map<id, Viaje> }
ids de ejemplo de un cliente: sha256("ejemplo|" + clienteId + "|completado" | "|encurso") con forma de UUID v4
fijos para todos los clientes: AJENO 33333333-3333-4333-8333-333333333333 (de otro cliente, COMPLETED) e
                               INEXISTENTE 44444444-4444-4444-8444-444444444444 (nunca se guarda)
cargarEjemplo(clienteId): guarda el completado y el en curso (si ya están, los reemplaza por lo mismo)
escenarios(clienteId): [completado→201, enCurso→422, ajeno→404, inexistente→404], con el id de cada uno
GET /api/v1/trips?clientId=…  → TripSummaryPage (filtra por clientId y state; page y pageSize)
GET /api/v1/trips/{id}       → Trip, o 404 ErrorResponse
toda llamada: verificar el token de servicio con la clave, el emisor y la audiencia M2_AUDIENCIA_M6 y el rol SERVICIO; si no, 401
modo lento: esperar M6_RETARDO_LENTO_MS antes de responder (M2 corta a los 2 s, reintenta y responde 503)
modo caido: cerrar el puerto M6_PUERTO (conexión rechazada); volver a normal lo abre de nuevo
el puerto de control sigue abierto en todos los modos
```

**Inicio de sesión simulado (RNF-12.9, RNF-02.2)** — `fuentes/sesion-simulada.ts` implementa la interfaz `FuenteDeSesion { iniciar(rol, sub) , cerrar(), actual() }` y es lo único que sabe de dónde sale la sesión; las pantallas piden la sesión a esa interfaz. Cuando exista M1, se cambia esa implementación y el panel deja de firmar los tokens. `fuentes/viajes-simulados.ts` hace lo mismo con el canal del M6 simulado (ejemplo, escenarios y modo). La etiqueta «simulado, pendiente de M1 / M6» sale de la interfaz (RNF-12.7).

## Integraciones
| Hacia | Cómo | Si falla |
|---|---|---|
| M2 (panel → M2) | `fetch` con token firmado por pedido y `X-Request-Id`, tiempo máximo 10 s, sin reintento automático (reintenta la persona, con la misma clave en los POST) | `504` `m2-no-responde` → «M2 no responde» con «Reintentar» (RNF-15.4) |
| M6 simulado, canal de control (panel → M6) | `fetch` con tiempo máximo 3 s, sin reintento | `502` problem+json del panel; en «Cargar ejemplo» el aviso parcial de RF-2.1.10 |
| M6 simulado, API (M2 → M6) | sin cambios en M2: sigue llamando a `M2_URL_M6` (`http://m6:3006/api/v1`) | M2 responde `503` con `Retry-After`; el historial y calificar lo muestran con RF-2.4.13 y RF-2.5.16 |

Con el perfil `panel`, el servicio de compose se llama `m6`, así que M2 lo alcanza con el nombre y el puerto que ya espera, sin cambiar su configuración (RNF-13.7). Sin el perfil, M2 queda como hoy.

## Empaquetado y arranque (RNF-04.6, RNF-04.7)
- `panel/Dockerfile`, una etapa de construcción (`npm ci`, `npm run panel:build`) y dos destinos de producción con la misma imagen base fijada que M2 (`node:24.22.0-trixie-slim`), `npm ci --omit=dev --ignore-scripts`, `USER node` y `init`: `panel` (servidor + cliente compilado) y `m6-simulado`. `panel/Dockerfile.dockerignore` deja entrar `panel/`, `contrato/` y los archivos de npm.
- `docker-compose.yml`: dos servicios con `profiles: [panel]` — `m6` (control publicado en `127.0.0.1:3007`) y `panel` (publicado en `127.0.0.1:8083`, `depends_on` M2 y `m6` sanos) — cada uno con su chequeo de salud para que `--wait` espere. Ningún servicio existente cambia.
- Como proceso en la máquina: `docker compose up -d --build --wait` y `docker compose --profile panel up -d --build --wait m6`, y después `npm run panel` (compila y arranca con los valores de `ejemplo.env`).
- Scripts de `package.json`: `panel:tipos`, `panel:build` (tipos, `tsc` del servidor, comprobación de tipos del cliente con `tsc --noEmit` porque Vite no la hace, y `vite build` del cliente), `panel` (build y arranque), `panel:navegador` (la prueba en navegador). `npm test` pasa a correr los proyectos `unitarias` e `integracion`; el proyecto `navegador` queda aparte.
- `scripts/panel-humo.mjs`: con el perfil levantado, comprueba `GET /salud-panel`, un `GET /health` por el reenvío, `GET /panel/m6/estado` y que un pedido con `Origin` ajeno recibe `403`. Lo usa CI y quien levanta el panel.

## Diseño visual
El estilo lo decide quien implementa, con las skills ya instaladas, y se anota en `guia.md`. Orden fijo para que no se contradigan: `impeccable` (definir y criticar), `design-taste-frontend` (dirección visual y revisión en navegador), `ui-ux-pro-max` (paletas, tipografías, gráficos) y las de Emil Kowalski (pulido y movimiento). Condiciones: `impeccable` descarga una vez su binario desde GitHub Releases y hay que avisar a la persona antes; si quiere escribir `PRODUCT.md` o `DESIGN.md` en la raíz del repo, se pide permiso y por defecto van en `panel/`; los scripts de `design-taste-frontend` se corren con `TASTE_SKILL_HISTORY` en una carpeta temporal y sin `assets.mjs`; no se instalan fuentes ni imágenes de terceros: las fuentes se guardan en `panel/cliente/fuentes/` con su licencia, o se usa la pila del sistema. Los estilos son CSS propio (variables globales y CSS Modules por componente), sin Tailwind: las recetas de las skills que lo usan se traducen a CSS. Las decisiones de estilo no cambian los requisitos: contraste 4,5:1, foco visible, `prefers-reduced-motion`, 360 a 1440 px y controles de 44×44 px (RNF-15.1, RNF-15.3).

## Decisiones
- Cliente en React 19 y TypeScript compilado con Vite 8, servidor del panel con Fastify y `jose`: ver el ADR 071 y sus alternativas descartadas (sin framework, Preact, `package.json` aparte, CORS en M2, Playwright Test con descarga de navegadores, importar `src/auth/tokens.ts`). React se eligió por decisión de Lautaro del 2026-10-27.
- Enrutador por `#` propio, estado con contexto y `useReducer`, y carga de datos con un hook propio: sin `react-router`, `zustand` ni TanStack Query. Son doce rutas y un puñado de estados; cada librería suma una dependencia que aprobar y aprender. Se reconsidera si crecen.
- Los tokens los firma el servidor del panel y no el navegador: así la clave nunca sale del proceso (RNF-19.3). El navegador solo indica rol e identificador. Alternativa descartada: firmar en el navegador con la clave, que la expone.
- Reenvío con lista de rutas permitidas y no un reenvío abierto: evita que el panel sirva de puerta a otras direcciones (RNF-12.8). Alternativa descartada: reenviar cualquier ruta bajo `/api/`.
- Enrutador por `#` (hash) en el navegador: no necesita que el servidor conozca las rutas de las pantallas. Alternativa descartada: rutas con `history`, que exigen que el servidor devuelva `index.html` para cada una.
- Los tipos del cliente salen de un archivo generado en `panel/cliente/src/generado/` y no de `src/generado/`: así el cliente compila sin importar nada de `src/` ni emitir archivos fuera de `panel/dist/`.
- Un pedido que falla lo reintenta la persona (botón «Reintentar»), no el panel de forma automática: un POST repetido sin que la persona lo sepa confunde más de lo que ayuda. La clave de idempotencia garantiza que el reintento no duplique.
- La prueba en navegador usa M2 real (en el proceso de la prueba, con la base de Testcontainers y el M6 simulado) y no un M2 de mentira: así comprueba el recorrido completo. Alternativa descartada: un M2 simulado, que no detectaría un cambio de contrato.
- Dependencias nuevas, todas en `devDependencies`, con versiones consultadas en npm el 2026-10-27 y fijadas exactas en `package.json`: `react` 19.3.1, `react-dom` 19.3.1, `@types/react` 19.3.0, `@types/react-dom` 19.3.0, `@vitejs/plugin-react` 6.1.2 (compatible con el Vite 8.3.4 que ya está), `playwright-core` 1.64.1 y `axe-core` 4.14.0. React y Vite los eligió Lautaro; se confirman todas juntas antes de instalar (AGENTS.md).
- La prueba en navegador queda fuera de `npm test` y tiene su script y su job de CI: sin Chrome, `npm test` sigue en verde. El job nuevo no es uno de los que exige la protección de `main`.

## Pruebas
| Nivel | Dónde | Qué comprueba | Requisitos |
|---|---|---|---|
| Unitarias | `pruebas/panel/unitarias/` | firma de tokens (y que `verificarToken` de M2 los acepta con el mismo emisor, audiencia y clave); `seguridad` (Host y Origin); validación de ruta del reenvío; buffer y `curl` con el token enmascarado; `cambios`, `recordados`, `clave-idempotencia`, `mensajes`, `cuenta-regresiva`, `ejemplo`; configuración y `entorno-ejemplo`; el M6 simulado cumple `contrato/dependencias/m6.yml` con Ajv, como `pruebas/unitarias/m6-simulado.test.ts` | RNF-12.6, RNF-12.8, RNF-14.9, RNF-19.3, RNF-13.7, RF-2.1.6, RF-2.1.8, RF-2.1.11, RF-2.5.15, RF-2.5.16, RF-2.4.13 |
| HTTP del panel | `pruebas/panel/http/` | el panel con un M2 de mentira (`servidor-modulo.ts`): reenvía solo lo permitido, devuelve `problem+json` tal cual, `504` si M2 no contesta, `403` con `Host` u `Origin` ajenos, no hay cabeceras CORS, los logs no llevan token ni cuerpo, el navegador no recibe la clave | RNF-03.6, RNF-12.8, RNF-15.4, RNF-19.3 |
| Integración | `pruebas/panel/integracion/` | M2 real con PostgreSQL, M6 simulado y panel: alta con clave repetida, dirección, preferencias, «Cargar ejemplo» dos veces sin duplicar, historial con `calificado`, calificar completado (201), repetir (409), en curso (422), ajeno e inexistente (404), modo lento y caído (503 con `Retry-After`), bloqueo y estado de cuenta, rol sin permiso (403) | RF-2.1.5, RF-2.1.10, RF-2.1.11, RF-2.2.6, RF-2.3.6, RF-2.4.12, RF-2.4.13, RF-2.5.15 a RF-2.5.17, RF-2.6.5 a RF-2.6.7, RNF-13.5, RNF-13.7 |
| Navegador | `pruebas/panel/navegador/` (`npm run panel:navegador`) | Chrome real a 360 y a 1280 px: recorrido de cada pantalla sin desplazamiento horizontal, controles de al menos 44×44 px, foco visible y uso solo con teclado, contraste y etiquetas con `axe-core` en claro y oscuro, estados de espera, confirmación, rechazo, cancelación, error y recuperación, valores máximos del contrato sin romper el diseño, doble clic que envía un solo pedido, «M2 no responde» con M2 detenido | RNF-07.5, RNF-15, RNF-15.1 a RNF-15.5, RNF-12.9, RF-2.2.7, RF-2.5.15 |
| Empaquetado | `scripts/panel-humo.mjs` en CI | el perfil `panel` levanta y responde; sin el perfil, M2 queda como antes | RNF-04.6, RNF-04.7 |
| Contrato | `npm run contrato:test` | sigue en verde: no cambia | RNF-02.1 |

CI: `build-test` suma `npm run panel:build`; un job nuevo `panel` (después de `build-test`) corre `panel:navegador` con el Chrome de `ubuntu-24.04` y levanta el perfil `panel` para `scripts/panel-humo.mjs`. Los jobs que exige la protección de `main` conservan su nombre.

## Cobertura de requisitos
| Requisito | Qué parte lo cubre |
|---|---|
| RF-2.1.5 | `pantallas/ingresar` y `crearCliente` con clave de `logica/clave-idempotencia` |
| RF-2.1.6, RF-2.1.7 | `logica/recordados`, `pantallas/ingresar` |
| RF-2.1.8, RF-2.1.9 | `pantallas/perfil`, `logica/cambios`, `componentes/formulario` (errores por campo) |
| RF-2.1.10, RF-2.1.11 | `logica/ejemplo`, `fuentes/viajes-simulados`, `m6-simulado/estado` (`cargarEjemplo`, ids fijos) |
| RF-2.2.6, RF-2.2.7 | `pantallas/direcciones`, `componentes/dialogo-confirmar` |
| RF-2.3.6 | `pantallas/preferencias` |
| RF-2.4.12, RF-2.4.13 | `pantallas/historial`, `logica/cuenta-regresiva`, `hooks/usar-cuenta-regresiva` |
| RF-2.5.15, RF-2.5.16, RF-2.5.17 | `pantallas/calificar`, `logica/clave-idempotencia`, `logica/mensajes`, `pantallas/calificaciones` |
| RF-2.6.5, RF-2.6.6, RF-2.6.7 | `pantallas/estado-cuenta`, `pantallas/operador`, `pantallas/otro-modulo` |
| RNF-02.1, RNF-02.3 | solo se crea `panel/`, `pruebas/panel/`, `scripts/panel-humo.mjs` y configuración; las rutas de reenvío son una lista cerrada; tipos generados del contrato |
| RNF-02.2 | `fuentes/sesion-simulada` y `fuentes/viajes-simulados`, únicos puntos de conexión, con la etiqueta «simulado, pendiente de…» |
| RNF-03.6 | `servidor/proxy` pasa el `problem+json` sin tocarlo; `api/errores` y `componentes/estado-pantalla` lo muestran completo |
| RNF-04.6, RNF-04.7 | `panel/Dockerfile`, perfil `panel` de compose, `npm run panel`, `scripts/panel-humo.mjs` |
| RNF-06.4 | `servidor/config`, `servidor/entorno-ejemplo`, sección nueva de `ejemplo.env` |
| RNF-07.5 | las cuatro carpetas de `pruebas/panel/` y el job `panel` de CI |
| RNF-12.6, RNF-12.7 | `servidor/tokens`; etiqueta de las fuentes simuladas en el encabezado de cada vista |
| RNF-12.8 | `servidor/seguridad`, publicación en `127.0.0.1` de compose |
| RNF-12.9 | `pantallas/ingresar`, `fuentes/sesion-simulada`, botón «Cerrar sesión» |
| RNF-13.5, RNF-13.7 | `m6-simulado/` (API, control, modos), `pantallas/m6-simulado`, servicio `m6` de compose |
| RNF-14.9 | `servidor/pedidos`, `servidor/proxy`, `pantallas/detalle-tecnico` |
| RNF-15, RNF-15.1 a RNF-15.5 | `hooks/` y `componentes/` (estado de pantalla, botón de acción, diálogo, avisos, formularios), estilos con variables, prueba en navegador |
| RNF-19.3 | la clave y los tokens no salen de `servidor/`; logs sin token ni cuerpo; `Authorization` enmascarado |
| RNF-20.2 | `README.md`, `docs/probar-m2.md`, `guia.md`, `docs/adr/071-front-panel.md` |
