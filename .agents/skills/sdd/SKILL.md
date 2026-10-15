---
name: sdd
description: Reglas y plantillas de Spec-Driven Development de este repositorio. Úsala siempre que redactes, revises o cambies una spec, un plan o tareas en specs/, o implementes o valides una tarea de una spec.
---

# Spec-Driven Development en este repositorio

## Flujo y puertas
Issue → rama `spec/NNN-slug` → spec → clarificación → plan → tareas → PR de spec → **aprobación del integrador (merge)** → rama `impl/NNN-slug` → T1, T2… → validación → PR de implementación → **aprobación del integrador (merge)**.

- NNN = número del issue de GitHub, con tres dígitos. Carpeta: `specs/NNN-slug/`.
- La aprobación es el merge del PR. Nunca pases al código sin que el PR de spec esté mergeado en `main`.
- El contrato (`contrato/openapi.yml`) manda sobre la spec. Si la spec necesita algo que el contrato no tiene, para: es un cambio de contrato (skill `contrato-cambio`).
- La spec manda sobre el código. Un cambio de requisitos ya mergeado va por `sdd-change`, en una rama `spec/`.
- Si falta una decisión: `[NECESITA ACLARACIÓN]` y pregunta. No la resuelvas por tu cuenta.
- `node scripts/spec-check.mjs` valida la estructura; CI corre lo mismo. Córrelo antes de cada PR.

## Plantilla de spec (spec.md)
```
# Spec NNN — <Nombre>

Estado: borrador
Issue: #N
Etapa: TP1
Responsable: @<usuario>

## Contexto y objetivo
## Usuarios
## Historias de usuario
- HU-1. Como <rol>, quiero <acción> para <beneficio>.
## Requisitos funcionales
- RF-2.<n>: <en EARS>
## Requisitos no funcionales
- RNF-xx: <en EARS, cómo aplica en esta spec>
## Contrato y dependencias
- Operaciones del contrato que cubre: <método ruta (operationId)>
- Operaciones de otros módulos que consume: <módulo, operación, qué pasa si no responde>
## Casos límite
## Fuera de alcance
## Criterios de finalización
## Dudas abiertas
- [NECESITA ACLARACIÓN] <duda>
```
- `Estado`: `borrador` mientras se redacta; `aprobada` en el PR de spec (queda aprobada al mergear); `implementada` al validar.
- Solo QUÉ y POR QUÉ: nada de clases, tablas ni librerías.
- Requisitos funcionales o no funcionales pueden quedar vacíos, pero no los dos.

## Requisitos
- ID de la cátedra: RF-2.n del módulo y RNF-xx transversales. Reglas propias: ID derivado del RF que precisan (RF-2.5.1). Nunca ID locales.
- En EARS, uno por línea, con este formato exacto:
  - `- RF-x.y: CUANDO <evento>, EL SISTEMA <respuesta>.`
  - `- RF-x.y: SI <condición no deseada>, ENTONCES EL SISTEMA <respuesta>.`
  - `- RF-x.y: MIENTRAS <estado>, EL SISTEMA <respuesta>.`
  - `- RF-x.y: EL SISTEMA <comportamiento permanente>.`
- Verificables: códigos HTTP, campos, límites y el `type` del problem+json de cada error que importa. Nada de "rápido" o "intuitivo" sin una medida.

## Plan (plan.md)
- Contrato: operationIds que se implementan y dónde.
- Datos: tablas, columnas, índices, restricciones (las que garantizan RNF-08) y migraciones.
- Lógica: funciones puras y algoritmo en pseudocódigo.
- Integraciones: cliente de cada módulo, timeout, reintentos y respuesta si falla (RNF-13).
- Decisiones con su alternativa descartada; si afectan al grupo, ADR en `docs/adr/NNN-slug.md`.
- Pruebas: unitarias, integración con base real en contenedor y contrato.
- Cada requisito de la spec (RF y RNF) aparece en el plan, indicando qué parte lo cubre.

## Tareas (tasks.md)
```
- [ ] **Tn. <Descripción>.** RF-x.y, RNF-zz
  - Hecho cuando: <comprobación verificable>.
```
20-30 minutos cada una, en orden de dependencia, numeradas desde T1. Cada requisito cubierto por al menos una tarea. Más de 10: propone dividir la spec en otro issue.

## Implementación
Una tarea por vez: tests primero (en rojo), código, tests en verde, entrada de guía, tarea marcada, commit `NNN/Tn: <descripción>`. Después para.

## Guía (guia.md)
Un mapa para que otra persona del grupo entienda lo hecho leyendo el código. Apunta a archivos, funciones, requisitos y commits; explica el porqué. Nunca copies código.
```
# Guía — Spec NNN <Nombre>

## Visión general (se escribe al validar, 30-60 líneas)
- Qué se construyó y para qué, en 2-3 frases sin jerga.
- Recorrido: una petición HTTP paso a paso por el sistema (archivo:función).
- Mapa: archivo → responsabilidad → requisito.
- Decisiones clave y alternativa descartada (remite a plan.md o al ADR).
- Conceptos que conviene entender: patrones, librerías, términos de dominio.
- Cómo probarlo uno mismo: comando, URL y ejemplo con curl.
- Preguntas de comprobación (3-5) para quien lo estudie.

## Tareas
### Tn — <descripción> · commit `NNN/Tn`
- Qué cambió: <archivo:función — qué hace ahora>.
- Por qué así: <decisión, requisito>.
- Cómo se conecta: <con qué parte existente y en qué punto>.
- Tests: <archivo — qué comprueba>.
- Para mirar con atención: <lo no obvio, riesgos, deuda>.
```
