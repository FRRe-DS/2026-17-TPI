# Guía — Spec 007 Historial resumido de viajes

## Visión general (se escribe al validar, 30-60 líneas)
Pendiente: se completa en T7.

## Tareas

### T1 — Configuración de M6 · commit `007/T1`
- Qué cambió: `src/config.ts:cargarConfig` lee tres variables nuevas y las suma a `Config` como `urlM6`, `credencialM6` y `reintentarDespuesS`. `ejemplo.env` y la tabla de variables del `README.md` las documentan.
- Por qué así: `M2_URL_M6` es obligatoria, así que una mala configuración se ve al arrancar y no con el primer pedido de historial (RNF-06, decisión de la spec). La URL se guarda sin la barra final porque el cliente de M6 le suma rutas que empiezan con una. `M2_CREDENCIAL_M6` es opcional y solo admite caracteres visibles sin espacios, porque va en un encabezado `Authorization`: un valor con un salto de línea haría fallar toda llamada. `M2_REINTENTAR_DESPUES_S` (5 por defecto, de 1 a 3600) alimenta el `Retry-After` del 503 de M6 (RF-2.4.6); 1 es el mínimo que admite el contrato.
- Cómo se conecta: sigue el mismo lector de variables de la spec #3 (`crearLector`), así que los errores nombran la variable y nunca repiten el valor, por si la URL trae una contraseña. Todavía no hay quien use estos campos: el cliente de M6 los usa desde T2 y T4.
- Tests: `pruebas/unitarias/config.test.ts` (valores válidos e inválidos, vacías, error sin el valor recibido), `pruebas/unitarias/ejemplo-env.test.ts` (el ejemplo trae las tres variables y pasa la validación) y `pruebas/integracion/arranque.test.ts` (sin URL de M6 el servicio no arranca y la nombra). Los helpers `pruebas/ayudas/app.ts` y `arranque.ts` suman los campos nuevos.
- Para mirar con atención: `ejemplo.env` trae una credencial de desarrollo (`credencial-de-desarrollo-para-m6`) porque compose solo pasa al contenedor lo que está en ese archivo, y la prueba del ejemplo exige un valor por defecto en cada línea. No es un secreto. La URL de ejemplo apunta a un host `m6` que no existe en el compose: el servicio arranca igual y el historial daría 503 hasta tener un M6. La credencial todavía no está en `secretosDeConfig` (`src/logs.ts`): se suma en T2, cuando empieza a usarse.
