# Spec 072 — Front de M2: vista de demostración e integridad de datos

Estado: aprobada
Issue: #72
Etapa: TP1
Responsable: @sandobaitt

## Contexto y objetivo
La spec 071 dejó el panel: una app web para usar M2 desde el navegador, con sus doce pantallas, la firma de tokens de desarrollo, el detalle técnico y un M6 simulado. Esta spec le suma una vista, «Demostración», pensada para quien evalúa el módulo y para el grupo. La primera entrega de la cátedra se centra en la integridad de los datos y el manejo del cliente, y hoy eso solo se comprueba con las pruebas automáticas o corriendo `scripts/demo.mjs`, que imprime texto. La vista muestra lo mismo, caso por caso y en vivo: cada respuesta de M2 contra lo que dice el contrato, qué pasa cuando muchas altas llegan a la vez, que la base rechaza un puntaje inválido aunque la API no lo dejara llegar, y qué hace M2 con la base apagada.

La spec no agrega requisitos funcionales al módulo: M2 no cambia. Todo lo que pide es del panel, y cada requisito conserva el ID de la cátedra al que sirve (RNF-05, RNF-07, RNF-08, RNF-13).

Regla del grupo (2026-10-27): lo que tiene funcionalidad pero todavía no existe se construye igual en el panel contra una fuente simulada, y a futuro solo se conecta. Acá se aplica al M6 de los casos de historial, calificación y resiliencia, que usan el M6 simulado de la 071.

En esta spec «el sistema» es el panel y «M2» es el servicio. El panel sigue sin cambiar `src/`, `contrato/` ni `migraciones/`. Lo nuevo respecto de la 071 es que el servidor del panel, además de hablar con M2 por su API, puede (1) consultar la base de M2 con una lista fija de acciones y (2) apagar y encender la base con Docker cuando corre en la máquina de quien prueba.

## Usuarios
- Evaluador o integrante del grupo: abre la vista, ejecuta casos, lanza las pruebas de integridad y apaga la base para ver cómo responde M2.
- Cliente de prueba y operador: no usan esta vista; siguen con las pantallas de la 071.

## Historias de usuario
- HU-1. Como evaluador, quiero ejecutar cada caso de `docs/probar-m2.md` con un botón y ver si M2 respondió lo que dice el contrato, para comprobar el módulo sin armar pedidos a mano.
- HU-2. Como evaluador, quiero ver qué pasa cuando llegan muchas altas a la vez con la misma clave o con claves distintas, para comprobar que M2 no duplica datos (RNF-08).
- HU-3. Como evaluador, quiero ver que la base rechaza un puntaje inválido por su propia restricción, para comprobar que la integridad no depende solo del código del servicio (RNF-05).
- HU-4. Como evaluador, quiero apagar y encender la base mirando la salud de M2 en vivo, para ver cómo se degrada y cómo se recupera (RNF-13).
- HU-5. Como evaluador, quiero que cada caso muestre el pedido, la respuesta y el código esperado, para entender por qué es ✔ o ✘.

## Requisitos funcionales
(Ninguno: el módulo no cambia. Los requisitos de esta spec son del panel y van como no funcionales.)

