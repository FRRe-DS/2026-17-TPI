// Valida las specs y la convención de ramas. Lo corre CI en cada PR; también en local.
// Uso: node scripts/spec-check.mjs [--rama <rama>] [--base <ref>]
// Sin dependencias: solo Node.js.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const MODULO = '2'; // M2 → los RF propios son RF-2.x
const ESTADOS = ['borrador', 'aprobada', 'implementada'];
const SECCIONES = ['Contexto y objetivo', 'Requisitos funcionales', 'Requisitos no funcionales',
  'Contrato y dependencias', 'Casos límite', 'Fuera de alcance', 'Criterios de finalización', 'Dudas abiertas'];
const PUEDEN_IR_VACIAS = ['Dudas abiertas', 'Requisitos funcionales', 'Requisitos no funcionales'];
const EARS = /^(CUANDO\b|SI\b.*\bENTONCES\b|MIENTRAS\b|EL SISTEMA\b)/;

const errores = [];
const avisos = [];
const error = (donde, msg) => errores.push(`${donde}: ${msg}`);
const aviso = (donde, msg) => avisos.push(`${donde}: ${msg}`);

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const leer = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : null);
const git = (cmd) => execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function secciones(texto) {
  const mapa = {};
  let actual = null;
  for (const linea of texto.split('\n')) {
    const m = linea.match(/^## (.+?)\s*$/);
    if (m) { actual = m[1]; mapa[actual] = []; continue; }
    if (actual) mapa[actual].push(linea);
  }
  for (const k of Object.keys(mapa)) mapa[k] = mapa[k].join('\n').trim();
  return mapa;
}

function tareas(texto) {
  const lista = [];
  for (const linea of texto.split('\n')) {
    const t = linea.match(/^- \[( |x|X)\] \*\*T(\d+)\.(.*)$/);
    if (t) { lista.push({ n: Number(t[2]), hecha: t[1] !== ' ', linea, hechoCuando: false }); continue; }
    if (lista.length && /^\s+- Hecho cuando:\s*\S/.test(linea)) lista.at(-1).hechoCuando = true;
  }
  return lista;
}

function revisarSpec(dir) {
  const nombre = path.basename(dir);
  const m = nombre.match(/^(\d{3})-[a-z0-9-]+$/);
  if (!m) { error(`specs/${nombre}`, 'el nombre debe ser NNN-slug (NNN = número del issue, tres dígitos)'); return null; }
  const nnn = m[1];
  const donde = `specs/${nombre}`;
  const spec = leer(path.join(dir, 'spec.md'));
  if (!spec) { error(donde, 'falta spec.md'); return null; }

  if (!new RegExp(`^# Spec ${nnn} — \\S`).test(spec)) error(`${donde}/spec.md`, `la primera línea debe ser "# Spec ${nnn} — <Nombre>"`);
  const estado = (spec.match(/^Estado:\s*(\S+)/m) || [])[1];
  if (!ESTADOS.includes(estado)) error(`${donde}/spec.md`, `"Estado:" debe ser ${ESTADOS.join(' | ')}`);
  const issue = (spec.match(/^Issue:\s*#(\d+)/m) || [])[1];
  if (!issue || Number(issue) !== Number(nnn)) error(`${donde}/spec.md`, `"Issue: #${Number(nnn)}" debe coincidir con el número de la carpeta`);
  if (!/^Etapa:\s*TP[123]\b/m.test(spec)) error(`${donde}/spec.md`, 'falta "Etapa: TP1 | TP2 | TP3"');

  const sec = secciones(spec);
  for (const s of SECCIONES) {
    if (!(s in sec)) error(`${donde}/spec.md`, `falta la sección "## ${s}"`);
    else if (!sec[s] && !PUEDEN_IR_VACIAS.includes(s)) error(`${donde}/spec.md`, `la sección "## ${s}" está vacía`);
  }

  const rfs = []; // requisitos de la spec: RF del módulo y RNF de la cátedra
  const leerRequisitos = (seccion, patron) => {
    for (const linea of (sec[seccion] || '').split('\n')) {
      const r = linea.match(patron);
      if (!r) continue;
      const [, id, texto] = r;
      if (id.startsWith('RF-') && !id.startsWith(`RF-${MODULO}.`)) error(`${donde}/spec.md`, `${id}: los RF de este módulo empiezan por RF-${MODULO}.`);
      if (rfs.includes(id)) error(`${donde}/spec.md`, `${id} está repetido`);
      if (!EARS.test(texto)) error(`${donde}/spec.md`, `${id} no está en EARS (CUANDO / SI … ENTONCES / MIENTRAS / EL SISTEMA)`);
      rfs.push(id);
    }
  };
  leerRequisitos('Requisitos funcionales', /^- (RF-\d+(?:\.\d+)+):\s*(.*)$/);
  leerRequisitos('Requisitos no funcionales', /^- (RNF-\d+(?:\.\d+)*):\s*(.*)$/);
  if (!rfs.length) error(`${donde}/spec.md`, 'no hay requisitos "- RF-x.y: …" ni "- RNF-xx: …"');

  const plan = leer(path.join(dir, 'plan.md'));
  const tasks = leer(path.join(dir, 'tasks.md'));
  const guia = leer(path.join(dir, 'guia.md'));

  if (estado && estado !== 'borrador') {
    for (const [f, t] of [['spec.md', spec], ['plan.md', plan], ['tasks.md', tasks]]) {
      if (t && t.includes('[NECESITA ACLARACIÓN]')) error(`${donde}/${f}`, `quedan [NECESITA ACLARACIÓN] con la spec ${estado}`);
    }
    if (!plan) error(donde, `falta plan.md (la spec está ${estado})`);
    if (!tasks) error(donde, `falta tasks.md (la spec está ${estado})`);
  }

  if (plan) for (const id of rfs) if (!plan.includes(id)) error(`${donde}/plan.md`, `${id} no aparece en el plan`);

  let lista = [];
  if (tasks) {
    lista = tareas(tasks);
    if (!lista.length) error(`${donde}/tasks.md`, 'no hay tareas con formato "- [ ] **Tn. …**"');
    lista.forEach((t, i) => {
      if (t.n !== i + 1) error(`${donde}/tasks.md`, `T${t.n}: la numeración debe ser correlativa desde T1`);
      if (!t.hechoCuando) error(`${donde}/tasks.md`, `T${t.n} no tiene línea "Hecho cuando:"`);
      if (!/R(N)?F-\d/.test(t.linea)) error(`${donde}/tasks.md`, `T${t.n} no indica qué requisito (RF o RNF) cubre`);
    });
    if (lista.length > 10) aviso(`${donde}/tasks.md`, `${lista.length} tareas: conviene dividir la spec`);
    for (const id of rfs) if (!lista.some((t) => new RegExp(`${id.replace(/\./g, '\\.')}(?![.\\d])`).test(t.linea))) {
      error(`${donde}/tasks.md`, `${id} no está cubierto por ninguna tarea`);
    }
  }

  for (const t of lista.filter((x) => x.hecha)) {
    if (!guia || !new RegExp(`^### T${t.n}\\b`, 'm').test(guia)) error(`${donde}/guia.md`, `T${t.n} está hecha pero no tiene entrada "### T${t.n}" en la guía`);
  }
  if (estado === 'implementada') {
    if (lista.some((t) => !t.hecha)) error(`${donde}/tasks.md`, 'la spec está implementada pero quedan tareas sin marcar');
    const vision = guia ? (secciones(guia)['Visión general'] || '') : '';
    if (vision.split('\n').filter((l) => l.trim()).length < 5) error(`${donde}/guia.md`, 'falta la "Visión general" (se escribe al validar)');
  }
  return { nnn, nombre, estado };
}

function revisarRama(rama, base, specs) {
  const m = rama.match(/^(spec|impl|fix|contrato)\/(\d{3})-[a-z0-9-]+$/);
  if (!m) { error(`rama ${rama}`, 'debe llamarse spec|impl|fix|contrato/NNN-slug'); return; }
  const [, tipo, nnn] = m;
  let cambiados = [];
  let commits = [];
  try {
    cambiados = git(`diff --name-only ${base}...HEAD`).split('\n').filter(Boolean);
    commits = git(`log ${base}..HEAD --no-merges --format=%s`).split('\n').filter(Boolean);
  } catch { aviso(`rama ${rama}`, `no se pudo comparar con ${base}; se omiten los controles de diff`); }
  const spec = specs.find((s) => s && s.nnn === nnn);
  const tocaContrato = cambiados.some((f) => f.startsWith('contrato/'));

  if (tipo === 'spec') {
    if (!spec) error(`rama ${rama}`, `no existe specs/${nnn}-…/`);
    else if (spec.estado !== 'aprobada') error(`rama ${rama}`, 'en el PR de spec, "Estado:" debe ser "aprobada": queda aprobada al mergear');
    const permitido = (f) => f.startsWith(`specs/${spec ? spec.nombre : nnn}/`) || f.startsWith('docs/adr/') || f.startsWith('docs/design');
    for (const f of cambiados) if (!permitido(f)) error(`rama ${rama}`, `una rama spec solo toca su carpeta de spec, docs/adr/ y docs/design*: ${f}`);
  }
  if (tipo === 'impl') {
    if (!spec) error(`rama ${rama}`, `no existe specs/${nnn}-…/ en esta rama`);
    else if (!['aprobada', 'implementada'].includes(spec.estado)) error(`rama ${rama}`, 'la spec no está aprobada: primero su PR de spec');
    if (spec) {
      let diff = '';
      try { diff = git(`diff ${base}...HEAD -- specs/${spec.nombre}/spec.md`); } catch {}
      const cambios = diff.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l));
      if (cambios.some((l) => !/^[+-]Estado:/.test(l))) error(`rama ${rama}`, 'la spec cambió en una rama impl: los cambios de requisitos van por /sdd-change en una rama spec');
    }
    for (const c of commits) if (!new RegExp(`^${nnn}/(T\\d+|V): \\S`).test(c)) aviso(`rama ${rama}`, `commit fuera de convención "${nnn}/Tn: …" o "${nnn}/V: …": ${c}`);
  }
  if (tipo === 'fix') {
    for (const c of commits) if (!new RegExp(`^${nnn}: \\S`).test(c)) aviso(`rama ${rama}`, `commit fuera de convención "${nnn}: …": ${c}`);
  }
  if (tipo !== 'contrato' && tocaContrato) error(`rama ${rama}`, 'contrato/ solo se modifica en una rama contrato/NNN-… con su ADR');
  if (tipo === 'contrato' && !cambiados.some((f) => f.startsWith('docs/adr/'))) aviso(`rama ${rama}`, 'un cambio de contrato debería venir con su ADR en docs/adr/');
}

const raiz = path.join(process.cwd(), 'specs');
const specs = fs.existsSync(raiz)
  ? fs.readdirSync(raiz, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => revisarSpec(path.join(raiz, d.name)))
  : [];
const rama = opcion('--rama');
if (rama) revisarRama(rama, opcion('--base') || 'origin/main', specs);

for (const a of avisos) console.log(`AVISO  ${a}`);
for (const e of errores) console.log(`ERROR  ${e}`);
console.log(errores.length ? `\n${errores.length} error(es). Corregirlos antes del PR.` : `\nspec-check OK (${specs.filter(Boolean).length} spec(s)).`);
process.exit(errores.length ? 1 : 0);
