import { timingSafeEqual } from 'node:crypto';
import { crearAlmacen, identificadorValido, nuevoIdentificador, resumirIdentificador, type Reloj } from './almacen.js';

const VIGENCIA_MS = 5 * 60_000;

export type DatosTransaccion =
  | { tipo: 'ingreso'; nonce: string; verifier: string; retorno: string }
  | { tipo: 'salida'; retorno: string };

type Transaccion = { datos: DatosTransaccion; vinculoHash: string; venceEn: number };

export function crearAlmacenTransacciones(ahora: Reloj = Date.now) {
  const almacen = crearAlmacen<Transaccion>((dato, instante) => instante >= dato.venceEn, ahora);

  return {
    crear(datos: DatosTransaccion): { state: string; vinculo: string } {
      const vinculo = nuevoIdentificador();
      const state = almacen.crear({ datos, vinculoHash: resumirIdentificador(vinculo), venceEn: ahora() + VIGENCIA_MS });
      return { state, vinculo };
    },
    consumir(state: string | undefined, vinculo: string | undefined): DatosTransaccion | undefined {
      const transaccion = almacen.obtener(state);
      if (transaccion === undefined || !identificadorValido(vinculo)) return undefined;
      if (!timingSafeEqual(Buffer.from(transaccion.vinculoHash, 'hex'), Buffer.from(resumirIdentificador(vinculo), 'hex'))) {
        return undefined;
      }
      // Sin await: validar el vínculo y retirar el state es una sola operación antes del intercambio con Keycloak.
      return almacen.eliminar(state) ? transaccion.datos : undefined;
    },
    cantidad: almacen.cantidad,
    limpiar: almacen.limpiar,
    cerrar: almacen.cerrar,
  };
}
