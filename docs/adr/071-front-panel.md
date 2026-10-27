# ADR 071 — Pila del front de M2 (el panel)

Fecha: 2026-10-27 · Estado: propuesta
Issue: #71

## Contexto
La spec 071 pide una interfaz web para M2 (app de cliente responsiva, vistas de operador y de otro módulo, detalle técnico y un M6 simulado). No puede tocar `src/`, `contrato/` ni `migraciones/`, tiene que levantarse en un contenedor o como proceso en la máquina, y la segunda parte (issue #72) le suma una vista de demostración. El grupo trabaja a nivel principiante (ADR 003) y el repositorio ya tiene TypeScript, Fastify, Vitest y ESLint. El servicio no tiene CORS y los tokens los firma un comando, así que un navegador no puede llamar a M2 directamente.

## Decisión
- **Un servidor propio del panel** (Fastify 5, ya presente) que sirve la página, firma los tokens de desarrollo con `jose` (ya presente) y reenvía a M2 solo las rutas `/api/v1/clientes…` y `/health`. El navegador nunca ve la clave ni un token.
- **Cliente en React 19 y TypeScript, compilado con Vite 8** (que el repo ya tiene por Vitest). React escapa el texto por defecto y se prohíbe `dangerouslySetInnerHTML`. CSS propio: variables globales para el diseño y CSS Modules por componente, sin Tailwind. El enrutador (por `#`) y el manejo de estado y de carga de datos son código propio pequeño, sin `react-router` ni librerías de datos. Los tipos de las respuestas salen del contrato con `openapi-typescript`, como en el servicio.
- **Mismo paquete y mismo `package-lock.json`** que M2, en la carpeta `panel/`. React y Vite son dependencias de desarrollo: se compilan dentro de los archivos finales y no entran en la imagen de producción, que no cambia.
- **M6 simulado como servicio propio** del perfil `panel` de compose, con un puerto de control por HTTP; sale de la misma imagen que el panel (otro destino del `Dockerfile`).
- **Prueba en navegador real** con `playwright-core` y el Chrome que ya esté instalado (el de las máquinas del grupo y el de `ubuntu-24.04` en CI), más `axe-core` para contraste y etiquetas. Sin descarga de navegadores. Corre aparte de `npm test`, en el script `panel:navegador` y en un job de CI propio.
- **Sin fuentes ni scripts de terceros** en el navegador: la política de contenido solo admite recursos del propio panel.

## Alternativas descartadas
- Sin framework (TypeScript y funciones que arman el DOM): cero dependencias para las pantallas y fácil de leer, pero más código a mano para doce pantallas con formularios y estados, y las recetas de las skills de diseño (Emil Kowalski, taste-skill) apuntan a React. Se descartó por decisión de Lautaro del 2026-10-27.
- Preact en lugar de React: más liviano, pero con menos ejemplos y documentación para un grupo que recién empieza.
- Un `panel/package.json` aparte: aísla las dependencias, pero duplica instalación, imagen y CI.
- Agregar CORS y un endpoint de tokens a M2: evitaría el servidor del panel, pero toca `src/` y el contrato.
- Playwright Test con descarga de navegadores: pesa cientos de MB por máquina y por corrida de CI, y el Chrome del sistema alcanza.
- Importar `src/auth/tokens.ts` en el panel: ahorra 15 líneas, pero acopla las dos imágenes. Lo evita una prueba que verifica que M2 acepta los tokens del panel.

## Consecuencias
- Siete dependencias de desarrollo nuevas (`react`, `react-dom`, `@types/react`, `@types/react-dom`, `@vitejs/plugin-react`, `playwright-core`, `axe-core`) y un job de CI nuevo; los nombres de los jobs que exige la protección de `main` no cambian.
- El grupo tiene que aprender lo básico de React (componentes, estado y efectos). La guía de la spec lo explica con el código del panel.
- `npm test` no corre la prueba en navegador: hace falta Chrome para `npm run panel:navegador`.
- Quien cambie el contrato rompe la compilación del panel si el cambio afecta a una pantalla, porque los tipos salen de `contrato/openapi.yml`.
- Si el panel pasa a producción alguna vez, hay que revisarlo entero: hoy es una herramienta de desarrollo y demostración, con la clave de desarrollo y sin HTTPS.
