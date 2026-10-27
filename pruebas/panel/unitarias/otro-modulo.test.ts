import { describe, expect, it } from 'vitest';
import { ErrorDeApi } from '../../../panel/cliente/src/api/errores.js';
import { IDENTIFICADOR_DE_EJEMPLO, validarIdentificador } from '../../../panel/cliente/src/logica/ingresar.js';
import { menuDe } from '../../../panel/cliente/src/logica/menu.js';
import { mensajeDeConsulta } from '../../../panel/cliente/src/logica/otro-modulo.js';

// La vista de otro módulo (T30, RF-2.6.7): entra con un identificador que nombra al módulo y solo consulta estados de cuenta.

const error = (estado: number) => new ErrorDeApi({ sinRespuesta: false, estado, type: 'about:blank', title: 'T' });

describe('entrar como otro módulo', () => {
  it('el identificador por defecto es m5-despacho y es válido', () => {
    expect(IDENTIFICADOR_DE_EJEMPLO.SERVICIO).toBe('m5-despacho');
    expect(validarIdentificador('SERVICIO', IDENTIFICADOR_DE_EJEMPLO.SERVICIO)).toBeUndefined();
  });

  it('se puede editar: otro nombre de módulo también vale; vacío no', () => {
    expect(validarIdentificador('SERVICIO', 'm9-pagos')).toBeUndefined();
    expect(validarIdentificador('SERVICIO', '  ')).toBeTruthy();
  });
});

describe('el menú del SERVICIO ofrece una sola operación de M2', () => {
  it('su grupo propio tiene solo «Consultar estado de cuenta»', () => {
    const [propio] = menuDe('SERVICIO');

    expect(propio!.elementos.map((e) => e.pantalla)).toEqual(['otro-modulo']);
  });
});

describe('mensajeDeConsulta', () => {
  it('404 y 403 tienen frase propia; lo demás, solo el error de M2', () => {
    expect(mensajeDeConsulta(error(404))).toBe('No hay un cliente con ese UUID.');
    expect(mensajeDeConsulta(error(403))).toContain('no deja');
    for (const estado of [400, 401, 500, 503]) expect(mensajeDeConsulta(error(estado))).toBeUndefined();
  });
});
