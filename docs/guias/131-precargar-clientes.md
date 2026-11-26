# 131 · Clientes de prueba precargados, con uno bloqueado

Issue #131 · rama `fix/131-precargar-clientes`

## Qué pasaba
El Grupo 9 (Reservas) consulta `GET /api/v1/clientes/{clienteId}/estado-cuenta` y pidió clientes de prueba con usuario de Keycloak, uno de ellos BLOQUEADO. El realm de desarrollo traía solo `cliente1` y `cliente2`, y la base arranca vacía: el único que creaba perfiles y bloqueos era `scripts/demo.mjs`, con un cliente nuevo en cada corrida y sin usuario de Keycloak.

## Qué cambió
- `keycloak/ds-2026-realm-realm.json`: suma `cliente3` (`c1e00000-0000-4000-8000-000000000003`) y `cliente4` (`…004`), rol `CLIENTE`, con los mismos campos que `cliente2` y contraseña `<usuario>-contrasena-de-desarrollo`.
- `pruebas/ayudas/realm.ts`: los dos en `USUARIOS_DE_EJEMPLO`, así `pruebas/unitarias/realm.test.ts` comprueba que el JSON los trae listos para entrar (habilitados, correo verificado, rol único, contraseña no temporal).
- `scripts/precargar-clientes.mjs` (nuevo): con M2 y Keycloak levantados con `ejemplo-keycloak.env`, crea por la API el perfil de `cliente2`, `cliente3` y `cliente4`, bloquea a `cliente4` con `operador1` y muestra el estado de cuenta de cada uno pedido con la cuenta de servicio `grupo-09`.
- `docs/probar-m2.md`, sección 9: los seis usuarios del realm y la subsección «Clientes precargados para otros grupos».

Nada cambia en `src/`, `contrato/` ni `migraciones/`.

## Por qué así
- **Por la API y no con SQL:** pasa por las mismas validaciones, idempotencia y caché que usa cualquier módulo, y no depende del esquema de la base.
- **Se puede repetir:** un `409` al crear el perfil se toma como «ya existía», y antes de bloquear se mira si hay un bloqueo vigente (`?vigente=true`). Correrlo dos veces deja un solo bloqueo.
- **`cliente1` queda sin perfil:** el recorrido manual de la sección 9 empieza con `cliente1` creando el suyo (`201`).
- **Solo en modo `jwks`:** los otros grupos van a entrar con tokens de Keycloak. Si M2 está en `hs256`, el script corta con un `401` y avisa cómo levantarlo.

## Cómo se verifica
En un proyecto de compose aparte (`COMPOSE_PROJECT_NAME=m2-precarga`, `--env-file ejemplo-keycloak.env`):

| Situación | Resultado |
|---|---|
| Primera corrida | tres perfiles creados, `cliente4` bloqueado; estado `ACTIVO`, `ACTIVO`, `BLOQUEADO` |
| Segunda corrida | «ya existía» en los tres y «ya tenía un bloqueo vigente»; mismo estado |
| En la base después de las dos | 3 filas en `clientes` (sin `cliente1`) y 1 en `bloqueos_cliente` |
| Keycloak o M2 en un puerto cerrado | corta con código 1 y «… no responde en … (ECONNREFUSED)» |

`npx vitest run --project unitarias pruebas/unitarias/realm.test.ts` primero en rojo (4 fallas, sin los usuarios en el JSON) y después en verde. `npm test`, `npm run lint`, `npm run build` y `node scripts/spec-check.mjs` en verde. El script no corre en CI.

## Qué mirar con atención
- Un Keycloak ya creado no ve los usuarios nuevos: el realm se importa una sola vez. Hace falta `down -v`, que también borra los datos de M2. El script lo dice si Keycloak rechaza a `cliente3` o `cliente4`.
- El aviso para M2 en modo `hs256` (`401`) no se probó levantando ese modo; sale del mismo camino de error que los demás.
