import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

// El job de CI de la prueba distribuida (spec 081, T8, RNF-07.7): aparte de ci.yml, porque construye el M6 del Grupo 12 desde su
// repositorio y tarda; no es uno de los checks de un PR ni de la protección de `main` (RNF-17.2).
type Paso = { name?: string; uses?: string; run?: string; if?: string; env?: Record<string, string> };
type Flujo = { on: Record<string, unknown>; permissions?: Record<string, string>; jobs: Record<string, { 'runs-on': string; 'timeout-minutes'?: number; steps: Paso[] }> };

const leer = (ruta: string) => parseYaml(readFileSync(new URL(`../../${ruta}`, import.meta.url), 'utf8')) as Flujo;
const flujo = leer('.github/workflows/integracion-m6.yml');
const pasos = Object.values(flujo.jobs).flatMap((job) => job.steps);

describe('.github/workflows/integracion-m6.yml (RNF-07.7)', () => {
  it('corre en push a main y a mano, y en nada más: no es un check de un PR', () => {
    expect(Object.keys(flujo.on).sort()).toEqual(['push', 'workflow_dispatch']);
    expect(flujo.on['push']).toEqual({ branches: ['main'] });
  });

  it('corre npm run integracion:m6', () => {
    expect(pasos.some((paso) => paso.run?.trim() === 'npm run integracion:m6')).toBe(true);
  });

  // global.ts baja el entorno al terminar, también si falla: sin M2_DEJAR_LEVANTADO los logs ya no estarían.
  it('deja el entorno levantado para leer sus logs si falla, y lo baja siempre después', () => {
    const prueba = pasos.find((paso) => paso.run?.trim() === 'npm run integracion:m6');
    expect(prueba?.env?.['M2_DEJAR_LEVANTADO']).toBe('1');
    const logs = pasos.find((paso) => paso.run?.includes('compose -p m2-distribuida --profile m6-real logs'));
    expect(logs?.if).toBe('failure()');
    const bajar = pasos.find((paso) => paso.run?.includes('compose -p m2-distribuida --profile m6-real down -v'));
    expect(bajar?.if).toBe('always()');
    expect(pasos.indexOf(bajar as Paso)).toBeGreaterThan(pasos.indexOf(logs as Paso));
  });

  it('usa las mismas versiones de actions y de Node que ci.yml, con permisos de solo lectura y un tiempo máximo', () => {
    const ci = leer('.github/workflows/ci.yml');
    const usadas = (f: Flujo) => new Set(Object.values(f.jobs).flatMap((job) => job.steps).flatMap((paso) => (paso.uses === undefined ? [] : [paso.uses])));
    for (const accion of usadas(flujo)) expect(usadas(ci), accion).toContain(accion);
    expect(flujo.permissions).toEqual({ contents: 'read' });
    for (const job of Object.values(flujo.jobs)) expect(job['timeout-minutes']).toBeGreaterThan(0);
  });
});
