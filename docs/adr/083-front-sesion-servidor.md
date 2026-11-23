# ADR 083 — Sesión del frontend en su servidor

Estado: propuesta, pendiente del merge de la spec 083
Issue: #83

## Contexto

M2 ya valida tokens de Keycloak, pero el panel firma tokens de desarrollo y no funciona con M2 en jwks. Su servidor ya intermedia las llamadas y M2 no tiene CORS. RNF-19.3 de la spec 071 evita entregar tokens al navegador. DRAZEN confirmó que los tokens de la nueva app deben permanecer en el servidor.

## Decisión propuesta

El servidor del frontend completa Authorization Code con PKCE S256 usando el cliente público m2-front existente. Valida el ID token y el access token por separado y mantiene tokens en memoria acotada, ligados a una cookie HttpOnly opaca. Solo el access token se reenvía a M2. Se conserva el mismo origen para navegador y API del frontend.

Modo real y modo HS256 de demostración son configuraciones de procesos distintos. El proceso real no registra rutas de suplantación, Docker, base o control del simulador. Las herramientas de desarrollo se ejecutan contra su instancia M2 en HS256, nunca contra la instancia real en jwks.

No se crean tablas, no se usa Redis de estado de cuenta como almacén de sesiones y no se agregan dependencias para esta propuesta. La identidad nueva se presenta con la estética bordó y marfil aprobada. M6 permanece simulado y conectable por configuración en otro trabajo.

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
- El plan 083 define rutas internas, tiempos, límites, pruebas y configuración. Su aprobación exige PR y merge del integrador; este archivo todavía no cambia el comportamiento del sistema.
