# Tareas 004 — Perfil y estado de cuenta

- [ ] **T1. Crear la migración de perfiles, bloqueos e idempotencias con restricciones e índices.** RF-2.1, RF-2.1.3, RF-2.6.1, RF-2.6.4, RNF-05.1, RNF-08.1
  - Hecho cuando: una prueba de integración aplica y revierte la migración, inspecciona claves, checks e índices, y demuestra que la base rechaza un segundo perfil y un levantamiento incompleto.
- [ ] **T2. Implementar el repositorio de perfiles y sus transformaciones.** RF-2.1, RF-2.1.1, RF-2.1.2, RF-2.1.3
  - Hecho cuando: las pruebas de integración crean, consultan y actualizan parcialmente un perfil, conservan campos no enviados, devuelven 404 cuando falta y resisten dos altas concurrentes sin duplicar.
- [ ] **T3. Implementar la idempotencia transaccional reutilizable para las altas.** RF-2.1, RF-2.6.1, RNF-08.1
  - Hecho cuando: pruebas con PostgreSQL real demuestran que la misma clave y cuerpo, incluso concurrentes, producen un solo efecto y la misma respuesta, y que otro cuerpo devuelve 422.
- [ ] **T4. Exponer crear, obtener y actualizar perfil con propiedad y errores del contrato.** RF-2.1, RF-2.1.1, RF-2.1.2, RF-2.1.3, RNF-03.1, RNF-19.1
  - Hecho cuando: pruebas HTTP cubren 201, `Location`, 200, 400, 403, 404, 409 y 422, roles CLIENTE/OPERADOR, PATCH parcial y ausencia de datos personales o claves en logs.
- [ ] **T5. Implementar vigencia y estado de cuenta consistente.** RF-2.6, RF-2.6.4
  - Hecho cuando: pruebas unitarias e integración cubren bloqueos indefinidos, futuros, vencidos y levantados, varios bloqueos simultáneos y coincidencia entre `estado` y `bloqueosVigentes`.
- [ ] **T6. Crear y consultar bloqueos con historial paginado.** RF-2.6.1, RF-2.6.2, RNF-03.1, RNF-08.1
  - Hecho cuando: pruebas HTTP e integración cubren alta idempotente, autor del token, `Location`, consulta individual, filtro de vigencia, totales, orden estable, página vacía y recursos de otro cliente como 404.
- [ ] **T7. Levantar bloqueos sin borrar historial y proteger la concurrencia.** RF-2.6.3, RF-2.6.4, RNF-08.1
  - Hecho cuando: se guardan juntos autor, instante y motivo; el historial conserva el bloqueo; dos levantamientos concurrentes producen un 200 y un 409; y levantar uno no activa la cuenta si queda otro vigente.
- [ ] **T8. Registrar las ocho operaciones y completar las pruebas por rol y propiedad.** RF-2.1.1, RF-2.1.2, RF-2.6, RF-2.6.1, RF-2.6.2, RF-2.6.3, RNF-07.1
  - Hecho cuando: CLIENTE solo opera sobre sí mismo, OPERADOR usa las operaciones permitidas, SERVICIO solo obtiene estado de cuenta y todos los rechazos tienen problem+json.
- [ ] **T9. Validar contrato, regresión y documentación de la spec.** RNF-03.1, RNF-07.1, RNF-20.1
  - Hecho cuando: las ocho operaciones pasan `npm run contrato:test`; build, lint, `npm test` y `spec-check` quedan en verde; y `guia.md` contiene el mapa por tarea, decisiones, comandos y ejemplos de uso comprobados.
