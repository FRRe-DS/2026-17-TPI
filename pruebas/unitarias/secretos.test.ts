import { describe, expect, it } from 'vitest';
import { limpiarSecretos, OCULTO, secretosDeAutorizacion, secretosDeConfig, serializarError } from '../../src/logs.js';

const CLAVE = 'clave-de-prueba-de-32-caracteres!';
const CONTRASENA = 'contrasena-de-la-bd';
const URL_BD = `postgres://m2:${CONTRASENA}@bd:5432/m2`;
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmMifQ.firma-del-token';
const SECRETOS = [CLAVE, CONTRASENA, TOKEN];

describe('limpiarSecretos: reemplaza cada secreto conocido por [oculto] (RNF-19.1)', () => {
  it('el placeholder es [oculto]', () => {
    expect(OCULTO).toBe('[oculto]');
  });

  it.each([
    ['la clave de los tokens', CLAVE],
    ['la contraseña de la base', CONTRASENA],
    ['el token', TOKEN],
  ])('oculta %s', (_caso, secreto) => {
    expect(limpiarSecretos(`falló con ${secreto} en el medio`, SECRETOS)).toBe('falló con [oculto] en el medio');
  });

  it('oculta los tres en el mismo texto', () => {
    expect(limpiarSecretos(`${CLAVE}, ${URL_BD} y Bearer ${TOKEN}`, SECRETOS)).toBe(
      '[oculto], postgres://m2:[oculto]@bd:5432/m2 y Bearer [oculto]',
    );
  });

  it('oculta todas las apariciones, también en varias líneas', () => {
    const texto = `Error: ${TOKEN}\n    at ${TOKEN} (${CLAVE})\n    at ${TOKEN}`;

    expect(limpiarSecretos(texto, SECRETOS)).toBe('Error: [oculto]\n    at [oculto] ([oculto])\n    at [oculto]');
  });

  it.each([
    ['sin secretos', 'nada que ocultar', []],
    ['con secretos que no aparecen', 'nada que ocultar', SECRETOS],
    ['con un texto vacío', '', SECRETOS],
    ['con mayúsculas distintas', CLAVE.toUpperCase(), [CLAVE]],
  ])('deja el texto igual %s', (_caso, texto, secretos) => {
    expect(limpiarSecretos(texto, secretos)).toBe(texto);
  });

  it('ignora un secreto vacío: ocultaría todo el texto', () => {
    expect(limpiarSecretos(`con ${CLAVE}`, ['', CLAVE, ''])).toBe('con [oculto]');
    expect(limpiarSecretos('abc', [''])).toBe('abc');
  });

  it.each(['a.c', '(x)', '[a-z]+', 'a|b', '^a$', 'a\\d', 'a*', 'a?b', 'a{2}', '$&', '$1$2', '${x}', '\\'])(
    'trata %j como un texto, no como un patrón',
    (secreto) => {
      expect(limpiarSecretos(`antes ${secreto} después`, [secreto])).toBe('antes [oculto] después');
    },
  );

  it('un secreto como a.c no oculta lo que solo lo parece', () => {
    expect(limpiarSecretos('abc a.c', ['a.c'])).toBe('abc [oculto]');
    expect(limpiarSecretos('aa a{2}', ['a{2}'])).toBe('aa [oculto]');
    expect(limpiarSecretos('ab b a?b', ['a?b'])).toBe('ab b [oculto]');
  });

  it('oculta primero el secreto más largo: si uno contiene a otro, no queda su resto a la vista', () => {
    expect(limpiarSecretos('x abcdef x', ['abc', 'abcdef'])).toBe('x [oculto] x');
    expect(limpiarSecretos('x abcdef x', ['abcdef', 'abc'])).toBe('x [oculto] x');
  });

  it('no vuelve a leer lo que ya reemplazó', () => {
    expect(limpiarSecretos(CLAVE, ['oculto', CLAVE])).toBe('[oculto]');
    expect(limpiarSecretos('a', ['a', 'oculto'])).toBe('[oculto]');
  });

  it('no cambia la lista de secretos', () => {
    const secretos = ['corto', 'un secreto más largo'];

    limpiarSecretos('texto', secretos);

    expect(secretos).toEqual(['corto', 'un secreto más largo']);
  });

  it('oculta secretos con acentos y con símbolos', () => {
    expect(limpiarSecretos('la clave es contraseña-ñandú!', ['contraseña-ñandú!'])).toBe('la clave es [oculto]');
  });
});

