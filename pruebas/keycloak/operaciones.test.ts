import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { claimsDe, idTokenDePersona, pedirM2, tokenDelComandoDeM2, tokenDePersona, tokenDeServicio, usuarioDeEjemplo } from './ayudas/pedir.js';

// M2 en modo jwks contra Keycloak real, con tokens pedidos a Keycloak por HTTP (spec 080, RNF-07.13, RNF-12.14). Los de persona
// piden `clientes:read clientes:write`, para que los escenarios sigan valiendo cuando #79 declare los scopes en el contrato. Los
// archivos de este proyecto corren de a uno y comparten el entorno: el perfil de cliente1 lo crea este archivo.
const SCOPES = ['clientes:read', 'clientes:write'];
const cliente1 = usuarioDeEjemplo('cliente1');
const cliente2 = usuarioDeEjemplo('cliente2');
const DATOS = { nombre: 'Cliente', apellido: 'Uno', telefono: '+5493624111111' };
const conClave = () => ({ 'idempotency-key': randomUUID() });

describe('M2 con tokens de Keycloak real (RNF-07.13)', () => {
  it('cliente1 crea su perfil, con su sub como clienteId, y lo lee', async () => {
    const token = await tokenDePersona('cliente1', SCOPES);
    expect(claimsDe(token)['sub']).toBe(cliente1.id);

    const alta = await pedirM2(token, 'POST', '/api/v1/clientes', { cuerpo: DATOS, encabezados: conClave() });
    expect(alta.estado, alta.texto).toBe(201);
    expect(alta.cuerpo).toMatchObject({ clienteId: cliente1.id, ...DATOS });

    const lectura = await pedirM2(token, 'GET', `/api/v1/clientes/${cliente1.id}`);
    expect(lectura.estado, lectura.texto).toBe(200);
    expect(lectura.cuerpo).toMatchObject({ clienteId: cliente1.id, nombre: DATOS.nombre });
  });

  it('cliente1 no lee el perfil de cliente2: 403', async () => {
    const token = await tokenDePersona('cliente1', SCOPES);
    const lectura = await pedirM2(token, 'GET', `/api/v1/clientes/${cliente2.id}`);
    expect(lectura.estado, lectura.texto).toBe(403);
    expect(lectura.encabezados.get('content-type')).toMatch(/^application\/problem\+json/);
  });

  it('operador1 registra un bloqueo de cliente1: 201', async () => {
    const token = await tokenDePersona('operador1', SCOPES);
    const bloqueo = await pedirM2(token, 'POST', `/api/v1/clientes/${cliente1.id}/bloqueos`, {
      cuerpo: { motivo: 'Prueba con Keycloak real' },
      encabezados: conClave(),
    });
    expect(bloqueo.estado, bloqueo.texto).toBe(201);
    expect(bloqueo.cuerpo).toMatchObject({ motivo: 'Prueba con Keycloak real' });
  });

  it('la cuenta de servicio de M5 (grupo-13) lee el estado de cuenta de cliente1, con el bloqueo, y no su perfil: 403', async () => {
    const token = await tokenDeServicio('grupo-13');
    expect(claimsDe(token)['roles']).toContain('SERVICIO');

    const estado = await pedirM2(token, 'GET', `/api/v1/clientes/${cliente1.id}/estado-cuenta`);
    expect(estado.estado, estado.texto).toBe(200);
    expect(estado.cuerpo).toMatchObject({ clienteId: cliente1.id, bloqueosVigentes: [expect.objectContaining({ motivo: 'Prueba con Keycloak real' })] });

    const perfil = await pedirM2(token, 'GET', `/api/v1/clientes/${cliente1.id}`);
    expect(perfil.estado, perfil.texto).toBe(403);
  });
});

describe('M2 rechaza lo que no es un token de acceso de Keycloak: 401 (RNF-07.13, RNF-12.11)', () => {
  const esperar401 = async (token: string, motivo: RegExp) => {
    const lectura = await pedirM2(token, 'GET', `/api/v1/clientes/${cliente1.id}`);
    expect(lectura.estado, lectura.texto).toBe(401);
    expect(lectura.encabezados.get('www-authenticate')).toMatch(/^Bearer/);
    expect((lectura.cuerpo as { detail?: string }).detail).toMatch(motivo);
  };

  it('un token de cliente1 con el contenido alterado (dice ser cliente2) y la firma original', async () => {
    const [cabecera, contenido, firma] = (await tokenDePersona('cliente1', SCOPES)).split('.');
    const otro = { ...(JSON.parse(Buffer.from(contenido ?? '', 'base64url').toString('utf8')) as object), sub: cliente2.id };
    await esperar401(`${cabecera}.${Buffer.from(JSON.stringify(otro)).toString('base64url')}.${firma}`, /firma/i);
  });

  it('un token HS256 del comando de tokens de M2, con el emisor y la audiencia correctos', async () => {
    const token = await tokenDelComandoDeM2(cliente1.id, ['CLIENTE']);
    expect(claimsDe(token)).toMatchObject({ sub: cliente1.id, aud: 'm2-clientes' });
    await esperar401(token, /firma|algoritmo/i);
  });

  it('un ID token de cliente1, firmado por Keycloak con la misma clave', async () => {
    const token = await idTokenDePersona('cliente1');
    expect(claimsDe(token)['aud']).not.toContain('m2-clientes');
    await esperar401(token, /audiencia/i);
  });
});
