// Demostración de M2 (guía: docs/probar-m2.md): recorre cada funcionalidad contra el servicio levantado con docker compose,
// con un M6 simulado en un contenedor, y comprueba que cada respuesta sea la que dice el contrato. Imprime una línea por
// paso (✔ o ✘) y termina con error si alguno no es la esperada. Crea un cliente nuevo en cada corrida, así que se puede
// repetir sin limpiar la base. No toca src/ ni el contrato.
//   docker compose up -d --build --wait
//   node scripts/demo.mjs [--detalle] [--dejar-m6]
// --detalle: muestra además el curl equivalente de cada paso y la respuesta completa.
// --dejar-m6: no borra el M6 simulado al terminar (se borra con `docker rm -f m6-simulado`).
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const ejecutar = promisify(execFile);
const { values: opciones } = parseArgs({ options: { detalle: { type: 'boolean' }, 'dejar-m6': { type: 'boolean' } }, strict: true });

// El puerto que publica docker-compose.yml, con su mismo valor por defecto, también si la variable está vacía (`:-`).
const PUERTO = process.env.M2_PUERTO || '8082';
const SERVICIO = `http://localhost:${PUERTO}`;
const BASE = `${SERVICIO}/api/v1`;
// docker compose busca el proyecto en la raíz del repositorio, aunque el script se corra desde otro directorio.
const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const IMAGEN = 'm2-clientes:0.1.0';
const NOMBRE_M6 = 'm6-simulado';

// Los viajes del M6 simulado: lo que M6 responde depende del comienzo del id del viaje.
const VIAJE_COMPLETADO = '11111111-1111-4111-8111-111111111111';
const VIAJE_EN_CURSO = '22222222-2222-4222-8222-222222222222';
const VIAJE_AJENO = '33333333-3333-4333-8333-333333333333';
const VIAJE_INEXISTENTE = '44444444-4444-4444-8444-444444444444';
const VIAJE_PARA_M6_CAIDO = '55555555-5555-4555-8555-555555555555';
const CONDUCTOR = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const pintar = (codigo, texto) => (color ? `\u001b[${codigo}m${texto}\u001b[0m` : texto);
const verde = (t) => pintar('32', t);
const rojo = (t) => pintar('31', t);
const gris = (t) => pintar('90', t);
const negrita = (t) => pintar('1', t);

const compose = (...args) => ejecutar('docker', ['compose', ...args], { cwd: RAIZ });

// El token que firma el servicio mismo, con la clave y la audiencia que usa (README, «Generar un token»).
async function token(sub, roles) {
  const { stdout } = await compose('exec', '-T', 'm2', 'node', 'dist/herramientas/token.js', '--sub', sub, '--roles', roles);
  return stdout.trim();
}

// Un M6 que responde según el viaje: `GET /trips/{id}` (el viaje a calificar) y `GET /trips` (el historial del cliente).
const CODIGO_M6 = `
const cliente = process.env.CLIENTE;
const viaje = (id, state, clientId = cliente) => ({ id, state, clientId, driverId: '${CONDUCTOR}', createdAt: '2026-10-01T10:00:00Z' });
const error = (code, message) => ({ code, message, timestamp: new Date().toISOString() });
const responder = (res, estado, cuerpo) => { res.statusCode = estado; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(cuerpo)); };
require('http').createServer((req, res) => {
  const ruta = req.url.split('?')[0];
  if (ruta.endsWith('/trips')) {
    return responder(res, 200, { items: [viaje('${VIAJE_COMPLETADO}', 'COMPLETED'), viaje('${VIAJE_EN_CURSO}', 'IN_PROGRESS'), viaje('${VIAJE_PARA_M6_CAIDO}', 'COMPLETED')], page: 1, pageSize: 20, total: 3 });
  }
  const id = ruta.split('/').pop();
  if (id.startsWith('22222222')) return responder(res, 200, viaje(id, 'IN_PROGRESS'));
  if (id.startsWith('33333333')) return responder(res, 200, viaje(id, 'COMPLETED', '99999999-9999-4999-8999-999999999999'));
  if (id.startsWith('44444444')) return responder(res, 404, error('NOT_FOUND', 'Viaje no encontrado'));
  return responder(res, 200, viaje(id, 'COMPLETED'));
}).listen(3006);`;

