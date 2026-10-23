// Los errores de la API en problem+json (RFC 9457) y `aProblema`, que convierte cualquier error en su respuesta
// (plan, Lógica 6). No importa nada: lo usan todos los demás componentes.

export type CuerpoProblema = {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
};

export type RespuestaProblema = {
  codigo: number;
  cuerpo: CuerpoProblema;
  encabezados: Record<string, string>;
};

type DatosProblema = {
  codigo: number;
  type?: string;
  title: string;
  detail: string;
  encabezados?: Readonly<Record<string, string>>;
};

const TIPO_GENERICO = 'about:blank';
const TITULO_SOLICITUD_INVALIDA = 'Solicitud inválida';
const TITULO_NO_DISPONIBLE = 'Servicio no disponible';

// Un error que ya sabe qué respuesta le corresponde. Sin `type` propio es genérico (`about:blank`); con uno, es un
// error de negocio que define el contrato. `message` es el `detail`, que se escribe sin datos internos: puede ir al log.
// `cause`, si la hay, es lo que lo provocó: va al log y nunca a la respuesta.
export class Problema extends Error {
  readonly codigo: number;
  readonly type: string;
  readonly title: string;
  readonly detail: string;
  readonly encabezados: Readonly<Record<string, string>>;

  constructor({ codigo, type = TIPO_GENERICO, title, detail, encabezados = {} }: DatosProblema, opciones?: ErrorOptions) {
    super(detail, opciones);
    this.name = new.target.name;
    this.codigo = codigo;
    this.type = type;
    this.title = title;
    this.detail = detail;
    this.encabezados = encabezados;
  }
}

// De `verificarToken`.
export class NoAutenticado extends Problema {
  constructor(motivo: string) {
    super({ codigo: 401, title: 'No autenticado', detail: motivo, encabezados: { 'WWW-Authenticate': 'Bearer' } });
  }
}

// De `autorizar` o, con `detail`, de una regla de propiedad (`exigirPropietario`). El `detail` no lleva datos de la solicitud
// (RNF-19).
export class SinPermiso extends Problema {
  constructor(detail = 'El rol del token no permite esta operación') {
    super({ codigo: 403, title: 'Sin permiso', detail });
  }
}

// De la solicitud a una ruta que no existe o, con `detail`, a un recurso que no existe. El `detail` no lleva datos de la
// solicitud (RNF-19).
export class NoEncontrado extends Problema {
  constructor(detail = 'No existe la ruta pedida') {
    super({ codigo: 404, title: 'No encontrado', detail });
  }
}

// De la solicitud a una ruta que existe, pero no con ese método. `metodos` son los que la ruta sí tiene.
export class MetodoNoPermitido extends Problema {
  constructor(metodos: Iterable<string>) {
    super({
      codigo: 405,
      title: 'Método no permitido',
      detail: 'La ruta solo admite los métodos de Allow',
      encabezados: { Allow: Array.from(metodos).join(', ') },
    });
  }
}

// De `consultar()`, ante una violación de restricción única. No lleva el nombre de la restricción ni la consulta (RNF-08.1).
export class Conflicto extends Problema {
  constructor() {
    super({ codigo: 409, title: 'Conflicto', detail: 'Ya existe un registro con esos datos' });
  }
}

// De `crearPerfil()`, cuando el clienteId ya tiene perfil (RF-2.1.3). No lleva el clienteId ni datos del perfil (RNF-19).
export class PerfilYaExiste extends Problema {
  constructor() {
    super({
      codigo: 409,
      type: '/errores/perfil-ya-existe',
      title: 'Perfil ya existe',
      detail: 'Ya existe un perfil para este usuario',
    });
  }
}

// De `conIdempotencia()`, cuando la Idempotency-Key ya se usó con otra solicitud (spec 004, Criterios). No lleva la clave
// (RNF-19).
export class IdempotenciaReutilizada extends Problema {
  constructor() {
    super({
      codigo: 422,
      type: '/errores/idempotencia-reutilizada',
      title: 'Clave de idempotencia reutilizada',
      detail: 'La Idempotency-Key ya se usó con otra solicitud',
    });
  }
}

