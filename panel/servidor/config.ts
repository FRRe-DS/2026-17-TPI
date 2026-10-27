import { isIP } from 'node:net';

// El panel tiene su propio lector de configuración, con la misma forma que el de M2 (src/config.ts): no puede importarlo porque
// se compila aparte, con `panel/` como raíz (plan, Estructura). Todas las variables nuevas tienen valor por defecto (RNF-06.4).

export type Entorno = Readonly<Record<string, string | undefined>>;

// Cada error nombra la variable y dice qué le pasa. Nunca repite el valor recibido, que puede ser un secreto (RNF-19.3).
export type ErrorConfig = { variable: string; motivo: string };

export type ResultadoConfig<T> = { config: T; errores?: undefined } | { config?: undefined; errores: ErrorConfig[] };

// Con lo que se firman y se verifican los tokens: son las M2_* que ya existen, las mismas que usa M2.
type ConfigTokens = {
  claveTokens: string;
  emisorTokens: string;
  audienciaTokens: string;
  campoRoles: string;
};

export type ConfigPanel = ConfigTokens & {
  puerto: number;
  escucha: string;
  // Dónde está M2 para el servidor del panel, y dónde lo ve quien copia el `curl` del detalle técnico (RNF-14.9).
  urlM2: string;
  urlM2Publica: string;
  urlM6Control: string;
};

export type ConfigM6 = ConfigTokens & {
  puerto: number;
  puertoControl: number;
  retardoLentoMs: number;
  // Audiencia (`aud`) del token de servicio con el que M2 se presenta ante M6 (RNF-13.7).
  audienciaM6: string;
};

type Regla<T> = { motivo: string; convertir: (texto: string) => T | undefined };

const LARGO_MINIMO_CLAVE = 32;
const TIEMPO_MODULOS_MS = 2000;
const RETARDO_LENTO_MS = 5000;

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

const puerto = enteroEntre(1, 65535);

// Hasta 2³¹ − 1, el mayor que aceptan los temporizadores de Node.
const tiempoEnMs = enteroEntre(1, 2147483647);

const claveDeTokens: Regla<string> = {
  motivo: `tiene menos de ${LARGO_MINIMO_CLAVE} caracteres`,
  convertir: (texto) => (texto.length >= LARGO_MINIMO_CLAVE ? texto : undefined),
};

const direccionIp: Regla<string> = {
  motivo: 'no es una dirección IP',
  convertir: (texto) => (isIP(texto) !== 0 ? texto : undefined),
};

// http o https, con una dirección válida y sin usuario ni contraseña, que `fetch` copia en sus errores y llegarían al log
// (RNF-19.3). Se guarda sin la barra final, porque a la URL se le suman rutas que empiezan con una.
const urlHttp: Regla<string> = {
  motivo: 'no es una URL http:// o https:// sin usuario ni contraseña',
  convertir: (texto) => {
    if (!/^https?:\/\//i.test(texto) || !URL.canParse(texto)) return undefined;
    const url = new URL(texto);
    return url.username === '' && url.password === '' ? texto.replace(/\/+$/, '') : undefined;
  },
};

const textoSinEspaciosAlBorde: Regla<string> = {
  motivo: 'está en blanco o tiene espacios al principio o al final',
  convertir: (texto) => (texto.trim() === texto && texto !== '' ? texto : undefined),
};

// Lee las variables de a una y junta los errores, para informar todos juntos. Una variable vacía cuenta como no definida.
function crearLector(env: Entorno) {
  const errores: ErrorConfig[] = [];

  const rechazar = <T>(variable: string, motivo: string, relleno: T): T => {
    errores.push({ variable, motivo });
    return relleno;
  };
  const texto = (variable: string): string | undefined => env[variable] || undefined;

  return {
    rechazar,

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

export function cargarConfigPanel(env: Entorno): ResultadoConfig<ConfigPanel> {
  const lector = crearLector(env);
  return lector.resultado({
    puerto: lector.opcional('PANEL_PUERTO', 8083, puerto),
    escucha: lector.opcional('PANEL_ESCUCHA', '127.0.0.1', direccionIp),
    urlM2: lector.opcional('PANEL_URL_M2', 'http://localhost:8082', urlHttp),
    urlM2Publica: lector.opcional('PANEL_URL_M2_PUBLICA', 'http://localhost:8082', urlHttp),
    urlM6Control: lector.opcional('PANEL_URL_M6_CONTROL', 'http://localhost:3007', urlHttp),
    ...leerTokens(lector),
  });
}

export function cargarConfigM6(env: Entorno): ResultadoConfig<ConfigM6> {
  const lector = crearLector(env);
  const config: ConfigM6 = {
    puerto: lector.opcional('M6_PUERTO', 3006, puerto),
    puertoControl: lector.opcional('M6_PUERTO_CONTROL', 3007, puerto),
    retardoLentoMs: lector.opcional('M6_RETARDO_LENTO_MS', RETARDO_LENTO_MS, tiempoEnMs),
    audienciaM6: lector.opcional('M2_AUDIENCIA_M6', 'm6-viajes', textoSinEspaciosAlBorde),
    ...leerTokens(lector),
  };
  // El modo caído cierra el puerto de la API y el canal de control tiene que seguir abierto para volver a normal.
  if (config.puerto === config.puertoControl) lector.rechazar('M6_PUERTO_CONTROL', 'es igual a M6_PUERTO', undefined);
  // Si M2 esperara más que el retardo, el modo lento no haría fallar nada y la demostración mostraría lo contrario.
  const esperaDeM2 = lector.opcional('M2_TIEMPO_MODULOS_MS', TIEMPO_MODULOS_MS, tiempoEnMs);
  if (config.retardoLentoMs <= esperaDeM2) lector.rechazar('M6_RETARDO_LENTO_MS', 'no supera a M2_TIEMPO_MODULOS_MS', undefined);
  return lector.resultado(config);
}