describe('secretosDeConfig: la clave de los tokens y la contraseña de la base (RNF-19.1)', () => {
  const de = (urlBd: string) => secretosDeConfig({ claveTokens: CLAVE, urlBd });

  it('la clave y la contraseña que va en la URL', () => {
    expect(de(URL_BD)).toEqual([CLAVE, CONTRASENA]);
  });

  it('una contraseña con caracteres codificados se oculta como está escrita en la URL y como queda al decodificarla', () => {
    expect(de('postgres://m2:p%40ss%3Aw%2Frd@bd/m2')).toEqual([CLAVE, 'p%40ss%3Aw%2Frd', 'p@ss:w/rd']);
  });

  it('una contraseña con un % mal escrito se oculta tal cual', () => {
    expect(de('postgres://m2:100%@bd/m2')).toEqual([CLAVE, '100%']);
  });

  it('la contraseña que va en la query string, también codificada', () => {
    expect(de('postgres://bd/m2?user=m2&password=via%40query&sslmode=disable')).toEqual([CLAVE, 'via%40query', 'via@query']);
  });

  it('solo la contraseña de la query string, no otros parámetros que terminan igual', () => {
    expect(de('postgres://bd/m2?sslpassword=otra&mypassword=tampoco')).toEqual([CLAVE]);
  });

  it('las dos, si están', () => {
    expect(de('postgresql://m2:una@bd/m2?password=otra')).toEqual([CLAVE, 'una', 'otra']);
  });

  it.each([
    ['sin contraseña', 'postgres://m2@bd:5432/m2'],
    ['con la contraseña vacía', 'postgres://m2:@bd:5432/m2'],
    ['sin usuario', 'postgres://bd:5432/m2'],
    ['con una contraseña vacía en la query string', 'postgres://bd/m2?password='],
  ])('solo la clave, %s', (_caso, urlBd) => {
    expect(de(urlBd)).toEqual([CLAVE]);
  });

  it('solo la clave si la URL no se puede leer', () => {
    expect(de('esto no es una URL')).toEqual([CLAVE]);
  });

  it('no suma el usuario, ni el servidor, ni el nombre de la base', () => {
    expect(de('postgres://usuario-bd:secreta@servidor-bd:5432/nombre-bd')).toEqual([CLAVE, 'secreta']);
  });

  it('ocultan la contraseña y dejan el resto de la URL', () => {
    expect(limpiarSecretos(`no conecta a ${URL_BD}`, de(URL_BD))).toBe('no conecta a postgres://m2:[oculto]@bd:5432/m2');
    const codificada = 'postgres://m2:p%40ss@bd/m2';

    expect(limpiarSecretos(codificada, de(codificada))).toBe('postgres://m2:[oculto]@bd/m2');
  });
});

describe('secretosDeAutorizacion: el encabezado Authorization y su token (RNF-19.1)', () => {
  it.each([
    ['ausente', undefined],
    ['vacío', ''],
    ['solo espacios', '   '],
  ])('ninguno si el encabezado está %s', (_caso, valor) => {
    expect(secretosDeAutorizacion(valor)).toEqual([]);
  });

  it('el valor entero y el token', () => {
    expect(secretosDeAutorizacion(`Bearer ${TOKEN}`)).toEqual([`Bearer ${TOKEN}`, TOKEN]);
  });

  it('con otro esquema, también', () => {
    const basico = 'Basic dXN1YXJpbzpjbGF2ZQ==';

    expect(secretosDeAutorizacion(basico)).toEqual([basico, 'dXN1YXJpbzpjbGF2ZQ==']);
  });

  it('sin esquema, el valor entero', () => {
    expect(secretosDeAutorizacion(TOKEN)).toEqual([TOKEN]);
  });

  it('con varias palabras después del esquema, cada una', () => {
    expect(secretosDeAutorizacion('Bearer  uno   dos')).toEqual(['Bearer  uno   dos', 'uno', 'dos']);
  });

  it('ocultan el encabezado entero, también en un texto que lo copia', () => {
    const encabezado = `Bearer ${TOKEN}`;

    expect(limpiarSecretos(`authorization: ${encabezado}`, secretosDeAutorizacion(encabezado))).toBe('authorization: [oculto]');
  });
});

