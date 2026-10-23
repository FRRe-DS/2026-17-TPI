# Tareas 005 — Direcciones frecuentes

Depende de: la migración de perfiles (T1 de la spec #4) debe estar mergeada en `main` antes de T1. T5 depende además de la idempotencia y las transacciones de la spec #4 y es delicada: se implementa con Opus.

- [x] **T1. Crear la migración de direcciones con relación, checks e índices.** RF-2.2, RNF-05
  - Hecho cuando: después de mergear la migración de perfiles de la spec #4, una prueba de integración aplica y revierte la migración, verifica la FK y los índices, y la base rechaza texto vacío, tipo inválido o coordenadas incompletas/fuera de rango.
- [x] **T2. Implementar el repositorio de alta y consulta por cliente.** RF-2.2, RF-2.2.2, RF-2.2.2.1
  - Hecho cuando: pruebas con PostgreSQL real crean direcciones con y sin datos opcionales, las convierten al esquema del contrato y nunca encuentran una dirección bajo otro cliente.
- [x] **T3. Implementar listado, filtro, orden y paginación estable.** RF-2.2.1
  - Hecho cuando: integración verifica favoritas, recientes, lista completa, totales, límites, empates de fecha y página fuera del total.
- [x] **T4. Implementar actualización parcial y borrado físico.** RF-2.2.3, RF-2.2.4, RF-2.2.4.1
  - Hecho cuando: PATCH modifica solo lo enviado y conserva `creadoEn`; DELETE elimina una sola fila, devuelve 404 al repetirse y no afecta direcciones de otro cliente.
- [x] **T5. Integrar rol efectivo, propiedad e idempotencia en el servicio.** RF-2.2, RF-2.2.5, RNF-08
  - Hecho cuando: pruebas cubren CLIENTE propio/ajeno, CLIENTE+OPERADOR para lecturas y escrituras, y el POST repetido o concurrente con la misma clave produce un solo registro, mientras otro cuerpo da 422.
- [ ] **T6. Exponer y registrar las cinco operaciones del contrato.** RF-2.2, RF-2.2.1, RF-2.2.2, RF-2.2.2.1, RF-2.2.3, RF-2.2.4, RF-2.2.4.1, RF-2.2.5, RNF-03, RNF-19
  - Hecho cuando: pruebas HTTP cubren todos los códigos, roles, `Location`, 204 sin cuerpo y errores problem+json, y comprueban que logs no contienen textos, alias, coordenadas ni claves.
- [ ] **T7. Validar contrato, regresión y documentación de la spec.** RNF-07, RNF-20
  - Hecho cuando: las cinco operaciones pasan `npm run contrato:test`; build, lint, `npm test` y `spec-check` quedan en verde; y `guia.md` documenta el mapa, decisiones y ejemplos ficticios comprobados.
