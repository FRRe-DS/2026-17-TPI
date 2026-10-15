// Hook Stop: cuando el contexto cruza el umbral blando, Claude deja el traspaso
// escrito y pregunta si compactar o limpiar. Si algo falla, no hace nada.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const AVISOS = [0.70, 0.85]; // fracciones de la ventana de compactación
const VENTANA_POR_DEFECTO = 400000;

const leerJSON = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

export function ventanaCompactacion(dirProyecto) {
  const env = Number(process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW);
  if (env > 0) return env;
  for (const f of [
    path.join(dirProyecto, '.claude', 'settings.local.json'),
    path.join(dirProyecto, '.claude', 'settings.json'),
    path.join(os.homedir(), '.claude', 'settings.json'),
  ]) {
    const v = Number(leerJSON(f)?.autoCompactWindow);
    if (v > 0) return v;
  }
  return VENTANA_POR_DEFECTO;
}

// Último uso de contexto de la conversación principal, leído del transcript.
function tokensActuales(transcript) {
  const MAX = 4 * 1024 * 1024;
  const { size } = fs.statSync(transcript);
  const fd = fs.openSync(transcript, 'r');
  const buf = Buffer.alloc(Math.min(size, MAX));
  fs.readSync(fd, buf, 0, buf.length, size - buf.length);
  fs.closeSync(fd);
  const lineas = buf.toString('utf8').split('\n');
  for (let i = lineas.length - 1; i >= 0; i--) {
    if (!lineas[i].includes('"usage"')) continue;
    let o; try { o = JSON.parse(lineas[i]); } catch { continue; }
    const u = o?.message?.usage;
    if (o.type !== 'assistant' || o.isSidechain || !u) continue;
    const t = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    if (t > 0) return t;
  }
  return 0;
}

function main() {
  const entrada = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (entrada.stop_hook_active) return;
  const dir = process.env.CLAUDE_PROJECT_DIR || entrada.cwd;
  const ventana = ventanaCompactacion(dir);
  const tokens = tokensActuales(entrada.transcript_path);
  const fraccion = tokens / ventana;
  const marca = path.join(os.tmpdir(), `claude-ctx-${entrada.session_id}.json`);
  const avisado = leerJSON(marca)?.nivel ?? 0;
  const nivel = AVISOS.filter((a) => fraccion >= a).length;
  if (nivel === 0 || nivel <= avisado) return;
  fs.writeFileSync(marca, JSON.stringify({ nivel }));

  const k = (n) => `${Math.round(n / 1000)}k`;
  const urgente = nivel === AVISOS.length
    ? ` La compactación automática está cerca (≈${k(ventana)}) y resumirá sin tu traspaso.`
    : '';
  const motivo = [
    `Contexto en ${k(tokens)} de ${k(ventana)} tokens (${Math.round(fraccion * 100)} % de la ventana de compactación).${urgente}`,
    'Antes de seguir:',
    '1. Actualiza EN-CURSO.local.md (en la raíz; no va a git): rama, spec y tarea activas, qué quedó hecho, el siguiente paso exacto y cualquier decisión o hallazgo de esta sesión que todavía no esté en un archivo. Si hay spec activa, deja su tasks.md al día. Si la decisión afecta al grupo, propón un ADR.',
    '2. Recomiéndame en una línea /compact (con la instrucción de foco que propones) o /clear, y por qué:',
    '   - /compact: la tarea sigue a medias y hay razonamiento útil que no está en archivos.',
    '   - /clear: la tarea terminó o está en un punto de corte limpio, o la sesión acumuló intentos fallidos o correcciones.',
    '   (Si no puedes editar archivos, escribe el traspaso en tu respuesta.)',
    '3. Después PARA y espera mi decisión. No retomes la tarea.',
  ].join('\n');
  process.stdout.write(JSON.stringify({ decision: 'block', reason: motivo }));
}

try { main(); } catch { /* sin datos fiables: no interviene */ }
