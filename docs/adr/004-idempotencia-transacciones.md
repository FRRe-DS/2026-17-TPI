# ADR 004 — Transacciones e idempotencia reutilizable

Fecha: 2026-10-22 · Estado: aceptada
Issue: #4

## Contexto
Las altas de perfil y bloqueo deben reservar una clave de idempotencia y crear el recurso como una sola operación. La spec #5 también necesita esa garantía para crear direcciones. `consultar()` de la base solo ejecuta una sentencia, por lo que no puede garantizar ambas escrituras juntas.

## Decisión
- `src/bd/transaccion.ts` expondrá `transaccion(pool, fn)`: abre `BEGIN`, entrega consultas con el mismo límite de 2 s por sentencia y la misma clasificación de errores que `consultar()`, y termina con `COMMIT` o `ROLLBACK`.
- La reserva de idempotencia y el efecto de negocio se ejecutarán dentro de esa transacción.
- La identidad de una solicitud idempotente incluye operación, sujeto autenticado, `clienteId` de ruta cuando exista, clave y huella de cuerpo más parámetros de ruta. Así no se devuelve la respuesta de un recurso al solicitar otro.

## Alternativas descartadas
- Dos llamadas separadas a `consultar()`: puede quedar una reserva sin efecto o un efecto sin respuesta guardada.
- Una tabla de idempotencia específica por operación: duplica mecanismos y deja reglas distintas entre #4 y #5.

## Consecuencias
- #4 implementa primero transacciones e idempotencia; #5 las reutiliza.
- Las pruebas de integración cubren COMMIT, ROLLBACK, 409, 503 y concurrencia.
