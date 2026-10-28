import { describe, expect, it } from 'vitest';
import {
  debeSondear,
  ESPERA_MAXIMA_MS,
  estadoInicial,
  INTERVALO_DE_SONDEO_MS,
  modeloControlBase,
  reducir,
  textoDeSalud,
  type EstadoSalud,
} from '../../../panel/cliente/src/logica/salud-en-vivo.js';

// La salud de M2 en vivo al apagar y encender la base (spec 072, T13, RNF-13.4): quieto → apagando → observando → encendiendo →
// recuperada | no-volvio. Un reductor puro; el temporizador es `usar-sondeo`.
const T0 = 1_000_000;

describe('constantes', () => {
  it('se sondea cada 2 s y se espera hasta 60 s', () => {
    expect(INTERVALO_DE_SONDEO_MS).toBe(2000);
    expect(ESPERA_MAXIMA_MS).toBe(60_000);
  });
});

describe('apagar', () => {
  it('quieto → apagando → observando, sin ningún estado todavía', () => {
    const apagando = reducir(estadoInicial, { tipo: 'apagar-pulsado' });
    const observando = reducir(apagando, { tipo: 'apagada' });

    expect(estadoInicial).toEqual({ fase: 'quieto' });
    expect(apagando).toEqual({ fase: 'apagando' });
    expect(observando).toEqual({ fase: 'observando', ultimo: undefined });
  });

  it('observando muestra el último estado de M2 (se espera 503) y sigue', () => {
    let estado: EstadoSalud = { fase: 'observando', ultimo: undefined };

    estado = reducir(estado, { tipo: 'salud', estado: 503, ahora: T0 });
    expect(estado).toEqual({ fase: 'observando', ultimo: 503 });

    estado = reducir(estado, { tipo: 'salud', estado: null, ahora: T0 + 2000 });
    expect(estado).toEqual({ fase: 'observando', ultimo: null });
  });

  it('si apagar falla, vuelve a quieto', () => {
    expect(reducir({ fase: 'apagando' }, { tipo: 'fallo' })).toEqual({ fase: 'quieto' });
  });

  it('una salud que llega apagando (el sondeo todavía no corre) no cambia nada', () => {
    expect(reducir({ fase: 'apagando' }, { tipo: 'salud', estado: 200, ahora: T0 })).toEqual({ fase: 'apagando' });
  });

  it('no se puede apagar mientras se apaga o se enciende', () => {
    const apagando: EstadoSalud = { fase: 'apagando' };
    const encendiendo: EstadoSalud = { fase: 'encendiendo', desde: T0, ultimo: undefined };

    expect(reducir(apagando, { tipo: 'apagar-pulsado' })).toBe(apagando);
    expect(reducir(encendiendo, { tipo: 'apagar-pulsado' })).toBe(encendiendo);
  });
});

describe('encender', () => {
  it('desde observando empieza a contar desde que se pulsó', () => {
    const estado = reducir({ fase: 'observando', ultimo: 503 }, { tipo: 'encender-pulsado', ahora: T0 });

    expect(estado).toEqual({ fase: 'encendiendo', desde: T0, ultimo: 503 });
  });

  it('también se puede encender con la base ya prendida (quieto): la salud vuelve a 200 enseguida', () => {
    const estado = reducir(estadoInicial, { tipo: 'encender-pulsado', ahora: T0 });

    expect(estado).toEqual({ fase: 'encendiendo', desde: T0, ultimo: undefined });
    expect(reducir(estado, { tipo: 'salud', estado: 200, ahora: T0 + 1000 })).toEqual({ fase: 'recuperada', tardoMs: 1000 });
  });

  it('el primer 200 la da por recuperada, con lo que tardó', () => {
    let estado: EstadoSalud = reducir({ fase: 'observando', ultimo: 503 }, { tipo: 'encender-pulsado', ahora: T0 });

    estado = reducir(estado, { tipo: 'salud', estado: 503, ahora: T0 + 2000 });
    expect(estado).toEqual({ fase: 'encendiendo', desde: T0, ultimo: 503 });
    estado = reducir(estado, { tipo: 'salud', estado: 200, ahora: T0 + 6000 });

    expect(estado).toEqual({ fase: 'recuperada', tardoMs: 6000 });
  });

  it('a los 60 s sin un 200, no volvió', () => {
    let estado: EstadoSalud = reducir({ fase: 'observando', ultimo: 503 }, { tipo: 'encender-pulsado', ahora: T0 });

    estado = reducir(estado, { tipo: 'salud', estado: 503, ahora: T0 + 59_999 });
    expect(estado.fase).toBe('encendiendo');
    estado = reducir(estado, { tipo: 'salud', estado: null, ahora: T0 + 60_000 });

    expect(estado).toEqual({ fase: 'no-volvio', ultimo: null });
  });

  it('un 200 justo a los 60 s cuenta como recuperada: manda el 200', () => {
    const estado = reducir({ fase: 'encendiendo', desde: T0, ultimo: 503 }, { tipo: 'salud', estado: 200, ahora: T0 + 60_000 });

    expect(estado).toEqual({ fase: 'recuperada', tardoMs: 60_000 });
  });

  it('si encender falla (el comando), vuelve a observar con el último estado', () => {
    expect(reducir({ fase: 'encendiendo', desde: T0, ultimo: 503 }, { tipo: 'fallo' })).toEqual({ fase: 'observando', ultimo: 503 });
  });

  it('desde recuperada o no-volvio se puede apagar o encender otra vez', () => {
    expect(reducir({ fase: 'recuperada', tardoMs: 5 }, { tipo: 'apagar-pulsado' })).toEqual({ fase: 'apagando' });
    expect(reducir({ fase: 'no-volvio', ultimo: null }, { tipo: 'encender-pulsado', ahora: T0 })).toEqual({ fase: 'encendiendo', desde: T0, ultimo: null });
  });

  it('no se puede encender dos veces seguidas: la cuenta no se reinicia', () => {
    const encendiendo: EstadoSalud = { fase: 'encendiendo', desde: T0, ultimo: undefined };

    expect(reducir(encendiendo, { tipo: 'encender-pulsado', ahora: T0 + 30_000 })).toBe(encendiendo);
  });
});

