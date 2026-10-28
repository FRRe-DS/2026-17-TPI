import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { Entorno } from './config.js';

// `ejemplo.env` escribe cada valor como VARIABLE=${VARIABLE:-valor}, que Docker Compose interpola y Node no. Para correr el panel
// como proceso (`npm run panel`) se leen esos valores por defecto acá. Solo `ejemplo.env`, nunca `.env` (RNF-06.3).
const LINEA = /^([A-Z][A-Z0-9_]*)=\$\{\1:-([^}]*)\}$/;

// Lo único que el panel y el M6 simulado toman del ejemplo. M2_URL_BD y POSTGRES_PASSWORD quedan afuera: el panel solo usa PANEL_URL_BD.
const VARIABLES_DE_TOKENS = [
  'M2_CLAVE_TOKENS',
  'M2_EMISOR_TOKENS',
  'M2_AUDIENCIA_TOKENS',
  'M2_CAMPO_ROLES',
  'M2_AUDIENCIA_M6',
  'M2_TIEMPO_MODULOS_MS',
];

const esDelPanel = (variable: string) =>
  variable.startsWith('PANEL_') || variable.startsWith('M6_') || VARIABLES_DE_TOKENS.includes(variable);

export function valoresDeEjemplo(texto: string): Record<string, string> {
  const valores: Record<string, string> = {};
  for (const linea of texto.replaceAll('\r\n', '\n').split('\n')) {
    const coincide = LINEA.exec(linea);
    if (coincide?.[1] !== undefined && coincide[2] !== undefined && esDelPanel(coincide[1])) valores[coincide[1]] = coincide[2];
  }
  return valores;
}

// Una variable ya definida manda sobre el ejemplo; una vacía cuenta como no definida, igual que en Compose (`:-`).
export function completarEntorno(env: Entorno, ejemplo: Readonly<Record<string, string>>): Record<string, string | undefined> {
  const completo: Record<string, string | undefined> = { ...env };
  for (const [variable, valor] of Object.entries(ejemplo)) completo[variable] ||= valor;
  return completo;
}

export function cargarEntornoEjemplo(env: Entorno, ruta: string | URL): Record<string, string | undefined> {
  const nombre = basename(typeof ruta === 'string' ? ruta : ruta.pathname);
  if (nombre !== 'ejemplo.env') throw new Error(`Solo se lee ejemplo.env, no ${nombre}`);
  return completarEntorno(env, valoresDeEjemplo(readFileSync(ruta, 'utf8')));
}
