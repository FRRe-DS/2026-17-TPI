# Plan — Spec 119 Interfaz rediseñada del cliente

## Resumen
Todo el trabajo es en el cliente del panel (`panel/cliente/src/`), sus pruebas (`pruebas/panel/`) y su documentación (`panel/DESIGN.md`, `panel/PRODUCT.md`). M2, su contrato y su base no cambian, y no se agregan paquetes npm (RNF-02.119.1).

1. **Base visual:** la paleta bordó y marfil reemplaza a «Verde ciudad» en `variables.css`. El tema oscuro deja de depender solo de la media query y pasa a un atributo `data-tema` en `<html>`, que también fija el selector. Se agrega la tipografía Inter, servida por el propio panel.
2. **Marco:** se rehacen la barra lateral, el menú del teléfono y el encabezado, con los mismos componentes de hoy.
3. **Inicio:** una pantalla nueva, que pasa a ser la de entrada del cliente.
4. **Pantallas del cliente:** se les cambia el aspecto con CSS Modules, sin tocar sus operaciones. Además, todos los formularios ganan una guardia de cambios sin guardar.

## Estructura
| Archivo | Qué hace | Requisitos |
|---|---|---|
| `estilos/variables.css` | Paleta bordó y marfil: claro en `:root`, oscuro en `:root[data-tema='oscuro']`; `--sans` empieza por `'Inter M2'`; tokens nuevos `--lateral-activo` y `--lateral-activo-texto` | RNF-15.83.1, RNF-15.119.2, RNF-15.119.8 |
| `estilos/tipografia.css` (nuevo) | `@font-face` de `'Inter M2'` con `url(../tipografia/inter-latin-wght-normal.woff2)`, `font-weight: 100 900` y `font-display: swap` | RNF-15.119.3, RNF-15.119.6 |
| `tipografia/inter-latin-wght-normal.woff2`, `tipografia/OFL.txt`, `tipografia/LEEME.md` (nuevos) | La fuente, su licencia y de dónde salió (paquete, versión y sha256) | RNF-15.119.3 |
| `logica/tema.ts` (nuevo, puro) | `temaEfectivo(guardado, sistemaOscuro)`, `leerTema(almacen)` y `guardarTema(almacen, tema)`, con lectura y escritura protegidas con `try/catch` | RNF-15.119.2 |
| `hooks/usar-tema.ts`, `componentes/selector-tema.tsx` (nuevos) | Ponen `data-tema` en `<html>`, siguen a `matchMedia('(prefers-color-scheme: dark)')` mientras no haya elección y ofrecen el selector Claro/Oscuro (dos botones con `aria-pressed`) | RNF-15.119.2 |
| `main.tsx` | Aplica el tema antes del primer render, para que no parpadee | RNF-15.119.2 |
| `rutas.ts` | Pantalla nueva `inicio`; `INICIO.CLIENTE = 'inicio'`; `TITULOS.inicio = 'Inicio'` | RF-2.1.119.2 |
| `logica/menu.ts` | El grupo del cliente empieza por Inicio, con las etiquetas de la maqueta: Inicio, Mi perfil, Direcciones, Preferencias, Mis viajes, Calificaciones y Estado de cuenta | RNF-15.83.1, RNF-15.119.1 |
| `logica/permisos-reales.ts` | `inicio` se suma a las pantallas de la cuenta (scope `clientes:read`) | RF-2.1.119.2 |
| `componentes/menu-lateral.tsx` + CSS | Barra lateral bordó con íconos SVG propios, elemento actual resaltado y selector de tema al pie. Debajo de 960 px, «Menú» (`aria-expanded`), que se cierra con Escape, al elegir una sección o al pasar a 960 px o más, y devuelve el foco al botón | RNF-15.83.1, RNF-15.119.1 |
| `componentes/encabezado.tsx` + CSS | Banda de entorno de prueba de hoy (RNF-12.7 de la 071), iniciales y nombre del perfil, selector de espacio (se mueve acá desde `app-real.tsx`), rol e identificador en el modo de desarrollo, y «Cerrar sesión» | RNF-15.119.7 |
| `logica/perfil-actual.ts` (nuevo) | Almacén chico (`suscribir`, `actual`, `publicar`, `limpiar`) con el `nombre` y el `apellido` que ya cargaron Inicio o Mi perfil. El encabezado lo lee sin pedir nada a M2 | RNF-15.119.7 |
| `logica/iniciales.ts` (nuevo, puro) | Iniciales a partir de `nombre` y `apellido` (primera letra de cada uno, en mayúsculas, respetando tildes y la ñ) | RNF-15.119.7 |
| `logica/guardia.ts` (nuevo, puro) + `hooks/usar-guardia.ts` (nuevo) | Registro de formularios con cambios (`marcar(id, sucio)`, `hayCambios()`) y la decisión de confirmar o no antes de salir | RNF-15.119.4, RF-2.1.83.5 |
| `componentes/guardia-de-navegacion.tsx` (nuevo) | Intercepta, en fase de captura, los clics a enlaces `#/…` y el `hashchange` de «atrás» y «adelante»; si hay cambios, vuelve al hash anterior y abre `DialogoConfirmar`; envuelve también «Cerrar sesión» y el cambio de espacio | RNF-15.119.4 |
| `logica/inicio.ts` (nuevo, puro) | `viajesDeInicio(pagina)` (hasta 5), `franjaDeEstado(estadoCuenta)` («Cuenta activa · Sin bloqueos vigentes» o «Cuenta bloqueada · N bloqueos vigentes») y `saludo(nombre)` | RF-2.1.83.4, RF-2.6.83.1 |
| `pantallas/inicio.tsx` + CSS (nuevo) | Tres cargas independientes con `usarCarga`: `obtenerCliente` primero; si da `404`, solo la invitación a crear el perfil; si no, `obtenerEstadoCuenta` y `listarHistorialViajes` con `size=5`, cada una con su estado. Secciones: saludo, franja de estado, «Últimos viajes», «Tu cuenta» y la etiqueta de viajes simulados | RF-2.1.83.4, RF-2.1.119.3, RF-2.4.83.1, RF-2.4.83.2 |
| `app.tsx`, `app-real.tsx` | Ruta `inicio`; `GuardiaDeNavegacion` y `usarTema` en los dos modos; el selector de espacio sale del contenido | RF-2.1.119.2, RNF-15.83.1 |
| `pantallas/historial.tsx` | «Calificado» enlaza a `#/calificaciones`; sin puntajes | RF-2.4.83.1, RF-2.5.83.3 |
| `pantallas/perfil.tsx`, `completar-perfil.tsx`, `direcciones.tsx`, `preferencias.tsx`, `calificar.tsx` | Se registran en la guardia con su «sucio» (lo escrito es distinto de lo cargado) y publican el nombre en `perfil-actual` al cargar o guardar el perfil | RF-2.1.83.5, RF-2.1.119.1, RNF-15.119.4 |
| `pantallas/*.module.css` y `componentes/*.module.css` del cliente | Composición nueva con los tokens; sin estilos en línea | RNF-15.83.1, RNF-15.119.5 |
| `panel/DESIGN.md`, `panel/PRODUCT.md` | Identidad bordó y marfil, tipografía, tema elegible e Inicio; «Verde ciudad» queda como antecedente | RNF-20.119.1 |

