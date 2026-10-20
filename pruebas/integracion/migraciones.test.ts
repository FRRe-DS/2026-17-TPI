// pruebas/integracion/migraciones.test.ts
// Cubre: T17 (migración inicial y segunda corrida sin efecto) y T18 (concurrencia, fallos, orden y plazo).
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { migrar } from '../../src/bd/migraciones.js';

// La URL del contenedor compartido la provee pruebas/ayudas/global.ts.
const urlBdAdmin = inject('urlBd');

// Crea una base de datos nueva en el contenedor y devuelve su URL.
// Cada prueba usa su propia base para no interferir con las demás.
async function crearBase(urlAdmin: string): Promise<string> {
  const nombre = `m2_t${Date.now()}`;
  const cliente = new pg.Client(urlAdmin);
  await cliente.connect();
  await cliente.query(`CREATE DATABASE "${nombre}"`);
  await cliente.end();
  const url = new URL(urlAdmin);
  url.pathname = `/${nombre}`;
  return url.toString();
}

// ── T17: migración inicial ────────────────────────────────────────────────────

describe('migrar() — migración inicial', () => {
  it('aplica la migración inicial y la anota en migraciones_aplicadas', async () => {
    const urlBd = await crearBase(urlBdAdmin);
    await migrar({ urlBd, tiempoBdMs: 5000 });

    const cliente = new pg.Client(urlBd);
    await cliente.connect();
    const resultado = await cliente.query<{ name: string }>(
      'SELECT name FROM migraciones_aplicadas ORDER BY run_on',
    );
    await cliente.end();

    expect(resultado.rows).toHaveLength(1);
    expect(resultado.rows[0].name).toMatch(/_inicial$/);
  });

  it('una segunda corrida no aplica nada', async () => {
    const urlBd = await crearBase(urlBdAdmin);
    await migrar({ urlBd, tiempoBdMs: 5000 });
    await migrar({ urlBd, tiempoBdMs: 5000 });

    const cliente = new pg.Client(urlBd);
    await cliente.connect();
    const resultado = await cliente.query<{ total: string }>(
      'SELECT COUNT(*) AS total FROM migraciones_aplicadas',
    );
    await cliente.end();

    expect(Number(resultado.rows[0].total)).toBe(1);
  });
});

// ── T18: migraciones seguras (se agregan en T18) ──────────────────────────────
