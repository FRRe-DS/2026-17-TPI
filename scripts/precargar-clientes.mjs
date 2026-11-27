// Precarga de clientes de prueba para otros grupos (#131; guía: docs/probar-m2.md, «Clientes precargados»). Con M2 y Keycloak
// levantados con `ejemplo-keycloak.env` (modo `jwks`), crea por la API el perfil de cliente2, cliente3 y cliente4 y bloquea a
// cliente4 con operador1. Se puede correr las veces que haga falta: un perfil que ya existe (409) o un bloqueo ya vigente se dejan
// como están. Al final muestra el estado de cuenta de cada uno como lo ve el Grupo 9 (cuenta de servicio `grupo-09`). cliente1
// queda sin perfil para el recorrido manual de la guía. No toca src/, el contrato ni la base directamente.
//   docker compose --env-file ejemplo-keycloak.env up -d --build --wait
//   node scripts/precargar-clientes.mjs
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Los puertos que publica docker-compose.yml, con los mismos valores por defecto. Keycloak se pide por `localhost`, que es el
// emisor que M2 espera en `ejemplo-keycloak.env`: con otro nombre, M2 rechaza el token.
const M2 = `http://localhost:${process.env.M2_PUERTO || '8082'}/api/v1`;
const TOKENS = `http://localhost:${process.env.KEYCLOAK_PUERTO || '8080'}/realms/ds-2026-realm/protocol/openid-connect/token`;
const REALM = JSON.parse(readFileSync(new URL('../keycloak/ds-2026-realm-realm.json', import.meta.url), 'utf8'));
const CORTE_MS = 15000;

// Los `id` son los fijos del realm: el `sub` del token y, por lo tanto, el `clienteId`.
const CLIENTES = [
  { usuario: 'cliente2', perfil: { nombre: 'Bruno', apellido: 'Díaz', telefono: '+5493624000002', fechaNacimiento: '1988-03-12' } },
  { usuario: 'cliente3', perfil: { nombre: 'Carla', apellido: 'Romero', telefono: '+5493624000003', fechaNacimiento: '1995-08-25' } },
  { usuario: 'cliente4', perfil: { nombre: 'Diego', apellido: 'Sosa', telefono: '+5493624000004', fechaNacimiento: '1979-11-02' }, bloquear: true },
];
const OPERADOR = 'operador1';
const MOTIVO_BLOQUEO = 'Cliente de prueba bloqueado a propósito (#131)';
const CUENTA_DE_SERVICIO = 'grupo-09';

const usuarioDelRealm = (nombre) => {
  const usuario = REALM.users.find((u) => u.username === nombre);
  if (!usuario) throw new Error(`El realm de keycloak/ no tiene el usuario ${nombre}: hace falta \`down -v\` y volver a levantar.`);
  return usuario;
};

async function pedirToken(campos, quien) {
  let respuesta;
  try {
    respuesta = await fetch(TOKENS, { method: 'POST', body: new URLSearchParams(campos), signal: AbortSignal.timeout(CORTE_MS) });
  } catch (error) {
    throw new Error(`Keycloak no responde en ${TOKENS} (${error.cause?.code ?? error.cause?.message ?? error.name}). ¿Está levantado con ejemplo-keycloak.env?`);
  }
  const cuerpo = await respuesta.json().catch(() => ({}));
  if (respuesta.status !== 200 || typeof cuerpo.access_token !== 'string') {
    // Un usuario que falta en un Keycloak ya creado: el realm se importa una sola vez, al crear su base.
    const pista = cuerpo.error === 'invalid_grant' ? ' Si es cliente3 o cliente4, el realm es anterior a #131: `down -v` y volver a levantar.' : '';
    throw new Error(`Keycloak no dio un token para ${quien}: HTTP ${respuesta.status} ${cuerpo.error ?? ''}.${pista}`);
  }
  return cuerpo.access_token;
}

