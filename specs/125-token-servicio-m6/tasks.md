# Tareas 125 — Token de servicio de M2 ante M6 obtenido de Keycloak

- [x] **T1. Configuración del token de servicio.** RF-2.4.11.1, RF-2.4.11.2, RF-2.4.11.3, RNF-06, RNF-19
  - Hecho cuando: `cargarConfig` lee `M2_URL_TOKENS_SERVICIO`, `M2_CLIENTE_SERVICIO` y `M2_SECRETO_SERVICIO` (las tres o ninguna; URL `http`/`https` sin usuario ni contraseña), una combinación incompleta da un error por cada variable que falta sin mostrar el secreto, `secretosDeConfig` tacha el secreto, `ejemplo.env` las trae vacías, y `config.test.ts`, `secretos.test.ts` y `ejemplo-env.test.ts` están en verde.

- [x] **T2. Token de servicio HS256 y paso por `m6.ts`.** RF-2.4.11.2, RF-2.4.11.9
  - Hecho cuando: `src/auth/token-servicio.ts` tiene la forma `obtener`/`descartar`/`modo` con la implementación HS256, `crearM6` la recibe desde `src/app.ts` en lugar de llamar a `tokenDeServicio`, el cliente de módulos acepta una credencial por llamada, y todas las pruebas existentes del historial y la calificación siguen en verde sin cambios.

- [ ] **T3. Pedido de token a Keycloak.** RF-2.4.11.1, RF-2.4.11.6, RF-2.4.11.7, RF-2.4.11.10, RNF-13
  - Hecho cuando: las pruebas unitarias con `servidor-modulo.ts` como endpoint de tokens muestran que el pedido va en formulario con `grant_type=client_credentials` y `Basic`; que un `5xx`, un corte o un `200` sin `access_token`, sin `expires_in` entero positivo o que no es JSON se reintenta una vez y termina en `ModuloNoDisponible('Keycloak')` con `Retry-After`; y que un `400` o `401` da `ErrorDeIntegracion` sin reintento.

- [ ] **T4. Caché y pedido compartido.** RF-2.4.11.4, RF-2.4.11.5
  - Hecho cuando: con reloj falso, las pruebas unitarias muestran que se reutiliza un token con 30 s o más de vida y se pide otro con menos, que un `expires_in` de 10 s se usa y no se guarda, que diez `obtener` simultáneos hacen un solo pedido y reciben el mismo token o el mismo error, que tras una falla el siguiente vuelve a pedir, y que `descartar` no borra un token más nuevo.

- [ ] **T5. Línea de log del pedido y línea de arranque.** RNF-14.14, RNF-14.15, RNF-19
  - Hecho cuando: cada pedido a Keycloak deja una línea con `idCorrelacion`, `modulo: 'Keycloak'`, `metodo`, `estado`, `intentos` y `duracionMs`, un token reutilizado no deja línea, ninguna línea tiene el token, el secreto ni la URL, y `arranque.test.ts` comprueba la línea `tokenServicioM6` con `keycloak` y con `hs256`.

- [ ] **T6. Renovación ante un `401` de M6.** RF-2.4.11.8, RF-2.4.11.9
  - Hecho cuando: `historial-http.test.ts` y `calificaciones-http.test.ts`, con el M6 de prueba y un endpoint de tokens falso, muestran que un `401` con token reutilizado descarta, pide otro y repite una vez; que un segundo `401` da `500`; que un `401` con token recién pedido da `500` sin repetir; y que con Keycloak caído la respuesta es `503` genérico con `Retry-After` y M6 no recibe pedidos.

- [ ] **T7. M6 simulado valida RS256 de Keycloak.** RNF-07, RNF-12
  - Hecho cuando: con `M6_EMISOR_KEYCLOAK` y `M6_URL_JWKS_KEYCLOAK` (las dos o ninguna), `m6-simulado.test.ts` con `pruebas/ayudas/jwks.ts` muestra que un RS256 del emisor correcto con `clientes-be` o `SERVICIO` en `roles` da `200`; que otro emisor, otra clave, sin rol o vencido da `401`; y que sin esas variables un RS256 da `401` y el HS256 sigue andando.

- [ ] **T8. Entornos con Keycloak.** RF-2.4.11.1, RNF-06, RNF-20
  - Hecho cuando: `m6` está en los perfiles `panel` y `keycloak`, `ejemplo-keycloak.env` y `ejemplo-front-keycloak.env` traen las variables de M2 (`grupo-17`) y del simulado (emisor `localhost`, JWKS `keycloak:8080`), `realm.test.ts` comprueba que la cuenta de servicio de `grupo-17` emite `clientes-be` en `roles`, y `docker compose --env-file ejemplo-front-keycloak.env -f docker-compose.yml -f docker-compose.front.yml up -d --build --wait` deja el historial de `cliente1` en `200` desde el front.

- [ ] **T9. Prueba con Keycloak real.** RNF-07, RNF-12, RNF-14.14, RNF-14.15
  - Hecho cuando: `pruebas/keycloak/token-servicio.test.ts` (`npm run keycloak:test`) muestra que el historial y la calificación de un cliente con viajes precargados responden `200` con el token de `grupo-17`, que dos consultas seguidas dejan una sola línea `modulo: 'Keycloak'` en el log de M2, que la línea de arranque dice `keycloak`, y que con Keycloak detenido el historial da `503` con `Retry-After`; el job `keycloak` de CI está en verde.

- [ ] **T10. Documentación y guía.** RNF-20
  - Hecho cuando: `docs/probar-m2.md` explica las tres variables, cómo levantar M2 con Keycloak para llamar a M6 y cómo comprobar con el log que M6 acepta el token; el `README.md` suma las variables; el ADR 125 pasa a «aceptada»; y `guia.md` tiene la visión general y una entrada por tarea.

- [ ] **T11. Prueba distribuida con el M6 real que exige RS256.** RNF-07.15
  - Hecho cuando: con el commit del Grupo 12 que exige RS256 ya mergeado en su rama de trabajo (si no lo está, la tarea espera), `M6_REAL_COMMIT` apunta a ese commit, `m6-real` recibe `AUTH_ISSUER` y `AUTH_JWKS_URI` de nuestro Keycloak, el proyecto `m2-distribuida` levanta Keycloak, `token-servicio.test.ts` pide el token por `client_credentials` y comprueba que `GET /trips` y `GET /trips/{tripId}` no dan `401` ni `403`, `workflow-integracion-m6.test.ts` está en verde y el workflow «Integración con M6 real» pasa.
