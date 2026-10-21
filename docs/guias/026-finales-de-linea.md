# Guía: Normalización de finales de línea

## El problema

En Windows, Git tiene `core.autocrlf=true` por defecto. Con esa configuración, los archivos se almacenan en el repositorio con `LF` pero se convierten a `CRLF` al hacer checkout. El problema surge cuando alguna herramienta del proyecto lee los archivos con sus finales de línea reales: `scripts/spec-check.mjs` fallaba porque encontraba `\r\n` donde esperaba `\n`, rompiendo las comparaciones de texto y las expresiones regulares.

## La causa raíz

Sin un `.gitattributes` en la raíz, Git aplica la política del sistema operativo. En Windows con `core.autocrlf=true`, los archivos de texto quedan en disco con `CRLF`. Eso afecta a cualquier script Node.js que procese línea por línea o compare strings con saltos de línea incluidos.

## La solución

Se agrega un archivo `.gitattributes` en la raíz del repositorio con el contenido:

```
* text=auto eol=lf
```

Esto le indica a Git que:
- trate todos los archivos como texto (`text=auto`), y
- los normalice siempre a `LF` en disco (`eol=lf`), independientemente del sistema operativo o de la configuración local de `core.autocrlf`.

Luego se ejecuta:

```bash
git add --renormalize .
```

Ese comando rescribe el índice aplicando las nuevas reglas de `.gitattributes` a todos los archivos ya rastreados, convirtiendo los `CRLF` que hubiera en `LF`.

## Archivos afectados

Después de `git add --renormalize .`, `git status` listará los archivos cuyo contenido en el índice cambió (los que tenían `CRLF`). Esos archivos no tienen cambios de contenido: solo cambian los finales de línea. El commit que sigue únicamente los renormaliza; no modifica ninguna lógica.

## Cómo verificar que funciona

```bash
# Ver qué archivos quedaron afectados
git status

# Confirmar que spec-check pasa
node scripts/spec-check.mjs

# Confirmar que los tests siguen verdes
npm test
```

## Referencias

- [gitattributes — Git Documentation](https://git-scm.com/docs/gitattributes)
- ADR relevante: `docs/adr/003-stack.md` (stack y convenciones del proyecto)
