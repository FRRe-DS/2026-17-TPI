import type { Rol } from '../rutas.js';
import type { OPERACIONES } from '../api/m2.js';

// El catálogo de casos de la vista «Demostración» (spec 072, plan «Lógica», RNF-07.3, RNF-07.4): lo que recorre `docs/probar-m2.md`
// y el script `scripts/demo.mjs`, escrito como datos. Es una lista y no una función por caso para poder comprobarla entera contra
// `contrato/openapi.yml` sin ejecutar nada (`casos.test.ts`) y para que agregar un caso sea agregar un objeto. Ejecutar un caso
// (T11) recorre sus pasos: cada uno prepara lo suyo, así que ninguno depende del orden ni de otro caso.

export type IdDeArea = 'perfil' | 'direcciones' | 'preferencias' | 'historial' | 'calificacion' | 'estado-cuenta' | 'seguridad' | 'resiliencia';

// En el orden de las filas de la tabla de `docs/probar-m2.md`.
export const AREAS: readonly { id: IdDeArea; titulo: string }[] = [
  { id: 'perfil', titulo: 'Perfil (RF-2.1)' },
  { id: 'direcciones', titulo: 'Direcciones frecuentes (RF-2.2)' },
  { id: 'preferencias', titulo: 'Preferencias (RF-2.3)' },
  { id: 'historial', titulo: 'Historial de viajes (RF-2.4)' },
  { id: 'calificacion', titulo: 'Calificación del conductor (RF-2.5)' },
  { id: 'estado-cuenta', titulo: 'Estado de cuenta y bloqueos (RF-2.6)' },
  { id: 'seguridad', titulo: 'Seguridad y errores (RNF-03)' },
  { id: 'resiliencia', titulo: 'Resiliencia con el M6 caído (RNF-13)' },
];

// Quién hace el pedido: el `sub` del token es el cliente del caso (`cliente`), otro cliente (`otro-cliente`), un módulo que
// consulta el estado de cuenta (`m5-despacho`) o una persona de soporte (`operador`). El ejecutor les da un UUID a cada uno.
export const IDENTIDADES = ['cliente', 'otro-cliente', 'm5-despacho', 'operador'] as const;
export type SubDelPaso = (typeof IDENTIDADES)[number];
export type IdentidadDelPaso = { rol: Rol; sub: SubDelPaso };

// Las variables que el ejecutor define antes del primer paso: el cliente del caso y otro cliente cualquiera.
export const VARIABLES_DEL_EJECUTOR = ['clienteId', 'otroCliente'] as const;

export type MetodoDelPaso = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

// Un pedido. `ruta` es la de M2 (`/api/v1/…`) o la del canal de control del M6 simulado (`/panel/m6/…`), con `{variable}` donde va
// una variable; el cuerpo puede llevarlas en sus textos. `identidad: null` es un pedido sin token.
//   clave:   la Idempotency-Key de un POST: `nueva` genera una, `la-anterior` repite la del último paso con clave del caso.
//   guardar: de la respuesta, variable → camino. Un camino son campos separados por punto; si el valor es una lista, `campo:valor`
//            elige el elemento cuyo `campo` vale `valor` (`escenarios.nombre:completado.viajeId`).
export type Paso = {
  metodo: MetodoDelPaso;
  ruta: string;
  identidad: IdentidadDelPaso | null;
  clave?: 'nueva' | 'la-anterior';
  cuerpo?: unknown;
  guardar?: Record<string, string>;
};

// Qué tiene que pasar para dar ✔. El código siempre; lo demás, cuando el caso lo pide. Un error (4xx o 5xx) además tiene que ser
// `application/problem+json` (RNF-03.6): eso lo comprueba el ejecutor en todos.
export type Esperado = { estado: number; type?: string; conRetryAfter?: boolean; conLocation?: boolean };

export type Caso = {
  id: string;
  area: IdDeArea;
  titulo: string;
  // El operationId del contrato de lo que se prueba (`prueba`).
  operacion: keyof typeof OPERACIONES;
  preparar: Paso[];
  prueba: Paso;
  esperado: Esperado;
};

const CLIENTE: IdentidadDelPaso = { rol: 'CLIENTE', sub: 'cliente' };
const OPERADOR: IdentidadDelPaso = { rol: 'OPERADOR', sub: 'operador' };
const SERVICIO: IdentidadDelPaso = { rol: 'SERVICIO', sub: 'm5-despacho' };
const CONDUCTOR: IdentidadDelPaso = { rol: 'CONDUCTOR', sub: 'otro-cliente' };

