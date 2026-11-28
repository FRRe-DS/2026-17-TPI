# Contratos de dependencias

Contratos de los módulos que M2 consume. Con ellos se valida lo que M2 manda y recibe, y lo que devuelve el M6 simulado propio (`panel/m6-simulado/`, servicio `m6` de `docker-compose.yml`, perfiles `panel` y `keycloak`). M1 lo cubre el Keycloak de desarrollo (ADR 080). Prism, que proponía el ADR 003, no se llegó a usar.

| Módulo | Grupo en el consorcio | Estado (2026-11-08) | Qué usa M2 | Archivo |
|---|---|---|---|---|
| M1 Identidad | Sin grupo: lo hacen todos o se acuerda en el consorcio (#9) | Keycloak hace de M1 (ADR 080); HS256 del ADR 009 solo en desarrollo | Validar el token con el JWKS del realm, los roles y los scopes (ADR 079); el `sub` de persona es el `clienteId` | `m1.yml` |
| M6 Viajes | Grupo 12 (contrato compartido con el Grupo 5) | Al 2026-11-10: extraído del contrato publicado en la cátedra (`contratos/m6_viajes/openapi.yml`, commit `35b3c4d`, 2026-11-01) (ADR 096, que actualiza el 057). El repositorio del Grupo 12 ya cambió `VehicleType` y documentó los alias de rol, sin subirlo todavía a la cátedra. Pendiente: `iss` y `aud` del token | Historial por cliente (RF-2.4); viaje completado, pasajero y conductor (RF-2.5) | [m6.yml](m6.yml) · [propuesta y aclaraciones](m6-propuesta.md) |

Mientras esos grupos no publiquen su contrato, el responsable de contrato escribe aquí la parte que M2 necesita (contrato desde el consumidor, issue #2) y se la propone. Cada archivo (`m1.yml`, `m6.yml`) indica en `info.description` de dónde sale. Solo se modifica en una rama `contrato/`.
