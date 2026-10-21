# 026 · Finales de línea LF

Issue #26 · rama fix/026-finales-de-linea

## Qué cambió
.gitattributes (nuevo, en la raíz): * text=auto eol=lf. Git guarda los archivos de texto con LF y los escribe con LF en el disco, sin importar el sistema ni el core.autocrlf de cada persona. No se tocó ningún otro archivo, ni scripts/spec-check.mjs.

## Por qué
En Windows, con core.autocrlf=true (lo que propone el instalador de Git for Windows), git clone y git checkout escriben los archivos con CRLF. Los scripts leen el disco, no el índice. En scripts/spec-check.mjs, la expresión que reconoce las tareas de tasks.md termina en (.*)$, y el . no abarca el \r: con CRLF no encuentra ninguna tarea y el hook de pre-push rechaza el push con «no hay tareas con formato…» y «RNF-20.1 no está cubierto por ninguna tarea». Con el .gitattributes el disco queda en LF y el script funciona sin cambios.

## Cómo se conecta
- Lo guardado en git ya estaba en LF: git add --renormalize . no cambió ningún archivo. El cambio agrega solo este .gitattributes y esta guía.
- El hook .githooks/pre-push y el job specs de CI corren el mismo spec-check. CI corre en Ubuntu, donde no hay conversión, y por eso nunca vio el problema.
- El .gitattributes solo vale para lo que git escribe de ahora en adelante: un clon que ya existe en Windows sigue con CRLF en el disco hasta que se regeneren sus archivos.

## Cómo se verifica
- Clon nuevo en Windows: git ls-files --eol no muestra w/crlf y node scripts/spec-check.mjs pasa con el script de main sin modificar.
- Clon existente: con git status limpio, git rm --cached -r . -q y después git reset --hard (pisa los cambios sin commitear). Después, git status sigue limpio y no cambia nada tras git checkout ..

## Qué mirar con atención
- Que git add --renormalize . no cambie nada aparte del .gitattributes: si apareciera otro archivo, había CRLF guardado en el repositorio y se revisa antes de commitear.
- Quien tenga el repo clonado en Windows tiene que regenerar sus archivos una vez, después de traerse este cambio con git pull. Si no, el pre-push vuelve a rechazar.
