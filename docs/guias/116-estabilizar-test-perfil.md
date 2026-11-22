# 116 · Estabilizar la prueba de actualización de perfil

Issue #116 · rama `fix/116-estabilizar-test-perfil`

## Qué pasaba

La prueba de `actualizarPerfil` comparaba los instantes de creación y actualización.
PostgreSQL puede registrar ambos dentro del mismo milisegundo que expone JavaScript.
En ese caso, exigir que el segundo sea mayor hacía fallar la prueba intermitentemente.

## Qué cambió

- En `pruebas/integracion/clientes.test.ts`, la prueba crea su propio cliente.
- Prepara `actualizado_en` con una fecha anterior fija, solo para ese `clienteId`.
- Recupera el perfil preparado antes de actualizarlo y conserva la comparación estricta.
- Comprueba también el teléfono, los campos conservados y la persistencia del resultado.

## Por qué así

La fecha conocida separa los instantes sin esperar ni depender de la velocidad de la máquina.
Si la actualización deja de renovar `actualizado_en`, la comparación estricta falla.
Aceptar igualdad por sí sola no detectaría esa regresión.
El plan de la spec 004 indica que cada actualización cambia explícitamente la marca de tiempo.

## Cómo se verifica

La prueba de integración usa PostgreSQL real y un identificador único para el perfil.
`npm test` incluye la prueba junto con las demás pruebas unitarias y de integración.
También corresponden lint, build y `spec-check` antes de presentar el cambio.

## Qué mirar con atención

La fecha artificial es solo un dato de preparación de la prueba; no modifica la lógica del servicio.
La conversión de fechas a JavaScript conserva milisegundos, no toda la precisión de PostgreSQL.