## Requisitos no funcionales
- RNF-07.3: CUANDO la persona abre la vista «Demostración», EL SISTEMA lista los casos agrupados en las áreas de `docs/probar-m2.md` (perfil, direcciones, preferencias, historial, calificación, estado de cuenta, seguridad y errores, resiliencia), cada uno con un botón «Ejecutar», y ofrece «Ejecutar todo».
- RNF-07.4: CUANDO se ejecuta un caso, EL SISTEMA muestra el pedido (método, ruta y cuerpo), la respuesta (código, `type` y los encabezados relevantes), el código esperado según el contrato, y ✔ o ✘ según coincidan.
- RNF-07.6: CUANDO la persona pulsa «Ejecutar todo», EL SISTEMA ejecuta los casos uno tras otro, muestra el avance, y al terminar informa cuántos dieron ✔ y cuántos ✘ sin detenerse en el primer ✘; «Ejecutar todo» no apaga la base.
- RNF-08.2: CUANDO la persona lanza N altas simultáneas (N de 2 a 50, por defecto 10) con la misma `Idempotency-Key` y el mismo cuerpo, EL SISTEMA muestra la cantidad de respuestas por código (se espera N×`201` con el mismo cuerpo) y la cantidad de filas de `clientes` creadas para ese cliente (se espera 1).
- RNF-08.3: CUANDO la persona lanza N altas simultáneas con N claves distintas para el mismo cliente, EL SISTEMA muestra la cantidad de respuestas por código (se espera 1×`201` y N−1×`409`) y la cantidad de filas de `clientes` creadas para ese cliente (se espera 1).
- RNF-08.4: CUANDO la persona lanza N calificaciones simultáneas del mismo viaje completado con N claves distintas, EL SISTEMA muestra la cantidad de respuestas por código (se espera 1×`201` y N−1×`409`) y la cantidad de filas de `calificaciones` de ese cliente (se espera 1).
- RNF-05.4: EL SISTEMA ejecuta contra la base de M2 solo una lista fija de acciones, sin texto libre de quien usa el panel: contar las filas de `clientes` y de `calificaciones` de un cliente, y la prueba de RNF-05.5.
- RNF-05.5: CUANDO la persona pulsa «Probar la restricción del puntaje», EL SISTEMA intenta insertar una calificación con puntaje 9 dentro de una transacción que termina siempre deshaciéndose, muestra el mensaje de PostgreSQL con el nombre de la restricción violada (`calificaciones_puntaje_valido`) y muestra que la cantidad de filas de `calificaciones` no cambió.
- RNF-13.4: CUANDO la persona pulsa «Apagar la base», EL SISTEMA ejecuta `docker compose stop bd`, consulta la salud de M2 cada 2 segundos y muestra el estado (se espera `503`); CUANDO pulsa «Encender la base», ejecuta `docker compose start bd` y espera hasta 60 segundos a que la salud de M2 vuelva a `200`, o informa que no volvió.
- RNF-13.6: SI Docker no está disponible para el panel (siempre cuando corre en el contenedor; en la máquina, si falta Docker o el permiso), ENTONCES EL SISTEMA muestra en «Apagar la base» y en «Encender la base» un mensaje que explica el motivo y cómo activarlas (levantar el panel en la máquina), y deshabilita solo esas dos acciones; el resto de la vista sigue funcionando.
- RNF-12.10: EL SISTEMA aplica a las acciones de esta vista (consultas a la base, prueba de la restricción, apagar y encender la base) el rechazo de `Host` y `Origin` ajenos de RNF-12.8, y ofrece solo la lista fija de comandos de Docker y de acciones de base, sin comandos ni SQL libres.
- RNF-06.5: EL SISTEMA se configura por variables de entorno para la dirección de la base de M2 que usa el panel y para el nombre del servicio de Docker a apagar y encender, con valores por defecto de `ejemplo.env` adecuados a cada forma de levantarlo, y no guarda secretos en el repositorio.
- RNF-04.8: CUANDO se levanta `docker compose --profile panel up -d --build --wait`, EL SISTEMA deja la base de M2 alcanzable por el panel también cuando este corre en la máquina, publicada solo en `127.0.0.1`; SI se levanta sin el perfil `panel`, ENTONCES EL SISTEMA no publica ningún puerto de la base ni cambia el arranque de M2.
- RNF-19.4: EL SISTEMA no entrega al navegador ni escribe en sus logs ni en la pantalla la dirección completa de la base ni su contraseña, y muestra el `Authorization` de los pedidos de los casos enmascarado como en la 071.
- RNF-15.6: EL SISTEMA muestra en la vista los estados de espera, éxito, rechazo y error de cada caso y de cada acción, deshabilita el botón que lanzó una ejecución mientras espera (un doble toque la lanza una sola vez), usa controles táctiles de al menos 44×44 píxeles y se puede usar sin desplazamiento horizontal de 360 a 1440 píxeles.
- RNF-20.3: EL SISTEMA documenta en el README, en `docs/probar-m2.md` y en la guía de esta spec qué hace la vista, cómo se activan las acciones de Docker y qué comprueba cada prueba de integridad.