describe('eventos que no corresponden', () => {
  it('«apagada» fuera de apagando y «fallo» en quieto no cambian nada', () => {
    const quieto: EstadoSalud = { fase: 'quieto' };

    expect(reducir(quieto, { tipo: 'apagada' })).toBe(quieto);
    expect(reducir(quieto, { tipo: 'fallo' })).toBe(quieto);
    expect(reducir(quieto, { tipo: 'salud', estado: 200, ahora: T0 })).toBe(quieto);
  });

  it('una salud en recuperada o no-volvio no los cambia', () => {
    const recuperada: EstadoSalud = { fase: 'recuperada', tardoMs: 1 };

    expect(reducir(recuperada, { tipo: 'salud', estado: 503, ahora: T0 })).toBe(recuperada);
  });

  it('«reiniciar» vuelve a quieto desde cualquier estado', () => {
    expect(reducir({ fase: 'no-volvio', ultimo: 503 }, { tipo: 'reiniciar' })).toEqual({ fase: 'quieto' });
    expect(reducir({ fase: 'observando', ultimo: 503 }, { tipo: 'reiniciar' })).toEqual({ fase: 'quieto' });
  });
});

describe('debeSondear: solo mientras se observa o se espera', () => {
  it.each([
    [{ fase: 'quieto' }, false],
    [{ fase: 'apagando' }, false],
    [{ fase: 'observando', ultimo: 503 }, true],
    [{ fase: 'encendiendo', desde: T0, ultimo: undefined }, true],
    [{ fase: 'recuperada', tardoMs: 1 }, false],
    [{ fase: 'no-volvio', ultimo: null }, false],
  ] as [EstadoSalud, boolean][])('%j → %s', (estado, esperado) => {
    expect(debeSondear(estado)).toBe(esperado);
  });
});

describe('textoDeSalud: lo que dice la vista', () => {
  it.each([
    [{ fase: 'quieto' }, 'Todavía no apagaste ni encendiste la base desde esta vista.'],
    [{ fase: 'apagando' }, 'Apagando la base…'],
    [{ fase: 'observando', ultimo: undefined }, 'Base apagada. Consultando la salud de M2…'],
    [{ fase: 'observando', ultimo: 503 }, 'Base apagada. M2 responde 503: no puede atender sin su base.'],
    [{ fase: 'observando', ultimo: 200 }, 'Base apagada. M2 todavía responde 200.'],
    [{ fase: 'observando', ultimo: null }, 'Base apagada. M2 no responde.'],
    [{ fase: 'encendiendo', desde: T0, ultimo: undefined }, 'Encendiendo la base. Esperando a que M2 vuelva a responder 200 (hasta 60 s)…'],
    [{ fase: 'encendiendo', desde: T0, ultimo: 503 }, 'Encendiendo la base. M2 responde 503; esperando el 200 (hasta 60 s)…'],
    [{ fase: 'encendiendo', desde: T0, ultimo: null }, 'Encendiendo la base. M2 no responde; esperando el 200 (hasta 60 s)…'],
    [{ fase: 'recuperada', tardoMs: 6200 }, 'M2 volvió a responder 200 a los 6 s.'],
    [{ fase: 'recuperada', tardoMs: 400 }, 'M2 volvió a responder 200 en menos de 1 s.'],
    [{ fase: 'recuperada', tardoMs: 1300 }, 'M2 volvió a responder 200 al segundo.'],
    [{ fase: 'no-volvio', ultimo: 503 }, 'M2 no volvió a responder 200 en 60 s (último estado: 503).'],
    [{ fase: 'no-volvio', ultimo: null }, 'M2 no volvió a responder 200 en 60 s (último estado: sin respuesta).'],
  ] as [EstadoSalud, string][])('%j', (estado, texto) => {
    expect(textoDeSalud(estado)).toBe(texto);
  });
});