## Contrato
No se agrega ninguna operación. Inicio usa `obtenerCliente`, `obtenerEstadoCuenta` y `listarHistorialViajes` (`page=0`, `size=5`; el contrato admite `size` de 1 a 100). Las demás pantallas siguen con las operaciones de hoy (lista en la spec). `npm run contrato:test` no cambia, porque M2 no cambia.

## Datos
No hay base. Lo único que se guarda es la elección de tema, en `localStorage`, con la clave `panel.tema` y valor `claro` u `oscuro`. Si no hay nada guardado, se sigue al sistema. Si el almacenamiento falla, el tema sigue al sistema y no se informa nada.

## Lógica
### Tema
```
temaEfectivo(guardado, sistemaOscuro):
  si guardado es 'claro' u 'oscuro': devolver guardado
  devolver sistemaOscuro ? 'oscuro' : 'claro'

al arrancar (main.tsx): html.dataset.tema = temaEfectivo(leerTema(localStorage), matchMedia(dark).matches)
usarTema: mientras no haya elección guardada, escucha el cambio de matchMedia y actualiza data-tema
elegir(t): guardarTema(localStorage, t) (si falla, sigue igual); html.dataset.tema = t
```
CSS: `:root` es el tema claro y `:root[data-tema='oscuro']`, el oscuro. Desaparece la media query `prefers-color-scheme`, así que el atributo es la única fuente. `color-scheme` sigue al atributo.

