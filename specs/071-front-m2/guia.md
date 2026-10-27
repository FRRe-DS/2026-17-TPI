# Guía — Spec 071 Front de M2: app de cliente y base del panel

## Visión general

El panel es una app web propia (React 19 y Vite 8) con un servidor chico en Fastify que le firma tokens de desarrollo y le reenvía los pedidos a M2.
Vive entera en `panel/`, con pruebas en `pruebas/panel/`, y no toca `src/`, `contrato/` ni `migraciones/`. Esta guía crece con cada tarea; por ahora
solo está la configuración del proyecto.

## Tareas

### T1 — Dependencias, scripts y configuración del proyecto · commit `071/T1`
- Qué cambió: `package.json` suma siete devDependencies con versión exacta (`react` y `react-dom` 19.3.1, `@types/react` y `@types/react-dom` 19.3.0, `@vitejs/plugin-react` 6.1.2, `playwright-core` 1.64.1, `axe-core` 4.14.0) y tres scripts: `panel:tipos` (genera `panel/cliente/src/generado/contrato.ts` desde el OpenAPI), `panel:build` (tipos y `tsc` del servidor; el cliente se suma cuando exista) y `panel:navegador`. `npm test` ahora corre `--project unitarias --project integracion`. Nuevos: `panel/tsconfig.servidor.json`, `panel/tsconfig.cliente.json` y `panel/servidor/main.ts` (vacío, lo completan T2 y T3). `eslint.config.mjs` revisa `.tsx`, ignora `panel/dist/` y los tipos generados y prohíbe `dangerouslySetInnerHTML` en `panel/cliente/`. `vitest.config.ts` suma las carpetas de `pruebas/panel/` a `unitarias` e `integracion` y declara el proyecto `navegador`. `.gitignore` suma los tipos generados del cliente.
- Por qué así: todas son devDependencies porque Vite compila el cliente y lo que corre en producción es solo el servidor (ADR 071). `navegador` es un proyecto aparte y `npm test` lo excluye por nombre, para que sin Chrome la suite siga en verde. El tsconfig del servidor emite a `panel/dist/` (que `dist/` ya ignora) y el del cliente solo comprueba tipos, porque Vite no lo hace. `main.ts` existe porque `tsc` falla si el proyecto no tiene ninguna entrada.
- Cómo se conecta: las tareas siguientes agregan archivos en `panel/servidor/` y en `pruebas/panel/unitarias|http`, y ya los toman los `include`. `panel:build` pasa a compilar también el cliente en el tramo C.
- Tests: `pruebas/unitarias/consistencia.test.ts` ahora exige los tres proyectos, que `unitarias` e `integracion` tengan pruebas y que cada prueba caiga en el que le toca (`pruebas/panel/integracion/` en integración, `pruebas/panel/navegador/` en navegador). Se comprobó a mano, con un archivo temporal, que ESLint rechaza `dangerouslySetInnerHTML` y que `tsc -p panel/tsconfig.cliente.json` compila un `.tsx`. `npm ci`, `lint`, `build`, `panel:build` y `npm test` (3135) en verde.
- Para mirar con atención: `npm audit` avisa de `fast-uri` (moderado, viene de Fastify); ya estaba antes de esta tarea. `npm run panel:navegador` falla con «No test files found» hasta que lleguen las pruebas de navegador (T33 en adelante).
