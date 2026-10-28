# ADR 072 — El panel consulta la base de M2 y controla Docker en la máquina

Fecha: 2026-10-28 · Estado: propuesta
Issue: #72

## Contexto
El ADR 071 dejó el panel como una herramienta de desarrollo que habla con M2 solo por su API HTTP. La spec 072 suma una vista de demostración para la primera entrega, que se centra en la integridad de los datos. Para eso hay que mostrar lo que la API no deja ver: cuántas filas quedaron en la base tras altas simultáneas, que la propia base rechaza un puntaje inválido por su restricción, y cómo responde M2 con la base apagada.

## Decisión
- El servidor del panel se conecta a la base de M2 con `pg` (que ya es dependencia), con el mismo usuario que M2 y **una lista fija de acciones**: contar las filas de `clientes` y de `calificaciones` de un cliente, e intentar una inserción con puntaje 9 dentro de una transacción que siempre se deshace. No hay SQL libre ni otras tablas. Lo decidió @sandobaitt el 2026-10-28.
- Cuando el panel corre en el contenedor, llega a la base por la red de compose (`bd:5432`). Cuando corre en la máquina, por un puente TCP propio (servicio `bd-puente`, misma imagen que el panel) que el perfil `panel` publica solo en `127.0.0.1:5433`. El servicio `bd` no cambia.
- Con el panel en la máquina, el servidor puede ejecutar `docker compose stop bd` y `docker compose start bd`, con `execFile`, sin shell y con argumentos fijos. En el contenedor esas dos acciones están deshabilitadas y la vista explica por qué: el contenedor no recibe el socket de Docker (se mantiene la decisión del ADR 071).

## Alternativas descartadas
- `psql` con `docker compose exec bd`: no publica nada, pero en el contenedor esas acciones dejarían de funcionar y habría dos caminos para lo mismo.
- Agregar a M2 rutas de diagnóstico (conteos, prueba de la restricción): cambia el contrato y `src/` para algo que solo sirve a la demostración.
- Publicar el puerto en el servicio `bd`: cambia el arranque de quien no usa el panel.
- Un puente con una imagen de terceros (`socat`): otra imagen que fijar y auditar (RNF-04).
- Un usuario de base propio del panel con permisos mínimos: exige una migración, que la spec 072 no toca. Se puede sumar más adelante con su propia spec.
- Dar al contenedor del panel el socket de Docker: equivale a control total de la máquina.

## Consecuencias
- La base de M2 queda alcanzable desde la máquina en `127.0.0.1:5433` mientras el perfil `panel` está levantado, con la contraseña de desarrollo de `ejemplo.env`. Es un entorno de desarrollo; el riesgo queda acotado a la propia máquina.
- El panel deja de ser «solo cliente de la API» para la vista de demostración; las pantallas del cliente siguen sin tocar la base.
- RNF-05 (datos propios) sigue cumpliéndose: la base es de M2 y el panel es una herramienta de prueba del propio módulo, que no guarda datos en ella.
