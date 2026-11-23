import { createHash, randomBytes } from 'node:crypto';

const MAXIMO_REGISTROS = 1000;
const LIMPIEZA_MS = 60_000;
const IDENTIFICADOR = /^[A-Za-z0-9_-]{43}$/;

export class CapacidadAgotada extends Error {
  override readonly name = 'CapacidadAgotada';
  constructor() { super('Capacidad del almacén agotada'); }
}

export class AlmacenCerrado extends Error {
  override readonly name = 'AlmacenCerrado';
  constructor() { super('El almacén está cerrado'); }
}

export type Reloj = () => number;
export const nuevoIdentificador = (): string => randomBytes(32).toString('base64url');
export const identificadorValido = (id: string | undefined): id is string => typeof id === 'string' && IDENTIFICADOR.test(id);
export const resumirIdentificador = (id: string): string => createHash('sha256').update(id).digest('hex');

// Solo los hashes se usan como claves. Los datos se copian al entrar y salir para que nadie cambie el estado por referencia.
// Es interno al servidor: las rutas futuras deben traducir sus errores controlados, sin serializar credenciales.
export function crearAlmacen<T>(haVencido: (dato: T, ahora: number) => boolean, ahora: Reloj = Date.now) {
  const datos = new Map<string, T>();
  let cerrado = false;

  const limpiar = () => {
    const instante = ahora();
    for (const [clave, dato] of datos) if (haVencido(dato, instante)) datos.delete(clave);
  };
  const temporizador = setInterval(limpiar, LIMPIEZA_MS);
  temporizador.unref();

  const claveDe = (id: string | undefined) => identificadorValido(id) ? resumirIdentificador(id) : undefined;

  return {
    crear(dato: T): string {
      if (cerrado) throw new AlmacenCerrado();
      limpiar();
      if (datos.size >= MAXIMO_REGISTROS) throw new CapacidadAgotada();
      let id: string;
      let clave: string;
      do { id = nuevoIdentificador(); clave = resumirIdentificador(id); } while (datos.has(clave));
      datos.set(clave, structuredClone(dato));
      return id;
    },
    obtener(id: string | undefined): T | undefined {
      limpiar();
      const clave = claveDe(id);
      const dato = clave === undefined ? undefined : datos.get(clave);
      return dato === undefined ? undefined : structuredClone(dato);
    },
    actualizar(id: string | undefined, dato: T): boolean {
      limpiar();
      const clave = claveDe(id);
      if (clave === undefined || !datos.has(clave)) return false;
      datos.set(clave, structuredClone(dato));
      return true;
    },
    eliminar(id: string | undefined): boolean {
      limpiar();
      const clave = claveDe(id);
      return clave !== undefined && datos.delete(clave);
    },
    limpiar,
    // Cantidad retenida en memoria, útil para verificar la limpieza periódica sin dispararla desde la consulta.
    cantidad: () => datos.size,
    cerrar() {
      cerrado = true;
      clearInterval(temporizador);
      datos.clear();
    },
  };
}
