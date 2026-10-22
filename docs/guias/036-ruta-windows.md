# 036 · consistencia.test.ts en Windows

Issue #36 · rama `fix/036-ruta-windows`

## Qué cambió
`pruebas/unitarias/consistencia.test.ts`: las rutas que devuelve `globSync` (`archivosDe` y `todasLasPruebas`) pasan por `conBarras`, que cambia cada `\` por `/` en el momento de leerlas. Nada más cambia: ni el código del servicio ni las demás pruebas.

## Por qué
El PR #34 informó que `npm test` dio 2006 pruebas en verde y una en rojo, la de «las de pruebas/integracion/ son de integracion, y las demás, de unitarias», y que la causa eran los separadores de ruta de Windows.

`globSync` de `node:fs` devuelve las rutas con el separador de la plataforma: en Windows, `pruebas\integracion\arranque.test.ts`. Esa prueba pregunta `archivo.startsWith('pruebas/integracion/')`, que con esas rutas nunca se cumple, y entonces espera las cinco pruebas de integración entre las unitarias. Las demás pruebas del archivo comparan rutas de `globSync` entre sí (las dos con `\`), y por eso pasan.

Se normaliza una sola vez, donde las rutas entran, y no en cada comparación: el que sume otra comparación con `/` no tiene que acordarse.

## Cómo se conecta
- Es la prueba de RNF-07.1 que cuida los dos proyectos de Vitest (T17 de la spec 003): que toda prueba caiga en uno solo, y que las de `pruebas/integracion/` sean de integración.
- El issue #26 (finales de línea LF) arregló otro problema de Windows, el de CRLF. Este es independiente.

## Cómo se verifica
Primero se simuló en Linux lo que informa el PR #34, reemplazando `globSync` en la prueba, solo por un rato, por una función que devuelve las mismas rutas con `\`:

| Código | En Linux | Con las rutas simuladas de Windows |
|---|---|---|
| El de `main` | 26 de 26 | 25 de 26: falla «las de pruebas/integracion/ son de integracion…», con las cinco rutas de integración con `\` |
| Con el cambio | 26 de 26 | 26 de 26 |

La simulación no queda en el repositorio.

Después se probó en Windows (Morena García, en esta rama): `npm test` dio 21 archivos y 2007 pruebas en verde, con las 26 de `consistencia.test.ts`. Con el código sin el cambio, la misma prueba había fallado en esa máquina, con las cinco rutas de integración con `\`.

## Qué mirar con atención
- Si se suma otra prueba que lea rutas de `globSync` o de `readdirSync` y las compare con textos escritos con `/`, tiene que pasar por `conBarras`.
- Una prueba que arme rutas para abrir archivos no tiene este problema: Windows acepta `/` como separador.
