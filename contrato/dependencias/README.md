# Contratos de dependencias

Contratos de los módulos que M2 consume, para generar sus mocks (Prism, en `docker-compose.yml`).

| Módulo | Grupo en el consorcio | Estado (2026-10-20) | Qué usa M2 | Archivo |
|---|---|---|---|---|
| M1 Identidad | Sin grupo: lo hacen todos o se acuerda en el consorcio (#9) | Propuesta borrador (ADR 009) | Validar el token y los roles (el `sub` se vincula según spec #4), JWKS futuro | `m1.yml` |
| M6 Viajes | Grupo 12 (contrato compartido con el Grupo 5) | El de la cátedra solo tiene `info` | Historial por cliente (RF-2.4); viaje completado y pasajero (RF-2.5) | — |

Mientras esos grupos no publiquen su contrato, el responsable de contrato escribe aquí la parte que M2 necesita (contrato desde el consumidor, issue #2) y se la propone. Cada archivo (`m1.yml`, `m6.yml`) indica en `info.description` de dónde sale. Solo se modifica en una rama `contrato/`.
