---
name: M2 · Clientes
description: Panel web de M2 para el cliente de prueba y para quien evalúa; tarjetas blancas sobre un fondo verde muy leve, con un solo acento verde azulado.
colors:
  papel: "#f3f6f4"
  hoja: "#ffffff"
  campo: "#ffffff"
  tinta: "#0f1f1a"
  tinta-suave: "#4a5a55"
  acento: "#0f766e"
  acento-tenue: "#e6f4f1"
  sobre-acento: "#ffffff"
  regla: "#dfe7e4"
  borde-campo: "#7f8f8a"
  foco: "#0f766e"
  seleccion: "#c9ebe5"
  etiqueta-fondo: "#ecf6f3"
  lateral: "#eaf1ee"
  lateral-hover: "#dde8e4"
  lateral-texto: "#0f2a24"
  lateral-suave: "#4f625c"
  lateral-regla: "#d5e0dc"
  franja: "#0c1a17"
  franja-texto: "#d5e3de"
  franja-metodo: "#5eead4"
  franja-ok: "#6ee7a0"
  franja-mal: "#fca5a5"
  franja-pista: "#24352f"
  ok: "#15803d"
  ok-fondo: "#ecfdf3"
  mal: "#b42318"
  mal-fondo: "#fef3f2"
  aviso: "#92400e"
  aviso-fondo: "#fffbeb"
typography:
  headline:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Ubuntu, Cantarell, 'Noto Sans', sans-serif"
    fontSize: "1.75rem"
    fontWeight: 750
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Ubuntu, Cantarell, 'Noto Sans', sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Ubuntu, Cantarell, 'Noto Sans', sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  label:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Ubuntu, Cantarell, 'Noto Sans', sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.3
  group:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Ubuntu, Cantarell, 'Noto Sans', sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "0.06em"
  data:
    fontFamily: "ui-monospace, 'SF Mono', 'Cascadia Mono', 'Ubuntu Mono', Menlo, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  control: "10px"
  hoja: "18px"
  etiqueta: "999px"
spacing:
  e-1: "4px"
  e-2: "8px"
  e-3: "16px"
  e-4: "24px"
  e-5: "32px"
  e-6: "40px"
components:
  boton-principal:
    backgroundColor: "{colors.acento}"
    textColor: "{colors.sobre-acento}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  boton-contorno:
    backgroundColor: "{colors.hoja}"
    textColor: "{colors.tinta}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  boton-contorno-hover:
    backgroundColor: "{colors.hoja}"
    textColor: "{colors.acento}"
  banda-prueba:
    backgroundColor: "{colors.aviso-fondo}"
    textColor: "{colors.aviso}"
    padding: "8px 40px"
    height: "36px"
  etiqueta-simulado:
    backgroundColor: "{colors.aviso-fondo}"
    textColor: "{colors.aviso}"
    rounded: "{rounded.etiqueta}"
    padding: "3px 10px 3px 8px"
  etiqueta-estado:
    backgroundColor: "{colors.acento-tenue}"
    textColor: "{colors.acento}"
    rounded: "{rounded.etiqueta}"
    padding: "2px 10px"
  chip-rol:
    backgroundColor: "{colors.acento-tenue}"
    textColor: "{colors.acento}"
    typography: "{typography.data}"
    rounded: "{rounded.etiqueta}"
    padding: "4px 8px"
  menu-elemento:
    backgroundColor: "{colors.lateral}"
    textColor: "{colors.lateral-texto}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "44px"
  menu-elemento-actual:
    backgroundColor: "{colors.hoja}"
    textColor: "{colors.acento}"
  hoja:
    backgroundColor: "{colors.hoja}"
    textColor: "{colors.tinta}"
    rounded: "{rounded.hoja}"
    padding: "24px"
  franja-tecnica:
    backgroundColor: "{colors.franja}"
    textColor: "{colors.franja-texto}"
    typography: "{typography.data}"
    height: "56px"
---

# Design System: M2 · Clientes

Las variables viven en `cliente/src/estilos/variables.css` y son la fuente normativa; este archivo las describe. `pruebas/panel/unitarias/contraste.test.ts` comprueba cada par de texto y fondo en los dos modos.

## Overview

**Creative North Star: "Verde ciudad"**

