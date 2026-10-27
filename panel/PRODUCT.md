# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Pesan lo mismo dos públicos (decisión de Lautaro, 2026-10-27):

- **Cliente de prueba**: entra al panel como un cliente de la plataforma de movilidad urbana del TPI y gestiona su perfil, sus direcciones frecuentes, sus preferencias, su historial de viajes, sus calificaciones al conductor y su estado de cuenta.
- **Evaluador o integrante del grupo** (la cátedra en la demo): recorre todo lo anterior, cambia de rol (OPERADOR, SERVICIO, CONDUCTOR), cambia lo que responde el M6 simulado y mira cada pedido y respuesta para encontrarlos en los logs de M2.

Otros roles que usa la misma persona: OPERADOR (busca un cliente, bloquea y levanta bloqueos) y SERVICIO (otro módulo que consulta el estado de cuenta).

## Product Purpose

«M2 · Clientes» es la interfaz web del módulo M2 (clientes) del TPI Desarrollo de Software 2026, Grupo 17. Hoy M2 solo se usa con `curl` y tokens firmados a mano; el panel deja usar sus 20 operaciones desde pantallas, con estados claros de espera, confirmación, rechazo, error y recuperación (RNF-15). Éxito: que un cliente complete cada tarea sin ayuda y que quien evalúa entienda en segundos qué hizo M2 y por qué.

## Positioning

Una sola app que es a la vez la del cliente y la del evaluador: cada acción del cliente se puede abrir en su detalle técnico (pedido, respuesta, `X-Request-Id`, `curl` equivalente), y lo que todavía no existe (M1, M6) funciona igual contra fuentes simuladas, marcadas como tales.

## Operating Context

- Herramienta local de desarrollo y demostración: corre en `localhost:8083` (contenedor de compose o proceso en la máquina), nunca en la nube.
- Se usa en notebook durante las clases y la demo (1280 px) y en el teléfono para probar la parte de cliente (360 px).
- Se lee junto a la terminal y los logs de M2: el `X-Request-Id` es el puente entre las dos.
- Tiene que verse bien en modo claro y oscuro.

## Capabilities and Constraints

- Doce pantallas: ingresar, perfil, direcciones, preferencias, historial, calificar, calificaciones, estado de cuenta, operador, otro módulo, detalle técnico y M6 simulado.
- Inicio de sesión simulado (pendiente de M1) y viajes del M6 simulado (pendiente de M6), con la etiqueta «simulado, pendiente de M1 / M6» visible.
- Política de seguridad estricta: sin estilos en línea, sin `data:`, sin recursos de terceros (fuentes, imágenes, scripts); todo sale del propio panel.
- CSS propio (variables globales y CSS Modules), sin Tailwind ni librerías de componentes.
- Textos en español; con los valores máximos del contrato (nombre de 100, dirección de 255, comentario de 500) el diseño no se rompe.

## Brand Commitments

- Nombre en el encabezado: **M2 · Clientes**.
- Pedido de Lautaro (2026-10-27): **profesional en lo estético y en lo funcional**, con **marrones y beige** como base de las páginas.

## Evidence on Hand

Sin logos, imágenes ni testimonios: no se inventan. Los datos que se muestran son los de M2 y los del M6 simulado.

## Product Principles

1. Lo que hace M2 se ve tal cual: códigos, errores `problem+json` y respuestas, sin maquillarlos.
2. Lo simulado se dice siempre; nunca se presenta como real.
3. Cada acción tiene su estado visible: espera, éxito, error y cómo seguir.
4. Las mismas pantallas sirven al cliente y a quien evalúa; lo técnico está a un clic, no en el medio.

## Accessibility & Inclusion

Contraste de texto 4,5:1 en claro y oscuro, foco visible, uso completo con teclado, cada error asociado a su campo, `prefers-reduced-motion` y controles de 44×44 px, de 360 a 1440 px (RNF-15.1, RNF-15.3).