## Contrato y dependencias
- Operaciones del contrato que consume (las mismas de la 071, sin cambiarlas): `verificarSalud`, `crearCliente`, `obtenerCliente`, `actualizarCliente`, `crearDireccion`, `listarDirecciones`, `obtenerDireccion`, `actualizarDireccion`, `eliminarDireccion`, `obtenerPreferencias`, `guardarPreferencias`, `listarHistorialViajes`, `calificarConductor`, `listarCalificaciones`, `obtenerCalificacion`, `obtenerEstadoCuenta`, `crearBloqueo`, `levantarBloqueo`. El panel no agrega rutas a M2.
- Base de M2: consultas de solo lectura sobre `clientes` y `calificaciones`, y un intento de inserción que siempre se deshace. La base sigue siendo de M2; el panel la usa como herramienta de prueba, no guarda datos propios en ella.
- Docker: `docker compose stop bd` y `docker compose start bd` desde el servidor del panel, solo cuando corre en la máquina.
- Operaciones de otros módulos: el panel no llama a M1 ni a M6. Los casos que dependen de M6 usan el M6 simulado de la 071 por su canal de control. Si el M6 simulado no está, esos casos dan ✘ con el `503` de M2 a la vista, no un error del panel.
- Depende de la spec 071 (implementada, PR #74): servidor del panel, firma de tokens, M6 simulado, pantalla de detalle técnico y prueba en navegador.

## Casos límite
- Se abre la vista con la base ya apagada: los casos que la usan dan ✘ con el `503` de M2; «Encender la base» la vuelve a levantar.
- «Apagar la base» cuando ya está apagada, o «Encender la base» cuando ya está encendida: no es un error; se informa el estado actual de la salud.
- Docker no está disponible o no hay permiso (RNF-13.6): se deshabilitan solo esas dos acciones, con el motivo y cómo activarlas.
- El panel corre en el contenedor: las consultas de filas y la prueba de la restricción funcionan, porque la base es alcanzable por la red de compose; «Apagar» y «Encender» quedan deshabilitadas.
- La base no responde cuando el panel la consulta (por ejemplo, apagada): la cuenta de filas muestra «base no disponible» y no rompe la vista.
- N fuera de 2 a 50 o que no es un entero: el panel lo rechaza antes de lanzar nada y marca el campo con su motivo.
- Altas o calificaciones simultáneas: usan un cliente creado para esa corrida (UUID nuevo), no el de la sesión, de modo que repetir la prueba no choca con datos anteriores.
- Una calificación simultánea con el M6 simulado en modo caído o lento: las respuestas son `503` con `Retry-After` y no se cuenta como fallo de integridad; la prueba pone el modo en `normal` antes de empezar y lo deja como estaba al terminar.
- Un caso o prueba falla a mitad (M2 cae, se corta la red): ese caso da ✘ con el error, los demás de «Ejecutar todo» siguen.
- La transacción de RNF-05.5 queda abierta si el panel se cae a mitad: no queda ninguna fila, porque nunca se confirma.
- Dos pestañas apagando o encendiendo a la vez: se ejecuta el comando una vez por pulsación y ambas ven el mismo estado de salud.
- Pedidos que llegan desde otra página web a las acciones de la vista: RNF-12.10.

## Fuera de alcance
- Revertir y reaplicar migraciones desde el panel (decisión de @sandobaitt del 2026-10-27: modifica el esquema y pide aprobación).
- Borrar datos o vaciar tablas desde el panel; `docker compose down -v` sigue siendo manual.
- Dar al contenedor del panel el socket de Docker: equivale a control total de la máquina.
- Ejecutar SQL libre, o consultas sobre tablas distintas de `clientes` y `calificaciones`.
- Pruebas de carga o de rendimiento (RNF-16) y pruebas con más de 50 solicitudes simultáneas.
- Conectar el M1 y el M6 reales: sigue siendo del panel de la 071.
- Cambios en `src/`, `contrato/` o `migraciones/`.

## Criterios de finalización
- Cada caso de las ocho áreas se ejecuta desde la vista, solo o con «Ejecutar todo», y da ✔ contra M2 y el M6 simulado levantados, y «Ejecutar todo» informa el resumen.
- Las tres pruebas de integridad muestran lo esperado: altas con la misma clave (N×`201`, 1 fila), con claves distintas (1×`201`, N−1×`409`, 1 fila), calificaciones del mismo viaje (1×`201`, N−1×`409`, 1 fila), y la restricción `calificaciones_puntaje_valido` con la cantidad de filas sin cambios.
- «Apagar la base» da `503` en la salud de M2 y «Encender la base» la devuelve a `200` en la máquina; en el contenedor esas dos acciones están deshabilitadas con su explicación y el resto funciona.
- `git diff --stat origin/main` no muestra cambios en `src/`, `contrato/` ni `migraciones/`.
- `docker compose up -d --build --wait` sigue funcionando sin cambios para quien no usa el perfil `panel`, y no publica ningún puerto nuevo.
- `npm test`, `npm run lint`, `npm run build`, `npm run contrato:test`, `npm run panel:navegador` y `node scripts/spec-check.mjs` terminan en verde.
- El README, `docs/probar-m2.md` y la guía explican cómo usar la vista y cómo activar las acciones de Docker.

## Decisiones
- La vista usa una conexión directa del servidor del panel a la base de M2, con una lista fija de acciones, por decisión de @sandobaitt del 2026-10-28. Alternativa descartada: ejecutar `psql` con `docker compose exec`, que no abre ningún puerto pero hace que esas acciones dejen de funcionar cuando el panel corre en el contenedor, y obliga a mantener dos caminos para lo mismo.
- Esto amplía lo que decía la spec 071 («el panel habla con M2 solo por su API HTTP»): sigue siendo cierto para las pantallas del cliente, y la conexión a la base es solo de la vista «Demostración» y de lista fija. La spec 071 no cambia.
- «Apagar la base» y «Encender la base» solo andan con el panel en la máquina, y la lista de comandos es fija (`stop bd` y `start bd`). Alternativa descartada: dar el socket de Docker al contenedor del panel (decisión de la 071, que se mantiene).
- «Ejecutar todo» no apaga la base: es una acción destructiva para quien esté usando M2 y requiere Docker, que no siempre está disponible. Se pulsa por separado.
- Las pruebas de integridad cuentan las filas del cliente de esa corrida y no el total de la tabla, para que el resultado no dependa de los datos que ya hubiera en la base.
- Los ID siguen la numeración que la spec 071 dejó reservada para este issue (RNF-05.4, 05.5, 07.3, 07.4, 08.2 a 08.4, 13.4 y 13.6); los demás (RNF-04.8, 06.5, 07.6, 12.10, 15.6, 19.4, 20.3) son derivados de los RNF que precisan, en el orden siguiente al último de cada uno.
- Pueden abrir la vista todos los roles con sesión en el panel (aclarado el 2026-10-28, por delegación de @sandobaitt): la vista firma sus propios tokens de cliente, operador y servicio para cada caso y no usa el de la sesión, así que sirve igual a quien evalúa que a quien entró como cliente. Alternativa descartada: limitarla a un rol, que obligaría a cambiar de sesión para usarla.
- Cada corrida crea datos nuevos (un cliente de prueba con UUID nuevo por área, como `scripts/demo.mjs`) y no reutiliza al cliente de la sesión (aclarado el 2026-10-28, por delegación de @sandobaitt): se puede repetir sin limpiar la base ni chocar con datos previos. Cada caso prepara lo que necesita (su cliente y, si hace falta, sus viajes en el M6 simulado), de modo que se puede ejecutar solo y no depende del orden. Alternativa descartada: reutilizar al cliente de la sesión, que mezcla la demostración con datos de uso real y rompe la segunda corrida.
- La base se publica en `127.0.0.1` con un servicio propio del perfil `panel` que reenvía a `bd:5432` (aclarado el 2026-10-28, por delegación de @sandobaitt): evita cambiar el servicio `bd`, que usa quien no levanta el panel (RNF-04.8). El plan fija el servicio y el puerto. Alternativa descartada: publicar el puerto en `bd`, que cambia el arranque de M2 para todos.
- El panel usa el mismo usuario de la base que M2, sin crear otro (aclarado el 2026-10-28, por delegación de @sandobaitt): un usuario nuevo exige una migración, que esta spec no toca. La defensa es la lista fija de acciones (RNF-05.4) y que la inserción de RNF-05.5 nunca se confirma.
- Etapa TP1: el issue #72 lo pide y la cátedra lo marca como foco de la primera entrega (integridad de datos y manejo de cliente).
- El diseño visual de la vista sigue el estilo «Verde ciudad» de la 071; las decisiones de estilo van en el plan.

## Dudas abiertas
Ninguna.
