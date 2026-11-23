# Guía — Spec 083 Sesión real del frontend

## Estado de trabajo

T1 implementada y validada en `impl/083-front-keycloak`. T2 a T26 siguen pendientes y la spec conserva el estado aprobada. El inicio de sesión real todavía no está implementado.

## Tareas

### T1 — Separar configuración real y de desarrollo y validar orígenes · commit `083/T1`

- Qué cambió: `panel/servidor/config.ts:cargarConfigPanel` devuelve una unión discriminada por `modoAuth`. Desarrollo conserva sus valores y credenciales anteriores. OIDC exige origen público y bases pública e interna del realm; no lee ni devuelve claves HS256, base, Docker o control M6 heredados.
- Por qué así: RNF-06.83.1. Las herramientas de desarrollo reciben `ConfigPanelDesarrollo` explícitamente y no pueden recibir una configuración OIDC por error de tipos.
- Retornos: se derivan exclusivamente del origen validado, como `/auth/retorno` y `/auth/salida`. El origen es exacto y HTTPS, o HTTP solo en localhost/127.0.0.1/::1. Se rechazan credenciales, comodines, rutas y parámetros. Las bases de Keycloak no admiten credenciales, query ni fragmento y deben corresponder al mismo camino de realm; la dirección interna puede usar HTTP entre contenedores.
- Configuración adicional: cliente `m2-front` por defecto, plazo de identidad de 2000 ms y etiqueta de M6 simulado activada. Los valores se validan sin repetir su contenido en errores. Los ejemplos del entorno real corresponden a T20 y su documentación a T25.
- Cómo se conecta: `app.ts` y `arranque.ts` rechazan por ahora el modo OIDC antes de registrar herramientas o abrir puertos, hasta conectar las rutas de sesión. Esta protección temporal se reemplaza al conectar el servidor OIDC. No hay acceso real ni sustitución por una identidad simulada.
- Tests: `pruebas/panel/unitarias/config-oidc.test.ts` comprueba configuración mínima, ausencia de secretos heredados, retornos propios, URLs inválidas, plazo y modo. `config.test.ts` y `tokens.test.ts` conservan la regresión de desarrollo. `pruebas/panel/http/arranque.test.ts` verifica que OIDC no abra el servidor de desarrollo mientras falta implementar sesión.

## Validación del 2026-11-23

- Rojo inicial de T1: 26 fallas de 29 casos nuevos antes de implementar la configuración. La comprobación posterior de configuración, tokens, arranque y proxy pasó sus 196 pruebas.
- Al validar toda la suite aparecieron ocho fallas previas de Windows y 43 pruebas que no ejecutaban por preparación fallida. Se reprodujeron en el commit original `29fc6ca`. La corrección se documenta aparte en [083-pruebas-windows](../../docs/guias/083-pruebas-windows.md) y se registra en su propio commit de validación.
- Tras instalar Docker y actualizar Node a 24.22.0: `npm test` pasa con 151 archivos y 5722 pruebas, sin omisiones ni errores de procesos. Incluye unitarias e integración con PostgreSQL real en Docker.
- `npm run build`, `npm run panel:build`, ESLint, `git diff --check` y `node scripts/spec-check.mjs --rama impl/083-front-keycloak --base origin/main` pasan.
- El entorno de desarrollo se conserva levantado: seis servicios sanos, panel en http://localhost:8083 y M2 en http://localhost:8082. `node scripts/panel-humo.mjs` pasó sus seis comprobaciones. No se realizó revisión visual en navegador ni se afirma que el login o el rediseño estén implementados.
- Comprobación adicional anterior: `npx tsc --noEmit` global tenía 42 diagnósticos, iguales a los del commit original en una comparación en memoria. Los builds de API y panel usan sus configuraciones propias y pasan; no se amplió T1 para modificar esas pruebas ajenas.

## Siguiente tarea

T2: almacenes acotados de sesiones y transacciones en memoria. Empezar por pruebas de vencimiento, consumo único, capacidad, limpieza y cierre de temporizadores; no conectar aún el login de las tareas siguientes.