El panel es una herramienta de una app de movilidad: tarjetas blancas donde se trabaja, sobre un fondo y un menú con un tinte verde muy leve, y un solo color de marca, el verde azulado de las apps de transporte. Cuatro planos lo arman: la banda ámbar de entorno de prueba arriba, el menú lateral claro, las tarjetas de cada pantalla y la franja técnica oscura al pie, que muestra el último pedido a M2 y su folio (el `X-Request-Id`, el puente con los logs).

Es una herramienta (modo Operate): densidad de notebook a 1280 px, lectura rápida y nada que compita con los datos. La marca está en los detalles precisos (el acento solo en lo que se toca o lo que está elegido, etiquetas punteadas de lo simulado, números tabulares), no en decoración. Lautaro eligió este estilo el 2026-10-28 entre cinco opciones (índigo, grafito, verde ciudad, azul tránsito y arena); reemplaza al «formulario con folio» en papel marrón.

**Key Characteristics:**
- Fondo verde casi gris, tarjetas blancas con sombra suave, tinta casi negra con un dejo verde.
- Un solo acento, verde azulado, en la acción principal, el elemento actual del menú, lo elegido, los enlaces y el foco.
- Lo simulado se avisa en ámbar: una banda de «Entorno de prueba» arriba de toda vista; la monoespaciada va solo sobre datos reales de M2.
- Esquinas redondeadas y generosas (10 px en controles, 18 px en tarjetas).
- De noche: fondo casi negro verdoso, tarjetas un paso más claras y el acento pasado a turquesa claro.

## Colors

Neutros con un tinte verde muy bajo y un acento verde azulado, con verde, rojo y ámbar reservados para estados.

