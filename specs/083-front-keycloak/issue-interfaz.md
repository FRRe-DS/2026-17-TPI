# Texto para issue: Spec: nueva interfaz de cliente, operador y evaluación de M2

## Requisitos de la cátedra

RF-2.1 a RF-2.6, RNF-15 (interfaz responsiva y estados), RNF-19 (privacidad), RNF-20 (documentación junto a versión). Etapa TP3.

## Qué se quiere y por qué

Rediseñar el frontend de M2 con la dirección bordó y marfil confirmada por DRAZEN y @sandobaitt en el PR #118, sin mezclar el trabajo con la conexión OIDC de #83. La app principal prioriza cliente y operador; evaluación conserva su funcionalidad en un espacio y proceso de desarrollo separados.

## Alcance

1. Sistema visual bordó y marfil, ambos temas, tipografía y recursos locales, CSS Modules y componentes reutilizables.
2. Marco, navegación de escritorio y móvil, encabezado y selector de espacio heredado de #83.
3. Inicio con perfil, estado y viajes cargados de forma independiente; no inventar datos ausentes del contrato.
4. Rediseñar perfil, primer perfil, direcciones, preferencias, historial, calificar, calificaciones y estado de cuenta conservando las operaciones y validaciones existentes.
5. Operador: consulta por UUID, ficha de cliente, bloqueos y acciones de crear o levantar con motivo y confirmación. No añadir búsqueda por nombre ni tabla general sin contrato.
6. Espacio visual propio de evaluación para detalle técnico, otro módulo, M6 simulado y Demostración, solo en el proceso de desarrollo. No restaurar esas rutas en modo OIDC.
7. Estados de carga, vacío, éxito, confirmación, cancelación, rechazo, error y recuperación. Advertencia al navegar con cambios; reingreso por sesión vencida ya resuelto en #83.
8. Teclado, foco, contraste 4,5:1, controles de 44 píxeles y adaptación 360–1440, con textos máximos del contrato y sin estilos inline ni recursos de terceros.

## Trazabilidad del alcance retirado de #83

Conservar al especificar los IDs ya propuestos: RF-2.1.83.4 (Inicio), RF-2.1.83.5 (perfil y cambios), RF-2.2.83.1, RF-2.3.83.1, RF-2.4.83.1 y RF-2.4.83.2, RF-2.5.83.1 a RF-2.5.83.3, RF-2.6.83.1 y RF-2.6.83.2 y RNF-15.83.1. Son reglas retiradas de la spec de sesión, no requisitos de backend nuevos. Los ID 83.x se conservan por indicación del integrador para evitar colisiones.

Corresponde a las antiguas tareas T17–T19 y T21–T30 de #83, más la advertencia general de navegación de T20. El nuevo issue recibe su propio número NNN y carpeta al crearse; no se inventa uno anticipadamente.

## Criterios de finalización

- Todas las operaciones existentes siguen disponibles según roles y scopes, con el diseño acordado y M6 simulado identificado.
- Cuenta bloqueada conserva las operaciones que el contrato admite; estado de cuenta no se convierte en saldo o pagos.
- Maqueta compartida y diferencias necesarias por campos reales documentadas; la imagen no prueba funcionalidad.
- Pruebas de lógica, integración y navegador propias del rediseño, accesibilidad y documentación del cambio verificadas.
- PRODUCT.md, DESIGN.md y el brief de superficie documentan el reemplazo del criterio anterior de app única de la 071; la separación funcional se hereda de #83.

## Dependencias

#83 (sesión, permisos, primer ingreso, usuario doble rol, compose y M6 precargado). Specs 071 y 072 para las operaciones actuales. La entrega visual integral se coordina con el segundo issue propuesto en issue-entrega.md.

## Fuera de alcance

OIDC, CSP de login, almacenamiento y renovación de tokens, realm de doble rol, precarga de viajes, perfil panel-bd y entorno Keycloak real: pertenecen a #83. Imagen M6 real, mapas, reservas, pagos, cambios de contrato, dependencias y esquema nuevos no autorizados.

## Responsable y coordinación

Responsable propuesto: @DrazenPavicich. La división fue pedida por @sandobaitt en https://github.com/FRRe-DS/2026-17-TPI/pull/118#issuecomment-7115292956. Al publicar, enlazar este issue desde #83 y el PR #118; su spec nace en su propia rama.
