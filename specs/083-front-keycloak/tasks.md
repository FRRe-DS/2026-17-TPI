# Tareas — Spec 083: frontend con sesión real y nueva interfaz

Estado: propuesta. Ninguna tarea habilitada hasta el merge de la spec.

Cada tarea está prevista como un paso de 20 a 30 minutos reutilizando el panel y sus pruebas. Si no cabe en ese tiempo, se divide antes de implementarla. En cada paso: prueba específica en rojo, cambio acotado, prueba en verde, entrada de guia.md y commit 083/Tn; después se detiene la sesión de implementación como indica AGENTS.md.

Por superar diez tareas, se propone al grupo dividir el alcance en issues de sesión, rediseño y entrega, conservando #83 como referencia. No se crean ni numeran esos issues sin autorización. La lista completa deja el alcance reviewable mientras se decide esa división; no reduce el trabajo a diez tareas demasiado grandes.

## Sesión y servidor

- [ ] **T1. Separar configuración real y de desarrollo y validar orígenes.** RNF-06.83.1
  - Hecho cuando: pruebas de cargarConfigPanel aceptan oidc sin clave HS256, rechazan retornos ajenos y conservan el comportamiento de desarrollo, sin imprimir valores sensibles.
- [ ] **T2. Crear almacenes acotados de sesiones y transacciones en memoria.** RNF-12.83.2
  - Hecho cuando: reloj de prueba verifica vencimiento, consumo único, máximos, limpieza y cierre de temporizadores; un identificador desconocido no obtiene sesión.
- [ ] **T3. Vincular cookies y solicitudes al origen del frontend.** RNF-12.83.2, RNF-19.83.1
  - Hecho cuando: pruebas HTTP comprueban HttpOnly, SameSite, Path, Secure según origen, limpieza de cookie y rechazo de POST de origen ajeno o sesión fijada por el cliente.
- [ ] **T4. Iniciar autorización con transacción, state, nonce y PKCE.** RF-2.1.83.1, RNF-12.83.1, RNF-13.83.1
  - Hecho cuando: POST propio genera 303 con parámetros correctos, verifier solo en servidor y retorno local permitido; las pruebas no usan contraseñas ni tokens en navegador.
- [ ] **T5. Validar ID token y access token por separado con JWKS de prueba.** RNF-12.83.1
  - Hecho cuando: pruebas rechazan firma, algoritmo, issuer, audiencia, nonce, sub y tipo inválidos; ID token nunca se acepta como access token de M2.
- [ ] **T6. Completar retorno OIDC y abrir sesión con URL limpia.** RF-2.1.83.1, RNF-12.83.1, RNF-19.83.1
  - Hecho cuando: retorno válido crea cookie nueva y redirige; retorno repetido, cancelado, expirado o de otro navegador no crea sesión ni deja códigos en logs o diagnósticos.
- [ ] **T7. Renovar credenciales con una operación compartida por sesión.** RNF-12.83.4, RNF-13.83.1
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

## Interfaz aprobada

- [ ] **T17. Definir tokens bordó y marfil en ambos temas.** RNF-15.83.1, RNF-15.83.2
  - Hecho cuando: variables y componentes base usan la nueva paleta, los pares de contraste están clasificados y medidos y se conserva la restricción de estilos y recursos locales.
- [ ] **T18. Rehacer marco y navegación responsiva.** RNF-15.83.1, RNF-15.83.2
  - Hecho cuando: escritorio muestra menú lateral y móvil menú compacto con foco y cierre por teclado; el selector de espacio cabe a 360 píxeles y la franja técnica no ocupa el pie del uso cotidiano.
- [ ] **T19. Unificar estados, mensajes y detalles de error.** RNF-03.83.1, RNF-15.83.3
  - Hecho cuando: componentes representan carga, vacío, rechazo, cancelación, error y éxito, conservan detalle real de M2 y no presentan falta de disponibilidad como lista vacía.
- [ ] **T20. Advertir cambios pendientes y permitir copia antes del reingreso.** RF-2.1.83.5, RNF-12.83.4.1, RNF-15.83.3
  - Hecho cuando: navegación interna pide confirmación, sesión vencida deja formulario montado con enviar deshabilitado y permite copiar o seleccionar texto, sin persistencia ni autoenvío tras login.
- [ ] **T21. Agregar Inicio con cargas independientes.** RF-2.1.83.4, RF-2.4.83.2
  - Hecho cuando: perfil, cuenta y viajes se cargan de forma independiente, una falla M6 no oculta cuenta ni accesos y no aparecen fechas o puntajes inexistentes en las respuestas.
- [ ] **T22. Adaptar presentación de Mi perfil y completar-perfil.** RF-2.1.83.5
  - Hecho cuando: ambas vistas usan el sistema visual y validaciones existentes, solo envían campos admitidos, muestran el resultado de M2 y admiten nombres de longitud máxima.
- [ ] **T23. Adaptar la vista de direcciones conservando sus operaciones.** RF-2.2.83.1
  - Hecho cuando: pruebas existentes ajustadas conservan listado, detalle, alta, edición, paginación y confirmación de eliminación con alias, texto y coordenadas válidos.