### Guardia de cambios sin guardar
```
estado: Map<idFormulario, sucio>
hayCambios = algún valor true

clic (captura) en <a href="#/…"> distinto del hash actual:
  si hayCambios: preventDefault; pendiente = destino; abrir diálogo
hashchange (atrás o adelante) con hayCambios y sin aprobación:
  history.pushState(null, '', hashAnterior)   // vuelve sin disparar otro hashchange
  pendiente = destino; abrir diálogo
cerrar sesión o cambiar de espacio con hayCambios: pendiente = acción; abrir diálogo
confirmar: limpiar estado; ejecutar pendiente (location.hash = destino, o la acción)
cancelar: no hacer nada (lo escrito queda en el formulario)
```
Al desmontarse, cada formulario se quita del registro. Al guardar bien, marca `sucio = false`.

### Inicio
```
cliente = obtenerCliente(sub)
  404 -> invitación a crear el perfil (la de Mi perfil); no pedir nada más      # RF-2.1.119.3
  error -> estado de error de la sección del saludo, con «Reintentar»
  ok -> publicar nombre en perfil-actual
       en paralelo:
         estado = obtenerEstadoCuenta(sub) -> franjaDeEstado o error con «Reintentar»
         viajes = listarHistorialViajes(sub, page=0, size=5)
           503 con Retry-After -> aviso y «Reintentar» al vencer (usarCuentaRegresiva de hoy)   # RF-2.4.83.2
           ok -> viajesDeInicio: «Calificar» si sePuedeCalificar(viaje) (regla de hoy),
                 «Calificado» con enlace a Calificaciones si calificado === true
```
`instante` y `nombreDelEstado` de `logica/historial.ts` se reutilizan: si M2 no informa fechas, no se muestran.

### Nombre en el encabezado
`perfil-actual` se publica cuando Inicio o Mi perfil cargan el perfil, y cuando `actualizarCliente` responde bien. Se limpia al cerrar sesión o cambiar de espacio. Si todavía no hay nombre, el encabezado muestra el identificador de la sesión, como hoy.

## Integraciones
El panel no llama a otros módulos: todo pasa por M2, con el cliente de hoy (`crearApiM2`), que corta a los 10 s en el modo de desarrollo (RNF-15.4 de la 071) y a los 15 s en el real (spec 083). Si M6 no responde, lo informa M2 con `503` y `Retry-After`, y Inicio y Mis viajes usan `usarCuentaRegresiva` para ofrecer el reintento. Lo único que se carga aparte es la fuente, desde el mismo origen (`default-src 'self'`); si falla, se usa la pila del sistema.

## Decisiones
- **Inter 5.3.0, solo el subconjunto latino y variable** (`inter-latin-wght-normal.woff2`, 48 256 bytes, sha256 `3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62`), sacado con `npm pack @fontsource-variable/inter@5.3.0`, sin instalar el paquete, y copiado junto a su licencia OFL 1.1. Tiene cifras tabulares (`tnum`), que el panel usa en los datos, y el subconjunto latino cubre tildes, ñ, ¿ y ¡. Alternativas descartadas: instalar el paquete npm (sería una dependencia nueva) y usar Public Sans o Figtree, que se alejan más de la maqueta.
- **Paleta.** Los valores salen de la maqueta y se ajustaron para el contraste; la prueba de contraste los fija en T1.

  | Token | Claro | Oscuro |
  |---|---|---|
  | `papel` (fondo, marfil) | `#f7f2ea` | `#16100f` |
  | `hoja` (tarjetas) | `#fffdf9` | `#211817` |
  | `tinta` | `#2a1418` | `#f3e9e4` |
  | `tinta-suave` | `#5e4a4d` | `#c2adaa` |
  | `acento` (botones y enlaces, bordó) | `#7a1f35` | `#f0a7b4` |
  | `lateral` | `#5c1a2b` | `#2a0f17` |
  | `lateral-texto` | `#fbf3ec` | `#f6e7e3` |
  | `lateral-activo` / `lateral-activo-texto` | `#f2d4cc` / `#3d0f1b` | `#5c2333` / `#fbe9e6` |
  | `borde-campo` | `#8c7a74` | `#8d7a76` |
  | `aviso` / `aviso-fondo` | `#8a4b08` / `#fcefd9` | `#f5c56b` / `#2e2310` |

  Contrastes calculados: texto de 5,98:1 a 17,06:1 y bordes de campo de 4,08:1 o más. Alternativa descartada: el bordó de la maqueta sobre fondo oscuro, que no llega a 4,5:1; en el tema oscuro el acento pasa a un rosado claro.