// De `crearBloqueo`, cuando `hasta` no es posterior al instante de creación (spec 004, Casos límite). No lleva la fecha ni el
// motivo (RNF-19).
export class BloqueoVencido extends Problema {
  constructor() {
    super({
      codigo: 422,
      type: '/errores/bloqueo-vencido',
      title: 'Bloqueo vencido',
      detail: 'El fin del bloqueo tiene que ser posterior a su creación',
    });
  }
}

// De `crearBloqueo`, cuando `hasta` cae después del año 9999 en UTC: no se podría devolver en el formato date-time del
// contrato, que pide el año con cuatro cifras (RF-2.6.1.2). No lleva la fecha ni el motivo (RNF-19).
export class BloqueoHastaFueraDeRango extends Problema {
  constructor() {
    super({
      codigo: 422,
      type: '/errores/bloqueo-hasta-fuera-de-rango',
      title: 'Fin del bloqueo fuera de rango',
      detail: 'El fin del bloqueo tiene que ser anterior al año 10000 (UTC)',
    });
  }
}

// De `levantarBloqueo`, cuando el bloqueo ya fue levantado (RF-2.6.3.1). No lleva el bloqueoId ni los motivos (RNF-19).
export class BloqueoYaLevantado extends Problema {
  constructor() {
    super({
      codigo: 409,
      type: '/errores/bloqueo-ya-levantado',
      title: 'Bloqueo ya levantado',
      detail: 'El bloqueo ya fue levantado',
    });
  }
}

// De `levantarBloqueo`, cuando el bloqueo venció por su fecha sin que nadie lo levantara (RF-2.6.3.1, spec 004, Casos
// límite). No lleva el bloqueoId ni la fecha (RNF-19).
export class BloqueoNoVigente extends Problema {
  constructor() {
    super({
      codigo: 409,
      type: '/errores/bloqueo-no-vigente',
      title: 'Bloqueo no vigente',
      detail: 'El bloqueo ya venció: no se puede levantar',
    });
  }
}

// Del cliente de módulos, una vez agotados los intentos (RNF-13.3). `modulo` es cómo se lo nombra, por ejemplo «M6», y la
// `cause`, lo que falló en el último intento: la registra el manejador de errores (RNF-14.8).
export class ModuloNoDisponible extends Problema {
  constructor(modulo: string, opciones?: ErrorOptions) {
    super({ codigo: 503, title: TITULO_NO_DISPONIBLE, detail: `${modulo} no está disponible` }, opciones);
  }
}

// De `consultar()`, cuando la base no responde a tiempo o no se puede conectar. La `cause` es el error de pg o el corte de
// `conTiempoMaximo`: la registra el manejador de errores (RNF-14.8).
export class BaseNoDisponible extends Problema {
  constructor(opciones?: ErrorOptions) {
    super({ codigo: 503, title: TITULO_NO_DISPONIBLE, detail: 'La base de datos no está disponible' }, opciones);
  }
}

// Del hook de parada, para lo que llega por una conexión abierta mientras el servicio se detiene.
export class Deteniendose extends Problema {
  constructor() {
    super({ codigo: 503, title: TITULO_NO_DISPONIBLE, detail: 'El servicio se está deteniendo' });
  }
}

const SOLICITUD_ILEGIBLE: DatosProblema = {
  codigo: 400,
  title: TITULO_SOLICITUD_INVALIDA,
  detail: 'La solicitud no se pudo leer',
};

// Del manejador de errores de cliente de Node, cuando el HTTP no se puede leer y no hay un código más preciso.
export class SolicitudIlegible extends Problema {
  constructor() {
    super(SOLICITUD_ILEGIBLE);
  }
}

// De una regla de una operación que el esquema del contrato no puede expresar, como que el sub del token sea un UUID para
// crear un perfil (spec 004, Casos límite). El `detail` no lleva datos de la solicitud (RNF-19).
export class SolicitudInvalida extends Problema {
  constructor(detail: string) {
    super({ codigo: 400, title: TITULO_SOLICITUD_INVALIDA, detail });
  }
}

const JSON_INVALIDO: DatosProblema = {
  codigo: 400,
  title: TITULO_SOLICITUD_INVALIDA,
  detail: 'El cuerpo no es JSON válido',
};