const PERFIL = { nombre: 'Ana', apellido: 'Gómez', telefono: '+5493624000000', fechaNacimiento: '1990-05-17' };
const DIRECCION = { tipo: 'FAVORITA', alias: 'Casa', texto: 'Av. Sarmiento 1500, Resistencia', coordenadas: { latitud: -27.45, longitud: -58.98 } };
const PREFERENCIAS = { tiposVehiculo: ['AUTO'], canales: ['EMAIL', 'PUSH'], accesibilidad: ['ASISTENCIA_VISUAL'] };
const CALIFICACION = { viajeId: '{viaje.completado}', puntaje: 5, comentario: 'Muy amable' };

const PERFILES = '/api/v1/clientes';
const MI_PERFIL = '/api/v1/clientes/{clienteId}';
const DIRECCIONES = `${MI_PERFIL}/direcciones`;
const PREFERENCIAS_RUTA = `${MI_PERFIL}/preferencias`;
const CALIFICACIONES = `${MI_PERFIL}/calificaciones`;
const BLOQUEOS = `${MI_PERFIL}/bloqueos`;

// Los pasos de preparación que se repiten.
const crearPerfil: Paso = { metodo: 'POST', ruta: PERFILES, identidad: CLIENTE, clave: 'nueva', cuerpo: PERFIL };
const crearDireccion: Paso = { metodo: 'POST', ruta: DIRECCIONES, identidad: CLIENTE, clave: 'nueva', cuerpo: DIRECCION, guardar: { direccionId: 'direccionId' } };
// Carga los viajes del cliente en el M6 simulado y guarda el id de cada escenario (completado, en curso, ajeno, inexistente).
const cargarViajes: Paso = {
  metodo: 'POST',
  ruta: '/panel/m6/clientes/{clienteId}/ejemplo',
  identidad: null,
  guardar: {
    'viaje.completado': 'escenarios.nombre:completado.viajeId',
    'viaje.enCurso': 'escenarios.nombre:enCurso.viajeId',
    'viaje.ajeno': 'escenarios.nombre:ajeno.viajeId',
    'viaje.inexistente': 'escenarios.nombre:inexistente.viajeId',
  },
};
const calificar: Paso = { metodo: 'POST', ruta: CALIFICACIONES, identidad: CLIENTE, clave: 'nueva', cuerpo: CALIFICACION };
const bloquear: Paso = {
  metodo: 'POST',
  ruta: BLOQUEOS,
  identidad: OPERADOR,
  clave: 'nueva',
  cuerpo: { motivo: 'Deuda pendiente' },
  guardar: { bloqueoId: 'bloqueoId' },
};
const levantar: Paso = { metodo: 'PATCH', ruta: `${BLOQUEOS}/{bloqueoId}`, identidad: OPERADOR, cuerpo: { motivo: 'Pagó la deuda' } };

// Calificar un viaje: la prueba de varios casos cambia el viaje, el cuerpo o la clave.
const calificarViaje = (viaje: string, extra: Partial<Paso> = {}, puntaje = 4): Paso => ({
  metodo: 'POST',
  ruta: CALIFICACIONES,
  identidad: CLIENTE,
  clave: 'nueva',
  cuerpo: { viajeId: `{viaje.${viaje}}`, puntaje },
  ...extra,
});