describe('serializarError: lo que el log guarda de un error, ya limpio (RNF-03.3, RNF-19.1)', () => {
  const serializar = (error: unknown) => serializarError(error, SECRETOS);

  it('el tipo, el mensaje y la traza de un error común', () => {
    const error = new TypeError('no es una función');

    expect(serializar(error)).toEqual({ tipo: 'TypeError', mensaje: 'no es una función', traza: error.stack });
  });

  it('el tipo es el nombre de la clase', () => {
    class ErrorMio extends Error {}

    expect(serializar(new ErrorMio('x')).tipo).toBe('ErrorMio');
  });

  it.each([
    ['de texto', 'ECONNREFUSED', 'ECONNREFUSED'],
    ['numérico', 42, '42'],
  ])('el código %s', (_caso, code, esperado) => {
    expect(serializar(Object.assign(new Error('x'), { code })).codigo).toBe(esperado);
  });

  it.each([
    ['ausente', {}],
    ['nulo', { code: null }],
    ['un objeto', { code: { a: 1 } }],
  ])('sin código si es %s', (_caso, campos) => {
    expect(serializar(Object.assign(new Error('x'), campos))).not.toHaveProperty('codigo');
  });

  it('quita los secretos del mensaje y de la traza', () => {
    const error = new Error(`falló con ${CLAVE}, ${URL_BD} y ${TOKEN}`);

    const registrado = serializar(error);

    expect(registrado.mensaje).toBe('falló con [oculto], postgres://m2:[oculto]@bd:5432/m2 y [oculto]');
    expect(registrado.traza).toMatch(
      /^Error: falló con \[oculto\], postgres:\/\/m2:\[oculto\]@bd:5432\/m2 y \[oculto\]\n\s+at /,
    );
    expect(JSON.stringify(registrado)).not.toMatch(new RegExp(SECRETOS.join('|').replaceAll('.', '\\.')));
  });

  it('quita los secretos de cada campo', () => {
    const error = Object.assign(new Error('x'), {
      code: `E_${CLAVE}`,
      table: `tabla_${CONTRASENA}`,
      column: `columna_${TOKEN}`,
      constraint: `restriccion_${CLAVE}`,
    });

    expect(serializar(error)).toMatchObject({
      codigo: 'E_[oculto]',
      tabla: 'tabla_[oculto]',
      columna: 'columna_[oculto]',
      restriccion: 'restriccion_[oculto]',
    });
  });

  describe('un error de pg', () => {
    const errorDePg = Object.assign(new Error('null value in column "email" violates not-null constraint'), {
      code: '23502',
      severity: 'ERROR',
      schema: 'public',
      table: 'clientes',
      column: 'email',
      constraint: 'clientes_email_key',
      detail: 'Failing row contains (7, Ana, ana@example.com).',
      where: 'COPY clientes, line 1: "7,Ana,ana@example.com"',
      hint: 'Revisá la fila de ana@example.com',
      routine: 'ExecConstraints',
    });

    it('guarda el código, la tabla, la columna y la restricción', () => {
      expect(serializar(errorDePg)).toMatchObject({
        codigo: '23502',
        tabla: 'clientes',
        columna: 'email',
        restriccion: 'clientes_email_key',
      });
    });

    it('no guarda detail ni where, que traen datos de la fila, ni nada más que lo previsto', () => {
      const registrado = serializar(errorDePg);

      expect(Object.keys(registrado).sort()).toEqual(['codigo', 'columna', 'mensaje', 'restriccion', 'tabla', 'tipo', 'traza']);
      expect(JSON.stringify(registrado)).not.toContain('ana@example.com');
    });

    it('fuera de la clase 22, el mensaje y la traza quedan como están', () => {
      const registrado = serializar(errorDePg);

      expect(registrado.mensaje).toBe(errorDePg.message);
      expect(registrado.traza).toBe(errorDePg.stack);
    });
  });

  // Los errores de datos de la base (SQLSTATE 22…, data_exception) citan el valor que rechazaron (spec 004, RNF-19).
  describe('un error de datos de pg (SQLSTATE 22…)', () => {
    const MENSAJE_OMITIDO = 'Error de datos de la base: mensaje omitido';
    const deDatos = (code: string, mensaje: string) => {
      const error = Object.assign(new Error(mensaje), { code, severity: 'ERROR', routine: 'DateTimeParseError' });
      error.name = 'error';
      return error;
    };

    it.each([
      ['22008', 'date/time field value out of range: "0000-01-01"', '0000-01-01'],
      ['22P02', 'invalid input syntax for type uuid: "Ana Gómez"', 'Ana Gómez'],
      ['22001', 'value too long for type character varying(100): Anastasia', 'Anastasia'],
    ])('%s: guarda un mensaje fijo, el código y la traza sin el valor', (code, mensaje, valor) => {
      const error = deDatos(code, mensaje);

      const registrado = serializar(error);

      expect(registrado).toMatchObject({ tipo: 'Error', codigo: code, mensaje: MENSAJE_OMITIDO });
      expect(registrado.traza).toMatch(/^\s+at /);
      expect(error.stack?.split('\n').slice(1).join('\n')).toBe(registrado.traza);
      expect(JSON.stringify(registrado)).not.toContain(valor);
    });

    it('un mensaje de varias líneas tampoco queda en la traza', () => {
      const registrado = serializar(deDatos('22008', 'primera línea con "0000-01-01"\nsegunda con "Ana"'));

      expect(JSON.stringify(registrado)).not.toMatch(/0000-01-01|Ana/);
      expect(registrado.traza).toMatch(/^\s+at /);
    });

    it('sin líneas de la pila, no guarda traza', () => {
      const error = Object.assign(deDatos('22008', 'out of range: "0000-01-01"'), { stack: 'error: out of range: "0000-01-01"' });

      expect(serializar(error)).toEqual({ tipo: 'Error', codigo: '22008', mensaje: MENSAJE_OMITIDO });
    });

    it('también cuando es la causa de otro error', () => {
      const registrado = serializar(new Error('falló el alta', { cause: deDatos('22008', 'out of range: "0000-01-01"') }));

      expect(registrado.mensaje).toBe('falló el alta');
      expect(registrado.causa).toMatchObject({ codigo: '22008', mensaje: MENSAJE_OMITIDO });
      expect(JSON.stringify(registrado)).not.toContain('0000-01-01');
    });

    it.each([
      ['de otra clase que empieza con 2', '23505'],
      ['numérico', 22008],
      ['que contiene 22 pero no empieza así', '0822'],
    ])('un código %s no es de la clase 22: el mensaje queda', (_caso, code) => {
      expect(serializar(Object.assign(new Error('con "0000-01-01"'), { code })).mensaje).toBe('con "0000-01-01"');
    });
  });

  it('sin traza si el stack no es un texto', () => {
    const error = Object.assign(new Error('x'), { stack: 42 });

    expect(serializar(error)).toEqual({ tipo: 'Error', mensaje: 'x' });
  });

  it('de table, column y constraint guarda solo lo que es un texto', () => {
    const error = Object.assign(new Error('x'), { table: 5, column: null, constraint: { nombre: 'x' } });

    expect(Object.keys(serializar(error)).sort()).toEqual(['mensaje', 'tipo', 'traza']);
  });

  it('no guarda las demás propiedades del error: pueden traer encabezados o la configuración', () => {
    const error = Object.assign(new Error('x'), {
      headers: { authorization: `Bearer ${TOKEN}` },
      config: { clave: CLAVE },
      request: { body: { nombre: 'Ana' } },
      detail: 'Ana',
    });

    const registrado = serializar(error);

    expect(Object.keys(registrado).sort()).toEqual(['mensaje', 'tipo', 'traza']);
    expect(JSON.stringify(registrado)).not.toContain('Ana');
  });

  describe('la causa', () => {
    it('se guarda, con los mismos campos y ya limpia', () => {
      const causa = Object.assign(new Error(`connect ECONNREFUSED con ${TOKEN}`), { code: 'ECONNREFUSED' });
      const error = new Error('fetch failed', { cause: causa });

      const registrado = serializar(error);

      expect(registrado.mensaje).toBe('fetch failed');
      expect(registrado.causa).toEqual({
        tipo: 'Error',
        codigo: 'ECONNREFUSED',
        mensaje: 'connect ECONNREFUSED con [oculto]',
        traza: expect.stringMatching(/^Error: connect ECONNREFUSED con \[oculto\]\n\s+at /),
      });
      expect(registrado.causa).not.toHaveProperty('causa');
    });

    it('sigue por la cadena, hasta 5 niveles, aunque se cierre en un círculo', () => {
      const a = new Error('a');
      const b = new Error('b', { cause: a });
      Object.assign(a, { cause: b });

      let registrado = serializar(a);
      let niveles = 1;
      while (registrado.causa !== undefined) {
        registrado = registrado.causa;
        niveles += 1;
      }

      expect(niveles).toBe(5);
    });

    it('una causa que no es un error se guarda como texto', () => {
      const registrado = serializar(new Error('x', { cause: `texto con ${CLAVE}` }));

      expect(registrado.causa).toEqual({ tipo: 'string', mensaje: 'texto con [oculto]' });
    });

    it.each([
      ['no hay', new Error('x')],
      ['es nula', new Error('x', { cause: null })],
      ['es indefinida', new Error('x', { cause: undefined })],
    ])('si %s, no hay campo', (_caso, error) => {
      expect(serializar(error)).not.toHaveProperty('causa');
    });
  });

  describe('lo que no es un error', () => {
    it('un texto', () => {
      expect(serializar(`se lanzó ${CLAVE}`)).toEqual({ tipo: 'string', mensaje: 'se lanzó [oculto]' });
    });

    it.each([
      ['un número', 42, 'number', '42'],
      ['nulo', null, 'null', 'null'],
      ['indefinido', undefined, 'undefined', 'undefined'],
      ['un booleano', false, 'boolean', 'false'],
    ])('%s', (_caso, valor, tipo, mensaje) => {
      expect(serializar(valor)).toEqual({ tipo, mensaje });
    });

    it('un objeto, con su contenido y sin los secretos', () => {
      const registrado = serializar({ estado: 500, clave: CLAVE, anidado: { token: TOKEN } });

      expect(registrado.tipo).toBe('object');
      expect(registrado.mensaje).toContain('estado: 500');
      expect(registrado.mensaje).toContain("clave: '[oculto]'");
      expect(registrado.mensaje).toContain("token: '[oculto]'");
      expect(registrado.mensaje).not.toContain(CLAVE);
      expect(registrado.mensaje).not.toContain(TOKEN);
    });

    it('un objeto con message y stack, aunque no sea un Error, se guarda como error', () => {
      const registrado = serializar({ name: 'Falso', message: `con ${CLAVE}`, stack: `pila con ${TOKEN}`, code: 'X1' });

      expect(registrado).toEqual({ tipo: 'Object', codigo: 'X1', mensaje: 'con [oculto]', traza: 'pila con [oculto]' });
    });

    it('un objeto sin traza, sin código y sin clase se guarda con lo que tiene', () => {
      expect(serializar({ message: 'sin pila' })).toEqual({ tipo: 'Object', mensaje: 'sin pila' });
      expect(serializar(Object.assign(Object.create(null), { name: 'SinClase', message: 'x' }))).toEqual({
        tipo: 'SinClase',
        mensaje: 'x',
      });
    });

    it('el tipo también se limpia', () => {
      const sinClase = Object.assign(Object.create(null), { name: `Clase${CLAVE}`, message: 'x' });

      expect(serializar(sinClase).tipo).toBe('Clase[oculto]');
    });

    it('un objeto cuyo message no es un texto se guarda como cualquier objeto', () => {
      expect(serializar({ message: 42 })).toEqual({ tipo: 'object', mensaje: '{ message: 42 }' });
    });
  });

  describe('un error que no se puede leer', () => {
    it('no lanza: deja un registro mínimo', () => {
      const error = new Error('x');
      Object.defineProperty(error, 'message', {
        get() {
          throw new Error(`no se puede leer ${CLAVE}`);
        },
      });

      expect(serializar(error)).toEqual({ tipo: 'desconocido', mensaje: 'El error no se pudo serializar' });
    });

    it('tampoco si lo que falla es la traza o la causa', () => {
      const sinTraza = new Error('x');
      Object.defineProperty(sinTraza, 'stack', {
        get() {
          throw new Error('no hay traza');
        },
      });
      const sinCausa = new Error('y');
      Object.defineProperty(sinCausa, 'cause', {
        get() {
          throw new Error('no hay causa');
        },
      });

      expect(serializar(sinTraza).tipo).toBe('desconocido');
      expect(serializar(sinCausa).tipo).toBe('desconocido');
    });
  });
});
