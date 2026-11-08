import { describe, expect, it } from 'vitest';
import { cargarContrato, RUTA_CONTRATO } from '../../src/contrato/cargar.js';

// El scope que el contrato real declara en cada operación (spec 080, T18, RNF-12.13; ADR 079): las lecturas `clientes:read`,
// salvo `obtenerEstadoCuenta`, que pide `clientes.estado:read`; las escrituras `clientes:write`, también las de bloqueos. Y en
// el mismo renglón de `security` que el rol: en OpenAPI dos renglones son alternativas, y con un renglón de scope aparte un
// token sin rol abriría la operación. Sin Keycloak: lee el archivo. `M2_CONTRATO_SCOPES` permite correrla contra otro archivo
// (por ejemplo, el de la cátedra) para ver que falla.
const contrato = cargarContrato(process.env['M2_CONTRATO_SCOPES'] ?? RUTA_CONTRATO);

const METODOS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const LECTURA = 'clientes:read';
const ESCRITURA = 'clientes:write';
const ESTADO = 'clientes.estado:read';

type Operacion = { operationId: string; metodo: string; security: unknown };

const operaciones: Operacion[] = Object.values(contrato.paths as Record<string, Record<string, unknown>>).flatMap((ruta) =>
  METODOS.filter((metodo) => ruta[metodo] !== undefined).map((metodo) => {
    const operacion = ruta[metodo] as { operationId: string; security?: unknown };
    return { operationId: operacion.operationId, metodo, security: operacion.security };
  }),
);
const protegidas = operaciones.filter(({ operationId }) => operationId !== 'verificarSalud');

const esperado = ({ operationId, metodo }: Operacion) =>
  operationId === 'obtenerEstadoCuenta' ? ESTADO : metodo === 'get' ? LECTURA : ESCRITURA;

describe('scopes del contrato real (RNF-12.13, T18)', () => {
  it('son 19 operaciones con token, y verificarSalud sigue pública', () => {
    expect(protegidas).toHaveLength(19);
    expect(operaciones.find(({ operationId }) => operationId === 'verificarSalud')?.security).toEqual([]);
  });

  it('OAuth2Bearer es un esquema oauth2 que declara los tres scopes de M2', () => {
    const esquema = (contrato.components as { securitySchemes: Record<string, { type: string; flows: Record<string, { scopes: object }> }> })
      .securitySchemes['OAuth2Bearer'];
    expect(esquema?.type).toBe('oauth2');
    for (const flujo of Object.values(esquema?.flows ?? {})) {
      expect(Object.keys(flujo.scopes).sort()).toEqual([ESTADO, LECTURA, ESCRITURA].sort());
    }
  });

  it.each(protegidas.map((operacion) => [operacion.operationId, operacion] as const))(
    '%s: un solo renglón, con su rol y su scope',
    (_nombre, operacion) => {
      expect(operacion.security).toEqual([{ bearerAuth: expect.arrayContaining([expect.any(String)]), OAuth2Bearer: [esperado(operacion)] }]);
    },
  );

  it('las de bloqueos son de OPERADOR, y sus escrituras piden clientes:write', () => {
    const bloqueos = protegidas.filter(({ operationId }) => /Bloqueo/.test(operationId));
    expect(bloqueos.map(({ operationId }) => operationId).sort()).toEqual(['crearBloqueo', 'levantarBloqueo', 'listarBloqueos', 'obtenerBloqueo']);
    for (const operacion of bloqueos) {
      expect(operacion.security).toEqual([{ bearerAuth: ['OPERADOR'], OAuth2Bearer: [esperado(operacion)] }]);
    }
    expect(bloqueos.filter(({ metodo }) => metodo !== 'get').every((o) => esperado(o) === ESCRITURA)).toBe(true);
  });
});
