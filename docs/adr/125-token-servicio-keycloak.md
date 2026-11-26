# ADR 125 — Token de servicio de M2 obtenido de Keycloak

Fecha: 2026-11-25 · Estado: propuesta
Issue: #125

## Contexto
M2 llama a M6 para el historial (spec 007) y para verificar el viaje al calificar (spec 008). Hasta ahora se presenta con un token que firma él mismo con HS256 y la clave compartida del consorcio (ADR 009, RF-2.4.11). El ADR 080 ya reemplazó al 009 para los tokens que M2 recibe: Keycloak hace de M1 y M2 los valida con su JWKS.

El Grupo 12 avisó en FRRe-DS/2026-12-TPI#9 (2026-11-25) que su M6 va a aceptar solo tokens RS256 de Keycloak, validados con el JWKS del emisor. No hay una instancia de Keycloak compartida por el consorcio: cada una genera sus claves, así que un token de una no vale en otra. El Grupo 12 propuso que, para nuestras pruebas, su M6 valide contra nuestro Keycloak (`AUTH_ISSUER`, `AUTH_JWKS_URI`).

## Decisión
- Con `M2_URL_TOKENS_SERVICIO`, `M2_CLIENTE_SERVICIO` y `M2_SECRETO_SERVICIO`, M2 pide su token a Keycloak con `client_credentials` y el cliente `grupo-17` del realm `ds-2026-realm`. Sin ellas, sigue firmando el token HS256 del ADR 009, solo para desarrollo y pruebas.
- El token se guarda en la memoria del proceso y se reutiliza hasta que le quedan 30 s; un solo pedido a Keycloak sirve a todos los que esperan.
- Si M6 responde `401` a un token reutilizado, M2 pide otro y repite una vez.
- Keycloak sin responder da `503` genérico con `Retry-After`; Keycloak rechazando las credenciales, `500`.
- M6 identifica a M2 como `grupo-17` (`azp`) y lo autoriza por el rol `clientes-be` que ya trae la cuenta de servicio.

## Alternativas descartadas
- **Seguir firmando HS256 hacia M6:** el M6 real lo va a rechazar con `401`.
- **Solo Keycloak, sin HS256:** obliga a levantar Keycloak en cada prueba que toque M6 y en el perfil `panel`.
- **Pedir un token nuevo en cada llamada:** suma una ida y vuelta a Keycloak en cada historial y calificación.
- **Guardar el token en Redis para compartirlo entre réplicas:** expone un secreto en un almacén compartido para ahorrar un pedido por réplica.
- **Pedir el rol `SERVICIO` en el realm:** M6 ya acepta `clientes-be`.

## Consecuencias
- El historial y la calificación pasan a depender también de Keycloak cuando está configurado: si no responde y no hay token guardado, dan `503`.
- El secreto de `grupo-17` es una configuración sensible más (RNF-06, RNF-19). El de desarrollo ya está en el realm de la cátedra que trae el repo.
- Las pruebas con Keycloak levantan también el M6 simulado, que valida RS256 con el JWKS de Keycloak.
- La prueba distribuida levanta Keycloak junto al M6 real y depende de que el Grupo 12 mantenga configurables `AUTH_ISSUER` y `AUTH_JWKS_URI`.
