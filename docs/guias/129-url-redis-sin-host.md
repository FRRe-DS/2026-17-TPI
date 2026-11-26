# 129 · Validar M2_URL_REDIS sin host

Issue: #129 · rama `fix/129-url-redis-sin-host`

## Qué cambió

- `src/config.ts` (`urlRedis`): ahora exige que la URL de Redis tenga `hostname`.
- `pruebas/unitarias/config.test.ts`: agrega `redis:///` a los casos inválidos y verifica el motivo reportado.
- El motivo indica que la URL debe ser válida y tener host; no incluye el valor recibido.

## Por qué

`URL.canParse('redis:///')` acepta esa forma aunque su `hostname` quede vacío.
Sin esta comprobación, la configuración permitía arrancar con una dirección sin servidor.
La validación temprana informa el problema en `M2_URL_REDIS`.

## Cómo se conecta

`cargarConfig` valida el entorno antes de construir Redis. `urlRedis` conserva
`redis://`, `rediss://`, las rutas de base válidas y las credenciales codificadas.

## Verificación

- `npx vitest run --project unitarias pruebas/unitarias/config.test.ts`: 178 pruebas pasan.
- `npx vitest run --project unitarias`: 5054 pruebas pasan; build y `spec-check` pasan.
- `npm test` no pudo iniciar PostgreSQL porque no hay runtime de contenedores disponible.

## Mirar con atención

`URL.hostname` admite IPv4, IPv6 y nombres de servicio, no solo nombres DNS.
