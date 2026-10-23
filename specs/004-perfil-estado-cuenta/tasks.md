# Tareas 004 — Perfil y estado de cuenta

Tareas delicadas: T3 (idempotencia concurrente) y T8 (levantamiento concurrente) se implementan con Opus. El primer PR de implementación debe incluir T1 a T3, para desbloquear la FK de las specs #5/#6 y la idempotencia de la #5.

- [x] **T1. Crear la migración de perfiles, bloqueos e idempotencias con restricciones e índices.** RF-2.1, RF-2.1.3, RF-2.6.1, RF-2.6.4, RNF-05, RNF-08
  - Hecho cuando: una prueba de integración aplica y revierte la migración creada con `--migrations-dir migraciones`, inspecciona claves, checks e índices, y demuestra que la base rechaza un segundo perfil, un levantamiento incompleto, un `crearBloqueo` sin cliente de la ruta (23514) y una segunda idempotencia de `crearCliente` con el mismo sujeto y clave, aunque su `cliente_id` sea nulo (23505), y que acepta la misma clave de `crearBloqueo` para dos clientes distintos.
- [ ] **T2. Implementar `transaccion()` con el tiempo máximo y la clasificación de errores de la base.** RNF-08
  - Hecho cuando: pruebas de integración comprueban COMMIT, ROLLBACK, 409 ante `23505`, 503 ante base indisponible y el límite de 2 s por sentencia.
- [ ] **T3. Implementar la idempotencia transaccional reutilizable para las altas.** RF-2.1, RF-2.6.1, RNF-08
  - Hecho cuando: con `transaccion()`, pruebas con PostgreSQL real demuestran que la misma solicitud concurrente produce un solo efecto y la misma respuesta, otro cuerpo da 422 y reutilizar una clave para otro `clienteId` crea el segundo bloqueo.
- [ ] **T4. Implementar el repositorio de perfiles y sus transformaciones.** RF-2.1, RF-2.1.1, RF-2.1.1.1, RF-2.1.2, RF-2.1.2.1, RF-2.1.3, RF-2.1.3.1
  - Hecho cuando: las pruebas de integración crean, consultan y actualizan parcialmente un perfil, conservan campos no enviados, devuelven 404 cuando falta y resisten dos altas concurrentes sin duplicar.
- [ ] **T5. Exponer crear, obtener y actualizar perfil con rol efectivo y errores del contrato.** RF-2.1, RF-2.1.1, RF-2.1.1.1, RF-2.1.2, RF-2.1.2.1, RF-2.1.3, RF-2.1.3.1, RNF-03, RNF-19
  - Hecho cuando: pruebas HTTP cubren 201, `Location`, 200, 400, 403, 404, 409 y 422; CLIENTE+OPERADOR puede consultar otro perfil pero no actualizarlo; y logs no contienen datos personales ni claves.
- [ ] **T6. Implementar vigencia y estado de cuenta consistente.** RF-2.6, RF-2.6.4
  - Hecho cuando: pruebas unitarias e integración cubren bloqueos indefinidos, futuros, vencidos y levantados, varios bloqueos simultáneos y coincidencia entre `estado` y `bloqueosVigentes`.
- [ ] **T7. Crear y consultar bloqueos con historial paginado.** RF-2.6.1, RF-2.6.2, RNF-03, RNF-08
  - Hecho cuando: pruebas HTTP e integración cubren alta idempotente, autor del token, `Location`, `desde` igual a `creadoEn`, consulta individual, filtro de vigencia, totales, orden estable, página vacía, recursos de otro cliente como 404 y `hasta` pasada como 422 con tipo propio.
- [ ] **T8. Levantar bloqueos sin borrar historial y proteger la concurrencia.** RF-2.6.3, RF-2.6.3.1, RF-2.6.4, RNF-08
  - Hecho cuando: se guardan juntos autor, instante y motivo; el historial conserva el bloqueo; dos levantamientos concurrentes producen un 200 y un 409; y levantar uno vencido responde 409 con `type: /errores/bloqueo-no-vigente`.
- [ ] **T9. Registrar las ocho operaciones y completar las pruebas por rol efectivo.** RF-2.1.1.1, RF-2.1.2.1, RF-2.6, RF-2.6.1, RF-2.6.2, RF-2.6.3, RF-2.6.3.1, RNF-07
  - Hecho cuando: CLIENTE solo opera sobre sí mismo cuando es su único rol efectivo, CLIENTE+OPERADOR usa las lecturas de OPERADOR, SERVICIO solo obtiene estado de cuenta, `pruebas/integracion/arranque.test.ts` reconoce los ocho `operationId` y todos los rechazos tienen problem+json.
- [ ] **T10. Validar contrato, regresión y documentación de la spec.** RNF-03, RNF-07, RNF-20
  - Hecho cuando: las ocho operaciones pasan `npm run contrato:test`; build, lint, `npm test` y `spec-check` quedan en verde; y `guia.md` contiene el mapa por tarea, decisiones, comandos y ejemplos de uso comprobados.