- [ ] **T24. Adaptar preferencias y sus explicaciones.** RF-2.3.83.1
  - Hecho cuando: selecciones vacías y límites del contrato se entienden, PUT conserva reemplazo completo y los estados de carga y error mantienen los datos editados.
- [ ] **T25. Adaptar historial y dependencia simulada.** RF-2.4.83.1, RF-2.4.83.2, RNF-02.83.2
  - Hecho cuando: listado paginado conserva estados, etiqueta M6 simulado y Calificar correcto; 503 respeta Retry-After y los campos ausentes no se inventan.
- [ ] **T26. Adaptar el formulario de calificación y sus rechazos.** RF-2.5.83.1, RF-2.5.83.2
  - Hecho cuando: puntaje accesible, comentario, doble clic, reintento y errores 404/409/422/503 conservan reglas y claves de las pruebas existentes bajo la nueva sesión.
- [ ] **T27. Adaptar listado y detalle de calificaciones.** RF-2.5.83.3
  - Hecho cuando: la paginación y detalle muestran datos propios sin usar calificado como puntaje y los comentarios máximos se leen en móvil.
- [ ] **T28. Adaptar estado de cuenta y bloqueos vigentes.** RF-2.6.83.1
  - Hecho cuando: ACTIVO y BLOQUEADO se explican con texto y datos recibidos, un bloqueo no impide editar perfil y no se muestran importes ni acciones de pago.
- [ ] **T29. Adaptar consulta y acciones del operador.** RF-2.6.83.2
  - Hecho cuando: consulta por UUID, ficha, detalle de bloqueo, motivo, confirmación, alta y levantamiento conservan sus pruebas y refrescan el estado; no se ofrece búsqueda por nombre.
- [ ] **T30. Reubicar y rediseñar Evaluación en desarrollo.** RNF-12.83.7, RNF-15.83.1
  - Hecho cuando: diagnóstico, otro módulo, M6 simulado y Demostración conservan sus casos y disponen de marco propio; ninguna ruta de control aparece registrada en modo real.

## Entrega y comprobación

- [ ] **T31. Preparar imagen y compose del frontend real con M6 simulado.** RNF-02.83.1, RNF-02.83.2, RNF-04.83.1, RNF-12.83.7
  - Hecho cuando: ejemplo y override levantan las cinco piezas principales, Redis y M6 simulado con versiones fijas, puertos de loopback y frontend sin permisos de base o Docker; el arranque de desarrollo sigue funcionando aparte.
- [ ] **T32. Agregar pruebas HTTP de aislamiento y ausencia de secretos.** RNF-07.83.1, RNF-19.83.1
  - Hecho cuando: pruebas negativas ejercitan callback de otro navegador, sesión fijada, origen ajeno, retorno externo, renovación tras logout, suplantación por encabezado y registros entre sesiones; no aparecen tokens, cookies o códigos en diagnósticos.
- [ ] **T33. Preparar el entorno del navegador con Keycloak real.** RNF-07.83.1
  - Hecho cuando: proyecto front-keycloak y comando de ejecución compilan el panel, aíslan puertos y volúmenes y abren el acceso real sin relajar PKCE ni claims; la limpieza funciona tras éxito y fallo.
- [ ] **T34. Automatizar el recorrido del cliente autenticado.** RNF-07.83.1, RNF-15.83.3
  - Hecho cuando: Chrome recorre login real, primer perfil, edición, dirección, preferencias, historial y calificación simulados y logout, sin inyectar sesión ni sustituir el formulario de Keycloak.
- [ ] **T35. Automatizar doble rol, operador y recuperación de sesión.** RNF-07.83.1, RNF-15.83.3
  - Hecho cuando: Chrome verifica selector sin cambio de identidad, gestión de bloqueos, rechazo de permisos y aviso/copia al vencer sesión con formulario abierto.
- [ ] **T36. Revisar temas, anchos y accesibilidad del render.** RNF-15.83.2, RNF-15.83.3
  - Hecho cuando: revisión agrupada en 360/768/1280/1440 y ambos temas comprueba foco, axe, contraste, textos máximos, estados y ausencia de overflow; los hallazgos se corrigen y quedan capturas válidas de los tamaños revisados.
- [ ] **T37. Actualizar la guía técnica y de arranque.** RNF-20.83.1
  - Hecho cuando: README, docs/probar-m2.md y guia.md explican modos, comandos verificados, variables, usuarios de ejemplo, límites de sesión y M6 simulado; todas las tareas implementadas tienen entrada de guía.
- [ ] **T38. Documentar el sistema visual implementado.** RNF-20.83.1
  - Hecho cuando: PRODUCT.md, DESIGN.md, sidecar y brief describen el diseño real aprobado, conservan trazabilidad y registran diferencias necesarias respecto de la maqueta.
- [ ] **T39. Ejecutar las puertas de validación de la entrega.** RNF-07.83.1, RNF-20.83.1
  - Hecho cuando: los comandos exigidos en plan.md pasan y sus resultados se registran; un bloqueo se informa sin declarar verde lo que no corrió ni desactivar checks.

## Puerta de validación

Al terminar las tareas y resolver todos los hallazgos, se escribe el commit 083/V con resultados reales. No se marca implementada ni se publica PR con pruebas bloqueadas. No se considera aprobada por haber elegido una maqueta ni por pasar solo spec-check.
