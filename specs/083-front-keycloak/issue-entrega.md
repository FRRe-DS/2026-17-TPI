# Texto para issue: Spec: entrega y validación integral del frontend de M2

## Requisitos de la cátedra

RNF-07 (pruebas), RNF-15 (cliente responsivo y estados), RNF-04 (imágenes reproducibles), RNF-19 (privacidad), RNF-20 (documentación). Etapa TP3.

## Qué se quiere y por qué

Cerrar la entrega del frontend después de la sesión de #83 y del nuevo issue de interfaz. Este trabajo comprueba el producto rediseñado de punta a punta y deja evidencia visual y documentación de uso y ejecución. No posterga la infraestructura que #83 necesita para probar el login.

## Alcance

1. Recorrido completo con Keycloak real, M2 jwks y M6 simulado precargado: login, primer perfil, edición, direcciones, preferencias, historial, calificación, estado, operador y logout.
2. Regresión de desarrollo: evaluación y demostraciones existentes en su proceso HS256, sin activarlas desde la app real.
3. Regresión del doble rol y de sesión vencida sobre las pantallas ya rediseñadas; no volver a implementar su protocolo o fixtures.
4. Revisión agrupada en 360, 768, 1280 y 1440, claro y oscuro, teclado y foco, axe, contraste, textos máximos y todos los estados. Conservar capturas válidas de los tamaños revisados y corregir hallazgos materiales.
5. Documentar el sistema visual efectivamente implementado en PRODUCT.md, DESIGN.md, sidecar y brief, y completar README, guía de uso y guía de implementación.
6. Ejecutar y registrar las puertas completas de build, lint, unitarias, integración, navegador, contrato y spec-check. Documentar límites reales sin atribuirse pruebas no ejecutadas.

## Tareas trasladadas del PR #118

- Antigua T34: recorrido completo de cliente; la prueba acotada de login permanece en #83.
- Antigua T35: regresión de doble rol, operador y reingreso sobre el rediseño; identidad y fixture ya se prueban en #83.
- T36 y T38: revisión visual y documentación del sistema final.
- Parte final de T37 y T39: documentación del producto y validación del conjunto; #83 conserva documentación y validación de su sesión.

## Criterios de finalización

- Recorridos completos pasan con datos reproducibles para cliente1/cliente2 y usuario doble rol, sin tocar controles de desarrollo para preparar la app real.
- Imágenes y comandos finales verificados; no se publica base ni control M6 en el entorno real.
- Evidencia visual y accesibilidad de ambas apariencias y tamaños; sin formularios o datos ficticios presentados como respuestas de API.
- Guía reproducible de acceso, tareas de cliente y operador, evaluación separada y fallas recuperables.
- Checks obligatorios en verde, sin desactivarlos ni marcar como aprobada una ejecución bloqueada.

## Dependencias

#83 y el issue de nueva interfaz, cuyo número se incorpora después de crearlo. Las antiguas T31 (compose real) y T33 (entorno navegador con Keycloak) NO pertenecen aquí: son parte de sesión para que #83 se valide de forma independiente.

## Fuera de alcance

Implementar OIDC, diseñar otra identidad, agregar funcionalidades de otros módulos, integrar la imagen real de M6, publicar en producción, cambiar contrato o esquema y abrir permisos de evaluación en la app real.

## Responsable y coordinación

Responsable propuesto: @DrazenPavicich. División solicitada en https://github.com/FRRe-DS/2026-17-TPI/pull/118#issuecomment-7115292956. Crear spec y rama propias cuando exista el número del issue; enlazar con #83 y el issue de interfaz.
