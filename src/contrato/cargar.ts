import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

// El documento OpenAPI tal como está en el YAML. Cada parte del servicio mira solo lo que usa.
export type Contrato = Readonly<Record<string, unknown>>;

// Relativa a este archivo: vale desde src/ (pruebas) y desde dist/ (servicio), porque las dos están al lado de contrato/.
export const RUTA_CONTRATO = fileURLToPath(new URL('../../contrato/openapi.yml', import.meta.url));

// El servicio expone solo lo que dice el contrato (RNF-03.4): si no lo puede leer, no arranca. El error nombra el archivo.
export function cargarContrato(ruta: string = RUTA_CONTRATO): Contrato {
  try {
    return leer(readFileSync(ruta, 'utf8'));
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(`No se pudo leer el contrato ${ruta}: ${motivo}`, { cause: error });
  }
}

// parseDocument junta los avisos en vez de escribirlos en la consola, que solo lleva logs en JSON (RNF-14.5). Un aviso
// (una etiqueta desconocida, por ejemplo) también corta: el contrato no diría lo que parece decir.
function leer(texto: string): Contrato {
  const documento = parseDocument(texto);
  const [problema] = [...documento.errors, ...documento.warnings];
  if (problema) throw problema;
  const contrato: unknown = documento.toJS();
  if (typeof contrato !== 'object' || contrato === null || Array.isArray(contrato)) {
    throw new Error('no es un objeto YAML');
  }
  return contrato as Contrato;
}
