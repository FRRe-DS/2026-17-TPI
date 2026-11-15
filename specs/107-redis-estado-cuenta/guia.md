# Guía — Spec 107 Caché del estado de cuenta con Redis

## Visión general

M2 va a guardar en Redis la respuesta de `obtenerEstadoCuenta` de cada cliente, porque otros módulos la consultan seguido y la base la recalcula en cada pedido. Redis es solo una copia: si falta, está caído o contesta tarde, M2 responde desde la base y nada cambia para quien consulta. Esta guía crece con cada tarea; el mapa y el recorrido completos se escriben en la T9.

**Decisiones clave** (el porqué está en `plan.md` y en el ADR 107): la copia lleva una versión por cliente en la clave, en lugar de borrarse; el vencimiento es el menor entre el tiempo configurado y el primer `hasta` de los bloqueos vigentes; solo se guardan respuestas `200`; los permisos se comprueban antes de mirar la caché.

## Tareas

### T1 — Configuración de la caché · commit `107/T1`
- Qué cambió: `src/config.ts` lee tres variables nuevas y las suma a `Config`: `M2_URL_REDIS` → `urlRedis` (opcional; `redis://` o `rediss://` con una dirección válida), `M2_CACHE_TTL_S` → `cacheTtlS` (entero de 1 a 3600, 60 por defecto) y `M2_TIEMPO_REDIS_MS` → `tiempoRedisMs` (de 1 a 2147483647, 200 por defecto). `pruebas/ayudas/app.ts` suma los tres campos a la configuración de prueba.
- Por qué así: sin `M2_URL_REDIS` el servicio funciona sin caché (RNF-06), así que la variable no es obligatoria y, si falta, `urlRedis` queda `undefined`. El tiempo de espera reusa la regla de los otros tiempos (hasta 2³¹ − 1, el tope de los temporizadores de Node). La URL puede llevar la contraseña de Redis (`redis://:clave@host`), así que, como con la de la base, el error nombra la variable y el motivo y nunca repite el valor (RNF-06.2, RNF-19).
- Cómo se conecta: todavía nada lee estos campos. `ejemplo.env` y el compose los reciben en la T2; el cliente de Redis los usa desde la T3.
- Tests: `pruebas/unitarias/config.test.ts` (valores por defecto, valores definidos, bordes de cada regla, `M2_URL_REDIS` vacía que cuenta como no definida, motivo exacto de cada error, y que ningún error repite el valor recibido, ni siquiera con una contraseña en la URL). `npm test` en verde.
- Para mirar con atención: `ejemplo.env` todavía no trae las variables nuevas; `ejemplo-env.test.ts` lista las variables a mano y sigue en verde hasta la T2, que las agrega a las dos puntas.

### T2 — Redis en el compose · commit `107/T2`
- Qué cambió: `docker-compose.yml` suma el servicio `redis` (imagen `redis:8.6.8-alpine`, sin perfil, es decir que se levanta siempre), con `redis-server --save "" --appendonly no`, sin volumen, sin puerto publicado y con un chequeo de salud `redis-cli ping` (cada 2 s, hasta 20 intentos). `m2` ahora espera también a que `redis` esté sano. `ejemplo.env` trae `M2_URL_REDIS` (`redis://redis:6379`), `M2_CACHE_TTL_S` (60) y `M2_TIEMPO_REDIS_MS` (200), cada una con su comentario.
- Por qué así: Redis es solo una copia, así que no persiste nada: un reinicio la vacía y todo se reconstruye desde la base (RNF-05, RF-2.6.8). No se publica ningún puerto porque solo M2 la usa, por la red de compose. No se le pone límite de memoria ni desalojo: si Redis desalojara el contador de versión de un cliente, una copia vieja volvería a ser válida; un Redis lleno solo hace fallar los guardados, y M2 los ignora. La versión de la imagen es exacta, como las demás (RNF-04.1). `m2` espera a Redis para que el primer pedido ya encuentre la caché lista; que Redis caiga después no detiene a `m2` (T7).
- Cómo se conecta: `m2` recibe las tres variables por `ejemplo.env`, pero todavía nada las usa: el cliente de Redis es la T3. Los perfiles `panel`, `m6-real` y `keycloak` no cambian: `redis` está en el compose base y los tres lo comparten.
- Tests: `pruebas/unitarias/consistencia.test.ts` (servicios del compose, `m2` espera a `bd` y `redis`, imagen con versión exacta, sin volumen ni puerto, comando y chequeo de salud, `M2_URL_REDIS` apunta al servicio) y `pruebas/unitarias/ejemplo-env.test.ts` (las variables nuevas con su comentario, sus valores por defecto y que pasan la validación). A mano: `docker compose up -d --build --wait` deja `bd`, `redis` y `m2` sanos, `redis-cli ping` responde `PONG`, el contenedor de `m2` ve las tres variables y `/health` da `200`.
- Para mirar con atención: quien levante M2 sin Docker (`npm run dev`) no tiene Redis; sin `M2_URL_REDIS` el servicio funciona sin caché, que es lo previsto. El `README` y `docs/probar-m2.md` suman Redis en la T9.
