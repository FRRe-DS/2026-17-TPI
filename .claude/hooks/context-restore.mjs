// Hook SessionStart (startup|resume|compact|clear): reinicia los avisos de contexto
// y le da a Claude el estado de trabajo para retomar. Si algo falla, no hace nada.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

function git(cmd, cwd) {
  try { return execSync(`git ${cmd}`, { cwd, timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return ''; }
}

function specsPendientes(dir) {
  const raiz = path.join(dir, 'specs');
  if (!fs.existsSync(raiz)) return [];
  const salida = [];
  for (const d of fs.readdirSync(raiz).sort()) {
    const tasks = path.join(raiz, d, 'tasks.md');
    const spec = path.join(raiz, d, 'spec.md');
    if (!fs.existsSync(tasks)) continue;
    if (fs.existsSync(spec) && /Estado:\s*implementada/i.test(fs.readFileSync(spec, 'utf8'))) continue;
    const texto = fs.readFileSync(tasks, 'utf8');
    const pendientes = [...texto.matchAll(/^\s*- \[ \] \*\*(T\d+)/gm)].map((m) => m[1]);
    const total = (texto.match(/^\s*- \[[ xX]\] /gm) || []).length;
    if (pendientes.length) salida.push(`  - specs/${d}: pendientes ${pendientes.join(', ')} (${pendientes.length} de ${total})`);
  }
  return salida.slice(-3);
}

function main() {
  const entrada = JSON.parse(fs.readFileSync(0, 'utf8'));
  try { fs.unlinkSync(path.join(os.tmpdir(), `claude-ctx-${entrada.session_id}.json`)); } catch {}
  const dir = process.env.CLAUDE_PROJECT_DIR || entrada.cwd;
  const specs = specsPendientes(dir);
  const rama = git('branch --show-current', dir);
  let enCurso = '';
  try { enCurso = fs.readFileSync(path.join(dir, 'EN-CURSO.local.md'), 'utf8').trim().split('\n').slice(0, 60).join('\n'); } catch {}
  const cambios = git('status --short', dir).split('\n').filter(Boolean).slice(0, 15);
  const commits = git('log --oneline -5', dir);
  const origen = { startup: 'inicio', resume: 'sesión retomada', clear: '/clear', compact: 'compactación' }[entrada.source] || entrada.source;
  const lineas = [`[Estado de trabajo · ${origen}]`];
  if (rama) lineas.push(`Rama actual: ${rama}`);
  lineas.push(enCurso ? `EN-CURSO.local.md:\n${enCurso}` : 'EN-CURSO.local.md: vacío o inexistente (no hay trabajo a medias registrado).');
  if (specs.length) lineas.push('Specs con tareas pendientes:', ...specs);
  if (cambios.length) lineas.push('Cambios sin commit:', ...cambios.map((c) => `  ${c}`));
  if (commits) lineas.push('Últimos commits:', ...commits.split('\n').map((c) => `  ${c}`));
  lineas.push('Si la próxima petición continúa ese trabajo, parte de aquí y confirma el siguiente paso antes de editar. Si es otro tema, ignóralo.');
  process.stdout.write(lineas.join('\n') + '\n');
}

try { main(); } catch { /* no interviene */ }
