# Plan 005 — Direcciones frecuentes

Spec: [spec.md](spec.md) · Issue: #5 · Contrato: `contrato/openapi.yml` · Depende de: spec #4

## Resumen
Se agrega una tabla hija de `clientes`, un repositorio SQL y cinco manejadores. La autorización por rol sigue saliendo del contrato y el servicio suma la verificación de propiedad. El alta reutiliza la idempotencia transaccional introducida por la spec #4.

## Estructura

| Archivo | Responsabilidad | Requisitos |
|---|---|---|
| `migraciones/<marca>_direcciones.sql` | Tabla e índices de direcciones | RF-2.2, RNF-05.1 |
| `src/direcciones/modelo.ts` | Tipos y conversión de coordenadas/filas | RF-2.2, RF-2.2.2 |
| `src/direcciones/repositorio.ts` | CRUD, filtro, paginación y orden | RF-2.2 a RF-2.2.4 |
| `src/direcciones/servicio.ts` | Existencia del perfil, propiedad e idempotencia | RF-2.2, RF-2.2.5, RNF-08.1 |
| `src/direcciones/operaciones.ts` | Cinco manejadores HTTP | RNF-03.1 |
| `src/operaciones/index.ts` | Registro por `operationId` | RNF-03.1 |
| `pruebas/unitarias/direcciones.test.ts` | Transformaciones, orden y propiedad | RF-2.2.1, RF-2.2.5 |
| `pruebas/integracion/direcciones.test.ts` | Persistencia, CRUD e idempotencia | RF-2.2 a RF-2.2.4, RNF-05.1, RNF-08.1 |
| `pruebas/http/direcciones.test.ts` | Contrato, permisos, filtros y errores | RF-2.2 a RF-2.2.5, RNF-03.1 |
| `specs/005-direcciones-frecuentes/guia.md` | Mapa y uso | RNF-20.1 |

## Contrato
- Se implementan `listarDirecciones`, `crearDireccion`, `obtenerDireccion`, `actualizarDireccion` y `eliminarDireccion`.
- Las validaciones de tipo, longitudes, coordenadas, UUID, paginación y cuerpos parciales salen de los `$ref` del OpenAPI.
- CLIENTE requiere coincidencia entre `sub` y `clienteId`. OPERADOR solo alcanza los dos GET. Un recurso se busca siempre por `(cliente_id, direccion_id)` para no filtrar su existencia a otro cliente.
- El POST devuelve 201, `Location: /api/v1/clientes/{clienteId}/direcciones/{direccionId}` y el cuerpo exacto de `Direccion`. DELETE devuelve 204 sin cuerpo.

## Datos

### `direcciones_cliente`
- `direccion_id uuid PRIMARY KEY`, generado por M2.
- `cliente_id uuid NOT NULL REFERENCES clientes(cliente_id) ON DELETE CASCADE`.
- `tipo text NOT NULL CHECK (tipo IN ('FAVORITA', 'RECIENTE'))`.
- `alias varchar(50) NULL`, `texto varchar(255) NOT NULL` con check no vacío.
- `latitud numeric NULL`, `longitud numeric NULL`; un check exige ambas ausentes o ambas presentes y dentro de los rangos del contrato.
- `creado_en timestamptz NOT NULL DEFAULT clock_timestamp()`.
- Índice `(cliente_id, creado_en DESC, direccion_id DESC)` y otro `(cliente_id, tipo, creado_en DESC, direccion_id DESC)` para listado y filtro.

No se guarda `actualizado_en` porque el contrato no lo expone ni existe un requisito de auditoría para direcciones. El DELETE borra la fila. La idempotencia usa la tabla definida por la spec #4 con `operacion = crearDireccion` y `sujeto = clienteId`.

## Lógica

### Crear
1. Comprobar propiedad y existencia del perfil.
2. Ejecutar el protocolo idempotente de la spec #4 dentro de una transacción.
3. Generar `direccionId`, insertar la instantánea, guardar respuesta/Location y confirmar.

### Listar
La consulta filtra siempre por `cliente_id` y opcionalmente por `tipo`, cuenta con el mismo filtro y devuelve `LIMIT/OFFSET`. Ordena por `creado_en DESC, direccion_id DESC`.

### Consultar, actualizar y borrar
- Buscar por la clave compuesta lógica `(cliente_id, direccion_id)`; cero filas produce 404.
- El PATCH arma un `UPDATE` únicamente con las propiedades presentes, ya validadas por el contrato. No interpreta ausencia como borrado.
- El DELETE ejecuta `DELETE ... RETURNING direccion_id`; cero filas produce 404.

### Privacidad
Los repositorios reciben parámetros SQL, nunca interpolan texto. Ningún logger recibe el cuerpo, texto, alias, coordenadas ni `Idempotency-Key`. Los tests usan direcciones ficticias.

## Pruebas
- Unitarias: mapeo con/sin alias y coordenadas, orden estable, propiedad y armado de cambios solo con campos presentes.
- HTTP: cinco operaciones; roles CLIENTE/OPERADOR/SERVICIO; 201/200/204/400/403/404/422; Location; filtro y paginación; PATCH mínimo; DELETE sin cuerpo; problem+json.
- Integración: FK a cliente, checks de coordenadas, CRUD, aislamiento entre clientes, filtros/totales, orden, idempotencia repetida y concurrente.
- Contrato: las cinco operaciones dejan de figurar pendientes y pasan Schemathesis.

## Trazabilidad

| Requisito | Cobertura |
|---|---|
| RF-2.2, RF-2.2.1, RF-2.2.2, RF-2.2.3, RF-2.2.4, RF-2.2.5 | Tabla, repositorio, servicio, manejadores y pruebas |
| RNF-03.1 | Registro por OpenAPI y pruebas HTTP/contrato |
| RNF-05.1 | Copia local, migración y ausencia de integración con M4 |
| RNF-07.1 | Unitarias, HTTP, integración y contrato |
| RNF-08.1 | Idempotencia transaccional y concurrencia |
| RNF-19.1 | Parametrización y pruebas de logs sin ubicaciones |
| RNF-20.1 | Guía por tarea y visión general al validar |

## Decisiones
- Se reutiliza la idempotencia de #4; no se crea un segundo mecanismo.
- Coordenadas se guardan en dos columnas numéricas con un check conjunto, suficiente para la API sin introducir PostGIS.
- No se agrega dependencia ni ADR.

## Dudas abiertas
Ninguna.
