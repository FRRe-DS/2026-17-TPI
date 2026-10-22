# 035 · Reintentar la consulta del job auditoria-main

Issue #35 · rama `fix/035-auditoria-reintento`

## Qué cambió
`.github/workflows/ci.yml`, job `auditoria-main`: las dos consultas a la API de GitHub (el PR del commit y sus aprobaciones) pasan por una función `consultar`, que las intenta hasta 5 veces, con 5 segundos de pausa entre un intento y otro (20 s como máximo por consulta). Reintenta si `gh` falla y también si la respuesta viene vacía.

Lo que el job decide no cambia. Si `gh` falla las 5 veces, el rojo dice «La API de GitHub no contestó…». Si contesta vacío las 5, quedan los mensajes de antes: «Push directo a main sin PR» o «mergeado sin aprobación».

## Por qué
En los merges de #17, #22, #30 y #32 el job dio rojo con «unexpected end of JSON input». Los cuatro PR estaban aprobados, y al volver a correr el job dio verde. En el de #32, el job corrió 5 segundos después del merge.

El paso corre con `bash -e`: con una sola consulta, el primer fallo de `gh` corta el paso antes de que llegue a su mensaje de error, y el rojo no dice qué pasó. Un rojo falso en `main` hace dudar de los rojos verdaderos, que son los que este job existe para mostrar.

No se comprobó si lo que falla es la consulta o si la API contesta vacío mientras todavía no asocia el PR con el commit. El reintento cubre las dos cosas.

Descartado: dejar el job como está y volver a correrlo a mano. Cada falso rojo cuesta atención y se confunde con uno verdadero.

## Cómo se conecta
- El nombre del job no cambia, así que la regla «Protección de main» sigue valiendo.
- Si se copia el paso a otro workflow, hay que copiar también `consultar`.

## Cómo se verifica
Un job de Actions no se prueba con Vitest, así que no hay tests propios. Se corrió el script del paso, sacado del `ci.yml`, como lo corre Actions (`bash -e`), con un `gh` de prueba que falla o contesta lo que se le pide y un `sleep` de prueba que no espera:

| Caso | Con el paso de `main` | Con el cambio |
|---|---|---|
| Contesta bien | verde | verde |
| `gh` falla 2 veces antes de contestar | rojo | verde, con 4 pausas |
| `gh` falla 4 veces antes de contestar | rojo | verde, con 8 pausas |
| `gh` falla 5 veces, o nunca contesta | rojo | rojo: «La API de GitHub no contestó al buscar el PR de …» |
| El commit no tiene PR | rojo: «Push directo a main sin PR» | rojo, el mismo mensaje, después de 4 pausas |
| El PR lo aprobó otra persona | rojo: «mergeado sin aprobación» | rojo, el mismo mensaje, sin pausas |
| El PR no tiene ninguna aprobación | rojo: «mergeado sin aprobación» | rojo, el mismo mensaje, después de 4 pausas |

Los checks de este PR no ejercitan el job: `auditoria-main` corre solo en un `push` a `main`. La prueba real es el próximo merge.

## Qué mirar con atención
- Un push directo a `main`, o un PR sin ninguna aprobación, tarda ahora unos 20 s más en dar el rojo: la respuesta vacía también se reintenta.
- Los 5 intentos y los 5 s son una elección, no un dato. Si después de un merge la API tarda más en contestar, se suben.
- La consulta de las aprobaciones trae solo la primera página de la API (30 revisiones). Con más de 30 revisiones en un PR, las aprobaciones podrían quedar afuera. Este cambio no lo toca.
