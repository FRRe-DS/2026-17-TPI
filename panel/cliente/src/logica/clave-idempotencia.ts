// La `Idempotency-Key` de un envío (RF-2.5.15, plan «Calificar sin duplicar»): se genera al abrir el formulario, se conserva ante un
// error o un tiempo agotado, para que «Reintentar» mande la misma, y se descarta tras un éxito o al cerrar el formulario. Un tiempo
// agotado no dice si M2 guardó el envío: con la misma clave, M2 devuelve la respuesta original y no lo duplica.
export type ClaveDeIdempotencia = {
  // Genera una clave nueva y la deja como la actual. Quien abre el formulario la llama una vez.
  abrir(): string;
  // La clave abierta, o `undefined` si no hay (no se abrió, o se descartó).
  actual(): string | undefined;
  // La abierta o, si no hay, una nueva: el envío siguiente a un éxito no reusa la clave del anterior.
  obtener(): string;
  descartar(): void;
};

export function crearClaveDeIdempotencia(generar: () => string = () => crypto.randomUUID()): ClaveDeIdempotencia {
  let clave: string | undefined;
  return {
    abrir: () => (clave = generar()),
    actual: () => clave,
    obtener: () => (clave ??= generar()),
    descartar: () => {
      clave = undefined;
    },
  };
}
