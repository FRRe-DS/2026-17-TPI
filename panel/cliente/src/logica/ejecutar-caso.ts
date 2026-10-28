import type { ModoM6 } from '../api/panel.js';
import type { Caso, Esperado, IdentidadDelPaso, Paso } from './casos.js';
import { compararRespuesta, ENCABEZADOS_RELEVANTES, type RespuestaObservada, type Veredicto } from './resultado.js';

// Ejecuta los casos del catálogo (spec 072, T11, RNF-07.4, RNF-07.6): para cada uno, prepara lo suyo, manda la prueba, compara
// con lo esperado y devuelve lo que se mandó, lo que llegó y el veredicto. No sabe de red ni de navegador: el `pedir` que manda
// cada pedido y el control del M6 simulado llegan por el entorno (T13 los conecta al panel), así se prueba sin nada levantado.

// Un pedido tal como lo manda el entorno: `identidad` null es sin token; `clave` es la Idempotency-Key.
export type PedidoDelCaso = {
  metodo: Paso['metodo'];
  ruta: string;
  identidad: { rol: IdentidadDelPaso['rol']; sub: string } | null;
  clave: string | undefined;
  cuerpo: unknown;
};

// Lo que contesta el entorno: nombres de encabezado en minúsculas y el cuerpo ya interpretado, si lo había. Si no hubo respuesta
// (M2 no contesta, se cortó el tiempo), `pedir` lanza el error.
export type RespuestaDelCaso = { estado: number; encabezados: Record<string, string>; cuerpo?: unknown };

export type EntornoDeCasos = {
  pedir: (pedido: PedidoDelCaso) => Promise<RespuestaDelCaso>;
  // El canal de control del M6 simulado: lo que usan los casos de resiliencia para dejarlo «caído» solo durante la prueba.
  viajes: {
    estado: () => Promise<{ modo: ModoM6 }>;
    ponerModo: (modo: ModoM6) => Promise<unknown>;
  };
  uuid?: () => string;
};

export type ResultadoDeCaso = {
  casoId: string;
  pedido?: PedidoDelCaso;
  respuesta?: RespuestaObservada;
  esperado: Esperado;
  veredicto: Veredicto;
};

export type Avance = { hechos: number; total: number; ultimo?: ResultadoDeCaso };
export type ResumenDeEjecucion = { correctos: number; incorrectos: number; resultados: ResultadoDeCaso[] };

const mensaje = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// El valor que dice `camino` dentro de `cuerpo`, como texto, o undefined si no está. Campos separados por punto; en una lista,
// `campo:valor` elige el elemento cuyo `campo` vale `valor`. Solo textos y números: un objeto no es un valor.
export function leerCamino(cuerpo: unknown, camino: string): string | undefined {
  let actual: unknown = cuerpo;
  for (const segmento of camino.split('.')) {
    const separador = segmento.indexOf(':');
    if (separador >= 0) {
      if (!Array.isArray(actual)) return undefined;
      const campo = segmento.slice(0, separador);
      const valor = segmento.slice(separador + 1);
      actual = actual.find((elemento) => typeof elemento === 'object' && elemento !== null && Object.hasOwn(elemento, campo) && String((elemento as Record<string, unknown>)[campo]) === valor);
    } else {
      if (typeof actual !== 'object' || actual === null || Array.isArray(actual) || !Object.hasOwn(actual, segmento)) return undefined;
      actual = (actual as Record<string, unknown>)[segmento];
    }
  }
  return typeof actual === 'string' || typeof actual === 'number' ? String(actual) : undefined;
}

// Lo que se ve de la respuesta: el código, el `type` del problema, el cuerpo y solo los encabezados relevantes.
function observar(respuesta: RespuestaDelCaso): RespuestaObservada {
  const encabezados: Record<string, string> = {};
  for (const [nombre, valor] of Object.entries(respuesta.encabezados)) {
    const minuscula = nombre.toLowerCase();
    if ((ENCABEZADOS_RELEVANTES as readonly string[]).includes(minuscula)) encabezados[minuscula] = valor;
  }
  const type = typeof respuesta.cuerpo === 'object' && respuesta.cuerpo !== null ? (respuesta.cuerpo as { type?: unknown }).type : undefined;
  return { estado: respuesta.estado, encabezados, ...(typeof type === 'string' ? { type } : {}), ...(respuesta.cuerpo === undefined ? {} : { cuerpo: respuesta.cuerpo }) };
}

export async function ejecutarCaso(caso: Caso, entorno: EntornoDeCasos): Promise<ResultadoDeCaso> {
  try {
    return await correr(caso, entorno);
  } catch (error) {
    return { casoId: caso.id, esperado: caso.esperado, veredicto: { correcto: false, motivo: `error inesperado: ${mensaje(error)}` } };
  }
}