// Fastify le pone 414 al parámetro largo, pero el contrato no documenta ese código: los dos son un 400 (RNF-03.2).
const URL_INVALIDA: DatosProblema = {
  codigo: 400,
  title: TITULO_SOLICITUD_INVALIDA,
  detail: 'La URL no es válida, o un parámetro de la ruta supera los 100 caracteres',
};

const ERROR_INTERNO: DatosProblema = { codigo: 500, title: 'Error interno', detail: 'Ocurrió un error interno' };

// Los errores de Fastify y de Node que tienen una fila propia en la tabla, por su `code`. Es un `Map` y no un objeto
// para que un código como `constructor` no encuentre nada.
const POR_CODIGO = new Map<string, DatosProblema>([
  ['FST_ERR_CTP_EMPTY_JSON_BODY', JSON_INVALIDO],
  ['FST_ERR_CTP_INVALID_JSON_BODY', JSON_INVALIDO],
  ['FST_ERR_BAD_URL', URL_INVALIDA],
  ['FST_ERR_MAX_PARAM_LENGTH', URL_INVALIDA],
  ['FST_ERR_CTP_INVALID_CONTENT_LENGTH', SOLICITUD_ILEGIBLE],
  [
    'FST_ERR_CTP_BODY_TOO_LARGE',
    { codigo: 413, title: 'Cuerpo demasiado grande', detail: 'El cuerpo supera 1 MiB' },
  ],
  [
    'FST_ERR_CTP_INVALID_MEDIA_TYPE',
    { codigo: 415, title: 'Tipo de contenido no soportado', detail: 'El cuerpo tiene que ser application/json' },
  ],
  [
    'ERR_HTTP_REQUEST_TIMEOUT',
    { codigo: 408, title: 'Tiempo agotado', detail: 'La solicitud no terminó de llegar a tiempo' },
  ],
  [
    'HPE_HEADER_OVERFLOW',
    { codigo: 431, title: 'Encabezados demasiado grandes', detail: 'Los encabezados superan 16 KiB' },
  ],
]);

// Un error de Ajv, tal como lo deja Fastify en `error.validation`: solo lo que se usa para armar el mensaje.
type ErrorAjv = { keyword: string; instancePath: string; params: Record<string, unknown> };

function esErrorAjv(valor: unknown): valor is ErrorAjv {
  if (typeof valor !== 'object' || valor === null) return false;
  const { keyword, instancePath, params } = valor as Partial<Record<keyof ErrorAjv, unknown>>;
  return (
    typeof keyword === 'string' && typeof instancePath === 'string' && typeof params === 'object' && params !== null
  );
}

// Cómo se nombra el dato según dónde estaba (`validationContext` de Fastify). `raiz` es el nombre del conjunto entero:
// solo el cuerpo puede fallar sin que haya un campo que nombrar (por ejemplo, si llega una lista en vez de un objeto).
type Lugar = { dato: string; en: string; de: string; raiz?: string };

const LUGARES = new Map<string, Lugar>([
  ['body', { dato: 'campo', en: ' en el cuerpo', de: ' del cuerpo', raiz: 'El cuerpo' }],
  ['params', { dato: 'parámetro', en: ' en la ruta', de: ' de la ruta' }],
  ['querystring', { dato: 'parámetro', en: ' en la query string', de: ' de la query string' }],
  ['headers', { dato: 'encabezado', en: '', de: '' }],
]);

const TIPOS = new Map([
  ['string', 'un texto'],
  ['integer', 'un número entero'],
  ['number', 'un número'],
  ['boolean', 'verdadero o falso'],
  ['array', 'una lista'],
  ['object', 'un objeto'],
  ['null', 'nulo'],
]);

const DETALLE_VALIDACION_GENERICO = 'La solicitud no es válida';

// "/direccion/calle" (JSON Pointer, con ~1 por / y ~0 por ~) pasa a ["direccion", "calle"].
const camino = (instancePath: string): string[] =>
  instancePath === ''
    ? []
    : instancePath
        .slice(1)
        .split('/')
        .map((segmento) => segmento.replaceAll('~1', '/').replaceAll('~0', '~'));

const cantidad = (valor: unknown, singular: string, plural: string): string =>
  `${Number(valor)} ${Number(valor) === 1 ? singular : plural}`;

