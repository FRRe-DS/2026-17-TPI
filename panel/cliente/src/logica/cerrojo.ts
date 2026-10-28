// El cerrojo de la vista «Demostración» (spec 072, T14 y T15, RNF-07.6): mientras una ejecución corre, ninguna otra arranca. Los
// casos, las pruebas simultáneas y la base comparten M2 y el M6 simulado, y los casos de resiliencia lo ponen en «caído»: correrlos
// a la vez los mezclaría. Tomarlo es síncrono, así que un doble clic (que llega antes de que React vuelva a dibujar) lo ve ocupado.
// Se compone con `useSyncExternalStore` (`suscribir` y `activa`).
export function crearCerrojo<K extends string = string>() {
  let activa: K | undefined;
  const oyentes = new Set<() => void>();
  const avisar = () => oyentes.forEach((oyente) => oyente());

  const cerrojo = {
    // La clave de lo que está corriendo, o `undefined` si nada.
    activa: (): K | undefined => activa,
    suscribir(oyente: () => void): () => void {
      oyentes.add(oyente);
      return () => void oyentes.delete(oyente);
    },
    // `false` si ya hay una ejecución en curso.
    tomar(clave: K): boolean {
      if (activa !== undefined) return false;
      activa = clave;
      avisar();
      return true;
    },
    soltar(): void {
      if (activa === undefined) return;
      activa = undefined;
      avisar();
    },
    // Corre `funcion` con el cerrojo tomado y lo suelta al terminar, también si falla. Con el cerrojo ocupado no la corre.
    async ejecutar<T>(clave: K, funcion: () => Promise<T>): Promise<T | undefined> {
      if (!cerrojo.tomar(clave)) return undefined;
      try {
        return await funcion();
      } finally {
        cerrojo.soltar();
      }
    },
  };
  return cerrojo;
}

export type Cerrojo = ReturnType<typeof crearCerrojo<string>>;
