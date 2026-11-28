# 136 · Pruebas inestables por tiempos ajustados

Issue #136 · rama `fix/136-pruebas-inestables`

## Qué pasaba
Cuatro pruebas fallaban de vez en cuando, casi siempre con la máquina cargada (CI, o `npm test` mientras corre otra cosa), y había que reintentar el CI a mano (#127, #132):

| Prueba | Falla | Causa |
|---|---|---|
| `pruebas/panel/integracion/compose-front.test.ts` (las dos) | `Test timed out in 5000ms` | `docker compose config` tarda 0,1 s en una máquina de desarrollo, pero pasó los 5 s de Vitest en el runner de CI. |
| `pruebas/unitarias/token-servicio.test.ts` | 2 pedidos en vez de 1, o el token siguiente («otro» en vez de «nuevo») | Tiempo máximo de 200 ms por intento en pruebas que no miden el corte. El servidor de prueba corre en el mismo proceso: cargado, tarda más que eso, M2 reintenta (como debe) y el servidor cuenta un pedido de más y entrega la respuesta siguiente de su lista. |
| `pruebas/unitarias/claves-jwks.test.ts` «con un 5xx hacen un solo pedido por intento» | 3 pedidos en vez de 2 | **Un defecto real de `src/auth/claves-jwks.ts`**, ver abajo. |
| `pruebas/modulos/cliente.test.ts` «corta el intento aunque los encabezados lleguen antes del plazo» | 611 ms, límite 600 | El corte es a los 200 ms; el límite separaba eso de los 800 ms del cuerpo demorado con poco margen. |

### El defecto de `claves-jwks.ts`
La spec 080 (Casos límite) dice que muchas solicitudes juntas sin claves hacen un solo pedido a Keycloak y todas esperan ese. `jose` junta las solicitudes en un pedido solo mientras ese pedido está en curso. Tras un intento fallido, cada solicitud esperaba su propia pausa de 200 ms, y Node le da a cada temporizador su hora de inicio: con la máquina cargada, las diez pausas no terminan juntas, y las más tardías llegaban con el segundo pedido ya respondido y hacían otro. Con las pausas desfasadas 5 ms entre sí, eran 9 o 10 pedidos en vez de 2.

## Qué cambió
- `src/auth/claves-jwks.ts`, `pausaDe`: las solicitudes que fallaron por el mismo pedido (jose les entrega el mismo objeto de error) esperan una sola pausa, guardada en un `WeakMap` por ese error, y vuelven a pedir en el mismo instante. La pausa sigue siendo de 200 ms desde la falla y solo entre intentos.
- `pruebas/unitarias/claves-jwks.test.ts`: prueba nueva «aunque sus pausas no empiecen en el mismo milisegundo, vuelven a pedir juntas», que reemplaza `setTimeout` por uno que arranca 5 ms tarde cada vez. Además, las pruebas que no miden el corte usan un tiempo máximo holgado.
- `pruebas/ayudas/servidor-modulo.ts`: `TIEMPO_HOLGADO_MS` (5 s) y `terminaPorTiempo`, para que cada prueba use el tiempo corto solo con `cuelga` o `demora-cuerpo`.
- `pruebas/unitarias/token-servicio.test.ts`: lo mismo en los tres bloques de Keycloak.
- `pruebas/modulos/cliente.test.ts`: el cuerpo demorado llega a los 2000 ms y el límite pasa a 1000 ms. Si el intento no se cortara, tardaría 2000 ms o más.
- `pruebas/panel/integracion/compose-front.test.ts`: límite de 30 s en las dos pruebas.

Nada cambia en el contrato, las migraciones ni la configuración.

## Por qué así
- **Pausa compartida y no un pedido compartido para toda la tanda de intentos:** cada solicitud puede pedir otro `kid`, así que no pueden compartir el resultado; sí el momento de volver a pedir. Atar la pausa al error y no a un instante evita que una solicitud que falló por otro pedido, más tarde, se sume a una pausa ya empezada y espere menos de 200 ms.
- **Tiempo holgado y no márgenes más grandes en todas:** las pruebas que miden el corte (`cuelga`, `demora-cuerpo`) siguen con 150 o 200 ms y sus márgenes; las demás no dependen del tiempo, así que no tienen por qué cortar.

## Cómo se verifica
- La prueba nueva, sin el cambio de `src/`: falla tres de tres veces (9 o 10 pedidos). Con el cambio: pasa tres de tres.
- Con el tiempo de `src/auth/claves-jwks.ts` y `src/auth/token-servicio.ts` multiplicado por 20 a propósito, caen 8 pruebas: las que miden el corte siguen detectándolo.
- Bajo carga, cuatro `npx vitest run --project unitarias` a la vez:

| Corridas | Antes | Después |
|---|---|---|
| 4 (sin cambios) | 1 con 2 fallas en `token-servicio` | — |
| 8 (solo tiempos holgados) | 2 con falla en `modulos/cliente` | — |
| 12 (tiempos holgados y `modulos/cliente`) | 1 con falla en `claves-jwks` 5xx | — |
| 12 (todo el cambio) | — | 12 en verde (5165 pruebas cada una) |

- La duración de `claves-jwks` y `token-servicio` no cambia (12,2 s las dos juntas, antes y después).
- `npm test` (174 archivos, 6071 pruebas), `npm run lint`, `npm run build` y `node scripts/spec-check.mjs` en verde.

## Qué mirar con atención
- `pausaDe` depende de que jose entregue a todas las solicitudes de un mismo pedido el mismo objeto de error (lo hace: todas esperan la misma promesa). Si una versión futura lo envolviera por solicitud, cada una volvería a tener su pausa; la prueba nueva lo detectaría.
- Otras pruebas con `crearServidorModulo` y tiempos cortos pueden tener el mismo problema; estas son las que fallaron. Si aparece otra, el arreglo es el mismo: `TIEMPO_HOLGADO_MS` salvo con `terminaPorTiempo`.