// Lo que le pasa al dato, sin repetir su valor ni los valores permitidos: lo que mandó quien llama no vuelve en la respuesta.
function regla({ keyword, params }: ErrorAjv): string {
  switch (keyword) {
    case 'type':
      return `tiene que ser ${[params.type].flat().map((tipo) => TIPOS.get(String(tipo)) ?? String(tipo)).join(' o ')}`;
    case 'format':
      return `no tiene el formato ${String(params.format)}`;
    case 'enum':
      return 'no es uno de los valores permitidos';
    case 'const':
      return 'no tiene el valor esperado';
    case 'pattern':
      return 'no tiene el formato esperado';
    case 'uniqueItems':
      return 'no puede tener elementos repetidos';
    case 'minLength':
      return `tiene que tener al menos ${cantidad(params.limit, 'carácter', 'caracteres')}`;
    case 'maxLength':
      return `tiene que tener como máximo ${cantidad(params.limit, 'carácter', 'caracteres')}`;
    case 'minProperties':
      return `tiene que tener al menos ${cantidad(params.limit, 'campo', 'campos')}`;
    case 'minimum':
      return `tiene que ser mayor o igual que ${String(params.limit)}`;
    case 'maximum':
      return `tiene que ser menor o igual que ${String(params.limit)}`;
    default:
      return 'no es válido';
  }
}

// Nombra el primer campo con problemas (el esquema se valida con `allErrors: false`), por ejemplo «Falta el campo nombre en el cuerpo».
function detalleDeValidacion(error: unknown, contexto: unknown): string {
  const lugar = typeof contexto === 'string' ? LUGARES.get(contexto) : undefined;
  if (!esErrorAjv(error) || lugar === undefined) return DETALLE_VALIDACION_GENERICO;

  const ruta = camino(error.instancePath);
  if (error.keyword === 'required') {
    return `Falta el ${lugar.dato} ${[...ruta, String(error.params.missingProperty)].join('.')}${lugar.en}`;
  }
  if (error.keyword === 'additionalProperties') {
    return `El ${lugar.dato} ${[...ruta, String(error.params.additionalProperty)].join('.')} no está permitido${lugar.en}`;
  }
  const sujeto = ruta.length > 0 ? `El ${lugar.dato} ${ruta.join('.')}${lugar.de}` : lugar.raiz;
  return sujeto === undefined ? DETALLE_VALIDACION_GENERICO : `${sujeto} ${regla(error)}`;
}

function datosDe(error: unknown): DatosProblema {
  if (error instanceof Problema) return error;
  if (typeof error !== 'object' || error === null) return ERROR_INTERNO;

  const { code, validation, validationContext } = error as Partial<
    Record<'code' | 'validation' | 'validationContext', unknown>
  >;
  if (Array.isArray(validation) || code === 'FST_ERR_VALIDATION') {
    const primero: unknown = Array.isArray(validation) ? validation[0] : undefined;
    return {
      codigo: 400,
      title: TITULO_SOLICITUD_INVALIDA,
      detail: detalleDeValidacion(primero, validationContext),
    };
  }
  if (typeof code !== 'string') return ERROR_INTERNO;
  // Todo error del analizador HTTP de Node (HPE_*) es un HTTP que no se puede leer; solo el desborde de encabezados
  // tiene código propio.
  return POR_CODIGO.get(code) ?? (code.startsWith('HPE_') ? SOLICITUD_ILEGIBLE : ERROR_INTERNO);
}

// Devuelve el código, el cuerpo y los encabezados de la respuesta a `error`. `ruta` es la de la solicitud, con o sin
// query string (que se descarta); sin `ruta` (la solicitud no se pudo leer), el cuerpo va sin `instance`.
// Un error que no es un `Problema` ni uno de los que reconoce es un 500, y su mensaje no sale de acá (RNF-03.3).
export function aProblema(error: unknown, ruta?: string): RespuestaProblema {
  const { codigo, type = TIPO_GENERICO, title, detail, encabezados } = datosDe(error);
  const cuerpo: CuerpoProblema = { type, title, status: codigo, detail };
  if (ruta) cuerpo.instance = ruta.split('?', 1)[0];
  return { codigo, cuerpo, encabezados: { ...encabezados, 'Content-Type': 'application/problem+json' } };
}
