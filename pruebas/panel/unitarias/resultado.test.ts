import { describe, expect, it } from 'vitest';
import { compararRespuesta, ENCABEZADOS_RELEVANTES, type RespuestaObservada } from '../../../panel/cliente/src/logica/resultado.js';

// Cómo decide la vista si un caso dio ✔ o ✘ (spec 072, T11, RNF-07.4): por código y, cuando el caso lo pide, por `type`,
// `Retry-After` y `Location`; todo error tiene que ser `application/problem+json` (RNF-03.6). El motivo va en una línea.
const PROBLEMA = 'application/problem+json';
const respuesta = (cambios: Partial<RespuestaObservada> & { encabezados?: Record<string, string> } = {}): RespuestaObservada => ({
  estado: 200,
  encabezados: {},
  ...cambios,
});

describe('compararRespuesta: el código', () => {
  it('✔ si el código es el esperado', () => {
    expect(compararRespuesta({ estado: 200 }, respuesta())).toEqual({ correcto: true });
  });

  it.each([
    [409, 201, 'se esperaba 409, llegó 201'],
    [201, 500, 'se esperaba 201, llegó 500'],
    [200, 0, 'se esperaba 200, no hubo respuesta'],
  ])('✘ si se esperaba %i y llegó %i: «%s»', (esperado, llegado, motivo) => {
    expect(compararRespuesta({ estado: esperado }, respuesta({ estado: llegado, encabezados: { 'content-type': PROBLEMA } }))).toEqual({
      correcto: false,
      motivo,
    });
  });
});

describe('compararRespuesta: el error es application/problem+json (RNF-03.6)', () => {
  it('✔ un 4xx con application/problem+json, también con parámetros como el charset', () => {
    expect(compararRespuesta({ estado: 404 }, respuesta({ estado: 404, encabezados: { 'content-type': PROBLEMA } })).correcto).toBe(true);
    expect(compararRespuesta({ estado: 404 }, respuesta({ estado: 404, encabezados: { 'content-type': `${PROBLEMA}; charset=utf-8` } })).correcto).toBe(true);
  });

  it.each([
    ['text/html', 'el error llegó como text/html y no como application/problem+json'],
    ['application/json', 'el error llegó como application/json y no como application/problem+json'],
  ])('✘ un error con %s', (tipo, motivo) => {
    expect(compararRespuesta({ estado: 404 }, respuesta({ estado: 404, encabezados: { 'content-type': tipo } }))).toEqual({ correcto: false, motivo });
  });

  it('✘ un error sin Content-Type', () => {
    expect(compararRespuesta({ estado: 503, conRetryAfter: true }, respuesta({ estado: 503, encabezados: { 'retry-after': '5' } }))).toEqual({
      correcto: false,
      motivo: 'el error llegó sin Content-Type y no como application/problem+json',
    });
  });

  it('un éxito no tiene que ser problem+json (un 204 no tiene cuerpo)', () => {
    expect(compararRespuesta({ estado: 204 }, respuesta({ estado: 204 })).correcto).toBe(true);
  });
});

describe('compararRespuesta: el type, Retry-After y Location, solo si el caso los pide', () => {
  const error = (estado: number, extra: Partial<RespuestaObservada> = {}): RespuestaObservada =>
    respuesta({ estado, encabezados: { 'content-type': PROBLEMA }, ...extra });

  it('✔ si el type es el esperado', () => {
    expect(compararRespuesta({ estado: 409, type: '/errores/perfil-ya-existe' }, error(409, { type: '/errores/perfil-ya-existe' })).correcto).toBe(true);
  });

  it('✘ si el type es otro, o no viene', () => {
    expect(compararRespuesta({ estado: 409, type: '/errores/perfil-ya-existe' }, error(409, { type: '/errores/calificacion-duplicada' }))).toEqual({
      correcto: false,
      motivo: 'se esperaba el error /errores/perfil-ya-existe, llegó /errores/calificacion-duplicada',
    });
    expect(compararRespuesta({ estado: 409, type: '/errores/perfil-ya-existe' }, error(409)).motivo).toBe(
      'se esperaba el error /errores/perfil-ya-existe, no llegó ninguno',
    );
  });

  it('no mira el type si el caso no lo pide', () => {
    expect(compararRespuesta({ estado: 400 }, error(400, { type: 'about:blank' })).correcto).toBe(true);
  });

  it('✔ el 503 con Retry-After, ✘ sin él', () => {
    expect(compararRespuesta({ estado: 503, conRetryAfter: true }, error(503, { encabezados: { 'content-type': PROBLEMA, 'retry-after': '5' } })).correcto).toBe(true);
    expect(compararRespuesta({ estado: 503, conRetryAfter: true }, error(503))).toEqual({ correcto: false, motivo: 'falta el encabezado Retry-After' });
  });

  it('✔ el 201 con Location, ✘ sin él', () => {
    expect(compararRespuesta({ estado: 201, conLocation: true }, respuesta({ estado: 201, encabezados: { location: '/api/v1/clientes/1' } })).correcto).toBe(true);
    expect(compararRespuesta({ estado: 201, conLocation: true }, respuesta({ estado: 201 }))).toEqual({ correcto: false, motivo: 'falta el encabezado Location' });
  });

  it('un Retry-After o un Location vacíos no cuentan', () => {
    expect(compararRespuesta({ estado: 201, conLocation: true }, respuesta({ estado: 201, encabezados: { location: '' } })).correcto).toBe(false);
  });

  it('el motivo es una línea: el primer problema, sin saltos de línea aunque lo que llegó los traiga', () => {
    const veredicto = compararRespuesta({ estado: 409, type: '/errores/x' }, error(409, { type: 'a\nb\r\nc' }));

    expect(veredicto.motivo).not.toMatch(/[\r\n]/);
  });

  it('si fallan varios, informa primero el código', () => {
    expect(compararRespuesta({ estado: 503, conRetryAfter: true }, respuesta({ estado: 200 })).motivo).toBe('se esperaba 503, llegó 200');
  });
});

describe('ENCABEZADOS_RELEVANTES', () => {
  it('son los que la vista muestra de cada respuesta', () => {
    expect(ENCABEZADOS_RELEVANTES).toEqual(['content-type', 'location', 'retry-after', 'x-request-id']);
  });
});
