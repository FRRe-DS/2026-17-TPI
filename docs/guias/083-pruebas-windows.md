# 083 · Portabilidad de las pruebas en Windows

Validación del issue #83 · rama de corrección `fix/083-pruebas-windows`.

## Problema y resultado

En Windows, ocho pruebas fallaban y otras 43 no llegaban a ejecutarse por un error de preparación. La corrección conserva las mismas comprobaciones y códigos esperados. No agrega requisitos, dependencias ni permisos al producto.

## Cambios

- `pruebas/panel/unitarias/docker.test.ts`: obtiene la raíz con `resolve(fileURLToPath(...))`. La ruta esperada queda normalizada tanto con separadores Windows como POSIX; siguen comprobándose el directorio y los argumentos exactos del comando.
- `pruebas/panel/http/estaticos.test.ts`: entrega a Vite una ruta nativa con `fileURLToPath`, en lugar de usar `URL.pathname`, que antepone una barra a la unidad Windows. Se mantienen las 43 comprobaciones del cliente realmente compilado.
- `scripts/panel-humo.mjs`: `main` devuelve 0 o 1 y se asigna a `process.exitCode`. Node puede cerrar conexiones y terminar la escritura de la salida; ante un panel inaccesible no se ejecutan las comprobaciones restantes. Las pruebas siguen exigiendo código 1 ante fallas.

## Entorno Windows

Node 24.15.0 también presentó cierres inesperados de los procesos de Vitest con código 3221226505. El [fallo de libuv de Node en Windows](https://github.com/nodejs/node/issues/56645) tiene una [corrección incluida en Node 24.20.0](https://nodejs.org/en/blog/release/v24.20.0). Se actualizó esta máquina a Node 24.22.0, la misma versión que usa la imagen del proyecto. El instalador oficial se verificó con SHA256 y firma OpenJS Foundation. No se modificaron `package.json`, `package-lock.json` ni las opciones de Vitest.

## Validación

- Antes: ocho fallas y 43 pruebas sin ejecutar en los tres archivos afectados.
- Después de corregir las rutas y la salida: las 74 pruebas de esos archivos pasan.
- Con Node 24.22.0, `npm test` pasa: 151 archivos y 5722 pruebas, sin omisiones ni errores de procesos. Se ejecutó con la configuración normal, incluida integración con PostgreSQL real en Docker.
- `npm run build`, `npm run panel:build`, ESLint, `git diff --check` y `spec-check` pasan.

Esta corrección desbloquea la validación de T1 de la spec 083. El acceso real con Keycloak sigue correspondiendo a las tareas siguientes.
