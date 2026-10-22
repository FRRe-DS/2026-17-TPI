# Plan 006 — Preferencias

Spec: [spec.md](spec.md) · Issue: #6 · Contrato: `contrato/openapi.yml` · Depende de: spec #4

## Resumen
Se agrega una tabla uno-a-uno con el perfil y dos manejadores. GET lee la fila o devuelve en memoria los valores predeterminados confirmados; PUT hace un UPSERT de las tres listas y las observaciones como una sola unidad. No se agregan integraciones externas ni dependencias.

## Estructura

| Archivo | Responsabilidad | Requisitos |
|---|---|---|
| `migraciones/<marca>_preferencias.sql` | Tabla, relación y checks de enumerados | RF-2.3, RF-2.3.3, RNF-05.1, RNF-08.1 |
| `src/preferencias/modelo.ts` | Tipos, enumerados y valor predeterminado | RF-2.3.2, RF-2.3.3 |
| `src/preferencias/repositorio.ts` | Lectura y UPSERT completo | RF-2.3, RF-2.3.1, RF-2.3.5 |
| `src/preferencias/servicio.ts` | Existencia del perfil y propiedad | RF-2.3.2, RF-2.3.4, RF-2.3.5 |
| `src/preferencias/operaciones.ts` | Manejadores GET y PUT | RNF-03.1 |
| `src/operaciones/index.ts` | Registro por `operationId` | RNF-03.1 |
| `pruebas/unitarias/preferencias.test.ts` | Predeterminados, mapeo y propiedad | RF-2.3.2, RF-2.3.3, RF-2.3.4 |
| `pruebas/integracion/preferencias.test.ts` | UPSERT, constraints y concurrencia | RF-2.3, RNF-05.1, RNF-08.1 |
| `pruebas/http/preferencias.test.ts` | Contrato, permisos y errores | RF-2.3 a RF-2.3.5, RNF-03.1 |
| `specs/006-preferencias/guia.md` | Mapa y uso | RNF-20.1 |

## Contrato
- Se implementan `obtenerPreferencias` y `guardarPreferencias`.
- GET y PUT devuelven siempre el esquema completo `Preferencias`; `observacionesAccesibilidad` solo aparece cuando tiene valor.
- Los arreglos obligatorios, `uniqueItems`, enumerados, longitud y rechazo de campos extra se validan desde el OpenAPI.
- CLIENTE requiere `sub = clienteId`. OPERADOR solo alcanza GET. SERVICIO no alcanza ninguna de las dos rutas.

## Datos

### `preferencias_cliente`
- `cliente_id uuid PRIMARY KEY REFERENCES clientes(cliente_id) ON DELETE CASCADE`.
- `tipos_vehiculo text[] NOT NULL DEFAULT '{}'`.
- `canales text[] NOT NULL DEFAULT '{}'`.
- `accesibilidad text[] NOT NULL DEFAULT '{}'`.
- `observaciones_accesibilidad varchar(255) NULL`.
- Checks garantizan que cada arreglo contiene solo valores admitidos y no tiene repetidos; la validación HTTP continúa siendo la primera barrera.

Una clave primaria por cliente impide filas duplicadas. No se guardan fechas porque el contrato no las expone ni el issue pide auditoría. El valor predeterminado recomendado es tres listas vacías y observaciones ausentes; se fijará en `modelo.ts` al resolver la aclaración.

## Lógica

### Obtener
1. Comprobar permiso de propiedad si llama CLIENTE.
2. Consultar el perfil junto con sus preferencias mediante `LEFT JOIN`.
3. Si no existe perfil, 404.
4. Si no existe fila de preferencias, devolver una copia nueva del objeto predeterminado; nunca compartir arreglos mutables entre solicitudes.

### Guardar
1. Comprobar propiedad y existencia del perfil.
2. Ejecutar `INSERT ... ON CONFLICT (cliente_id) DO UPDATE` asignando las cuatro columnas desde una sola solicitud.
3. Usar `RETURNING` para formar la respuesta. La sentencia es atómica: cada respuesta representa un objeto completo confirmado.

### Concurrencia
PostgreSQL serializa los UPSERT sobre la misma clave. No se hace lectura previa para fusionar campos, por lo que dos solicitudes no pueden producir una combinación. La última confirmación determina el estado observable posterior.

### Privacidad
Las consultas son parametrizadas. Los manejadores no entregan el objeto de preferencias al logger; las pruebas capturan logs y buscan valores centinela de observaciones y enumerados.

## Pruebas
- Unitarias: objeto predeterminado independiente por llamada, mapeo con/sin observaciones, propiedad y enumerados sincronizados con el contrato.
- HTTP: GET predeterminado y persistido; PUT y repetición; listas vacías; 400 por duplicados/enum/campos; 403 propio/ajeno; 404 sin perfil; OPERADOR GET/PUT; SERVICIO; problem+json.
- Integración: migración up/down; FK; checks; insert/update; una fila por cliente; dos UPSERT concurrentes sin mezcla.
- Contrato: ambas operaciones dejan de figurar pendientes y pasan Schemathesis.

## Trazabilidad

| Requisito | Cobertura |
|---|---|
| RF-2.3, RF-2.3.1, RF-2.3.2, RF-2.3.3, RF-2.3.4, RF-2.3.5 | Modelo, tabla, repositorio, servicio, manejadores y pruebas |
| RNF-03.1 | Rutas desde OpenAPI, respuestas y contrato |
| RNF-05.1 | Migración y ausencia de integraciones |
| RNF-07.1 | Unitarias, HTTP, integración y contrato |
| RNF-08.1 | PK, UPSERT y prueba concurrente |
| RNF-19.1 | Consultas parametrizadas y comprobación de logs |
| RNF-20.1 | Guía por tarea y visión general al validar |

## Decisiones
- PostgreSQL `text[]` mantiene el objeto completo legible y evita tablas de unión innecesarias para enumerados pequeños y cerrados.
- GET sin fila no escribe; PUT es la única operación con efecto.
- No se crea ADR ni se agrega una dependencia.

## Dudas abiertas
- [NECESITA ACLARACIÓN] Responsable y conjunto predeterminado indicados en `spec.md`.
