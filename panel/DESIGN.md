---
name: M2 · Clientes
description: Panel web de M2 para el cliente de prueba y para quien evalúa; un formulario con folio en papel cálido.
colors:
  papel: "#f3ece0"
  hoja: "#fbf8f2"
  campo: "#ffffff"
  tinta: "#2a2018"
  tinta-suave: "#665a4d"
  acento: "#6b4a2e"
  acento-tenue: "#efe4d3"
  sobre-acento: "#fbf8f2"
  regla: "#d8cab4"
  borde-campo: "#8f7e69"
  foco: "#6b4a2e"
  seleccion: "#e6d3b3"
  etiqueta-fondo: "#f6efe3"
  lateral: "#4e3420"
  lateral-hover: "#5e412a"
  lateral-texto: "#f3ece0"
  lateral-suave: "#d2bfa3"
  lateral-regla: "#6b4a2e"
  franja: "#2a2018"
  franja-texto: "#e9dfd0"
  franja-metodo: "#d6b48a"
  franja-ok: "#8cc79a"
  franja-mal: "#f09a86"
  franja-pista: "#4a3d33"
  ok: "#2f6b3a"
  ok-fondo: "#e8f0e6"
  mal: "#a23b2a"
  mal-fondo: "#f7e6e1"
  aviso: "#7a5410"
  aviso-fondo: "#f5ebd6"
typography:
  headline:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Ubuntu, Cantarell, 'Noto Sans', sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Ubuntu, Cantarell, 'Noto Sans', sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 650
    lineHeight: 1.3
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Ubuntu, Cantarell, 'Noto Sans', sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  label:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Ubuntu, Cantarell, 'Noto Sans', sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.3
  data:
    fontFamily: "ui-monospace, 'SF Mono', 'Cascadia Mono', 'Ubuntu Mono', Menlo, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  chip: "4px"
  control: "6px"
  hoja: "8px"
  etiqueta: "999px"
spacing:
  e-1: "4px"
  e-2: "8px"
  e-3: "16px"
  e-4: "24px"
  e-5: "32px"
  e-6: "40px"
components:
  boton-contorno:
    backgroundColor: "transparent"
    textColor: "{colors.acento}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  boton-contorno-hover:
    backgroundColor: "{colors.acento-tenue}"
    textColor: "{colors.acento}"
  boton-principal:
    backgroundColor: "{colors.acento}"
    textColor: "{colors.sobre-acento}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  etiqueta-simulado:
    backgroundColor: "{colors.etiqueta-fondo}"
    textColor: "{colors.acento}"
    rounded: "{rounded.etiqueta}"
    padding: "3px 10px"
  chip-rol:
    backgroundColor: "{colors.tinta}"
    textColor: "{colors.hoja}"
    typography: "{typography.data}"
    rounded: "{rounded.chip}"
    padding: "4px 8px"
  menu-elemento:
    backgroundColor: "{colors.lateral}"
    textColor: "{colors.lateral-texto}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  menu-elemento-actual:
    backgroundColor: "{colors.lateral-texto}"
    textColor: "{colors.lateral}"
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

**Creative North Star: "El formulario con folio"**

El panel es un formulario de papel: cada pantalla es una hoja con sus casilleros, y cada respuesta de M2 queda archivada bajo su folio, el `X-Request-Id`, que es el puente con los logs de M2. Tres planos lo arman: el menú lateral en sepia oscuro, la hoja clara donde se trabaja y la franja técnica oscura al pie, siempre a la vista y siempre chica.

Es una herramienta (modo Operate): densidad de notebook a 1280 px, lectura rápida y nada que compita con los datos. La marca está en los detalles precisos (tinta sepia, etiquetas punteadas de lo simulado, números tabulares), no en decoración. Se rechaza a propósito el aspecto de cafetería o rústico (nada de texturas, madera ni tipografías manuscritas) y el tablero sobrecargado de tarjetas con cifras.

**Key Characteristics:**
- Papel cálido de fondo, hoja un paso más clara para trabajar, tinta casi negra.
- Un solo acento, sepia, en acciones, enlaces y foco.
- Lo simulado se marca con borde punteado; lo técnico va en monoespaciada.
- Plano: separación por líneas de 1 px y por escalones de tono, sin sombras.
- Mismo escritorio de noche en modo oscuro, nunca un negro azulado.

## Colors

Marrones y beige de baja saturación, con verde, ladrillo y ámbar reservados para estados.

