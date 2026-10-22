# Tareas 006 — Preferencias

- [ ] **T1. Crear la migración uno-a-uno de preferencias con checks de enumerados.** RF-2.3, RF-2.3.3, RNF-05.1, RNF-08.1
  - Hecho cuando: una prueba de integración aplica y revierte la migración, verifica PK/FK y demuestra que la base rechaza valores desconocidos, repetidos o una segunda fila del mismo cliente.
- [ ] **T2. Implementar el modelo y la consulta con valores predeterminados.** RF-2.3.1, RF-2.3.2, RF-2.3.3, RF-2.3.5
  - Hecho cuando: pruebas unitarias e integración devuelven el objeto predeterminado sin insertar una fila, devuelven 404 sin perfil y mapean exactamente valores guardados con y sin observaciones.
- [ ] **T3. Implementar el UPSERT completo y su comportamiento concurrente.** RF-2.3, RNF-08.1
  - Hecho cuando: PUT repetidos dejan una fila y dos UPSERT concurrentes producen uno de los dos objetos completos, sin mezclar listas ni fallar por unicidad.
- [ ] **T4. Aplicar propiedad y permisos de CLIENTE, OPERADOR y SERVICIO.** RF-2.3.4, RF-2.3.5
  - Hecho cuando: CLIENTE consulta/guarda solo lo propio, OPERADOR solo consulta, SERVICIO no accede y un perfil inexistente responde 404 sin crear preferencias.
- [ ] **T5. Exponer y registrar GET/PUT con validación y privacidad.** RF-2.3, RF-2.3.1, RF-2.3.2, RF-2.3.3, RNF-03.1, RNF-19.1
  - Hecho cuando: pruebas HTTP cubren 200, 400, 403, 404, listas vacías, reemplazo total, campos extra, duplicados, observaciones y problem+json, y ningún valor del cuerpo aparece en logs.
- [ ] **T6. Validar contrato, regresión y documentación de la spec.** RNF-07.1, RNF-20.1
  - Hecho cuando: las dos operaciones pasan `npm run contrato:test`; build, lint, `npm test` y `spec-check` quedan en verde; y `guia.md` explica valores, predeterminados, permisos y ejemplos comprobados.