const tokenDePersona = (nombre) => {
  const { credentials } = usuarioDelRealm(nombre);
  return pedirToken(
    { grant_type: 'password', client_id: 'm2-desarrollo', username: nombre, password: credentials[0].value, scope: 'clientes:read clientes:write' },
    nombre,
  );
};

const tokenDeServicio = (clientId) => {
  const { secret } = REALM.clients.find((c) => c.clientId === clientId);
  return pedirToken({ grant_type: 'client_credentials', client_id: clientId, client_secret: secret }, clientId);
};

async function llamar(metodo, ruta, token, cuerpo) {
  const encabezados = { authorization: `Bearer ${token}` };
  if (cuerpo !== undefined) Object.assign(encabezados, { 'content-type': 'application/json', 'idempotency-key': randomUUID() });
  let respuesta;
  try {
    respuesta = await fetch(`${M2}${ruta}`, { method: metodo, headers: encabezados, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo), signal: AbortSignal.timeout(CORTE_MS) });
  } catch (error) {
    throw new Error(`M2 no responde en ${M2} (${error.cause?.code ?? error.cause?.message ?? error.name}). ¿Está levantado?`);
  }
  const texto = await respuesta.text();
  let json;
  try {
    json = texto === '' ? undefined : JSON.parse(texto);
  } catch {
    json = undefined;
  }
  return { estado: respuesta.status, json };
}

function fallar(que, { estado, json }) {
  // Un 401 con un token recién pedido a Keycloak casi siempre es M2 en modo hs256 (el entorno por defecto).
  const pista = estado === 401 ? ' ¿M2 está en modo jwks? Levantalo con `--env-file ejemplo-keycloak.env`.' : '';
  throw new Error(`${que}: HTTP ${estado} ${json?.detail ?? json?.title ?? ''}.${pista}`);
}

async function main() {
  const tokenOperador = await tokenDePersona(OPERADOR);
  for (const { usuario, perfil, bloquear } of CLIENTES) {
    const { id } = usuarioDelRealm(usuario);
    const creado = await llamar('POST', '/clientes', await tokenDePersona(usuario), perfil);
    if (creado.estado === 201) console.log(`✔ ${usuario}: perfil creado`);
    else if (creado.estado === 409) console.log(`· ${usuario}: el perfil ya existía`);
    else fallar(`Crear el perfil de ${usuario}`, creado);

    if (!bloquear) continue;
    const vigentes = await llamar('GET', `/clientes/${id}/bloqueos?vigente=true`, tokenOperador);
    if (vigentes.estado !== 200) fallar(`Listar los bloqueos de ${usuario}`, vigentes);
    if (vigentes.json.items.length > 0) {
      console.log(`· ${usuario}: ya tenía un bloqueo vigente`);
      continue;
    }
    const bloqueo = await llamar('POST', `/clientes/${id}/bloqueos`, tokenOperador, { motivo: MOTIVO_BLOQUEO });
    if (bloqueo.estado !== 201) fallar(`Bloquear a ${usuario}`, bloqueo);
    console.log(`✔ ${usuario}: bloqueado por ${OPERADOR}`);
  }

  console.log(`\nEstado de cuenta, visto por la cuenta de servicio ${CUENTA_DE_SERVICIO}:`);
  const tokenServicio = await tokenDeServicio(CUENTA_DE_SERVICIO);
  for (const { usuario } of CLIENTES) {
    const { id } = usuarioDelRealm(usuario);
    const estado = await llamar('GET', `/clientes/${id}/estado-cuenta`, tokenServicio);
    if (estado.estado !== 200) fallar(`Leer el estado de cuenta de ${usuario}`, estado);
    console.log(`  ${usuario.padEnd(9)} ${id}  ${estado.json.estado}`);
  }
}

main().catch((error) => {
  console.error(`✘ ${error.message}`);
  process.exitCode = 1;
});
