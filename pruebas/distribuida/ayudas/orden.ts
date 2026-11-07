import { BaseSequencer, type TestSpecification } from 'vitest/node';

// `resiliencia.test.ts` apaga a M6, que comparte con los demás archivos, así que corre al final (spec 081, plan «Resiliencia»).
// El orden por defecto de Vitest no lo garantiza: pone primero los que fallaron y los más largos, y ese es de los más largos.
export const ARCHIVO_ULTIMO = 'pruebas/distribuida/resiliencia.test.ts';
// Lo mismo con el de Keycloak caído (spec 080, T15): detiene Keycloak y reinicia M2, que comparten los archivos de su proyecto.
export const ARCHIVO_ULTIMO_KEYCLOAK = 'pruebas/keycloak/caido.test.ts';
const ULTIMOS = [ARCHIVO_ULTIMO, ARCHIVO_ULTIMO_KEYCLOAK];

const esElUltimo = ({ moduleId }: { moduleId: string }) => {
  const ruta = moduleId.replaceAll('\\', '/');
  return ULTIMOS.some((ultimo) => ruta.endsWith(`/${ultimo}`));
};

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
