# ADR 002 — Propuesta de dependencia M6 para M2

Fecha: 2026-10-22 · Estado: propuesta
Issue: #2 (solo M6)

## Contexto

RF-2.4 requiere historial por cliente; RF-2.5 requiere verificar viaje completado, pasajero y conductor. RNF-05 exige obtener esos datos por API, sin acceder a la base de M6 ni copiar los viajes en la base de M2.

La revisión previa a la edición encontró un OpenAPI público del Grupo 12. Sus consultas permiten proponer un subconjunto basado en evidencia. El contrato de la cátedra aún contiene solo metadatos; no hay evidencia de aceptación conjunta de los grupos 12 y 5. Fuentes, diferencias y preguntas en [la propuesta](../../contrato/dependencias/m6-propuesta.md).

## Decisión

Preparar `contrato/dependencias/m6.yml` como borrador desde el consumidor: extraer únicamente `GET /trips`, `GET /trips/{id}` y los componentes que referencian del commit público del Grupo 12 identificado en la propuesta. Mantener las demás definiciones de la fuente; los metadatos locales identifican procedencia y pendientes.

M2 propone como única adaptación de consumo que `clientId` en `GET /trips` sea obligatorio y tenga formato UUID, pendiente de acuerdo con los grupos 12 y 5.

Es una primera propuesta de dependencia: compatible/incompatible no aplica respecto de un contrato previo de consumo. No representa aprobación ni publicación de M6. Se adapta el paso de la skill que menciona `contrato/openapi.yml` al archivo de dependencia exigido por #2. El contrato publicado de M2 y `contrato/ORIGEN` no cambian.

Toda decisión de los grupos pares queda como [NECESITA ACLARACIÓN] en la propuesta. Las diferencias entre fuentes quedan abiertas; no se elige una solución técnica ni se implementa un adaptador.

## Alternativas descartadas

- Inventar rutas en español, estados o respuestas: no hay acuerdo que lo permita.
- Tratar el README o el modelo de persistencia de M6 como contrato HTTP: difieren del OpenAPI público.
- Copiar todo M6: creación, transiciones, eventos y auditoría no pertenecen al consumo solicitado.
- Resolver paginación, autenticación o traducción de errores sin los grupos pares: introduciría decisiones no acordadas.

## Consecuencias

El borrador permite revisar necesidades concretas, pero no basta para implementar la integración o construir fixtures representativos de Prism. Primero deben resolverse las preguntas y obtenerse aceptación conjunta. Después se actualizan contrato y ADR y se valida el archivo de dependencia con Redocly.

El mensaje de coordinación queda redactado, sin enviarlo. El responsable de contrato publica en la cátedra tras aceptación del grupo par. Cualquier impacto sobre el contrato de M2 se coordina con el Grupo 1 antes de cambiarlo. La parte M1 de #2 permanece fuera de este trabajo.
