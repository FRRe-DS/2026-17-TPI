# Propuesta M6 — consumo de M2, issue #2

Fecha de revisión: 2026-10-22. Estado: propuesta pendiente de los grupos 12 y 5.
Alcance exclusivo: RF-2.4, RF-2.5 y RNF-05. ADR: [002](../../docs/adr/002-dependencia-m6.md).

## Evidencia revisada antes de editar

- [Issue #2 y comentario de alcance](https://github.com/FRRe-DS/2026-17-TPI/issues/2): dependencia desde el consumidor; M1 se coordina aparte.
- [Contrato de la cátedra](https://github.com/FRRe-DS/2026-TPI/blob/main/contratos/m6_viajes/openapi.yml): solo `openapi`, `info`, versión 1.0.0; blob consultado `dec1a7cb8191b284260efde7d7339dedfb4cd13d`.
- [OpenAPI público del Grupo 12](https://github.com/FRRe-DS/2026-12-TPI/blob/4cc05b07725c6b6551f319578bbf73a5de926689/openapi.yaml): OpenAPI 3.0.3, versión 1.0.0, blob `ba8180b5491214b3116aa127907b5071a8edf3be`.
- [README del Grupo 12](https://github.com/FRRe-DS/2026-12-TPI/blob/4cc05b07725c6b6551f319578bbf73a5de926689/README.md): describe consultas y estados, pero su modelo usa `vehicleType`, `origin` y `destination`; el OpenAPI usa `vehicleId` y coordenadas. No se resuelve la diferencia tomando columnas de su base.
- [Repositorio público del Grupo 5](https://github.com/FRRe-DS/2026-05-TPI): la búsqueda devuelve tamaño 0; no se obtuvo allí un contrato ni un acuerdo. Esto no demuestra que no exista documentación por otros medios.
- Fuentes locales: `contrato/openapi.yml`, `contrato/dependencias/README.md`, `docs/constitution.md` y ADR 001. La publicación de M2 deja abierto el resumen y los estados de M6.

## Confirmado para M2

- RF-2.4: consultar historial por cliente mediante la API de M6; M2 agrega `calificado` con sus datos.
- RF-2.5: verificar viaje completado y cliente pasajero; obtener el conductor de M6, sin confiar en un conductor enviado por el cliente.
- RNF-05: no consultar la base de M6 ni replicar sus viajes en M2.
- La paginación pública de M2 usa `page` desde 0, `size` por defecto 20 y máximo 100, con totales. Esto no confirma paginación en M6.
- Los campos de `ViajeResumen` de M2 no son evidencia de campos HTTP provistos por M6. `FINALIZADO` es un ejemplo de M2, no un estado confirmado de M6.

## Documentado por Grupo 12, pendiente de acuerdo conjunto

El borrador `m6.yml` conserva estas definiciones de la fuente, sin añadir garantías:

| Consumo | Evidencia pública |
|---|---|
| Historial | `GET /trips` con filtro `clientId` de tipo string; 200 devuelve array de `Trip`; declara 401 y 403. No declara paginación ni orden. |
| Verificar viaje | `GET /trips/{id}`, identificador UUID; 200 devuelve `Trip`; declara 401, 403 y 404. |
| Pasajero y conductor | `Trip.clientId` y `Trip.driverId`, UUID en el esquema. `Trip` no declara `required`, ni siquiera para `id` y `state`. |
| Estado | `state`: PENDING_ARRIVAL, DRIVER_ARRIVED, IN_PROGRESS, COMPLETED, CANCELLED_BY_CLIENT, CANCELLED_BY_DRIVER. README asocia COMPLETED con finalización. |
| Seguridad y errores | Bearer JWT, claim `role` con CLIENT/DRIVER/OPERATOR; errores `application/json` con ErrorResponse. No acredita acceso con rol SERVICIO ni equivalencia con CLIENTE/OPERADOR de M2. |

## Preguntas a grupos 12 y 5

1. [NECESITA ACLARACIÓN] ¿Ambos grupos aceptan estas dos consultas como contrato compartido? Confirmar versión, URL base y publicación canónica. El servidor local del archivo es evidencia de desarrollo, no una URL de integración acordada.
2. [NECESITA ACLARACIÓN] ¿El filtro `clientId` garantiza historial exclusivamente del pasajero solicitado? Confirmar identificadores, relación con `clienteId` de M2 y campos garantizados de identidad, conductor y estado para RF-2.5.
3. [NECESITA ACLARACIÓN] ¿COMPLETED es el estado definitivo que habilita calificar en ambas implementaciones? Confirmar conjunto y significado de estados; no traducirlo automáticamente a FINALIZADO.
4. [NECESITA ACLARACIÓN] ¿Cómo se pagina y ordena el historial, con qué límites y totales? ¿Qué responde para historial vacío, cliente desconocido o página fuera de rango? No se agregan parámetros ni respuestas al borrador.
5. [NECESITA ACLARACIÓN] ¿Qué campos de Trip son obligatorios, opcionales o nulos? Aclarar diferencias README/OpenAPI sobre vehículo y origen/destino; si hay fechas reales de inicio/finalización. `createdAt` y `updatedAt` no se asumen equivalentes a esas fechas.
6. [NECESITA ACLARACIÓN] ¿Cómo autoriza M6 a M2 para ambas consultas, incluidas solicitudes de operador? Confirmar token, claims y roles sin cambiar el acuerdo M1 ni asumir propagación del token del cliente.
7. [NECESITA ACLARACIÓN] Confirmar errores para identificadores/filtros inválidos, viaje inexistente, acceso ajeno e indisponibilidad; formato y correlación. Los errores publicados por M2 no se imponen como respuestas de M6. La adaptación se decidirá después del acuerdo.
8. [NECESITA ACLARACIÓN] Entregar ejemplos acordados de historial con/sin viajes, viaje completado/no completado y errores para fixtures fiables de Prism. La fuente no garantiza la presencia de los campos que M2 necesita.

## Mensaje preparado — no enviado

Para grupos 12 y 5; copia al Grupo 1 para coordinar impactos sobre el contrato compartido de M2:

> Desde Grupo 17, issue #2, necesitamos acordar el consumo de M6 para historial por cliente (RF-2.4) y verificar viaje completado, pasajero y conductor antes de calificar (RF-2.5), siempre por API (RNF-05). Encontramos las consultas GET /trips y GET /trips/{id} en el OpenAPI público del Grupo 12, commit 4cc05b07725c6b6551f319578bbf73a5de926689. Preparamos una extracción como borrador de dependencia, sin modificar sus rutas, campos ni respuestas. La cátedra aún publica solo metadatos de M6. Necesitamos respuesta conjunta a las ocho preguntas de esta propuesta, especialmente garantías de campos, paginación, permisos y errores. La versión 0.1.0-borrador es local; versión y fecha de vigencia de M6: [NECESITA ACLARACIÓN]. No hay acuerdo ni publicación nuevos. ¿Pueden confirmar o corregir estas definiciones y facilitar ejemplos? Coordinaremos con Grupo 1 cualquier impacto sobre el resumen de viajes de M2 antes de modificarlo.

## Validación y próximo paso

Validar el YAML extraído con Redocly y ejecutar los checks del repositorio. Un lint correcto no sustituye aceptación ni garantiza datos útiles para Prism. Tras recibir respuestas, actualizar el borrador y el ADR, revisar compatibilidad y preparar el PR local siguiendo sdd-pr. La publicación en la cátedra corresponde al responsable de contrato después de aceptación; ORIGEN se actualiza cuando esté publicado el cambio que corresponda.

Validación realizada el 2026-10-22: Redocly 2.62.1 valida ambos OpenAPI sin errores. El borrador M6 tiene cuatro avisos: licencia ausente, servidor localhost y dos operationId ausentes. No se inventan licencia ni identificadores de operación. [NECESITA ACLARACIÓN] Grupos 12 y 5: confirmar metadatos y operationId del contrato compartido. El OpenAPI propio de M2 conserva sus tres avisos previos, que quedan fuera de este cambio. `spec-check` pasa; al comparar la rama advierte que falta ADR porque los archivos nuevos aún no están incorporados a Git. El ADR 002 está presente en el directorio de trabajo.

Docker ya funciona: `npm test`, ejecutado fuera del sandbox con Testcontainers, ejecutó 2007 pruebas; 2006 pasaron y 1 falló únicamente por la comparación de separadores de ruta de Windows en `pruebas/unitarias/consistencia.test.ts`. Ese fallo no está relacionado con los cambios de M6. No hay resultado completamente verde ni se considera cerrada la validación. No se modificaron tests ni configuración para omitir el problema.