- **Tema por atributo y no por media query.** Un solo bloque oscuro (`:root[data-tema='oscuro']`), que fijan el sistema o la elección. Alternativa descartada: duplicar el bloque dentro de `@media` y del selector, que obliga a mantener dos copias. La prueba de contraste pasa a leer este bloque.
- **Títulos de pantalla sin cambios.** El menú usa las etiquetas de la maqueta («Mis viajes», «Calificaciones»), pero los `h1` siguen siendo los de `TITULOS` («Historial de viajes», «Mis calificaciones»): son más descriptivos y las pruebas de integración de las specs 071 y 083 los buscan. Alternativa descartada: renombrar los títulos, que cambia decenas de pruebas sin ganar nada.
- **Guardia propia sobre el enrutador por `#`.** El panel no usa una librería de rutas: se intercepta el clic en fase de captura y se revierte el `hashchange` de «atrás». Alternativa descartada: `beforeunload`, que solo cubre cerrar o recargar, y eso está fuera de alcance.
- **El nombre del encabezado sale de lo ya cargado**, sin un pedido propio. Alternativa descartada: pedir `obtenerCliente` desde el marco, que duplica el pedido de Inicio y Mi perfil.
- **Íconos SVG dibujados en el código**, como los de hoy, sin librería. La política de seguridad no permite cargarlos de terceros, y una librería sería una dependencia.
- **Operador y evaluación** toman la paleta nueva por compartir variables y marco; su composición no se toca hasta #155. Las pruebas de navegador les miden el contraste (RNF-15.119.8).
- Sin ADR: las decisiones afectan solo al panel de este grupo.

## Pruebas
- **Unitarias** (`pruebas/panel/unitarias/`):
  - `tema.test.ts` (nuevo): `temaEfectivo` con guardado, sin guardado y con un valor inválido; lectura y escritura con un almacén que tira error.
  - `guardia.test.ts` (nuevo): marcar, desmarcar, varios formularios, `hayCambios`.
  - `inicio.test.ts` (nuevo): hasta 5 viajes, franja activa y bloqueada (con 1 y con N), saludo con un nombre de 100 caracteres.
  - `iniciales.test.ts` (nuevo): tildes, ñ y apellido vacío.
  - `menu.test.ts` y `rutas.test.ts`: Inicio primero y entrada del cliente a `inicio`.
  - `permisos-reales.test.ts`: `inicio` con `clientes:read`.
  - `contraste.test.ts`: lee el bloque `[data-tema='oscuro']` y suma los pares de `lateral-activo`.
- **Integración** (`pruebas/panel/integracion/`, con M2 y PostgreSQL reales y el M6 simulado, como las de hoy):
  - `pantalla-inicio.test.ts` (nuevo): saludo, franja activa y bloqueada, hasta 5 viajes, «Calificar» y «Calificado» con su enlace, `503` de M6 que afecta solo a los viajes, y `404` del perfil que muestra solo la invitación.
  - `pantalla-historial.test.ts`: «Calificado» enlaza a Calificaciones.
  - `guardia.test.ts` (nuevo): perfil con cambios y clic en el menú; cancelar conserva lo escrito y confirmar navega. También «atrás» y «Cerrar sesión».
