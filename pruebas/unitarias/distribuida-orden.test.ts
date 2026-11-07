import { describe, expect, it } from 'vitest';
import { ARCHIVO_ULTIMO, conResilienciaAlFinal } from '../distribuida/ayudas/orden.js';

// `resiliencia.test.ts` apaga a M6: si corriera antes que otro archivo, ese otro fallaría (spec 081, T7).
describe('conResilienciaAlFinal (RNF-13.8)', () => {
  const archivo = (nombre: string) => ({ moduleId: `/repo/pruebas/distribuida/${nombre}.test.ts` });

  it('pasa resiliencia al final y deja a los demás en el mismo orden', () => {
    const orden = conResilienciaAlFinal([archivo('resiliencia'), archivo('historial'), archivo('salud')]);
    expect(orden.map((a) => a.moduleId)).toEqual([archivo('historial').moduleId, archivo('salud').moduleId, archivo('resiliencia').moduleId]);
  });

  it('reconoce la ruta con barras de Windows', () => {
    const windows = { moduleId: `C:\\repo\\${ARCHIVO_ULTIMO.replaceAll('/', '\\')}` };
    const otro = archivo('salud');
    expect(conResilienciaAlFinal([windows, otro])).toEqual([otro, windows]);
  });

  it('no toca una lista sin resiliencia, ni un archivo de otra carpeta con el mismo nombre', () => {
    const ajeno = { moduleId: '/repo/pruebas/integracion/resiliencia.test.ts' };
    const lista = [ajeno, archivo('salud')];
    expect(conResilienciaAlFinal(lista)).toEqual(lista);
  });
});
