# ADR 083 — Sesión del frontend en su servidor

Estado: propuesta, pendiente del merge de la spec 083
Issue: #83

## Contexto

M2 ya valida tokens de Keycloak, pero el panel firma tokens de desarrollo y no funciona con M2 en jwks. Su servidor ya intermedia las llamadas y M2 no tiene CORS. RNF-19.3 de la spec 071 evita entregar tokens al navegador. DRAZEN confirmó que los tokens de la nueva app deben permanecer en el servidor.

## Decisión propuesta

El servidor del frontend completa Authorization Code con PKCE S256 usando el cliente público m2-front existente. Valida el ID token y el access token por separado y mantiene tokens en memoria acotada, ligados a una cookie HttpOnly opaca. Solo el access token se reenvía a M2. Se conserva el mismo origen para navegador y API del frontend.

Modo real y modo HS256 de demostración son configuraciones de procesos distintos. El proceso real no registra rutas de suplantación, Docker, base o control del simulador. Las herramientas de desarrollo se ejecutan contra su instancia M2 en HS256, nunca contra la instancia real en jwks.

No se crean tablas, no se usa Redis de estado de cuenta como almacén de sesiones y no se agregan dependencias. M6 permanece simulado, precargado por configuración en desarrollo y conectable al servicio real en otro trabajo. La estética bordó y marfil corresponde al issue de interfaz separado de #83.

La separación de evaluación reemplaza el criterio de una sola app de la spec 071 y de panel/PRODUCT.md. El PR #118 conserva sesión, compose real y entorno Keycloak; interfaz y entrega continúan en dos issues propios, según la revisión del integrador.

## Alternativas descartadas

- Tokens en memoria del navegador: requeriría cambiar RNF-19.3 y el proxy; el usuario eligió servidor.
- Guardar tokens en almacenamiento persistente del navegador: no cumple la privacidad acordada.
- Cliente OIDC con secreto nuevo: el realm ya tiene m2-front público con PKCE; no se necesita distribuir otro secreto para el entorno local.
- Mezclar suplantación y sesión real bajo un selector de pantalla: ocultar enlaces no evita invocar rutas privilegiadas.
- Base o Redis nuevos para sesiones: innecesarios para un proceso local; implicarían ampliar infraestructura o esquema.

## Consecuencias

- Reiniciar frontend requiere reingreso. Memoria local no permite múltiples réplicas: otra spec debe resolverlas si se necesitan.
- Hace falta vincular state a una transacción del navegador, validar nonce y PKCE, controlar renovación concurrente, evitar recreación de sesión tras logout y sanear logs de autenticación.
- Logout remoto usa client_id y retorno registrado, sin id_token_hint en URL; puede pedir confirmación en Keycloak. Logout local queda confirmado aunque falle el remoto.
- Una sesión vencida no dispara escrituras pendientes. El formulario queda visible para copiar antes de reingresar y puede perderse con la redirección, como confirmó el usuario.
- La CSP real debe permitir form-action hacia el origen público exacto de Keycloak para el POST de acceso y su redirección, conservando las demás restricciones y comprobándolo en Chrome.
- La prueba reproducible requiere precargar viajes del simulador para cliente1/cliente2 y agregar cliente-operador1 al realm con ambos roles. Estas son fixtures de desarrollo, no datos de otros módulos en la base M2.
- bd-puente se activa solo con panel-bd; panel y el entorno real no publican la base por activar el simulador. Esto cambia el disparador de RNF-04.8 de la 072 y exige actualizar los comandos de desarrollo.
- El plan 083 define rutas internas, tiempos, límites, pruebas y configuración. Su aprobación exige PR y merge del integrador; este archivo todavía no cambia el comportamiento del sistema.
