# Tareas 007 — Historial resumido de viajes

Depende de: las specs #3 (cliente de módulos) y #4 (perfiles) en `main`. T2, T4 y T5 son delicadas (error compartido, llamada a otro módulo y orden de las comprobaciones): se implementan con Opus. Las pruebas usan un M6 simulado que cumple `contrato/dependencias/m6.yml`; el M6 real solo se necesita al final (ver Dudas de la spec). T8 a T10 vienen del cambio del #58 (token de servicio, ADR 009): se hacen antes de T7, que valida todo; T10 es delicada (credencial en el cliente compartido) y va con Opus.

- [x] **T1. Agregar la configuración de M6.** RNF-06
  - Hecho cuando: `M2_URL_M6` es obligatoria (sin ella el servicio no arranca y nombra la variable, sin su valor), `M2_CREDENCIAL_M6` es opcional y `M2_REINTENTAR_DESPUES_S` vale 5 por defecto y acepta enteros desde 1; pruebas de configuración y arranque lo comprueban, y `ejemplo.env`, `docker-compose.yml` y la tabla de variables del README las incluyen con valores de desarrollo.
- [x] **T2. Completar el cliente de módulos: credencial y `Retry-After`.** RF-2.4.6, RNF-06, RNF-13, RNF-19
  - Hecho cuando: pruebas de módulos comprueban que `Authorization: Bearer` se envía solo si hay credencial, que `ModuloNoDisponible` puede llevar `Retry-After` y que sin él las respuestas `503` existentes no cambian, y que la credencial no aparece en `detail`, en la causa ni en el log.
- [x] **T3. Convertir la respuesta de M6 al esquema del contrato.** RF-2.4.1, RF-2.4.2, RF-2.4.9
  - Hecho cuando: pruebas unitarias cubren viaje con y sin `driverId`, estado sin traducir, `page + 1` hacia M6, `totalPaginas` por redondeo hacia arriba, página vacía y descarte de viajes de otro cliente.
- [x] **T4. Leer la respuesta de M6 y sus fallas.** RF-2.4, RF-2.4.6, RF-2.4.7, RF-2.4.10, RNF-13, RNF-14
  - Hecho cuando: pruebas con un servidor HTTP simulado cubren `200`, página vacía, `5xx`, cuerpo que no es JSON, demora mayor al tiempo (un reintento y `503`), `4xx` incluido `404` (sin reintento, error de integración), total inválido e `items` de más; el pedido lleva `clientId`, `page`, `pageSize` y el identificador de correlación.
- [x] **T5. Armar el servicio del historial.** RF-2.4.3, RF-2.4.4, RF-2.4.5, RNF-05
  - Hecho cuando: pruebas de integración con PostgreSQL real y M6 simulado comprueban el orden propiedad, perfil y M6 (`403` y `404` no llaman a M6), CLIENTE propio y ajeno, CLIENTE+OPERADOR y cliente sin viajes.
- [x] **T6. Exponer y registrar `listarHistorialViajes`.** RF-2.4, RF-2.4.5, RF-2.4.6, RF-2.4.7, RF-2.4.8, RNF-03, RNF-14, RNF-19
  - Hecho cuando: pruebas HTTP cubren `200`, `400`, `401`, `403`, `404`, `500` y `503` con `Retry-After` en problem+json, el `503` de la base sin `Retry-After`, y comprueban que los logs no contienen el token, la credencial, identificadores de viajes ni de conductores; las listas de operaciones de `arranque.test.ts`, `salud.test.ts` y `contrato-test.test.ts` incluyen la operación y el manejador sigue el orden del contrato.
- [ ] **T7. Validar contrato, regresión y documentación.** RNF-03, RNF-07, RNF-20
  - Hecho cuando: `listarHistorialViajes` pasa `npm run contrato:test` (el `503` de M6 aceptado en `schemathesis.toml` y en su prueba guardiana), `npm test`, lint, build y `spec-check` quedan en verde, y `guia.md` documenta el mapa, los supuestos con M6, ejemplos con un M6 simulado comprobados y la visión general.
- [x] **T8. Cambiar la credencial fija por la audiencia de M6 en la configuración.** RNF-06, RF-2.4.11, RNF-19
  - Hecho cuando: `M2_CREDENCIAL_M6` ya no existe en la configuración, `ejemplo.env`, `docker-compose.yml` ni el README, ni en `secretosDeConfig`; `M2_AUDIENCIA_M6` es opcional, vale `m6-viajes` por defecto y rechaza un valor vacío; las pruebas de configuración, del ejemplo, de secretos y de arranque lo comprueban.
- [x] **T9. Firmar el token de servicio.** RF-2.4.11
  - Hecho cuando: pruebas unitarias comprueban que `tokenDeServicio` da un JWT HS256 que verifica con la clave del consorcio, con `iss` del emisor configurado, `sub` `m2-clientes`, `roles` `["SERVICIO"]` (también con otro `M2_CAMPO_ROLES`), `aud` igual a `M2_AUDIENCIA_M6` y `exp` 60 segundos después de `iat`.
- [x] **T10. Enviar el token de servicio en cada intento a M6.** RF-2.4.11, RNF-13, RNF-19
  - Hecho cuando: la opción `credencial` del cliente de módulos es una función que se llama en cada intento; pruebas de módulos comprueban que sin ella no hay `Authorization`, que cada intento (también el reintento) lleva un token propio, que el M6 simulado recibe un token de servicio que verifica con la clave y la audiencia de M6, y que el token no aparece en `detail`, en la causa ni en el log.