async function correr(caso: Caso, entorno: EntornoDeCasos): Promise<ResultadoDeCaso> {
  const uuid = entorno.uuid ?? (() => crypto.randomUUID());
  const clienteId = uuid();
  const otroCliente = uuid();
  const subs: Record<IdentidadDelPaso['sub'], string> = { cliente: clienteId, 'otro-cliente': otroCliente, 'm5-despacho': uuid(), operador: uuid() };
  const variables: Record<string, string> = { clienteId, otroCliente };
  let ultimaClave: string | undefined;

  const reemplazar = <T>(valor: T): T => {
    if (typeof valor === 'string') {
      return valor.replace(/\{([A-Za-z][\w.]*)\}/g, (_texto, nombre: string) => {
        const reemplazo = variables[nombre];
        if (reemplazo === undefined) throw new Error(`la variable {${nombre}} no está definida`);
        return reemplazo;
      }) as T;
    }
    if (Array.isArray(valor)) return valor.map(reemplazar) as T;
    if (typeof valor === 'object' && valor !== null) return Object.fromEntries(Object.entries(valor).map(([campo, interno]) => [campo, reemplazar(interno)])) as T;
    return valor;
  };

  const armar = (paso: Paso): PedidoDelCaso => {
    let clave: string | undefined;
    if (paso.clave === 'nueva') clave = uuid();
    else if (paso.clave === 'la-anterior') {
      if (ultimaClave === undefined) throw new Error('no hay una clave anterior para repetir');
      clave = ultimaClave;
    }
    if (clave !== undefined) ultimaClave = clave;
    return {
      metodo: paso.metodo,
      ruta: reemplazar(paso.ruta),
      identidad: paso.identidad === null ? null : { rol: paso.identidad.rol, sub: subs[paso.identidad.sub] },
      clave,
      cuerpo: reemplazar(paso.cuerpo),
    };
  };

  type Enviado = { pedido: PedidoDelCaso; respuesta: RespuestaDelCaso; falla?: undefined } | { pedido: PedidoDelCaso; respuesta?: undefined; falla: string };
  const mandar = async (paso: Paso): Promise<Enviado> => {
    const pedido = armar(paso);
    try {
      return { pedido, respuesta: await entorno.pedir(pedido) };
    } catch (error) {
      return { pedido, falla: mensaje(error) };
    }
  };

  const incorrecto = (motivo: string, pedido?: PedidoDelCaso, respuesta?: RespuestaDelCaso): ResultadoDeCaso => ({
    casoId: caso.id,
    ...(pedido === undefined ? {} : { pedido }),
    ...(respuesta === undefined ? {} : { respuesta: observar(respuesta) }),
    esperado: caso.esperado,
    veredicto: { correcto: false, motivo },
  });

  for (const paso of caso.preparar) {
    const nombre = `${paso.metodo} ${paso.ruta}`;
    const enviado = await mandar(paso);
    if (enviado.falla !== undefined) return incorrecto(`no se pudo preparar: ${nombre} no tuvo respuesta (${enviado.falla})`, enviado.pedido);
    if (enviado.respuesta.estado < 200 || enviado.respuesta.estado >= 300) {
      return incorrecto(`no se pudo preparar: ${nombre} respondió ${enviado.respuesta.estado}`, enviado.pedido, enviado.respuesta);
    }
    for (const [variable, camino] of Object.entries(paso.guardar ?? {})) {
      const valor = leerCamino(enviado.respuesta.cuerpo, camino);
      if (valor === undefined) return incorrecto(`no se pudo preparar: la respuesta de ${nombre} no trae ${variable}`, enviado.pedido, enviado.respuesta);
      variables[variable] = valor;
    }
  }

  const probar = async (): Promise<ResultadoDeCaso> => {
    const enviado = await mandar(caso.prueba);
    if (enviado.falla !== undefined) return incorrecto(`sin respuesta: ${enviado.falla}`, enviado.pedido);
    const respuesta = observar(enviado.respuesta);
    return { casoId: caso.id, pedido: enviado.pedido, respuesta, esperado: caso.esperado, veredicto: compararRespuesta(caso.esperado, respuesta) };
  };

  if (caso.area !== 'resiliencia') return probar();

  // Resiliencia: el M6 simulado queda «caído» solo durante la prueba y se repone sí o sí, en el modo en que estaba.
  let previo: ModoM6 | undefined;
  try {
    previo = (await entorno.viajes.estado()).modo;
    await entorno.viajes.ponerModo('caido');
  } catch (error) {
    if (previo !== undefined) await entorno.viajes.ponerModo(previo).catch(() => undefined);
    return incorrecto(`no se pudo preparar: el canal de control del M6 simulado no respondió (${mensaje(error)})`);
  }

  let resultado: ResultadoDeCaso | undefined;
  let falloDeLaPrueba: unknown;
  try {
    resultado = await probar();
  } catch (error) {
    falloDeLaPrueba = error;
  }
  try {
    await entorno.viajes.ponerModo(previo);
  } catch (error) {
    return { ...(resultado ?? incorrecto('')), veredicto: { correcto: false, motivo: `no se pudo reponer el modo ${previo} del M6 simulado (${mensaje(error)})` } };
  }
  if (falloDeLaPrueba !== undefined) throw falloDeLaPrueba;
  return resultado!;
}

// Todos los casos, uno tras otro y nunca en paralelo (RNF-07.6): comparten M2 y el M6 simulado. Un ✘ o una excepción no corta la
// tanda. La señal corta entre un caso y el siguiente.
export async function ejecutarTodo(casos: readonly Caso[], entorno: EntornoDeCasos, alAvanzar?: (avance: Avance) => void, senal?: AbortSignal): Promise<ResumenDeEjecucion> {
  const resultados: ResultadoDeCaso[] = [];
  alAvanzar?.({ hechos: 0, total: casos.length });
  for (const caso of casos) {
    if (senal?.aborted) break;
    const ultimo = await ejecutarCaso(caso, entorno);
    resultados.push(ultimo);
    alAvanzar?.({ hechos: resultados.length, total: casos.length, ultimo });
  }
  const correctos = resultados.filter((resultado) => resultado.veredicto.correcto).length;
  return { correctos, incorrectos: resultados.length - correctos, resultados };
}