async function levantarM6(clienteId) {
  await ejecutar('docker', ['rm', '-f', NOMBRE_M6]).catch(() => undefined);
  const { stdout: m2 } = await compose('ps', '-q', 'm2');
  const { stdout: redes } = await ejecutar('docker', ['inspect', '-f', '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}', m2.trim()]);
  const red = redes.trim().split(' ')[0];
  await ejecutar('docker', ['run', '--rm', '-d', '--name', NOMBRE_M6, '--network', red, '--network-alias', 'm6', '-e', `CLIENTE=${clienteId}`, IMAGEN, 'node', '-e', CODIGO_M6]);
  // Espera a que escuche: el contenedor tarda un instante en arrancar Node.
  for (let intento = 0; intento < 20; intento++) {
    try {
      await ejecutar('docker', ['exec', NOMBRE_M6, 'node', '-e', "fetch('http://127.0.0.1:3006/trips').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]);
      return;
    } catch {
      await new Promise((resolver) => setTimeout(resolver, 250));
    }
  }
  throw new Error('el M6 simulado no respondió');
}

let pasos = 0;
const fallas = [];

function seccion(titulo) {
  console.log(`\n${negrita(titulo)}`);
}

const recortar = (texto, largo = 110) => (texto.length > largo ? `${texto.slice(0, largo - 1)}…` : texto);

// El curl equivalente, con el token abreviado para que se pueda leer.
function comoCurl({ metodo, ruta, cuerpo, tokenAbreviado, clave }) {
  const partes = [`curl -s -X ${metodo} '${SERVICIO}${ruta}'`];
  if (tokenAbreviado) partes.push(`-H 'Authorization: Bearer ${tokenAbreviado}'`);
  if (clave) partes.push(`-H 'Idempotency-Key: ${clave}'`);
  if (cuerpo !== undefined) partes.push("-H 'Content-Type: application/json'", `-d '${JSON.stringify(cuerpo)}'`);
  return partes.join(' ');
}

// Un pedido y su comprobación. `esperado` es el estado HTTP; `tipo`, el `type` del problema si es un error con tipo propio;
// `revisar(cuerpo, respuesta)` devuelve un texto con lo que no coincide, o nada si está bien.
async function paso(descripcion, { metodo, ruta, tk, cuerpo, clave, esperado, tipo, revisar, ruta_base = BASE }) {
  pasos++;
  const encabezados = {};
  if (tk) encabezados.authorization = `Bearer ${tk}`;
  if (clave) encabezados['idempotency-key'] = clave;
  if (cuerpo !== undefined) encabezados['content-type'] = 'application/json';
  const url = `${ruta_base}${ruta}`;
  let respuesta;
  let texto = '';
  let json;
  try {
    respuesta = await fetch(url, { method: metodo, headers: encabezados, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo), signal: AbortSignal.timeout(15000) });
    texto = await respuesta.text();
    try {
      json = texto === '' ? undefined : JSON.parse(texto);
    } catch {
      json = undefined;
    }
  } catch (error) {
    texto = String(error);
  }
  const estado = respuesta?.status;
  const problemas = [];
  if (estado !== esperado) problemas.push(`esperaba ${esperado} y respondió ${estado ?? 'nada'}`);
  if (tipo !== undefined && json?.type !== tipo) problemas.push(`esperaba type ${tipo} y vino ${json?.type}`);
  if (problemas.length === 0 && revisar) {
    const motivo = revisar(json, respuesta);
    if (motivo) problemas.push(motivo);
  }
  const marca = problemas.length === 0 ? verde('✔') : rojo('✘');
  console.log(`  ${marca} ${String(pasos).padStart(2)}. ${descripcion} ${gris(`${metodo} ${ruta_base === BASE ? ruta : '/health'} → ${estado ?? 'sin respuesta'}`)}`);
  if (opciones.detalle) {
    console.log(gris(`       ${comoCurl({ metodo, ruta: ruta_base === BASE ? `/api/v1${ruta}` : ruta, cuerpo, tokenAbreviado: tk ? `${tk.slice(0, 12)}…` : undefined, clave })}`));
    console.log(gris(`       ${recortar(texto.replaceAll('\n', ' '), 400)}`));
  } else if (problemas.length === 0 && texto) {
    console.log(gris(`       ${recortar(texto)}`));
  }
  if (problemas.length > 0) {
    console.log(rojo(`       ${problemas.join('; ')}`));
    if (!opciones.detalle) console.log(rojo(`       ${recortar(texto.replaceAll('\n', ' '), 300)}`));
    fallas.push(`${pasos}. ${descripcion}: ${problemas.join('; ')}`);
  }
  return { respuesta, json, estado };
}

const igual = (campo, valor) => (json) => (json?.[campo] === valor ? undefined : `esperaba ${campo} = ${JSON.stringify(valor)} y vino ${JSON.stringify(json?.[campo])}`);
const todas = (...revisiones) => (json, respuesta) => revisiones.map((revision) => revision(json, respuesta)).find(Boolean);
const conLocation = (esperada) => (_json, respuesta) => {
  const encabezado = respuesta.headers.get('location');
  return encabezado === esperada ? undefined : `esperaba Location ${esperada} y vino ${encabezado}`;
};

async function main() {
  try {
    const respuesta = await fetch(`${SERVICIO}/health`, { signal: AbortSignal.timeout(5000) });
    if (!respuesta.ok) throw new Error(`/health respondió ${respuesta.status}`);
  } catch {
    console.error(`El servicio no responde en ${SERVICIO}. Levántalo con \`docker compose up -d --build --wait\`.`);
    process.exit(2);
  }

  const cliente = randomUUID();
  const otro = randomUUID();
  const operador = randomUUID();
  const tkCliente = await token(cliente, 'CLIENTE');
  const tkOtro = await token(otro, 'CLIENTE');
  const tkOperador = await token(operador, 'OPERADOR');
  const tkServicio = await token(randomUUID(), 'SERVICIO');
  const tkConductor = await token(randomUUID(), 'CONDUCTOR');
  const miPerfil = `/clientes/${cliente}`;

  console.log(negrita('M2 Clientes · demostración'));
  console.log(gris(`Servicio: ${SERVICIO} · cliente de la prueba: ${cliente}`));
  await levantarM6(cliente);
  console.log(gris(`M6 simulado: contenedor ${NOMBRE_M6}, alias de red m6`));

  seccion('1. Salud y seguridad (RNF-03, RNF-06)');
  await paso('El servicio responde, sin token', { metodo: 'GET', ruta: '/health', ruta_base: SERVICIO, esperado: 200, revisar: igual('estado', 'ok') });
  await paso('Sin token: 401', { metodo: 'GET', ruta: miPerfil, esperado: 401 });
  await paso('Con el token de otro cliente: 403', { metodo: 'GET', ruta: miPerfil, tk: tkOtro, esperado: 403 });
  await paso('Con el rol CONDUCTOR, que el contrato no admite acá: 403', { metodo: 'GET', ruta: miPerfil, tk: tkConductor, esperado: 403 });

  seccion('2. Perfil de cliente (RF-2.1)');
  const alta = { nombre: 'Ana', apellido: 'Gómez', telefono: '+5493624000000', fechaNacimiento: '1990-05-17' };
  const creado = await paso('Crear el perfil: 201 con Location', {
    metodo: 'POST', ruta: '/clientes', tk: tkCliente, clave: 'perfil-1', cuerpo: alta, esperado: 201,
    revisar: todas(igual('clienteId', cliente), igual('nombre', 'Ana'), conLocation(`/api/v1/clientes/${cliente}`)),
  });
  await paso('Repetir la misma solicitud (misma clave y cuerpo): el mismo 201, sin duplicar', {
    metodo: 'POST', ruta: '/clientes', tk: tkCliente, clave: 'perfil-1', cuerpo: alta, esperado: 201,
    revisar: (json) => (JSON.stringify(json) === JSON.stringify(creado.json) ? undefined : 'la respuesta repetida no es la original'),
  });
  await paso('Crear otro perfil para el mismo cliente (otra clave): 409', { metodo: 'POST', ruta: '/clientes', tk: tkCliente, clave: 'perfil-2', cuerpo: alta, esperado: 409 });
  await paso('Crear sin teléfono: 400', { metodo: 'POST', ruta: '/clientes', tk: tkCliente, clave: 'perfil-3', cuerpo: { nombre: 'Ana', apellido: 'Gómez' }, esperado: 400 });
  await paso('Consultar el perfil propio: 200', { metodo: 'GET', ruta: miPerfil, tk: tkCliente, esperado: 200, revisar: igual('apellido', 'Gómez') });
  await paso('Un OPERADOR consulta el perfil de cualquiera: 200', { metodo: 'GET', ruta: miPerfil, tk: tkOperador, esperado: 200 });
  await paso('Actualizar solo el nombre: 200 y el resto igual', {
    metodo: 'PATCH', ruta: miPerfil, tk: tkCliente, cuerpo: { nombre: 'Ana María' }, esperado: 200,
    revisar: todas(igual('nombre', 'Ana María'), igual('apellido', 'Gómez')),
  });
  await paso('Un perfil que no existe: 404', { metodo: 'GET', ruta: `/clientes/${randomUUID()}`, tk: tkOperador, esperado: 404 });

  seccion('3. Direcciones frecuentes (RF-2.2)');
  const direcciones = `${miPerfil}/direcciones`;
  const direccion = await paso('Registrar una dirección favorita: 201', {
    metodo: 'POST', ruta: direcciones, tk: tkCliente, clave: 'direccion-1', esperado: 201,
    cuerpo: { tipo: 'FAVORITA', alias: 'Casa', texto: 'Av. Sarmiento 1500, Resistencia', coordenadas: { latitud: -27.45, longitud: -58.98 } },
    revisar: igual('alias', 'Casa'),
  });
  const idDireccion = direccion.json?.direccionId;
  await paso('Listarlas: 200 con una', { metodo: 'GET', ruta: direcciones, tk: tkCliente, esperado: 200, revisar: igual('totalElementos', 1) });
  await paso('Consultar una: 200', { metodo: 'GET', ruta: `${direcciones}/${idDireccion}`, tk: tkCliente, esperado: 200 });
  await paso('Cambiar el alias: 200', { metodo: 'PATCH', ruta: `${direcciones}/${idDireccion}`, tk: tkCliente, cuerpo: { alias: 'Trabajo' }, esperado: 200, revisar: igual('alias', 'Trabajo') });
  await paso('Una dirección con tipo inválido: 400', { metodo: 'POST', ruta: direcciones, tk: tkCliente, clave: 'direccion-2', cuerpo: { tipo: 'OTRA', texto: 'x' }, esperado: 400 });
  await paso('Eliminarla: 204', { metodo: 'DELETE', ruta: `${direcciones}/${idDireccion}`, tk: tkCliente, esperado: 204 });
  await paso('Consultarla de nuevo: 404', { metodo: 'GET', ruta: `${direcciones}/${idDireccion}`, tk: tkCliente, esperado: 404 });

  seccion('4. Preferencias (RF-2.3)');
  const preferencias = `${miPerfil}/preferencias`;
  await paso('Antes de guardar nada: 200 con las preferencias vacías', { metodo: 'GET', ruta: preferencias, tk: tkCliente, esperado: 200 });
  await paso('Guardar tipo de vehículo, canales y accesibilidad: 200', {
    metodo: 'PUT', ruta: preferencias, tk: tkCliente, esperado: 200,
    cuerpo: { tiposVehiculo: ['AUTO'], canales: ['EMAIL', 'PUSH'], accesibilidad: ['ASISTENCIA_VISUAL'], observacionesAccesibilidad: 'Prefiere que el conductor avise por teléfono' },
  });
  await paso('Consultarlas: lo guardado', { metodo: 'GET', ruta: preferencias, tk: tkCliente, esperado: 200, revisar: (json) => (json?.tiposVehiculo?.[0] === 'AUTO' && json?.canales?.length === 2 ? undefined : 'no devolvió lo guardado') });
  await paso('Un tipo de vehículo que no existe: 400', { metodo: 'PUT', ruta: preferencias, tk: tkCliente, cuerpo: { tiposVehiculo: ['BICI'], canales: [], accesibilidad: [] }, esperado: 400 });

  seccion('5. Estado de cuenta y bloqueos (RF-2.6)');
  await paso('Estado de cuenta de un cliente sin bloqueos: 200', { metodo: 'GET', ruta: `${miPerfil}/estado-cuenta`, tk: tkCliente, esperado: 200, revisar: igual('estado', 'ACTIVO') });
  await paso('El cliente no puede bloquearse a sí mismo: 403', { metodo: 'POST', ruta: `${miPerfil}/bloqueos`, tk: tkCliente, clave: 'bloqueo-0', cuerpo: { motivo: 'x' }, esperado: 403 });
  const bloqueo = await paso('Un OPERADOR bloquea la cuenta: 201', { metodo: 'POST', ruta: `${miPerfil}/bloqueos`, tk: tkOperador, clave: 'bloqueo-1', cuerpo: { motivo: 'Deuda pendiente' }, esperado: 201 });
  const idBloqueo = bloqueo.json?.bloqueoId;
  await paso('Otro módulo (rol SERVICIO) consulta el estado: 200, con el bloqueo vigente', { metodo: 'GET', ruta: `${miPerfil}/estado-cuenta`, tk: tkServicio, esperado: 200, revisar: igual('estado', 'BLOQUEADO') });
  await paso('El OPERADOR lista los bloqueos: 200', { metodo: 'GET', ruta: `${miPerfil}/bloqueos`, tk: tkOperador, esperado: 200 });
  await paso('Consultar un bloqueo: 200', { metodo: 'GET', ruta: `${miPerfil}/bloqueos/${idBloqueo}`, tk: tkOperador, esperado: 200 });
  await paso('Levantarlo: 200', { metodo: 'PATCH', ruta: `${miPerfil}/bloqueos/${idBloqueo}`, tk: tkOperador, cuerpo: { motivo: 'Pagó la deuda' }, esperado: 200 });
  await paso('El estado vuelve a no tener bloqueos vigentes: 200', { metodo: 'GET', ruta: `${miPerfil}/estado-cuenta`, tk: tkCliente, esperado: 200, revisar: igual('estado', 'ACTIVO') });

  seccion('6. Historial de viajes (RF-2.4): lo arma M6');
  await paso('El historial resumido, leído de M6: 200 con sus tres viajes sin calificar', {
    metodo: 'GET', ruta: `${miPerfil}/viajes`, tk: tkCliente, esperado: 200,
    revisar: (json) => (json?.items?.length === 3 && json.items.every((viaje) => viaje.calificado === false) ? undefined : 'esperaba tres viajes con calificado: false'),
  });

  seccion('7. Calificación del conductor (RF-2.5): usa M6');
  const calificaciones = `${miPerfil}/calificaciones`;
  const calificacion = await paso('Calificar un viaje completado: 201 con el conductor que informó M6', {
    metodo: 'POST', ruta: calificaciones, tk: tkCliente, clave: 'calificacion-1', cuerpo: { viajeId: VIAJE_COMPLETADO, puntaje: 5, comentario: 'Muy amable' }, esperado: 201,
    revisar: todas(igual('conductorId', CONDUCTOR), igual('puntaje', 5), (json, respuesta) => conLocation(`/api/v1/clientes/${cliente}/calificaciones/${json?.calificacionId}`)(json, respuesta)),
  });
  const idCalificacion = calificacion.json?.calificacionId;
  await paso('Repetir la solicitud (misma clave y cuerpo): el mismo 201', {
    metodo: 'POST', ruta: calificaciones, tk: tkCliente, clave: 'calificacion-1', cuerpo: { viajeId: VIAJE_COMPLETADO, puntaje: 5, comentario: 'Muy amable' }, esperado: 201,
    revisar: igual('calificacionId', idCalificacion),
  });
  await paso('Calificar el mismo viaje con otra clave: 409, sin duplicar', {
    metodo: 'POST', ruta: calificaciones, tk: tkCliente, clave: 'calificacion-2', cuerpo: { viajeId: VIAJE_COMPLETADO, puntaje: 1 }, esperado: 409, tipo: '/errores/calificacion-duplicada',
  });
  await paso('La misma clave con otro cuerpo: 422', {
    metodo: 'POST', ruta: calificaciones, tk: tkCliente, clave: 'calificacion-1', cuerpo: { viajeId: VIAJE_COMPLETADO, puntaje: 2 }, esperado: 422, tipo: '/errores/idempotencia-reutilizada',
  });
  await paso('Un viaje que M6 dice que sigue en curso: 422', {
    metodo: 'POST', ruta: calificaciones, tk: tkCliente, clave: 'calificacion-3', cuerpo: { viajeId: VIAJE_EN_CURSO, puntaje: 4 }, esperado: 422, tipo: '/errores/viaje-no-completado',
  });
  await paso('Un viaje de otro cliente: 404', { metodo: 'POST', ruta: calificaciones, tk: tkCliente, clave: 'calificacion-4', cuerpo: { viajeId: VIAJE_AJENO, puntaje: 4 }, esperado: 404 });
  await paso('Un viaje que M6 no conoce: 404', { metodo: 'POST', ruta: calificaciones, tk: tkCliente, clave: 'calificacion-5', cuerpo: { viajeId: VIAJE_INEXISTENTE, puntaje: 4 }, esperado: 404 });
  await paso('Un puntaje fuera de 1 a 5: 400', { metodo: 'POST', ruta: calificaciones, tk: tkCliente, clave: 'calificacion-6', cuerpo: { viajeId: VIAJE_COMPLETADO, puntaje: 6 }, esperado: 400 });
  await paso('Calificar en nombre de otro cliente: 403', { metodo: 'POST', ruta: calificaciones, tk: tkOtro, clave: 'calificacion-7', cuerpo: { viajeId: VIAJE_COMPLETADO, puntaje: 3 }, esperado: 403 });
  await paso('Listar las calificaciones del cliente: 200 con una', { metodo: 'GET', ruta: calificaciones, tk: tkCliente, esperado: 200, revisar: igual('totalElementos', 1) });
  await paso('Un OPERADOR también las lista: 200', { metodo: 'GET', ruta: calificaciones, tk: tkOperador, esperado: 200 });
  await paso('Consultar la calificación: 200', { metodo: 'GET', ruta: `${calificaciones}/${idCalificacion}`, tk: tkCliente, esperado: 200, revisar: igual('comentario', 'Muy amable') });
  await paso('Otro cliente no la ve: 403', { metodo: 'GET', ruta: `/clientes/${otro}/calificaciones/${idCalificacion}`, tk: tkCliente, esperado: 403 });
  await paso('El historial ahora marca como calificado solo ese viaje', {
    metodo: 'GET', ruta: `${miPerfil}/viajes`, tk: tkCliente, esperado: 200,
    revisar: (json) => (json?.items?.filter((viaje) => viaje.calificado === true).map((viaje) => viaje.viajeId).join() === VIAJE_COMPLETADO ? undefined : 'esperaba calificado: true solo en el viaje calificado'),
  });

  seccion('8. M6 caído (RNF-13): lo que depende de M6 falla claro, lo demás sigue');
  await ejecutar('docker', ['stop', NOMBRE_M6]).catch(() => undefined);
  const caido = (esperadoRetry) => (_json, respuesta) => (esperadoRetry && !respuesta.headers.get('retry-after') ? 'falta el encabezado Retry-After' : undefined);
  await paso('Calificar con M6 caído: 503 con Retry-After', {
    metodo: 'POST', ruta: calificaciones, tk: tkCliente, clave: 'calificacion-8', cuerpo: { viajeId: VIAJE_PARA_M6_CAIDO, puntaje: 4 }, esperado: 503, revisar: caido(true),
  });
  await paso('El historial con M6 caído: 503 con Retry-After', { metodo: 'GET', ruta: `${miPerfil}/viajes`, tk: tkCliente, esperado: 503, revisar: caido(true) });
  await paso('Repetir una calificación ya hecha: el mismo 201, sin consultar a M6', {
    metodo: 'POST', ruta: calificaciones, tk: tkCliente, clave: 'calificacion-1', cuerpo: { viajeId: VIAJE_COMPLETADO, puntaje: 5, comentario: 'Muy amable' }, esperado: 201, revisar: igual('calificacionId', idCalificacion),
  });
  await paso('Las lecturas propias de M2 siguen respondiendo: 200', { metodo: 'GET', ruta: miPerfil, tk: tkCliente, esperado: 200 });
  await paso('Y también las calificaciones ya guardadas: 200', { metodo: 'GET', ruta: calificaciones, tk: tkCliente, esperado: 200 });
}

try {
  await main();
} catch (error) {
  console.error(rojo(`La demostración se cortó: ${error instanceof Error ? error.message : String(error)}`));
  fallas.push('se cortó antes de terminar');
} finally {
  if (!opciones['dejar-m6']) await ejecutar('docker', ['rm', '-f', NOMBRE_M6]).catch(() => undefined);
}

console.log('');
if (fallas.length === 0) {
  console.log(verde(negrita(`Todo en orden: ${pasos} pasos comprobados.`)));
} else {
  console.log(rojo(negrita(`${fallas.length} de ${pasos} pasos fallaron:`)));
  for (const falla of fallas) console.log(rojo(`  - ${falla}`));
  process.exit(1);
}
