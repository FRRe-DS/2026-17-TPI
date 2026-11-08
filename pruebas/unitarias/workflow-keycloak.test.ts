import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

// El job `keycloak` de ci.yml (spec 080, T16, RNF-07.13): la prueba con Keycloak real en cada PR. Solo baja imágenes públicas, y
// no es uno de los checks que exige la protección de `main` (RNF-17.2).
type Paso = { name?: string; uses?: string; run?: string; if?: string; env?: Record<string, string> };
type Job = { needs?: string | string[]; 'runs-on': string; 'timeout-minutes'?: number; steps: Paso[] };
type Flujo = { on: Record<string, unknown>; jobs: Record<string, Job> };

const flujo = parseYaml(readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')) as Flujo;
const job = flujo.jobs['keycloak'];
const pasos = job?.steps ?? [];

describe('.github/workflows/ci.yml, job keycloak (RNF-07.13)', () => {
  it('existe y corre en cada PR a main', () => {
    expect(job).toBeDefined();
    expect(flujo.on['pull_request']).toEqual({ branches: ['main'] });
    expect(job?.['runs-on']).toBe('ubuntu-24.04');
    expect(job?.['timeout-minutes']).toBeGreaterThan(0);
  });

  it('corre npm run keycloak:test', () => {
    expect(pasos.some((paso) => paso.run?.trim() === 'npm run keycloak:test')).toBe(true);
  });

  // global.ts baja el entorno al terminar, también si falla: sin M2_DEJAR_LEVANTADO los logs ya no estarían.
  it('deja el entorno levantado para leer sus logs si falla, y lo baja siempre después', () => {
    const prueba = pasos.find((paso) => paso.run?.trim() === 'npm run keycloak:test');
    expect(prueba?.env?.['M2_DEJAR_LEVANTADO']).toBe('1');
    const logs = pasos.find((paso) => paso.run?.includes('compose -p m2-keycloak') && paso.run.includes(' logs'));
    expect(logs?.if).toBe('failure()');
    const bajar = pasos.find((paso) => paso.run?.includes('compose -p m2-keycloak') && paso.run.includes('down -v'));
    expect(bajar?.if).toBe('always()');
    expect(pasos.indexOf(bajar as Paso)).toBeGreaterThan(pasos.indexOf(logs as Paso));
    // Con el mismo archivo de variables que la prueba: sin él, compose no ve el perfil `keycloak` ni los puertos.
    for (const paso of [logs, bajar]) expect(paso?.run).toContain('--env-file ejemplo-keycloak.env');
  });

  // La regla «Protección de main» exige estos checks por nombre: si uno se renombra o desaparece, los PR quedan esperándolo.
  it('no cambia los nombres de los jobs que exige la protección de main', () => {
    for (const nombre of ['specs', 'contrato', 'build-test', 'contract-test']) expect(flujo.jobs[nombre], nombre).toBeDefined();
  });
});
