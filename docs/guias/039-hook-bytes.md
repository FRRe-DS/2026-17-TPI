# 039 · El hook de contexto lee EN-CURSO.local.md por bytes

Issue #39 · rama `fix/039-hook-bytes`

## Qué cambió
`.claude/hooks/context-restore.mjs`: en vez de tomar las primeras 60 líneas de `EN-CURSO.local.md`, toma hasta 4000 bytes (`MAX_BYTES`), cortados en el último salto de línea completo. Si recorta, agrega al final la línea `[recortado: el archivo sigue en EN-CURSO.local.md]`. Sin el archivo, o con un error de lectura, el hook hace lo mismo que antes.

## Por qué
El hook corre en cada arranque, reanudación, `/clear` y compactación, y lo que imprime entra en el contexto del agente. Un tope por líneas no acota nada si las líneas son largas: el 2026-10-22 el archivo tenía 138 KB y sus primeras 60 líneas pesaban 30 KB, unos 7.500 tokens por arranque. Se corrigió a mano reescribiendo el archivo a 3 KB; este cambio evita que vuelva a pasar sin que nadie se dé cuenta.

El aviso de recorte es para que el agente sepa que hay más y lo lea entero si lo necesita.

## Cómo se verifica
El hook no tiene pruebas automáticas; se corrió a mano con `CLAUDE_PROJECT_DIR` apuntando a carpetas de prueba:

| Archivo | Lo que imprime el hook |
|---|---|
| 60 líneas de 2 KB | Una sola línea completa y el aviso de recorte; 2241 bytes en total, sin caracteres cortados |
| El `EN-CURSO.local.md` real (27 líneas, 3 KB) | Todo, sin aviso; 3293 bytes en total |
| Sin archivo | La misma línea de siempre: «vacío o inexistente» |

## Qué mirar con atención
- 4000 bytes son unos 1000 tokens. Si `EN-CURSO.local.md` necesita más, hay que archivar lo viejo, no subir el tope.
- Un archivo con una sola línea de más de 4000 bytes se imprime vacío más el aviso: es a propósito, una línea así no es un traspaso.
