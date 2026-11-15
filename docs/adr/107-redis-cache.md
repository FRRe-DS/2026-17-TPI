# ADR 107 — Redis para la caché del estado de cuenta

Fecha: 2026-11-14 · Estado: propuesta
Issue: #107

## Contexto
RNF-11 pide que el estado efímero, con TTL e invalidación, lo administre Redis o una alternativa aprobada. M5 y M9 consultan `obtenerEstadoCuenta` en cada operación, y hoy cada consulta calcula los bloqueos vigentes en PostgreSQL. La base sigue siendo la fuente de verdad (RNF-05).

## Decisión
- Redis guarda una copia de la respuesta `EstadoCuenta` por cliente, con un TTL corto (60 s por defecto) y acotado por el primer `hasta` de los bloqueos vigentes.
- La invalidación sube un contador de versión por cliente en el alta y el levantamiento de bloqueos; la copia va en una clave que incluye esa versión.
- Redis es opcional: sin `M2_URL_REDIS`, o con Redis caído, M2 responde desde su base.
- Redis corre en el `docker-compose` por defecto, con una imagen de versión fija.
- Cliente: el paquete oficial `redis` (node-redis), con su versión exacta en `package.json`.

## Alternativas descartadas
- **Borrar la copia (`DEL`) al invalidar:** un lector lento puede volver a guardar una copia vieja después del borrado.
- **Transacciones `WATCH`/`MULTI` o scripts Lua:** más piezas para el mismo resultado que da la versión en la clave.
- **Caché en memoria del proceso:** no cumple RNF-11 y no sirve si M2 tiene más de una réplica.
- **`ioredis`:** también sirve; se prefiere el cliente oficial.
- **Cachear también perfil, historial o calificaciones:** más superficie para invalidar sin un consumidor que lo pida.

## Consecuencias
- M2 gana una dependencia opcional de infraestructura y una de npm.
- Una invalidación que falla deja una copia vieja hasta su TTL; para acortarlo, M2 deja de servir copias de ese cliente mientras no pueda invalidar.
- Con más de un proceso de M2, la marca de invalidación pendiente debería vivir en Redis; hoy está en memoria.