- **Navegador** (`pruebas/panel/navegador/`, Chrome de la máquina con `playwright-core` y `axe-core`, como hoy):
  - `ANCHOS` pasa a 360, 768, 1280 y 1440.
  - `rediseno.test.ts` (nuevo), para cada pantalla de cliente, en cada ancho y en claro y oscuro: sin desplazamiento horizontal, sin violaciones serias o críticas de axe y controles de 44 px.
  - Operador, otro módulo, detalle técnico, M6 simulado y Demostración: axe con la regla `color-contrast`.
  - Menú del teléfono: `aria-expanded`, Escape devuelve el foco, se cierra al pasar a 1280.
  - Selector de tema: persiste al recargar y sigue al sistema sin elección.
  - Fuente: `document.fonts.check('1rem "Inter M2"')`; con el `.woff2` bloqueado, sin desplazamiento horizontal.
- **Regresión:** `npm test`, `npm run panel:navegador`, `npm run front:keycloak`, lint, build y spec-check. Las pruebas existentes de las specs 071, 072 y 083 tienen que seguir en verde; si alguna busca un texto que cambia (por ejemplo, una etiqueta del menú), se ajusta en la misma tarea.

## Trazabilidad
| Requisito | Dónde se cubre |
|---|---|
| RF-2.1.83.4 | `pantallas/inicio.tsx`, `logica/inicio.ts`; unitarias e integración de Inicio |
| RF-2.1.83.5 | `pantallas/perfil.tsx` (envío de cambios de hoy) y guardia; integración de la guardia |
| RF-2.1.119.1 | `completar-perfil.tsx` con el diseño nuevo; `primer-perfil.test.ts` de hoy y navegador |
| RF-2.1.119.2 | `rutas.ts`, `permisos-reales.ts`; `rutas.test.ts`, `permisos-reales.test.ts` |
| RF-2.1.119.3 | `pantallas/inicio.tsx` (`404`); integración de Inicio |
| RF-2.2.83.1, RF-2.3.83.1 | Direcciones y Preferencias con el diseño nuevo y la guardia; sus pruebas de hoy y navegador |
| RF-2.4.83.1, RF-2.4.83.2 | `historial.tsx`, `inicio.tsx`; integración de Inicio e historial |
| RF-2.5.83.1, RF-2.5.83.2, RF-2.5.83.3 | `calificar.tsx`, `calificaciones.tsx` con el diseño nuevo; sus pruebas de hoy, historial e Inicio sin puntaje |
| RF-2.6.83.1 | `estado-cuenta.tsx` y la franja de Inicio; `inicio.test.ts` y sus pruebas de hoy |
| RNF-02.119.1 | Solo `panel/`, `pruebas/panel/` y la spec; revisión del diff en la validación |
| RNF-07.119.1 | `rediseno.test.ts`, `ANCHOS`, unitarias e integración nuevas |
| RNF-15.83.1 | `variables.css`, `menu-lateral.tsx`, CSS Modules; navegador |
| RNF-15.119.1 | `menu-lateral.tsx`; navegador |
| RNF-15.119.2 | `tema.ts`, `usar-tema.ts`, `selector-tema.tsx`, `main.tsx`; `tema.test.ts`, `contraste.test.ts`, navegador |
| RNF-15.119.3, RNF-15.119.6 | `tipografia/`, `tipografia.css`; navegador (carga y bloqueo) |
| RNF-15.119.4 | `guardia.ts`, `usar-guardia.ts`, `guardia-de-navegacion.tsx`; unitarias e integración de la guardia |
| RNF-15.119.5 | Diseño nuevo sin quitar lo de las specs 071 y 083; pruebas de hoy y navegador |
| RNF-15.119.7 | `encabezado.tsx`, `perfil-actual.ts`, `iniciales.ts`; unitarias e integración |
| RNF-15.119.8 | Variables compartidas; axe `color-contrast` en navegador |
| RNF-19.119.1 | Sin datos nuevos en pantalla ni en `localStorage` (solo `panel.tema`); pruebas de RNF-19 de la 083 en verde |
| RNF-20.119.1 | `panel/DESIGN.md`, `panel/PRODUCT.md` y guía |

## Dudas abiertas
Ninguna.