export const CASOS: readonly Caso[] = [
  // --- Perfil (RF-2.1)
  {
    id: 'perfil-crear',
    area: 'perfil',
    titulo: 'Crear el perfil: 201 con Location',
    operacion: 'crearCliente',
    preparar: [],
    prueba: crearPerfil,
    esperado: { estado: 201, conLocation: true },
  },
  {
    id: 'perfil-repetir',
    area: 'perfil',
    titulo: 'Repetir la solicitud (misma clave y cuerpo): el mismo 201, sin duplicar',
    operacion: 'crearCliente',
    preparar: [crearPerfil],
    prueba: { ...crearPerfil, clave: 'la-anterior' },
    esperado: { estado: 201, conLocation: true },
  },
  {
    id: 'perfil-segundo',
    area: 'perfil',
    titulo: 'Crear otro perfil para el mismo cliente (otra clave): 409',
    operacion: 'crearCliente',
    preparar: [crearPerfil],
    prueba: crearPerfil,
    esperado: { estado: 409, type: '/errores/perfil-ya-existe' },
  },
  {
    id: 'perfil-invalido',
    area: 'perfil',
    titulo: 'Crear sin teléfono: 400',
    operacion: 'crearCliente',
    preparar: [],
    prueba: { ...crearPerfil, cuerpo: { nombre: 'Ana', apellido: 'Gómez' } },
    esperado: { estado: 400 },
  },
  {
    id: 'perfil-consultar',
    area: 'perfil',
    titulo: 'Consultar el perfil propio: 200',
    operacion: 'obtenerCliente',
    preparar: [crearPerfil],
    prueba: { metodo: 'GET', ruta: MI_PERFIL, identidad: CLIENTE },
    esperado: { estado: 200 },
  },
  {
    id: 'perfil-actualizar',
    area: 'perfil',
    titulo: 'Actualizar solo el nombre: 200',
    operacion: 'actualizarCliente',
    preparar: [crearPerfil],
    prueba: { metodo: 'PATCH', ruta: MI_PERFIL, identidad: CLIENTE, cuerpo: { nombre: 'Ana María' } },
    esperado: { estado: 200 },
  },

  // --- Direcciones frecuentes (RF-2.2)
  {
    id: 'direcciones-crear',
    area: 'direcciones',
    titulo: 'Registrar una dirección favorita: 201',
    operacion: 'crearDireccion',
    preparar: [crearPerfil],
    prueba: crearDireccion,
    esperado: { estado: 201, conLocation: true },
  },
  {
    id: 'direcciones-listar',
    area: 'direcciones',
    titulo: 'Listar las direcciones: 200',
    operacion: 'listarDirecciones',
    preparar: [crearPerfil, crearDireccion],
    prueba: { metodo: 'GET', ruta: DIRECCIONES, identidad: CLIENTE },
    esperado: { estado: 200 },
  },
  {
    id: 'direcciones-consultar',
    area: 'direcciones',
    titulo: 'Consultar una dirección: 200',
    operacion: 'obtenerDireccion',
    preparar: [crearPerfil, crearDireccion],
    prueba: { metodo: 'GET', ruta: `${DIRECCIONES}/{direccionId}`, identidad: CLIENTE },
    esperado: { estado: 200 },
  },
  {
    id: 'direcciones-actualizar',
    area: 'direcciones',
    titulo: 'Cambiar el alias: 200',
    operacion: 'actualizarDireccion',
    preparar: [crearPerfil, crearDireccion],
    prueba: { metodo: 'PATCH', ruta: `${DIRECCIONES}/{direccionId}`, identidad: CLIENTE, cuerpo: { alias: 'Trabajo' } },
    esperado: { estado: 200 },
  },
  {
    id: 'direcciones-eliminar',
    area: 'direcciones',
    titulo: 'Eliminar una dirección: 204',
    operacion: 'eliminarDireccion',
    preparar: [crearPerfil, crearDireccion],
    prueba: { metodo: 'DELETE', ruta: `${DIRECCIONES}/{direccionId}`, identidad: CLIENTE },
    esperado: { estado: 204 },
  },
  {
    id: 'direcciones-eliminada',
    area: 'direcciones',
    titulo: 'Consultar la dirección eliminada: 404',
    operacion: 'obtenerDireccion',
    preparar: [crearPerfil, crearDireccion, { metodo: 'DELETE', ruta: `${DIRECCIONES}/{direccionId}`, identidad: CLIENTE }],
    prueba: { metodo: 'GET', ruta: `${DIRECCIONES}/{direccionId}`, identidad: CLIENTE },
    esperado: { estado: 404 },
  },
  {
    id: 'direcciones-tipo-invalido',
    area: 'direcciones',
    titulo: 'Una dirección con tipo inválido: 400',
    operacion: 'crearDireccion',
    preparar: [crearPerfil],
    prueba: { ...crearDireccion, cuerpo: { tipo: 'OTRA', texto: 'x' } },
    esperado: { estado: 400 },
  },

  // --- Preferencias (RF-2.3)
  {
    id: 'preferencias-vacias',
    area: 'preferencias',
    titulo: 'Antes de guardar nada: 200 con las preferencias vacías',
    operacion: 'obtenerPreferencias',
    preparar: [crearPerfil],
    prueba: { metodo: 'GET', ruta: PREFERENCIAS_RUTA, identidad: CLIENTE },
    esperado: { estado: 200 },
  },
  {
    id: 'preferencias-guardar',
    area: 'preferencias',
    titulo: 'Guardar tipo de vehículo, canales y accesibilidad: 200',
    operacion: 'guardarPreferencias',
    preparar: [crearPerfil],
    prueba: { metodo: 'PUT', ruta: PREFERENCIAS_RUTA, identidad: CLIENTE, cuerpo: PREFERENCIAS },
    esperado: { estado: 200 },
  },
  {
    id: 'preferencias-leer',
    area: 'preferencias',
    titulo: 'Volver a leerlas: 200',
    operacion: 'obtenerPreferencias',
    preparar: [crearPerfil, { metodo: 'PUT', ruta: PREFERENCIAS_RUTA, identidad: CLIENTE, cuerpo: PREFERENCIAS }],
    prueba: { metodo: 'GET', ruta: PREFERENCIAS_RUTA, identidad: CLIENTE },
    esperado: { estado: 200 },
  },
  {
    id: 'preferencias-invalida',
    area: 'preferencias',
    titulo: 'Un tipo de vehículo que no existe: 400',
    operacion: 'guardarPreferencias',
    preparar: [crearPerfil],
    prueba: { metodo: 'PUT', ruta: PREFERENCIAS_RUTA, identidad: CLIENTE, cuerpo: { tiposVehiculo: ['BICI'], canales: [], accesibilidad: [] } },
    esperado: { estado: 400 },
  },

  // --- Historial de viajes (RF-2.4): lo arma M6
  {
    id: 'historial-viajes',
    area: 'historial',
    titulo: 'El historial resumido, leído del M6 simulado: 200',
    operacion: 'listarHistorialViajes',
    preparar: [crearPerfil, cargarViajes],
    prueba: { metodo: 'GET', ruta: `${MI_PERFIL}/viajes`, identidad: CLIENTE },
    esperado: { estado: 200 },
  },

  // --- Calificación del conductor (RF-2.5): usa M6
  {
    id: 'calificacion-completado',
    area: 'calificacion',
    titulo: 'Calificar un viaje completado: 201',
    operacion: 'calificarConductor',
    preparar: [crearPerfil, cargarViajes],
    prueba: { ...calificar, cuerpo: CALIFICACION },
    esperado: { estado: 201, conLocation: true },
  },
  {
    id: 'calificacion-repetir',
    area: 'calificacion',
    titulo: 'Repetir la solicitud (misma clave y cuerpo): el mismo 201',
    operacion: 'calificarConductor',
    preparar: [crearPerfil, cargarViajes, calificar],
    prueba: { ...calificar, clave: 'la-anterior' },
    esperado: { estado: 201, conLocation: true },
  },
  {
    id: 'calificacion-duplicada',
    area: 'calificacion',
    titulo: 'Calificar el mismo viaje con otra clave: 409, sin duplicar',
    operacion: 'calificarConductor',
    preparar: [crearPerfil, cargarViajes, calificar],
    prueba: { ...calificar, cuerpo: { viajeId: '{viaje.completado}', puntaje: 1 } },
    esperado: { estado: 409, type: '/errores/calificacion-duplicada' },
  },
  {
    id: 'calificacion-clave-reutilizada',
    area: 'calificacion',
    titulo: 'La misma clave con otro cuerpo: 422',
    operacion: 'calificarConductor',
    preparar: [crearPerfil, cargarViajes, calificar],
    prueba: { ...calificar, clave: 'la-anterior', cuerpo: { viajeId: '{viaje.completado}', puntaje: 2 } },
    esperado: { estado: 422, type: '/errores/idempotencia-reutilizada' },
  },
  {
    id: 'calificacion-en-curso',
    area: 'calificacion',
    titulo: 'Un viaje que M6 dice que sigue en curso: 422',
    operacion: 'calificarConductor',
    preparar: [crearPerfil, cargarViajes],
    prueba: calificarViaje('enCurso'),
    esperado: { estado: 422, type: '/errores/viaje-no-completado' },
  },
  {
    id: 'calificacion-ajeno',
    area: 'calificacion',
    titulo: 'Un viaje de otro cliente: 404',
    operacion: 'calificarConductor',
    preparar: [crearPerfil, cargarViajes],
    prueba: calificarViaje('ajeno'),
    esperado: { estado: 404 },
  },
  {
    id: 'calificacion-inexistente',
    area: 'calificacion',
    titulo: 'Un viaje que M6 no conoce: 404',
    operacion: 'calificarConductor',
    preparar: [crearPerfil, cargarViajes],
    prueba: calificarViaje('inexistente'),
    esperado: { estado: 404 },
  },
  {
    id: 'calificacion-puntaje-invalido',
    area: 'calificacion',
    titulo: 'Un puntaje fuera de 1 a 5: 400',
    operacion: 'calificarConductor',
    preparar: [crearPerfil, cargarViajes],
    prueba: calificarViaje('completado', {}, 9),
    esperado: { estado: 400 },
  },

  // --- Estado de cuenta y bloqueos (RF-2.6)
  {
    id: 'estado-cuenta-bloquear',
    area: 'estado-cuenta',
    titulo: 'Un OPERADOR bloquea la cuenta: 201',
    operacion: 'crearBloqueo',
    preparar: [crearPerfil],
    prueba: bloquear,
    esperado: { estado: 201, conLocation: true },
  },
  {
    id: 'estado-cuenta-consultar',
    area: 'estado-cuenta',
    titulo: 'Otro módulo (rol SERVICIO) consulta el estado, con el bloqueo vigente: 200',
    operacion: 'obtenerEstadoCuenta',
    preparar: [crearPerfil, bloquear],
    prueba: { metodo: 'GET', ruta: `${MI_PERFIL}/estado-cuenta`, identidad: SERVICIO },
    esperado: { estado: 200 },
  },
  {
    id: 'estado-cuenta-levantar',
    area: 'estado-cuenta',
    titulo: 'Levantar el bloqueo: 200',
    operacion: 'levantarBloqueo',
    preparar: [crearPerfil, bloquear],
    prueba: levantar,
    esperado: { estado: 200 },
  },
  {
    id: 'estado-cuenta-despues',
    area: 'estado-cuenta',
    titulo: 'El estado vuelve a no tener bloqueos vigentes: 200',
    operacion: 'obtenerEstadoCuenta',
    preparar: [crearPerfil, bloquear, levantar],
    prueba: { metodo: 'GET', ruta: `${MI_PERFIL}/estado-cuenta`, identidad: CLIENTE },
    esperado: { estado: 200 },
  },

  // --- Seguridad y errores (RNF-03): todo error vuelve como application/problem+json
  {
    id: 'seguridad-sin-token',
    area: 'seguridad',
    titulo: 'Sin token: 401',
    operacion: 'obtenerCliente',
    preparar: [crearPerfil],
    prueba: { metodo: 'GET', ruta: MI_PERFIL, identidad: null },
    esperado: { estado: 401 },
  },
  {
    id: 'seguridad-otro-cliente',
    area: 'seguridad',
    titulo: 'Un CLIENTE pide el perfil de otro cliente: 403',
    operacion: 'obtenerCliente',
    preparar: [crearPerfil],
    prueba: { metodo: 'GET', ruta: '/api/v1/clientes/{otroCliente}', identidad: CLIENTE },
    esperado: { estado: 403 },
  },
  {
    id: 'seguridad-rol-conductor',
    area: 'seguridad',
    titulo: 'Con el rol CONDUCTOR, que el contrato no admite acá: 403',
    operacion: 'obtenerCliente',
    preparar: [crearPerfil],
    prueba: { metodo: 'GET', ruta: MI_PERFIL, identidad: CONDUCTOR },
    esperado: { estado: 403 },
  },
  {
    id: 'seguridad-perfil-inexistente',
    area: 'seguridad',
    titulo: 'Un perfil que no existe: 404 como problem+json',
    operacion: 'obtenerCliente',
    preparar: [],
    prueba: { metodo: 'GET', ruta: MI_PERFIL, identidad: OPERADOR },
    esperado: { estado: 404 },
  },

  // --- Resiliencia (RNF-13): el ejecutor pone el M6 simulado en modo «caído» entre la preparación y la prueba
  {
    id: 'resiliencia-calificar',
    area: 'resiliencia',
    titulo: 'Calificar con el M6 caído: 503 con Retry-After',
    operacion: 'calificarConductor',
    preparar: [crearPerfil, cargarViajes],
    prueba: calificarViaje('completado'),
    esperado: { estado: 503, conRetryAfter: true },
  },
  {
    id: 'resiliencia-historial',
    area: 'resiliencia',
    titulo: 'El historial con el M6 caído: 503 con Retry-After',
    operacion: 'listarHistorialViajes',
    preparar: [crearPerfil, cargarViajes],
    prueba: { metodo: 'GET', ruta: `${MI_PERFIL}/viajes`, identidad: CLIENTE },
    esperado: { estado: 503, conRetryAfter: true },
  },
  {
    id: 'resiliencia-perfil',
    area: 'resiliencia',
    titulo: 'Lo que no depende de M6 sigue respondiendo: el perfil, 200',
    operacion: 'obtenerCliente',
    preparar: [crearPerfil],
    prueba: { metodo: 'GET', ruta: MI_PERFIL, identidad: CLIENTE },
    esperado: { estado: 200 },
  },
];