describe('modeloControlBase: los botones de la sección «Base de datos» (T16, RNF-13.4, RNF-13.6, RNF-15.6)', () => {
  const DISPONIBLE = { disponible: true };
  const QUIETO: EstadoSalud = { fase: 'quieto' };
  const listo = { esperando: false, deshabilitado: false };
  const apagado = { esperando: false, deshabilitado: true };

  it('mientras se consulta si hay Docker, los dos deshabilitados y lo dice', () => {
    const modelo = modeloControlBase(undefined, QUIETO, undefined);

    expect(modelo.apagar).toEqual(apagado);
    expect(modelo.encender).toEqual(apagado);
    expect(modelo.aviso).toEqual({ texto: 'Consultando si el panel puede usar Docker…' });
  });

  it('sin Docker, los dos deshabilitados con el motivo y cómo activarlos (RNF-13.6)', () => {
    const modelo = modeloControlBase({ disponible: false, motivo: 'el panel corre en un contenedor', comoActivar: 'Levantá el panel en la máquina.' }, QUIETO, undefined);

    expect(modelo.apagar).toEqual(apagado);
    expect(modelo.encender).toEqual(apagado);
    expect(modelo.aviso).toEqual({ texto: 'Apagar y encender la base no están disponibles: el panel corre en un contenedor.', comoActivar: 'Levantá el panel en la máquina.' });
  });

  it('sin Docker y sin motivo, igual lo explica', () => {
    expect(modeloControlBase({ disponible: false }, QUIETO, undefined).aviso?.texto).toBe('Apagar y encender la base no están disponibles.');
  });

  it('con Docker y nada corriendo, los dos habilitados y sin aviso', () => {
    const modelo = modeloControlBase(DISPONIBLE, QUIETO, undefined);

    expect(modelo).toEqual({ apagar: listo, encender: listo, tono: 'neutro' });
  });

  it('apagando: «Apagar» espera y «Encender» queda deshabilitado', () => {
    for (const [salud, activa] of [
      [{ fase: 'apagando' }, 'base:apagar'],
      [{ fase: 'apagando' }, undefined],
    ] as [EstadoSalud, string | undefined][]) {
      const modelo = modeloControlBase(DISPONIBLE, salud, activa);
      expect(modelo.apagar).toEqual({ esperando: true, deshabilitado: true });
      expect(modelo.encender).toEqual(apagado);
    }
  });

  it('encendiendo: «Encender» espera hasta la respuesta de M2 (también después del comando) y «Apagar» queda deshabilitado', () => {
    for (const activa of ['base:encender', undefined]) {
      const modelo = modeloControlBase(DISPONIBLE, { fase: 'encendiendo', desde: T0, ultimo: 503 }, activa);
      expect(modelo.encender).toEqual({ esperando: true, deshabilitado: true });
      expect(modelo.apagar).toEqual(apagado);
    }
  });

  it('otra ejecución de la vista en curso: los dos deshabilitados sin esperar (el cerrojo es de la vista)', () => {
    const modelo = modeloControlBase(DISPONIBLE, QUIETO, 'caso:alta-201');

    expect(modelo.apagar).toEqual(apagado);
    expect(modelo.encender).toEqual(apagado);
  });

  it('con la base apagada se puede encender y también volver a apagar (no es un error, spec: casos límite)', () => {
    const modelo = modeloControlBase(DISPONIBLE, { fase: 'observando', ultimo: 503 }, undefined);

    expect(modelo.apagar).toEqual(listo);
    expect(modelo.encender).toEqual(listo);
  });

  it.each([
    [{ fase: 'quieto' }, 'neutro'],
    [{ fase: 'apagando' }, 'neutro'],
    [{ fase: 'observando', ultimo: undefined }, 'neutro'],
    [{ fase: 'observando', ultimo: 503 }, 'mal'],
    [{ fase: 'observando', ultimo: null }, 'mal'],
    [{ fase: 'observando', ultimo: 200 }, 'bien'],
    [{ fase: 'encendiendo', desde: T0, ultimo: 503 }, 'mal'],
    [{ fase: 'recuperada', tardoMs: 1 }, 'bien'],
    [{ fase: 'no-volvio', ultimo: 503 }, 'mal'],
  ] as [EstadoSalud, string][])('el tono de la salud %j → %s', (salud, tono) => {
    expect(modeloControlBase(DISPONIBLE, salud, undefined).tono).toBe(tono);
  });
});
