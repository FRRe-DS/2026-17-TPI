# Constitución — M2 Clientes · Grupo 17

1. **Contrato primero.** `contrato/openapi.yml` manda: nada se expone fuera de él, y lo que está en él tiene test al cerrar su spec.
2. **Datos propios.** Solo la base de este módulo; lo de otros módulos, por su API (RNF-05).
3. **La spec manda.** Cada RF de la cátedra se rastrea: RF → spec → test. Lo que no está en una spec aprobada no se implementa.
4. **Tests como puerta.** Unitarias e integración con base real en contenedor por tarea; contrato en CI. Nada se mergea en rojo (RNF-07).
5. **Sin duplicados ni bloqueos.** Restricciones en la base e idempotencia para lo que no puede repetirse; timeout y respuesta explícita en toda llamada externa (RNF-08, RNF-09, RNF-13).
6. **Configuración y privacidad.** Configuración y secretos por entorno; nada sensible en repo, logs ni URLs (RNF-06, RNF-19).
7. **Idioma.** Dominio en español en código, API y mensajes de error (`/api/v1/clientes`, `crearCliente`), salvo que el contrato acordado con el Grupo 1 diga otra cosa; términos técnicos del framework en inglés; documentación en español.
