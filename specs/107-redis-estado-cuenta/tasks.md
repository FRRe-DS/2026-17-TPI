# Tareas 107 — Caché del estado de cuenta con Redis

- [ ] **T1. Configuración de la caché.** RNF-06
  - Hecho cuando: `cargarConfig` lee `M2_URL_REDIS` (opcional, `redis://` o `rediss://`), `M2_CACHE_TTL_S` (entero de 1 a 3600, 60 por defecto) y `M2_TIEMPO_REDIS_MS` (200 por defecto); un valor inválido se informa por nombre sin mostrarlo, y la prueba de configuración está en verde.

- [ ] **T2. Redis en el compose.** RNF-06, RNF-11
  - Hecho cuando: `docker compose up -d --build --wait` levanta `redis` con imagen de versión fija y healthcheck, `m2` espera a que esté sano, `ejemplo.env` trae `M2_URL_REDIS`, y la prueba que compara `ejemplo.env` con la configuración sigue en verde.

- [ ] **T3. Cliente Redis y módulo de caché vacío.** RNF-13
  - Hecho cuando: con la dependencia `redis` agregada (aprobada por el integrador), `src/cache/redis.ts` se conecta con tiempo máximo por operación, falla de inmediato si no está conectado, se cierra en `detener`, y sin `M2_URL_REDIS` la caché es un no-op; las pruebas unitarias lo comprueban con un servidor que no contesta.

- [ ] **T4. Leer y guardar con TTL y versión.** RF-2.6.5, RF-2.6.5.1, RF-2.6.7, RNF-11, RNF-19
  - Hecho cuando: las pruebas unitarias con un Redis falso muestran que una segunda lectura sale de la copia, que el TTL es el menor entre el configurado y el primer `hasta`, que no se guarda si ya venció, y que las claves solo contienen el `clienteId`.

- [ ] **T5. `obtenerEstadoCuenta` usa la caché.** RF-2.6.5, RF-2.6.5.2, RF-2.6.5.3, RF-2.6.5.4
  - Hecho cuando: la prueba HTTP muestra que un rol sin permiso recibe `403` aunque exista copia, que un cliente inexistente da `404` sin guardar nada, y que el cuerpo es idéntico con y sin caché.

- [ ] **T6. Invalidar al cambiar un bloqueo.** RF-2.6.6, RF-2.6.6.1, RF-2.6.6.2
  - Hecho cuando: las pruebas muestran que, tras `201` de `crearBloqueo` y `200` de `levantarBloqueo`, la siguiente consulta lee la base; y que un alta rechazada (`422`, `404`, `409`) no cambia la versión.

- [ ] **T7. Redis caído o lento.** RF-2.6.8, RF-2.6.8.1, RNF-13, RNF-14, RNF-19
  - Hecho cuando: con Redis cortado y con un servidor que no contesta, `obtenerEstadoCuenta` responde `200` dentro del tiempo máximo más lo que cuesta la base; una invalidación que falla deja al cliente sin copias hasta que se confirma; `/health` responde `200`; y el log tiene un aviso sin `clienteId` ni valores.

- [ ] **T8. Prueba de integración con Redis y PostgreSQL reales.** RF-2.6.5 a RF-2.6.8.1, RNF-05, RNF-07
  - Hecho cuando: con Testcontainers, vaciar Redis no pierde ningún dato (todo se reconstruye desde la base), dos consultas seguidas hacen una sola lectura de estado en la base, un bloqueo con `hasta` cercano deja de informarse al vencer, y detener y volver a levantar Redis no cambia ninguna respuesta.

- [ ] **T9. Demostración, guía y documentos.** RNF-20
  - Hecho cuando: `scripts/demo.mjs` muestra una consulta fría, una caliente, una invalidada por un bloqueo y otra con Redis detenido; `guia.md` y `docs/probar-m2.md` explican qué se guarda, cuánto dura y cómo comprobarlo; y el README suma la fila de Redis.
