import { BaseSequencer, type TestSpecification } from 'vitest/node';

// `resiliencia.test.ts` apaga a M6, que comparte con los demás archivos, así que corre al final (spec 081, plan «Resiliencia»).
// El orden por defecto de Vitest no lo garantiza: pone primero los que fallaron y los más largos, y ese es de los más largos.
export const ARCHIVO_ULTIMO = 'pruebas/distribuida/resiliencia.test.ts';

const esElUltimo = ({ moduleId }: { moduleId: string }) => moduleId.replaceAll('\\', '/').endsWith(`/${ARCHIVO_ULTIMO}`);

export const conResilienciaAlFinal = <T extends { moduleId: string }>(archivos: readonly T[]): T[] => [
  ...archivos.filter((archivo) => !esElUltimo(archivo)),
  ...archivos.filter(esElUltimo),
];

// Vitest lee el orden de la configuración raíz, para todos los proyectos: los demás quedan como estaban.
export class OrdenDeArchivos extends BaseSequencer {
  override async sort(archivos: TestSpecification[]): Promise<TestSpecification[]> {
    return conResilienciaAlFinal(await super.sort(archivos));
  }
}
