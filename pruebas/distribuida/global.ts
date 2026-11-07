import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';
import { compose, esperarSalud, URL_M2, URL_M6 } from './ayudas/entorno.js';

declare module 'vitest' {
  export interface ProvidedContext {
    // Donde se cuentan los pedidos a M6 de toda la corrida (ayudas/contador.ts).
    archivoPedidos: string;
  }
}

// Levanta el entorno distribuido antes de la primera prueba y lo baja al terminar (spec 081, RNF-07.7). Con M2_DEJAR_LEVANTADO=1 lo
// deja levantado para mirarlo o repetir la corrida. Si Docker no está o el build falla, esto lanza un error que dice qué falló:
// la corrida termina en rojo, no saltada.
export default async function levantarEntorno(proyecto: TestProject): Promise<() => Promise<void>> {
  const carpeta = mkdtempSync(join(tmpdir(), 'm2-distribuida-'));
  const borrarCuenta = () => {
    rmSync(carpeta, { recursive: true, force: true });
  };
  proyecto.provide('archivoPedidos', join(carpeta, 'pedidos-a-m6'));
  try {
    await compose(['up', '-d', '--build', '--wait']);
    await esperarSalud('M2', URL_M2);
    await esperarSalud('M6', URL_M6);
  } catch (error) {
    borrarCuenta();
    // Lo que alcanzó a levantarse no queda colgado, salvo que la persona haya pedido dejarlo.
    if (process.env['M2_DEJAR_LEVANTADO'] !== '1') await compose(['down', '-v']).catch(() => undefined);
    throw error;
  }
  return async () => {
    borrarCuenta();
    if (process.env['M2_DEJAR_LEVANTADO'] === '1') return;
    await compose(['down', '-v']);
  };
}
