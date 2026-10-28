import type { ResultadoRestriccion, ResultadoSimultaneo } from '../api/panel.js';

// Lo que muestra la sección «Integridad» de la vista de demostración (spec 072, T13, RNF-08.2 a RNF-08.4, RNF-05.5): el campo N, la
// tabla de respuestas por código y el veredicto de cada prueba. Funciones puras sobre lo que devolvió el panel.

export const N_MINIMO = 2;
export const N_MAXIMO = 50;
export const N_POR_DEFECTO = 10;

// La restricción de la base que tiene que rechazar el puntaje 9. La misma que prueba `servidor/demo/restriccion.ts`.
export const RESTRICCION_ESPERADA = 'calificaciones_puntaje_valido';

export type ValidacionDeN = { valido: true; n: number } | { valido: false; motivo: string };

// El campo N: solo dígitos y de 2 a 50. Lo mismo que valida el esquema de la ruta, pero antes, junto al campo.
export function validarN(texto: string): ValidacionDeN {
  const limpio = texto.trim();
  if (limpio === '') return { valido: false, motivo: `Escribí cuántos pedidos lanzar, de ${N_MINIMO} a ${N_MAXIMO}.` };
  const n = /^\d{1,6}$/.test(limpio) ? Number(limpio) : Number.NaN;
  if (!Number.isInteger(n) || n < N_MINIMO || n > N_MAXIMO) return { valido: false, motivo: `Tiene que ser un número entero de ${N_MINIMO} a ${N_MAXIMO}.` };
  return { valido: true, n };
}

export type Veredicto = { correcto: boolean; titulo: 'Correcto' | 'No coincide'; motivos: string[] };
const veredicto = (motivos: string[], servidorDiceQueCumple: boolean): Veredicto => {
  const todos = motivos.length === 0 && !servidorDiceQueCumple ? ['El servidor no dio la prueba por cumplida.'] : motivos;
  const correcto = todos.length === 0;
  return { correcto, titulo: correcto ? 'Correcto' : 'No coincide', motivos: todos };
};

export type FilaDeConteo = { codigo: string; etiqueta: string; obtenidas: number; esperadas: number; coincide: boolean };
export type FilasEnBase = { obtenidas: number | null; esperadas: number; coincide: boolean; motivo?: string };

// El código 0 es «sin respuesta»: va al final y se llama así. Los demás se ordenan como números.
const SIN_RESPUESTA = '0';
const porCodigo = (a: string, b: string): number => (a === SIN_RESPUESTA ? 1 : b === SIN_RESPUESTA ? -1 : Number(a) - Number(b));

// La tabla de respuestas por código, con los códigos que llegaron y los que se esperaban, y la cantidad de filas en la base.
export function armarConteo(resultado: ResultadoSimultaneo): { filas: FilaDeConteo[]; filasEnBase: FilasEnBase } {
  const codigos = [...new Set([...Object.keys(resultado.porCodigo), ...Object.keys(resultado.esperado.porCodigo)])].sort(porCodigo);
  const filas = codigos.map((codigo) => {
    const obtenidas = resultado.porCodigo[codigo] ?? 0;
    const esperadas = resultado.esperado.porCodigo[codigo] ?? 0;
    return { codigo, etiqueta: codigo === SIN_RESPUESTA ? 'Sin respuesta' : codigo, obtenidas, esperadas, coincide: obtenidas === esperadas };
  });
  const filasEnBase: FilasEnBase =
    resultado.filas === null
      ? { obtenidas: null, esperadas: resultado.esperado.filas, coincide: false, motivo: resultado.motivoFilas ?? 'la base no responde' }
      : { obtenidas: resultado.filas, esperadas: resultado.esperado.filas, coincide: resultado.filas === resultado.esperado.filas };
  return { filas, filasEnBase };
}

// ✔ o ✘ de una prueba simultánea. Manda el conteo y no el `cumple` del servidor: si el servidor dijera que cumple y el conteo no,
// se muestra lo que se ve; si dijera que no cumple y no hay otro motivo, se dice.
export function veredictoSimultaneo(resultado: ResultadoSimultaneo): Veredicto {
  const { filas, filasEnBase } = armarConteo(resultado);
  const motivos: string[] = [];
  for (const fila of filas) {
    if (fila.codigo === SIN_RESPUESTA || fila.coincide) continue;
    motivos.push(`Código ${fila.codigo}: se esperaba ${fila.esperadas}, llegaron ${fila.obtenidas}.`);
  }
  const sinRespuesta = resultado.porCodigo[SIN_RESPUESTA] ?? 0;
  if (sinRespuesta > 0) motivos.push(`Hubo ${sinRespuesta} ${sinRespuesta === 1 ? 'pedido sin respuesta' : 'pedidos sin respuesta'}.`);
  if (resultado.cuerposIguales === false) motivos.push('Los 201 no trajeron el mismo cuerpo.');
  if (filasEnBase.obtenidas === null) motivos.push(`No se pudieron contar las filas: ${filasEnBase.motivo}.`);
  else if (!filasEnBase.coincide) motivos.push(`Filas en la base: se esperaba ${filasEnBase.esperadas}, hay ${filasEnBase.obtenidas}.`);
  return veredicto(motivos, resultado.cumple);
}

// ✔ o ✘ de la prueba de la restricción: la base tiene que rechazar el puntaje 9 con su propia restricción y no cambiar nada.
export function veredictoDeRestriccion(resultado: ResultadoRestriccion): Veredicto {
  const motivos: string[] = [];
  if (resultado.filasAntes === null || resultado.filasDespues === null) {
    motivos.push(resultado.mensaje ?? 'No se pudieron contar las calificaciones de la base.');
    return veredicto(motivos, resultado.cumple);
  }
  if (resultado.restriccion === undefined) {
    motivos.push(resultado.codigo === undefined ? (resultado.mensaje ?? 'La base no rechazó el puntaje 9.') : `La base falló con el código ${resultado.codigo}${resultado.mensaje === undefined ? '' : `: ${resultado.mensaje}`}.`);
  } else if (resultado.restriccion !== RESTRICCION_ESPERADA) {
    motivos.push(`La base rechazó el puntaje 9 con otra restricción: ${resultado.restriccion}.`);
  }
  if (resultado.filasAntes !== resultado.filasDespues) motivos.push(`Cambió la cantidad de calificaciones: había ${resultado.filasAntes} y hay ${resultado.filasDespues}.`);
  return veredicto(motivos, resultado.cumple);
}
