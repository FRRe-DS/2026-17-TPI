# Título del PR

Spec 083: sesión real del frontend con Keycloak

# Descripción para GitHub

## Tipo
- [x] Spec: specs/083-front-keycloak/ y su ADR.

Relacionado con #83. Responsable: @DrazenPavicich — Drazen Pavicich.

## Resumen

Define sesión OIDC en servidor para usar las pantallas existentes con M2 en jwks. La revisión divide el alcance en sesión, nueva interfaz y entrega integral: #83 conserva compose y entorno Chrome necesarios para probar el login.

## Correcciones de revisión

- CSP por modo: form-action permite self y el origen público exacto de Keycloak en modo real; prueba Chrome recorre el POST y 303 sin violaciones.
- M6_CLIENTES_PRECARGA carga viajes deterministas para cliente1/cliente2 antes de abrir la API, sin usar herramientas de desarrollo.
- Usuario cliente-operador1 en el realm para probar ambos espacios con una identidad real.
- bd-puente se mueve al perfil exclusivo panel-bd y se verifican configuración y puertos efectivos.
- Decisiones explicitan que evaluación separada reemplaza la app única de la 071; se conservan los IDs 83.x.
- #83 queda con 27 tareas. El resto está conservado en issue-interfaz.md e issue-entrega.md para crear los dos issues solicitados.
- Se retiraron frases de borrador y contexto de conversación de los documentos principales.

## Pendientes antes del merge

- [ ] Crear y enlazar el issue de interfaz y el de entrega; sus textos completos están en la carpeta de la spec. No se crearon desde el complemento porque GitHub devolvió 403.
- [ ] Adjuntar la maqueta original al PR o al repositorio y reemplazar la referencia de maqueta.md por un enlace accesible al grupo. El enlace de ChatGPT requiere la cuenta propietaria.

## Validación

- [x] Spec, plan, tareas y ADR coherentes con el alcance de sesión.
- [x] spec-check en verde; permanece el aviso de cantidad de tareas.
- [x] git diff --check sin errores.
- [x] Sin cambios en código de aplicación, contrato ni migraciones.
- npm test no llegó a Vitest: pretest falla por openapi-typescript no instalado localmente. Las pruebas de implementación no se presentan como ejecutadas.

## Herramienta

Codex, con decisiones confirmadas por Drazen Pavicich y ajustes solicitados por @sandobaitt en el comentario de revisión del PR #118.