### Primary
- **Verde ciudad** (#0f766e; oscuro #5eead4): botón principal, «M2» de la marca, texto del elemento actual del menú, opciones elegidas, enlaces, chip de rol y anillo de foco (`foco`).
- **Verde tenue** (#e6f4f1; oscuro #10302b): fondo de las opciones elegidas, del chip de rol y de las etiquetas de estado positivas (Completado, Favorita).

### Neutral
- **Papel** (#f3f6f4; oscuro #0a1210): fondo de la página.
- **Hoja** (#ffffff; oscuro #111c19): tarjetas, el elemento actual del menú y los botones de contorno.
- **Campo** (#ffffff; oscuro #0c1513): fondo de los campos de formulario.
- **Tinta** (#0f1f1a; oscuro #e6efec): todo el texto corrido.
- **Tinta suave** (#4a5a55; oscuro #9fb3ad): texto secundario y ayudas.
- **Regla** (#dfe7e4; oscuro #1f2f2b): líneas de 1 px y borde de las tarjetas y los botones de contorno.
- **Borde de campo** (#7f8f8a; oscuro #6b7f79): contorno de los campos, 3:1 contra el campo.
- **Lateral** (#eaf1ee; oscuro #0d1714) con **texto lateral** (#0f2a24) y **lateral suave** (#4f625c; oscuro #93a8a1) para los títulos de grupo.
- **Franja** (#0c1a17; oscuro #060c0b) con su propio texto (#d5e3de), método (#5eead4), código bueno (#6ee7a0), código malo (#fca5a5) y pista de la barra (#24352f).

### Estados
- **Bien** (#15803d / fondo #ecfdf3; oscuro #6ee7a0 / #0f2a1c), **Mal** (#b42318 / #fef3f2; oscuro #fca5a5 / #3a1414), **Aviso** (#92400e / #fffbeb; oscuro #fcd34d / #2e2510). El aviso también marca lo simulado: la banda de prueba y las etiquetas «M6: simulado».

### Named Rules
**The Un Solo Acento Rule.** El verde azulado es el único color de marca y marca lo que se toca o lo que está elegido. Verde, rojo y ámbar significan estado y no se usan para decorar. Lo simulado es un aviso, así que va en ámbar.

**The Clasificado Rule.** Todo color nuevo se agrega en los dos modos y se clasifica en `contraste.test.ts` como texto (4,5:1), componente (3:1) o decorativo; si no, la prueba falla.

## Typography

**Body Font:** pila del sistema (`system-ui` y alternativas).
**Data Font:** `ui-monospace` y alternativas, solo para datos: identificadores, método y ruta HTTP, códigos, folios, duraciones, valores literales de M2 (`ACTIVO`, `CLIENTE`).

**Character:** letra del sistema operativo, sobria y familiar para quien usa la herramienta todos los días; la monoespaciada marca lo que se copia o se busca en un log. No se cargan fuentes de terceros (política de seguridad del panel).

### Hierarchy
- **Headline** (750, 1.75rem, 1.15, -0.025em): el título `h1` de cada pantalla, uno por vista.
- **Title** (650, 1.0625rem, 1.3): títulos de tarjetas y secciones (`h2`), con aire debajo antes del primer campo.
- **Body** (400, 1rem en teléfono y 0.9375rem desde 960 px, 1.5): texto y controles; cifras tabulares en todo el cuerpo.
- **Label** (500, 0.8125rem): etiquetas de campo y leyendas de grupos de opciones.
- **Group** (650, 0.6875rem, mayúsculas con 0.06em): solo los títulos de grupo del menú lateral.
- **Data** (400, 0.8125rem, 1.4): la franja técnica, el chip de rol y los identificadores.

### Named Rules
**The Mono Es Dato Rule.** La monoespaciada va solo sobre valores que existen tal cual en M2 o en un log. Las etiquetas de estado escritas para la persona («En curso», «Favorita», «hecho») y la paginación van en la letra del cuerpo.

## Layout

Una sola grilla de 8 px (4 px para lo muy apretado): `e-1` a `e-6`. Controles de 44 px de alto como mínimo.

- **Desde 960 px:** dos columnas, menú lateral fijo de 248 px a toda la altura (con «TPI 2026 · Grupo 17» al pie) y, a la derecha, encabezado fijo arriba (banda de prueba de 36 px y fila de la sesión de 64 px, translúcida), pantalla y franja técnica de 56 px pegada al pie. Márgenes de la pantalla de 40 px.
- **De 600 a 959 px:** una columna, márgenes de 32 px; el menú pasa arriba como barra con el botón «Menú».
- **Menos de 600 px:** márgenes de 16 px; el texto de la banda de prueba ocupa dos líneas, el identificador se corta con puntos suspensivos y la franja se acorta.
- Las fichas de pocos datos no se estiran: el estado de cuenta hasta 48rem, la consulta de otro módulo hasta 48rem y el operador hasta 56rem. Las listas y los formularios de varios campos llegan hasta 72rem.
- `scroll-padding-bottom` deja libre la franja: lo que recibe el foco nunca queda debajo de ella.

## Elevation & Depth

Tarjetas con una sombra muy suave en capas (`sombra-hoja`: una línea de contacto y una difusa) y borde de 1 px; los botones llevan una sombra mínima (`sombra-boton`) y el principal una del color del acento (`sombra-acento`). Lo que flota de verdad (el diálogo de confirmación) lleva `sombra-flotante`. Nada de halos de color sin desplazamiento.

## Shapes

Esquinas de 10 px en botones, campos, opciones y elementos del menú; 18 px en las tarjetas; píldora completa en etiquetas, chips y el chip de rol. Bordes de 1 px.

## Components

### Buttons
- **Shape:** esquinas de 10 px, 44 px de alto, 16 px a los costados, peso 600.
- **Principal:** fondo verde ciudad, texto blanco, un brillo arriba y sombra del acento; al pasar el puntero sube 1 px, se oscurece apenas y la sombra crece. Uno por tarjeta, abajo a la derecha.
- **Contorno:** la acción secundaria: fondo blanco, borde regla y texto tinta; al pasar el puntero sube 1 px y el borde y el texto toman el acento. Los enlaces con forma de botón («Editar», «Calificar», la paginación) y «Cerrar sesión» usan el mismo estilo y el mismo movimiento.
- **Peligro:** borde rojo suave y texto rojo; con el puntero encima el relleno rojo entra barriendo desde la izquierda (`clip-path`, 260 ms) y se va en 160 ms al alejarse; con el foco del teclado se llena de una vez. Va apartado de «Cancelar».
- **Esperando:** deshabilitado, `aria-busy`, un arco SVG que gira cada 650 ms y el texto de espera. La espera entra desde abajo y al terminar el texto vuelve desde arriba (8 px, desenfoque de 4 px, 240 ms); con «reducir movimiento» solo se funde.
- **Press / Focus:** `scale(0.97)` al presionar en 100 ms y la sombra se pega a la superficie; al soltar vuelve en 160 ms con salida exponencial. Foco con anillo de 2 px separado 2 px, del color `foco`.

### Chips
- **Banda de prueba:** arriba del encabezado en toda vista, fondo `aviso-fondo`, texto `aviso` de 13 px con un triángulo de aviso: «**Entorno de prueba.** Sesión: simulado, pendiente de M1 · Viajes: simulado, pendiente de M6».
- **Etiqueta de lo simulado** (dentro de una pantalla, como «M6: simulado, pendiente de M6»): píldora ámbar con un punto, 12 px.
- **Etiqueta de estado:** píldora de 12 px en la letra del cuerpo, peso 600: verde tenue con texto verde para lo positivo, borde regla con texto suave para lo neutro, rojo tenue para lo bloqueado.
- **Chip de rol:** verde tenue con texto verde, monoespaciada 600 de 11 px; muestra el valor del rol tal cual.

### Cards / Containers
- **Hoja:** fondo blanco, borde regla de 1 px, esquinas de 18 px, `sombra-hoja`. Los formularios tienen el título arriba sin línea divisoria y un pie gris claro con las acciones; las listas tienen una línea entre fila y fila. Las hojas no se anidan.

### Error de M2
- **Style:** bloque con borde rojo de 1 px sobre `mal-fondo`, título en rojo y las filas tal como vinieron (código, tipo, detalle, instancia, reintentar en, folio). Debajo, «Reintentar» en contorno.

### Bloqueo vigente
- **Style:** caja con fondo `mal-fondo` y borde rojo al 30 %, sin franja lateral gruesa: motivo en negrita, vigencia y quién lo registró debajo.

### Inputs / Fields
- **Style:** fondo campo, borde `borde-campo` de 1 px, esquinas de 10 px, 44 px de alto y 16 px de letra (sin zoom en el teléfono). Al enfocar, borde del acento y un halo (`anillo`). Una columna en el teléfono y dos desde 600 px.
- **Opciones (casillas y radios):** cajas de 44 px con borde `borde-campo`; la elegida, con borde y fondo del acento.
- **Error:** borde rojo, `aria-invalid` y el mensaje en rojo debajo, asociado con `aria-describedby`.

### Navigation
- **Menú lateral:** la marca es solo texto, «M2» en el acento (800), una línea fina y «Clientes» (650); «TPI 2026 · Grupo 17» va al pie del menú. Grupos por rol con su título chico en mayúsculas; elementos de 44 px. El actual lleva `aria-current="page"` y es una pestaña blanca con el texto en el acento y una sombra mínima; el resto cambia solo de fondo al pasar el puntero.
- **Teléfono:** barra con la marca y el botón «Menú»; el menú aparece con 200 ms de opacidad y 4 px de desplazamiento y empuja la pantalla.
- **Saltar al contenido:** primer elemento del orden de foco, visible solo con teclado.

### Franja técnica
Fija al pie, fondo franja, monoespaciada de 13 px: método, ruta cortada, código en verde o rojo, duración dibujada a escala (barra de 120 px = 1 s) y el folio, con el enlace «Ver pedidos y respuestas». En «Detalle técnico» cada pedido se alinea en columnas (hora, método, ruta, código, duración) con el folio debajo de la ruta.

## Do's and Don'ts

### Do:
- **Do** usar solo las variables de `variables.css`; un valor nuevo se agrega en claro y oscuro y se clasifica en `contraste.test.ts`.
- **Do** avisar en ámbar todo lo que sale de una fuente simulada.
- **Do** mostrar en monoespaciada solo los valores reales de M2 (UUID, método, ruta, código, folio, estados literales).
- **Do** mantener controles de 44×44 px, foco visible y el uso completo con teclado de 360 a 1440 px.
- **Do** limitar el movimiento a respuesta: presión, paso del puntero, aparición del menú y de los avisos.

### Don't:
- **Don't** usar estilos en línea (`style`): la política de seguridad del panel los bloquea y el lint lo prohíbe.
- **Don't** cargar fuentes, imágenes ni scripts de terceros, ni usar `data:`.
- **Don't** usar el acento para decorar ni para lo simulado (va en ámbar).
- **Don't** usar franjas de color gruesas al costado de tarjetas o cajas, degradados de texto ni reflejos animados.
- **Don't** armar las pantallas con filas de tarjetas de cifras ni poner etiquetas sobre los títulos.
