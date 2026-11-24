# Tareas — Spec 083: sesión real del frontend

T1 a T5 están implementadas y validadas (ver guia.md). T6 a T26 siguen pendientes. Se ejecutan después del merge de la spec, una por vez: prueba en rojo, cambio acotado, prueba en verde, entrada de guía y commit 083/Tn. Cada paso se estima en 20 a 30 minutos y se divide antes de implementar si excede ese tiempo.

El PR #118 se dividió en sesión, interfaz y entrega por pedido del integrador. Esta lista conserva solo sesión y la infraestructura necesaria para probarla. Las antiguas T31 (compose) y T33 (entorno Keycloak) permanecen aquí como T20 y T22. El recorrido completo antiguo T34 se traslada a entrega; aquí se agrega un recorrido acotado de sesión que no depende del rediseño.

Aunque quedan más de diez tareas, no se vuelven a mezclar diseño y entrega para reducir el número: las tareas pequeñas de autenticación conservan verificaciones independientes. La interfaz continúa en [#119](https://github.com/FRRe-DS/2026-17-TPI/issues/119) y la entrega en [#120](https://github.com/FRRe-DS/2026-17-TPI/issues/120).

## Servidor y adaptación funcional

- [x] **T1. Separar configuración real y de desarrollo y validar orígenes.** RNF-06.83.1
  - Hecho cuando: pruebas de cargarConfigPanel aceptan oidc sin clave HS256, rechazan retornos ajenos y conservan el comportamiento de desarrollo, sin imprimir valores sensibles.
- [x] **T2. Crear almacenes acotados de sesiones y transacciones en memoria.** RNF-12.83.2
  - Hecho cuando: reloj de prueba verifica vencimiento, consumo único, máximos, limpieza y cierre de temporizadores; un identificador desconocido no obtiene sesión.
- [x] **T3. Vincular cookies y solicitudes al origen del frontend.** RNF-12.83.2, RNF-19.83.1
  - Hecho cuando: pruebas HTTP comprueban HttpOnly, SameSite, Path, Secure según origen, limpieza de cookie y rechazo de POST de origen ajeno o sesión fijada por el cliente.
- [x] **T4. Iniciar autorización y permitir su destino en la CSP real.** RF-2.1.83.1, RNF-12.83.1, RNF-12.83.9, RNF-13.83.1
  - Hecho cuando: POST propio genera 303 con parámetros correctos, verifier solo en servidor y retorno local permitido; la CSP oidc permite solo self y el origen público de Keycloak, desarrollo conserva self y las pruebas rechazan comodines y no usan contraseñas ni tokens en navegador.
- [x] **T5. Validar ID token y access token por separado con JWKS de prueba.** RNF-12.83.1
  - Hecho cuando: pruebas rechazan firma, algoritmo, issuer, audiencia, nonce, sub y tipo inválidos; ID token nunca se acepta como access token de M2.
- [x] **T6. Completar retorno OIDC y abrir sesión con URL limpia.** RF-2.1.83.1, RNF-12.83.1, RNF-19.83.1
  - Hecho cuando: retorno válido crea cookie nueva y redirige; retorno repetido, cancelado, expirado o de otro navegador no crea sesión ni deja códigos en logs o diagnósticos.
- [x] **T7. Renovar credenciales con una operación compartida por sesión.** RNF-12.83.4, RNF-13.83.1
  - Hecho cuando: varios pedidos concurrentes causan un refresh, los tokens se actualizan atómicamente y una renovación que termina después de logout no recrea la sesión.
- [ ] **T8. Clasificar fallas de renovación y exponer sesión mínima.** RNF-12.83.4, RNF-13.83.1
  - Hecho cuando: /auth/sesion no entrega tokens ni prolonga la inactividad; credencial válida, sesión rechazada y dependencia caída producen resultados distintos y ningún fallo reenvía una escritura por sí solo.
- [ ] **T9. Cerrar sesión local y completar salida remota.** RNF-12.83.5, RNF-19.83.1
  - Hecho cuando: logout invalida primero, verifica retorno con state, admite la confirmación de Keycloak y no envía id_token_hint en URL; fallo remoto no restaura la sesión local.
- [ ] **T10. Adaptar el proxy real al access token de la sesión.** RNF-02.83.1, RNF-03.83.1, RNF-12.83.3
  - Hecho cuando: tests confirman ausencia de firma HS256 en modo real, rechazo de encabezados de suplantación, respuesta M2 preservada, clave de idempotencia intacta y ningún reenvío automático de escritura tras 401.
- [ ] **T11. Aislar registro técnico y rutas de evaluación por modo.** RNF-03.83.1, RNF-12.83.7, RNF-14.83.1, RNF-19.83.1
  - Hecho cuando: dos sesiones no leen el registro de la otra, el modo real no registra rutas de Docker/base/control/demo y los detalles conservan correlación sin cuerpos personales ni secretos.

## Acceso y permisos en el cliente

- [ ] **T12. Agregar fuente de sesión real y estado de permisos.** RNF-12.83.6
  - Hecho cuando: cliente solo consulta /auth/sesion, no conserva tokens, distingue 401 de 503 y expone roles y scopes a la navegación sin aceptar un rol escrito manualmente.
- [ ] **T13. Adaptar rutas y selector Mi cuenta / Operación.** RNF-12.83.6, RNF-12.83.6.1
  - Hecho cuando: pruebas cubren cliente, operador, doble rol, CONDUCTOR y acceso directo a rutas; cambiar espacio no cambia sub ni token ni exige perfil para usar Operación.
- [ ] **T14. Construir acceso real y cierre desde el encabezado.** RF-2.1.83.1
  - Hecho cuando: la pantalla real ofrece Keycloak y el aviso de errores, sin selector de rol, y los botones llaman a las rutas propias con origen protegido; desarrollo conserva su acceso anterior.
- [ ] **T15. Distinguir perfil existente y primer ingreso.** RF-2.1.83.2
  - Hecho cuando: 200 entra, 404 ofrece completar perfil y 401/403/503 mantienen sus estados; siempre se consulta el sub autenticado y no un UUID generado por el navegador.
- [ ] **T16. Completar perfil con reintentos y concurrencia.** RF-2.1.83.3
  - Hecho cuando: tests con M2 y base real comprueban 201, reintento con misma clave, fallo recuperable y dos pestañas; 409 recupera el perfil propio sin duplicarlo.

## Datos y entorno reproducible

- [ ] **T17. Añadir al realm un usuario de ejemplo con CLIENTE y OPERADOR.** RNF-12.83.6.1, RNF-12.83.8
  - Hecho cuando: cliente-operador1 tiene UUID fijo d0b00000-0000-4000-8000-000000000001, ambos roles y scopes solicitados de M2 en un token real; tests de realm comprueban que cliente1, cliente2 y operador1 mantienen sus roles previos y PKCE sigue obligatorio.
- [ ] **T18. Configurar precarga determinista del M6 simulado al arrancar.** RNF-02.83.2, RNF-02.83.3, RNF-06.83.1
  - Hecho cuando: M6_CLIENTES_PRECARGA se valida antes de abrir API, vacío conserva el comportamiento anterior y los IDs configurados reciben un COMPLETED y un IN_PROGRESS propios; repetir no duplica, y ningún perfil ni calificación se escribe en M2.
- [ ] **T19. Conservar el formulario y permitir copia antes de reingresar.** RNF-12.83.4.1, RNF-15.83.2, RNF-15.83.3
  - Hecho cuando: sesión vencida mantiene la vista montada con enviar deshabilitado, ofrece copia o selección manual y avisa la pérdida posible al redirigir; no persiste datos ni reenvía escrituras después del login.
- [ ] **T20. Preparar compose e imagen del frontend real con M6 precargado.** RNF-02.83.1, RNF-02.83.2, RNF-04.83.1, RNF-04.83.2, RNF-12.83.7, RNF-19.83.2
  - Hecho cuando: ejemplo y override levantan frontend oidc, M2 jwks, bases, Keycloak, Redis y M6 con datos para cliente1/cliente2; el panel usa env_file: !reset [] y environment: !override con solo las variables necesarias, sin PANEL_URL_BD ni secretos de base o firma; m6 usa ports: !reset [], front,keycloak no inicia bd-puente y desarrollo conserva el puente en panel.

## Pruebas de sesión y documentación

- [ ] **T21. Comprobar aislamiento y ausencia de secretos heredados.** RNF-07.83.1, RNF-19.83.1, RNF-19.83.2
  - Hecho cuando: pruebas negativas cubren callback ajeno, state/cookie incorrectos, retorno externo, sesión fijada, logout concurrente, suplantación y diagnóstico entre sesiones, sin tokens, cookies o códigos en registros; configuración resuelta y entorno efectivo de panel no contienen claves prohibidas ni valores centinela de base/firma/control, sin imprimirlos.
- [ ] **T22. Preparar entorno Chrome con Keycloak real y M6 precargado.** RNF-07.83.1
  - Hecho cuando: proyecto front-keycloak y comando de ejecución compilan y levantan entorno aislado con retornos exactos, datos para los dos clientes y usuario doble rol, sin relajar PKCE ni claims; bajan sus recursos también al fallar.
- [ ] **T23. Probar en Chrome el POST de login, CSP y datos de viaje del modo real.** RNF-07.83.1, RNF-12.83.9, RNF-02.83.3
  - Hecho cuando: Chrome pulsa acceso, ejecuta el POST y atraviesa 303 y login de Keycloak sin securitypolicyviolation; cliente1 y cliente2 consultan viajes propios y uno califica sin tocar herramientas ni canal de control.
- [ ] **T24. Probar doble rol, operador, expiración y cierre real.** RNF-07.83.1, RNF-12.83.6.1, RNF-12.83.8, RNF-12.83.4.1, RNF-15.83.2, RNF-15.83.3
  - Hecho cuando: usuario doble rol recorre ambos espacios con el mismo sub, operador-only actúa sin perfil propio, cliente-only recibe rechazo, formulario vencido permite copiar y logout invalida sesión; vistas mínimas de sesión pasan teclado/foco y no desbordan a 360/1280.
- [ ] **T25. Documentar el arranque y los límites de sesión.** RNF-20.83.1
  - Hecho cuando: README, docs/probar-m2.md y guia.md tienen comandos verificados, nuevos usuarios, CSP, precarga, lista de variables permitidas, fallas y separación de modos; no afirman que el nuevo diseño o entrega completa estén implementados.
- [ ] **T26. Ejecutar las puertas de validación de sesión.** RNF-07.83.1, RNF-20.83.1
  - Hecho cuando: comandos del plan y recorrido de sesión pasan con resultados registrados; no se desactivan checks ni se declara verde una prueba bloqueada.

## Continuidad del alcance

- [#119](https://github.com/FRRe-DS/2026-17-TPI/issues/119): rediseño de pantallas, marco, Inicio y evaluación, conservando el contrato y la sesión de #83.
- [#120](https://github.com/FRRe-DS/2026-17-TPI/issues/120): recorrido funcional completo, regresión visual, documentación del producto y validación de la entrega.
- Compose real (antigua T31 de la propuesta integral) permanece en sesión como T20.
- Entorno Chrome con Keycloak (antigua T33) permanece en sesión como T22.
- La tarea de mover bd-puente se retira; el desarrollo conserva su configuración actual y no se modifica otra spec.

El commit 083/V registra resultados efectivos al completar la implementación. Elegir colores o pasar spec-check no equivale a implementar ni a mergear.
