# ADR 133 — Telemetría OTLP directa hacia Grafana Cloud

Fecha: 2026-11-28 · Estado: propuesta
Issue: #133

## Contexto
M2 necesita métricas y trazas sin exigir infraestructura de monitoreo local ni credenciales en el repositorio. Grafana Cloud es una dependencia externa opcional; el servicio debe funcionar sin ella.

## Decisión
Exportar métricas y trazas por OTLP/HTTP directamente desde M2 al endpoint configurado por entorno. El SDK queda desactivado si falta el endpoint. Seleccionar las instrumentaciones necesarias y filtrar los atributos antes de exportar.

## Alternativas descartadas
- Collector local: agrega un componente que mantener; podría evaluarse más adelante si se necesita desacoplar, transformar o enrutar telemetría.
- Prometheus y Grafana locales: agregan servicios y configuración que duplican la plataforma de observabilidad elegida.
- Auto-instrumentación completa: habilita componentes innecesarios y aumenta la superficie que debe verificarse para privacidad y compatibilidad.

## Consecuencias
- La exportación directa depende de la red y del destino, sin garantías de entrega durante caídas; no debe afectar las respuestas de M2.
- La configuración requiere un endpoint y, cuando corresponda, credenciales externas. No se agregan servicios locales de monitoreo ni se exponen puertos nuevos.
- La privacidad y compatibilidad de cada instrumentación se verifican antes de habilitarla. La definición de CPU y memoria de infraestructura depende del despliegue.
