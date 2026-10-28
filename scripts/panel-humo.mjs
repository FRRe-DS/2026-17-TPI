// Prueba de humo del panel (spec 071, T13; spec 072, T9): con el panel andando, comprueba que está sano, que llega a M2, que llega al
// canal del M6 simulado, que la vista de demostración llega a la base y sabe decir si puede usar Docker, y que rechaza lo que no
// viene de su propia página. Imprime una línea por comprobación (✔ o ✘) y termina con
// código 1 si alguna falla o si el panel no escucha. No cambia nada: el pedido con Origin ajeno es justamente el que el panel
// tiene que rechazar, y si no lo hiciera solo pediría el modo `normal`.
//   El panel como proceso:  docker compose up -d --build --wait
//                           docker compose --profile panel up -d --build --wait m6
//                           npm run panel
//   El perfil completo:     docker compose --profile panel up -d --build --wait
//                           (el panel del contenedor informa Docker no disponible, con su motivo; con `npm run panel`, disponible)
//   node scripts/panel-humo.mjs [--panel <url>]
// Sin --panel usa http://localhost:$PANEL_PUERTO (por defecto, 8083), el puerto que publica docker-compose.yml.
import { request } from 'node:http';
import { parseArgs } from 'node:util';

const USO = 'Uso: node scripts/panel-humo.mjs [--panel <url>]';
const ESPERA_MS = 5000;

const { values: opciones } = parseArgs({ options: { panel: { type: 'string' } }, strict: true });
const PANEL = (opciones.panel ?? `http://localhost:${process.env.PANEL_PUERTO || '8083'}`).replace(/\/+$/, '');

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const pintar = (codigo, texto) => (color ? `\u001b[${codigo}m${texto}\u001b[0m` : texto);
const verde = (t) => pintar('32', t);
const rojo = (t) => pintar('31', t);
const gris = (t) => pintar('90', t);

const COMO_LEVANTARLO = [
  'Levanta M2 y la base:   docker compose up -d --build --wait',
  'Levanta el M6 simulado: docker compose --profile panel up -d --build --wait m6',
  'Y el panel:             npm run panel',
  'O todo junto:           docker compose --profile panel up -d --build --wait',
].join('\n  ');

// Un pedido con fetch y un tiempo máximo. Devuelve el estado y el cuerpo JSON (undefined si no es JSON).
async function pedir(ruta, { method = 'GET', headers = {}, body } = {}) {
  const respuesta = await fetch(`${PANEL}${ruta}`, { method, headers, body, signal: AbortSignal.timeout(ESPERA_MS) });
  const texto = await respuesta.text();
  let cuerpo;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    cuerpo = undefined;
  }
  return { estado: respuesta.status, cuerpo };
}

// fetch no deja cambiar el encabezado Host (lo toma de la URL), así que el pedido con Host ajeno va con http.request.
function pedirConHostAjeno(ruta) {
  const url = new URL(PANEL);
  return new Promise((resolver, rechazar) => {
    const pedido = request(
      { host: url.hostname, port: url.port, path: ruta, method: 'GET', headers: { host: 'panel.ajeno.test' }, timeout: ESPERA_MS },
      (respuesta) => {
        respuesta.resume();
        respuesta.on('end', () => resolver(respuesta.statusCode));
      },
    );
    pedido.on('timeout', () => pedido.destroy(new Error('sin respuesta')));
    pedido.on('error', rechazar);
    pedido.end();
  });
}

// Lo que la vista de demostración informa de la base y de Docker (spec 072, RNF-13.6): la base tiene que estar disponible, y Docker
// puede no estarlo (el panel en su contenedor) siempre que lo diga con su motivo, que es lo que la vista le muestra a la persona.
// Lo que dijo de Docker queda en la línea de salida.
let dockerInformado = '';

const comprobaciones = [
  {
    nombre: 'El panel está sano',
    async correr() {
      const { estado, cuerpo } = await pedir('/salud-panel');
      return estado === 200 && cuerpo?.estado === 'ok' ? undefined : `GET /salud-panel respondió ${estado}`;
    },
  },
  {
    nombre: 'GET /health llega a M2',
    async correr() {
      const { estado, cuerpo } = await pedir('/health');
      return estado === 200 && cuerpo?.estado === 'ok' ? undefined : `GET /health respondió ${estado}${cuerpo ? '' : ' sin JSON de M2'}`;
    },
  },
  {
    nombre: 'El M6 simulado responde',
    async correr() {
      const { estado, cuerpo } = await pedir('/panel/m6/estado');
      return estado === 200 && ['normal', 'lento', 'caido'].includes(cuerpo?.modo) ? undefined : `GET /panel/m6/estado respondió ${estado}`;
    },
  },
  {
    nombre: 'La vista de demostración informa la base y Docker',
    async correr() {
      const { estado, cuerpo } = await pedir('/panel/demo/estado');
      if (estado !== 200) return `GET /panel/demo/estado respondió ${estado}`;
      const { base, docker } = cuerpo ?? {};
      if (base?.disponible !== true) return `la base no está disponible: ${base?.motivo ?? 'sin motivo'}`;
      if (typeof docker?.disponible !== 'boolean') return 'no informó si Docker está disponible';
      if (docker.disponible) {
        dockerInformado = 'Docker disponible';
        return undefined;
      }
      if (typeof docker.motivo !== 'string' || docker.motivo === '') return 'Docker no disponible y sin motivo';
      dockerInformado = `Docker no disponible: ${docker.motivo}`;
      return undefined;
    },
  },
  {
    nombre: 'Un Origin ajeno recibe 403',
    async correr() {
      const { estado } = await pedir('/panel/m6/modo', {
        method: 'PUT',
        headers: { origin: 'http://pagina.ajena.test', 'content-type': 'application/json' },
        body: JSON.stringify({ modo: 'normal' }),
      });
      return estado === 403 ? undefined : `PUT /panel/m6/modo con Origin ajeno respondió ${estado}`;
    },
  },
  {
    nombre: 'Un Host ajeno recibe 403',
    async correr() {
      const estado = await pedirConHostAjeno('/salud-panel');
      return estado === 403 ? undefined : `GET /salud-panel con Host ajeno respondió ${estado}`;
    },
  },
];

// Si el panel no escucha, el resto no tiene sentido: se dice cómo levantarlo en lugar de fallar cinco veces.
try {
  await pedir('/salud-panel');
} catch (error) {
  const causa = error?.cause?.code ?? error?.name ?? 'error';
  console.error(`${rojo('✘')} El panel no responde en ${PANEL} (${causa}).\n  ${COMO_LEVANTARLO}`);
  process.exit(1);
}

let fallas = 0;
for (const { nombre, correr } of comprobaciones) {
  let problema;
  try {
    problema = await correr();
  } catch (error) {
    problema = `no hubo respuesta (${error?.cause?.code ?? error?.name ?? 'error'})`;
  }
  if (problema === undefined) {
    console.log(`${verde('✔')} ${nombre}${dockerInformado !== '' && nombre.includes('Docker') ? ` ${gris(`— ${dockerInformado}`)}` : ''}`);
  } else {
    fallas++;
    console.log(`${rojo('✘')} ${nombre} ${gris(`— ${problema}`)}`);
  }
}

if (fallas > 0) {
  console.log(`\n${rojo(`${fallas} de ${comprobaciones.length} comprobaciones fallaron.`)} ${USO}`);
  process.exit(1);
}
console.log(`\n${verde(`Las ${comprobaciones.length} comprobaciones pasaron`)} contra ${PANEL}.`);
