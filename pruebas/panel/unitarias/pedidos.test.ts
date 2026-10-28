import { describe, expect, it } from 'vitest';
import {
  CAPACIDAD,
  crearRegistroDePedidos,
  curlEquivalente,
  LIMITE_CUERPO_GUARDADO,
  presentarPedido,
  type Pedido,
} from '../../../panel/servidor/pedidos.js';

const PUBLICA = 'http://localhost:8082';

const pedido = (cambios: Partial<Pedido> = {}): Pedido => ({
  requestId: 'panel-1',
  hora: '2026-10-27T12:00:00.000Z',
  metodo: 'GET',
  ruta: '/api/v1/clientes',
  encabezados: {},
  conToken: true,
  estado: 200,
  duracionMs: 12,
  ...cambios,
});

describe('registro de pedidos: los últimos 50, el más nuevo primero (RNF-14.9)', () => {
  it('la capacidad es 50', () => {
    expect(CAPACIDAD).toBe(50);
  });

  it('guarda método, ruta, código, duración y X-Request-Id, y el más nuevo va primero', () => {
    const registro = crearRegistroDePedidos();
    registro.registrar(pedido({ requestId: 'a', metodo: 'GET', ruta: '/health', estado: 200, duracionMs: 3 }));
    registro.registrar(pedido({ requestId: 'b', metodo: 'POST', ruta: '/api/v1/clientes', estado: 201, duracionMs: 21 }));

    expect(registro.recientes().map((p) => [p.requestId, p.metodo, p.ruta, p.estado, p.duracionMs])).toEqual([
      ['b', 'POST', '/api/v1/clientes', 201, 21],
      ['a', 'GET', '/health', 200, 3],
    ]);
  });

  it('con más de 50 se queda con los últimos 50: se pierden los más viejos', () => {
    const registro = crearRegistroDePedidos();
    for (let i = 0; i < 60; i++) registro.registrar(pedido({ requestId: `p-${i}` }));

    const ids = registro.recientes().map((p) => p.requestId);
    expect(ids).toHaveLength(50);
    expect(ids[0]).toBe('p-59');
    expect(ids.at(-1)).toBe('p-10');
  });

  it('sin pedidos devuelve una lista vacía', () => {
    expect(crearRegistroDePedidos().recientes()).toEqual([]);
  });

  it('la lista que devuelve es una copia: cambiarla no cambia el registro', () => {
    const registro = crearRegistroDePedidos();
    registro.registrar(pedido());

    registro.recientes().pop();

    expect(registro.recientes()).toHaveLength(1);
  });

  it('guarda el cuerpo si entra en el límite, y si no lo omite y lo avisa', () => {
    const registro = crearRegistroDePedidos();
    registro.registrar(pedido({ requestId: 'justo', cuerpo: 'x'.repeat(LIMITE_CUERPO_GUARDADO) }));
    registro.registrar(pedido({ requestId: 'grande', cuerpo: 'x'.repeat(LIMITE_CUERPO_GUARDADO + 1) }));

    const [grande, justo] = registro.recientes();
    expect(justo?.cuerpo).toHaveLength(LIMITE_CUERPO_GUARDADO);
    expect(grande?.cuerpo).toBeUndefined();
    expect(grande?.cuerpoOmitido).toBe(true);
  });
});

describe('curlEquivalente: el curl con $TOKEN y la dirección pública de M2 (RNF-14.9, RNF-19.3)', () => {
  it('una consulta con token', () => {
    expect(curlEquivalente(pedido({ ruta: '/api/v1/clientes/abc', encabezados: { 'X-Request-Id': 'panel-1' } }), PUBLICA)).toBe(
      `curl -X GET -H "Authorization: Bearer $TOKEN" -H 'X-Request-Id: panel-1' 'http://localhost:8082/api/v1/clientes/abc'`,
    );
  });

  it('una alta con Idempotency-Key, Content-Type y cuerpo', () => {
    const curl = curlEquivalente(
      pedido({
        metodo: 'POST',
        ruta: '/api/v1/clientes',
        encabezados: { 'Content-Type': 'application/json', 'Idempotency-Key': 'clave-1', 'X-Request-Id': 'panel-2' },
        cuerpo: '{"nombre":"Ana"}',
        estado: 201,
      }),
      PUBLICA,
    );

    expect(curl).toBe(
      `curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -H 'Idempotency-Key: clave-1' -H 'X-Request-Id: panel-2' -d '{"nombre":"Ana"}' 'http://localhost:8082/api/v1/clientes'`,
    );
  });

  it('sin token no pone Authorization', () => {
    expect(curlEquivalente(pedido({ conToken: false, ruta: '/health' }), PUBLICA)).toBe(`curl -X GET 'http://localhost:8082/health'`);
  });

  it('usa la dirección pública que se le pasa', () => {
    expect(curlEquivalente(pedido({ conToken: false, ruta: '/health' }), 'https://m2.ejemplo.test')).toContain(`'https://m2.ejemplo.test/health'`);
  });

  it('con el cuerpo omitido deja un archivo en su lugar', () => {
    const curl = curlEquivalente(pedido({ metodo: 'PUT', cuerpoOmitido: true }), PUBLICA);

    expect(curl).toContain(`-d @cuerpo.json`);
  });

  // Lo que se copia y se pega en una terminal no puede ejecutar nada que la persona no escribió.
  it.each([
    ['una comilla simple en el cuerpo', { cuerpo: `{"n":"O'Brien"}` }, `-d '{"n":"O'\\''Brien"}'`],
    ['una sustitución en el cuerpo', { cuerpo: '$(rm -rf ~)`id`' }, `-d '$(rm -rf ~)\`id\`'`],
    ['una comilla en un encabezado', { encabezados: { 'Idempotency-Key': `a'b` } }, `-H 'Idempotency-Key: a'\\''b'`],
    ['una sustitución en un encabezado', { encabezados: { 'Idempotency-Key': '$(id)' } }, `-H 'Idempotency-Key: $(id)'`],
    ['una comilla y símbolos en la ruta', { ruta: `/api/v1/clientes?x='$(id);&y=1` }, `'http://localhost:8082/api/v1/clientes?x='\\''$(id);&y=1'`],
  ] as const)('escapa %s', (_caso, cambios, esperado) => {
    expect(curlEquivalente(pedido(cambios), PUBLICA)).toContain(esperado);
  });

  it('el curl no contiene ningún token real: el pedido registrado no lo tiene', () => {
    const registrado = pedido();

    expect(JSON.stringify(registrado)).not.toMatch(/eyJ|Bearer/);
    expect(curlEquivalente(registrado, PUBLICA)).toContain('$TOKEN');
    expect(curlEquivalente(registrado, PUBLICA)).not.toMatch(/eyJ/);
  });
});

describe('presentarPedido: lo que ve la pantalla (RNF-19.3)', () => {
  it('muestra el Authorization enmascarado y trae el curl', () => {
    const presentado = presentarPedido(pedido({ encabezados: { 'Idempotency-Key': 'clave-1' } }), PUBLICA);

    expect(presentado.encabezados).toEqual({ Authorization: 'Bearer ••••', 'Idempotency-Key': 'clave-1' });
    expect(presentado.curl).toContain('$TOKEN');
    expect(presentado).toMatchObject({ requestId: 'panel-1', metodo: 'GET', ruta: '/api/v1/clientes', estado: 200, duracionMs: 12 });
  });

  it('sin token no muestra Authorization', () => {
    expect(presentarPedido(pedido({ conToken: false }), PUBLICA).encabezados).toEqual({});
  });
});
