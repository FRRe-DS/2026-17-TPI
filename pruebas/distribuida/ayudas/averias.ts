// Provoca una avería, corre `cuerpo` y restablece, pase lo que pase (spec 081, plan «Resiliencia»): si un paso falla, M6 no queda
// apagado para lo que sigue. Si además falla restablecer, salen las dos fallas: esa última no tapa a la que explica la prueba roja.
export async function conAveria<T>(
  averiar: () => Promise<void>,
  restablecer: () => Promise<void>,
  cuerpo: () => Promise<T>,
): Promise<T> {
  const fallas: unknown[] = [];
  try {
    await averiar();
    return await cuerpo();
  } catch (falla) {
    fallas.push(falla);
    throw falla;
  } finally {
    await restablecer().catch((falla: unknown) => {
      throw fallas.length === 0 ? falla : new AggregateError([...fallas, falla], 'Falló la prueba y además no se pudo restablecer a M6.');
    });
  }
}
