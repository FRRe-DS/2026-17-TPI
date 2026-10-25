import { validateHeaderName } from 'node:http';

export type Entorno = Readonly<Record<string, string | undefined>>;

// Cada error nombra la variable y dice qué le pasa. Nunca repite el valor recibido, que puede ser un secreto (RNF-06.2).
export type ErrorConfig = { variable: string; motivo: string };

export type ResultadoConfig<T> = { config: T; errores?: undefined } | { config?: undefined; errores: ErrorConfig[] };

// Lo que usan el servicio y el comando de tokens para firmar y validar.
export type ConfigTokens = {
  claveTokens: string;
  emisorTokens: string;
  audienciaTokens: string;
  campoRoles: string;
};

export type Config = ConfigTokens & {
  urlBd: string;
  puerto: number;
  tiempoBdMs: number;
  tiempoModulosMs: number;
  reintentosModulos: number;
  encabezadoCorrelacion: string;
  // M6 (spec 007): su URL base sin barra final, la credencial con la que M2 se presenta (si hay) y los segundos que
  // sugiere el `Retry-After` del 503 cuando M6 no está disponible (RF-2.4.6).
  urlM6: string;
  credencialM6: string | undefined;
  reintentarDespuesS: number;
};

// Una regla convierte el texto de una variable en su valor, o devuelve undefined si no la cumple.
type Regla<T> = { motivo: string; convertir: (texto: string) => T | undefined };

const LARGO_MINIMO_CLAVE = 32;

// Para las variables sin condición de validez: no falla nunca, así que no tiene motivo.
const cualquierTexto: Regla<string> = { motivo: '', convertir: (texto) => texto };

// Solo dígitos decimales: nada de signos, espacios, decimales ni notación científica.
function aEntero(texto: string): number | undefined {
  const numero = Number(texto);
  return /^\d+$/.test(texto) && Number.isSafeInteger(numero) ? numero : undefined;
}

const enteroEntre = (minimo: number, maximo: number): Regla<number> => ({
  motivo: `no es un entero entre ${minimo} y ${maximo}`,
  convertir: (texto) => {
    const numero = aEntero(texto);
    return numero !== undefined && numero >= minimo && numero <= maximo ? numero : undefined;
  },
});

// Los tiempos van de 1 ms hasta 2³¹ − 1, el mayor que aceptan los temporizadores de Node: con uno más, `setTimeout` y
// `AbortSignal.timeout` disparan casi al instante y toda consulta daría 503 (RNF-06.2).
const tiempoEnMs = enteroEntre(1, 2147483647);

const urlPostgres: Regla<string> = {
  motivo: 'no es una URL postgres:// o postgresql://',
  convertir: (texto) => (/^postgres(?:ql)?:\/\//i.test(texto) && URL.canParse(texto) ? texto : undefined),
};

const claveDeTokens: Regla<string> = {
  motivo: `tiene menos de ${LARGO_MINIMO_CLAVE} caracteres`,
  convertir: (texto) => (texto.length >= LARGO_MINIMO_CLAVE ? texto : undefined),
};

// La URL de otro módulo: http o https, con una dirección válida. Se guarda sin la barra final, porque el cliente le suma rutas
// que empiezan con una.
const urlHttp: Regla<string> = {
  motivo: 'no es una URL http:// o https://',
  convertir: (texto) => (/^https?:\/\//i.test(texto) && URL.canParse(texto) ? texto.replace(/\/+$/, '') : undefined),
};

// Va en `Authorization: Bearer <valor>`: solo caracteres visibles de ASCII, sin espacios ni saltos de línea.
const credencialDeModulo: Regla<string> = {
  motivo: 'tiene espacios o caracteres que no van en un encabezado',
  convertir: (texto) => (/^[\x21-\x7e]+$/.test(texto) ? texto : undefined),
};

// Es la misma regla que aplica Node al escribir el encabezado en una respuesta.
const nombreDeEncabezado: Regla<string> = {
  motivo: 'no es un nombre de encabezado HTTP válido',
  convertir: (texto) => {
    try {
      validateHeaderName(texto);
      return texto;
    } catch {
      return undefined;
    }
  },
};

// Lee las variables de a una y junta los errores, para informar todas juntas. Cuando una falla devuelve un valor de
// relleno (el valor por defecto, o '' si es obligatoria): con errores, la configuración no le llega a quien llama.
function crearLector(env: Entorno) {
  const errores: ErrorConfig[] = [];

  const rechazar = <T>(variable: string, motivo: string, relleno: T): T => {
    errores.push({ variable, motivo });
    return relleno;
  };

  // Una variable definida pero vacía cuenta como no definida.
  const texto = (variable: string): string | undefined => env[variable] || undefined;

  return {
    obligatoria(variable: string, regla: Regla<string> = cualquierTexto): string {
      const valor = texto(variable);
      if (valor === undefined) return rechazar(variable, 'es obligatoria y no tiene valor', '');
      return regla.convertir(valor) ?? rechazar(variable, regla.motivo, '');
    },

    opcional<T>(variable: string, porDefecto: T, regla: Regla<T>): T {
      const valor = texto(variable);
      if (valor === undefined) return porDefecto;
      return regla.convertir(valor) ?? rechazar(variable, regla.motivo, porDefecto);
    },

    resultado<T>(config: T): ResultadoConfig<T> {
      return errores.length > 0 ? { errores } : { config };
    },
  };
}

type Lector = ReturnType<typeof crearLector>;

function leerTokens(lector: Lector): ConfigTokens {
  return {
    claveTokens: lector.obligatoria('M2_CLAVE_TOKENS', claveDeTokens),
    emisorTokens: lector.obligatoria('M2_EMISOR_TOKENS'),
    audienciaTokens: lector.obligatoria('M2_AUDIENCIA_TOKENS'),
    campoRoles: lector.opcional('M2_CAMPO_ROLES', 'roles', cualquierTexto),
  };
}

// Valida solo lo que necesita el comando que genera tokens (RNF-12.5): no pide la base ni lo demás.
export function cargarConfigTokens(env: Entorno): ResultadoConfig<ConfigTokens> {
  const lector = crearLector(env);
  return lector.resultado(leerTokens(lector));
}

// Una línea por variable, como la tabla de Lógica 1 del plan (RNF-06.1, RNF-06.2).
export function cargarConfig(env: Entorno): ResultadoConfig<Config> {
  const lector = crearLector(env);
  return lector.resultado({
    urlBd: lector.obligatoria('M2_URL_BD', urlPostgres),
    puerto: lector.opcional('M2_PUERTO', 8082, enteroEntre(1, 65535)),
    ...leerTokens(lector),
    tiempoBdMs: lector.opcional('M2_TIEMPO_BD_MS', 2000, tiempoEnMs),
    tiempoModulosMs: lector.opcional('M2_TIEMPO_MODULOS_MS', 2000, tiempoEnMs),
    reintentosModulos: lector.opcional('M2_REINTENTOS_MODULOS', 1, enteroEntre(0, 5)),
    encabezadoCorrelacion: lector.opcional('M2_ENCABEZADO_CORRELACION', 'X-Request-Id', nombreDeEncabezado),
    urlM6: lector.obligatoria('M2_URL_M6', urlHttp),
    credencialM6: lector.opcional<string | undefined>('M2_CREDENCIAL_M6', undefined, credencialDeModulo),
    reintentarDespuesS: lector.opcional('M2_REINTENTAR_DESPUES_S', 5, enteroEntre(1, 3600)),
  });
}
