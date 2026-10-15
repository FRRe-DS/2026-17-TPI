// pre-push: bloquea el push a main y corre spec-check en las ramas del flujo.
// Es una protección local (se puede saltear con --no-verify): la real es la regla de GitHub.
// Excepción explícita para el commit del arnés o una emergencia: PERMITIR_MAIN=1 git push …
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const CERO = /^0+$/;
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const entrada = fs.readFileSync(0, 'utf8').trim();
if (!entrada) process.exit(0);

const head = git('rev-parse', 'HEAD');
for (const linea of entrada.split('\n')) {
  const [, shaLocal, refRemota] = linea.split(' ');
  if (CERO.test(shaLocal)) continue; // borrado de una rama remota
  const rama = refRemota.replace(/^refs\/heads\//, '');

  if (rama === 'main') {
    if (process.env.PERMITIR_MAIN === '1') { console.error('pre-push: push a main permitido por PERMITIR_MAIN=1.'); continue; }
    console.error('pre-push: no se pushea a main. Trabajá en una rama spec/, impl/, fix/ o contrato/ y abrí un PR.');
    process.exit(1);
  }
  if (!/^(spec|impl|fix|contrato)\//.test(rama)) {
    console.error(`pre-push: la rama "${rama}" no sigue la convención spec|impl|fix|contrato/NNN-slug.`);
    process.exit(1);
  }
  if (shaLocal !== head) { console.error(`pre-push: ${rama} no es la rama actual; no se validó con spec-check.`); continue; }
  try { git('fetch', '--quiet', 'origin', 'main'); } catch { /* sin red: spec-check avisa si no puede comparar */ }
  try {
    execFileSync('node', ['scripts/spec-check.mjs', '--rama', rama, '--base', 'origin/main'], { stdio: 'inherit' });
  } catch {
    console.error('pre-push: spec-check falló. Corregí antes de pushear.');
    process.exit(1);
  }
}