### Primary
- **Tinta sepia** (#6b4a2e; oscuro #ddb98d): botón principal, botones de contorno, enlaces, texto de las etiquetas de lo simulado y anillo de foco (`foco`).
- **Sepia tenue** (#efe4d3; oscuro #3a2e23): fondo del botón de contorno al pasar el puntero.

### Neutral
- **Papel** (#f3ece0; oscuro #1c1611): fondo de la página.
- **Hoja** (#fbf8f2; oscuro #262019): superficies de trabajo, el encabezado y el texto del chip de rol.
- **Campo** (#ffffff; oscuro #1f1914): fondo de los campos de formulario.
- **Tinta** (#2a2018; oscuro #efe6d8): todo el texto corrido y el fondo del chip de rol.
- **Tinta suave** (#665a4d; oscuro #bbaa94): texto secundario, nunca texto corrido.
- **Regla** (#d8cab4; oscuro #3e3329): líneas de 1 px entre superficies.
- **Borde de campo** (#8f7e69; oscuro #7d6c59): contorno de los campos, 3:1 contra el campo.
- **Lateral** (#4e3420; oscuro #22180f) con **texto lateral** (#f3ece0) y **lateral suave** (#d2bfa3; oscuro #b9a387) para grupos y subtítulos.
- **Franja** (#2a2018; oscuro #0f0b08) con su propio texto (#e9dfd0), método (#d6b48a), código bueno (#8cc79a), código malo (#f09a86) y pista de la barra (#4a3d33).

### Estados
- **Bien** (#2f6b3a / fondo #e8f0e6; oscuro #8cc79a / #1e2a1f), **Mal** (#a23b2a / #f7e6e1; oscuro #f09a86 / #33201b), **Aviso** (#7a5410 / #f5ebd6; oscuro #e2b45e / #30261a).

### Named Rules
**The Un Solo Acento Rule.** El sepia es el único color de marca. Verde, ladrillo y ámbar significan estado y no se usan para decorar.

**The Clasificado Rule.** Todo color nuevo se agrega en los dos modos y se clasifica en `contraste.test.ts` como texto (4,5:1), componente (3:1) o decorativo; si no, la prueba falla.

## Typography

**Body Font:** pila del sistema (`system-ui` y alternativas).
**Data Font:** `ui-monospace` y alternativas, solo para datos: identificadores, método y ruta HTTP, códigos, folios, duraciones.

**Character:** letra del sistema operativo, sobria y familiar para quien usa la herramienta todos los días; la monoespaciada marca lo que se copia o se busca en un log. No se cargan fuentes de terceros (política de seguridad del panel); una fuente propia solo entra guardada en `cliente/fuentes/` con su licencia.

### Hierarchy
- **Headline** (700, 1.75rem, 1.2): el título `h1` de cada pantalla, uno por vista.
- **Title** (650, 0.9375rem, 1.3): títulos de secciones y de hojas.
- **Body** (400, 1rem en teléfono y 0.9375rem desde 960 px, 1.5): texto y controles; cifras tabulares en todo el cuerpo.
- **Label** (600, 0.8125rem): títulos de grupo del menú, en minúscula de oración.
- **Data** (400, 0.8125rem, 1.4): la franja técnica, el chip de rol y los identificadores.

### Named Rules
**The Mono Es Dato Rule.** La monoespaciada va solo sobre valores que existen tal cual en M2 o en un log. Nunca como adorno de «técnico».

**The Sin Versalitas Rule.** Nada de etiquetas chicas en mayúsculas con espaciado; los grupos se escriben en minúscula de oración. La única mayúscula es la del valor real del rol (`CLIENTE`).

## Layout

Una sola grilla de 8 px (4 px para lo muy apretado): `e-1` a `e-6`. Controles de 44 px de alto como mínimo.

- **Desde 960 px:** dos columnas, menú lateral fijo de 248 px a toda la altura y, a la derecha, encabezado de 64 px, pantalla y franja técnica de 56 px pegada al pie de la ventana. Márgenes de la pantalla de 40 px.
- **De 600 a 959 px:** una columna, márgenes de 32 px; el menú pasa arriba como barra con el botón «Menú».
- **Menos de 600 px:** márgenes de 16 px; las etiquetas de lo simulado se apilan, el identificador se corta con puntos suspensivos, la franja oculta la barra de duración y el folio y acorta su enlace.
- El menú abierto en el teléfono empuja la pantalla, no la tapa, y se cierra al navegar o con Escape.
- `scroll-padding-bottom` deja libre la franja: lo que recibe el foco nunca queda debajo de ella.

## Elevation & Depth

Plano. La profundidad sale de tres escalones de tono (lateral, papel y hoja) y de líneas de 1 px; no hay sombras en reposo. Solo lo que realmente flota (un diálogo de confirmación, T18) puede llevar sombra suave.

**The Plano Por Defecto Rule.** Una superficie se separa de otra por tono o por una regla de 1 px, nunca por sombra ni degradado.

## Shapes

Esquinas suaves y pocas: 4 px en el chip de rol, 6 px en botones, campos y elementos del menú, 8 px en las hojas, píldora completa solo en las etiquetas de lo simulado. Los bordes son de 1 px; el punteado queda reservado a lo simulado.

## Components

### Buttons
- **Shape:** esquinas de 6 px, 44 px de alto, 16 px a los costados, peso 600.
- **Principal:** fondo tinta sepia y texto hoja.
- **Contorno:** borde sepia de 1 px, fondo transparente y texto sepia; al pasar el puntero, fondo sepia tenue (solo con puntero fino). Las acciones que deshacen (como «Cerrar sesión») van en contorno y apartadas.
- **Press / Focus:** `scale(0.97)` al presionar, 160 ms con salida exponencial; foco con anillo de 2 px separado 2 px, del color `foco` (o del texto del menú sobre fondos oscuros).

### Chips
- **Etiqueta de lo simulado:** píldora con borde punteado sepia, fondo `etiqueta-fondo`, texto sepia de 12 px: «Sesión: simulado, pendiente de M1», «Viajes: simulado, pendiente de M6». Va en el encabezado de toda vista.
- **Chip de rol:** fondo tinta, texto hoja, monoespaciada 600 de 11 px con 0.08em; muestra el valor del rol tal cual.

### Cards / Containers
- **Hoja:** fondo hoja, borde regla de 1 px, esquinas de 8 px, 24 px de relleno, sin sombra. Las hojas no se anidan.

### Inputs / Fields
- **Style:** fondo campo, borde `borde-campo` de 1 px, esquinas de 6 px, 44 px de alto y 16 px de letra (sin zoom en el teléfono). Los detalles de error y espera llegan con T18.

### Navigation
- **Menú lateral:** marca «M2 · Clientes» con «Grupo 17 · TPI 2026» debajo, grupos por rol con su título en minúscula de oración, elementos de 44 px. El actual lleva `aria-current="page"` y se invierte (fondo del texto del menú, texto del lateral); el resto cambia solo de fondo al pasar el puntero.
- **Teléfono:** barra con la marca y el botón «Menú» (ícono SVG propio de 20 px, `aria-expanded`); el menú aparece con 200 ms de opacidad y 4 px de desplazamiento.
- **Saltar al contenido:** primer elemento del orden de foco, visible solo con teclado, lleva el foco a `main`.

### Franja técnica
La firma del sistema: fija al pie, fondo franja, monoespaciada de 13 px. Muestra el último pedido a M2 (método, ruta cortada con puntos suspensivos, código en verde o ladrillo, duración dibujada a escala con una barra SVG de 120 px en la que el ancho completo es un segundo, y el folio) y el enlace «Ver pedidos y respuestas». Sin pedidos dice «Sin pedidos a M2 todavía». El registro que la llena llega con la pantalla de detalle técnico (T31).

## Do's and Don'ts

### Do:
- **Do** usar solo las variables de `variables.css`; un valor nuevo se agrega en claro y oscuro y se clasifica en `contraste.test.ts`.
- **Do** marcar con borde punteado todo lo que sale de una fuente simulada.
- **Do** mostrar en monoespaciada los valores reales de M2 (UUID, método, ruta, código, folio).
- **Do** mantener controles de 44×44 px, foco visible y el uso completo con teclado de 360 a 1440 px.
- **Do** limitar el movimiento a respuesta: presión, aparición del menú; nada de entradas al cargar.

### Don't:
- **Don't** usar estilos en línea (`style`): la política de seguridad del panel los bloquea y el lint lo prohíbe.
- **Don't** cargar fuentes, imágenes ni scripts de terceros, ni usar `data:`.
- **Don't** usar sombras en reposo, degradados ni texturas de papel o madera: el pedido fue profesional, no rústico.
- **Don't** armar las pantallas con filas de tarjetas de cifras ni poner etiquetas sobre los títulos.
- **Don't** usar verde, ladrillo o ámbar para algo que no sea un estado.
