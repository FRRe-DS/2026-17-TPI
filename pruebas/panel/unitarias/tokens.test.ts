import { describe, expect, it } from 'vitest';
import { verificarToken } from '../../../src/auth/tokens.js';
import { NoAutenticado } from '../../../src/errores.js';
import { cargarConfigPanel } from '../../../panel/servidor/config.js';
import { cargarEntornoEjemplo } from '../../../panel/servidor/entorno-ejemplo.js';
import { firmarToken, ROLES_DEL_PANEL, TokenInvalido } from '../../../panel/servidor/tokens.js';

const EJEMPLO = new URL('../../../ejemplo.env', import.meta.url);
const SUB = '00000000-0000-4000-8000-000000000001';

// La configuración de tokens del panel sale de ejemplo.env, la misma que usa M2 en compose: si cambia allá, esta prueba sigue
// diciendo si M2 acepta lo que firma el panel.
const { config } = cargarConfigPanel(cargarEntornoEjemplo({}, EJEMPLO));
if (config === undefined) throw new Error('ejemplo.env no da una configuración válida del panel');
const TOKENS = { claveTokens: config.claveTokens, emisorTokens: config.emisorTokens, audienciaTokens: config.audienciaTokens, campoRoles: config.campoRoles };

const decodificar = (parte: string) => JSON.parse(Buffer.from(parte, 'base64url').toString('utf8')) as Record<string, unknown>;
const partes = (token: string) => token.split('.') as [string, string, string];
const AHORA_MS = Date.UTC(2026, 9, 27, 12, 0, 0);

describe('firmarToken: M2 acepta lo que firma el panel (RNF-12.6)', () => {
  it('verificarToken de M2 devuelve el sub y los roles pedidos', async () => {
    const token = await firmarToken({ sub: SUB, roles: ['CLIENTE'] }, TOKENS);

    expect(await verificarToken(`Bearer ${token}`, TOKENS)).toEqual({ sub: SUB, roles: ['CLIENTE'] });
  });

  it.each(ROLES_DEL_PANEL)('M2 reconoce el rol %s', async (rol) => {
    const token = await firmarToken({ sub: 'm9-reservas', roles: [rol] }, TOKENS);

    expect((await verificarToken(`Bearer ${token}`, TOKENS)).roles).toEqual([rol]);
  });

  it('acepta varios roles y no repite los repetidos', async () => {
    const token = await firmarToken({ sub: SUB, roles: ['OPERADOR', 'CLIENTE', 'OPERADOR'] }, TOKENS);

    expect((await verificarToken(`Bearer ${token}`, TOKENS)).roles).toEqual(['OPERADOR', 'CLIENTE']);
  });

  it('usa el campo de roles configurado', async () => {
    const otro = { ...TOKENS, campoRoles: 'permisos' };
    const token = await firmarToken({ sub: SUB, roles: ['CLIENTE'] }, otro);

    expect(decodificar(partes(token)[1])).toHaveProperty('permisos', ['CLIENTE']);
    expect(await verificarToken(`Bearer ${token}`, otro)).toEqual({ sub: SUB, roles: ['CLIENTE'] });
    expect((await verificarToken(`Bearer ${token}`, TOKENS)).roles).toEqual([]);
  });

  it('el token tiene HS256, el emisor y la audiencia de ejemplo.env y solo los claims del acuerdo (ADR 009)', async () => {
    const token = await firmarToken({ sub: SUB, roles: ['CLIENTE'] }, TOKENS, AHORA_MS);

    expect(decodificar(partes(token)[0])).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(decodificar(partes(token)[1])).toEqual({
      roles: ['CLIENTE'],
      iss: TOKENS.emisorTokens,
      aud: TOKENS.audienciaTokens,
      sub: SUB,
      iat: AHORA_MS / 1000,
      exp: AHORA_MS / 1000 + 300,
    });
  });

  it('vence a los 300 segundos', async () => {
    const ahora = Date.now();
    const { iat, exp } = decodificar(partes(await firmarToken({ sub: SUB, roles: ['CLIENTE'] }, TOKENS, ahora))[1]) as { iat: number; exp: number };

    expect(exp - iat).toBe(300);
    expect(iat).toBe(Math.floor(ahora / 1000));
  });

  // Prueba que `exp` es el que M2 honra y no solo un número en el token: uno firmado hace 10 minutos ya venció (la tolerancia es 30 s).
  it('M2 rechaza el token cuando pasaron más de 300 segundos', async () => {
    const hace10Minutos = await firmarToken({ sub: SUB, roles: ['CLIENTE'] }, TOKENS, Date.now() - 600_000);
    const hace4Minutos = await firmarToken({ sub: SUB, roles: ['CLIENTE'] }, TOKENS, Date.now() - 240_000);

    await expect(verificarToken(`Bearer ${hace10Minutos}`, TOKENS)).rejects.toThrow(NoAutenticado);
    await expect(verificarToken(`Bearer ${hace4Minutos}`, TOKENS)).resolves.toMatchObject({ sub: SUB });
  });

  it('un M2 con otra clave, emisor o audiencia lo rechaza', async () => {
    const token = await firmarToken({ sub: SUB, roles: ['CLIENTE'] }, TOKENS);

    for (const otra of [
      { ...TOKENS, claveTokens: 'otra-clave-de-prueba-de-32-caracteres' },
      { ...TOKENS, emisorTokens: 'otro-emisor' },
      { ...TOKENS, audienciaTokens: 'otra-audiencia' },
    ]) {
      await expect(verificarToken(`Bearer ${token}`, otra)).rejects.toThrow(NoAutenticado);
    }
  });
});

describe('firmarToken: rechaza lo que no es una identidad de prueba válida (RNF-12.6)', () => {
  it.each([
    ['vacío', ''],
    ['solo espacios', '   '],
    ['de 129 caracteres', 'x'.repeat(129)],
  ])('rechaza un sub %s', async (_caso, sub) => {
    await expect(firmarToken({ sub, roles: ['CLIENTE'] }, TOKENS)).rejects.toThrow(TokenInvalido);
    await expect(firmarToken({ sub, roles: ['CLIENTE'] }, TOKENS)).rejects.toThrow(/sub/);
  });

  it('acepta un sub de 1 y de 128 caracteres', async () => {
    for (const sub of ['a', 'x'.repeat(128)]) {
      expect((await verificarToken(`Bearer ${await firmarToken({ sub, roles: ['CLIENTE'] }, TOKENS)}`, TOKENS)).sub).toBe(sub);
    }
  });

  it.each([
    ['sin roles', []],
    ['un rol que no existe', ['ADMIN']],
    ['en minúscula', ['cliente']],
    ['uno bueno y uno malo', ['CLIENTE', 'ADMIN']],
    ['con espacios', [' CLIENTE']],
    ['un rol vacío', ['']],
  ])('rechaza los roles %s', async (_caso, roles) => {
    await expect(firmarToken({ sub: SUB, roles }, TOKENS)).rejects.toThrow(TokenInvalido);
    await expect(firmarToken({ sub: SUB, roles }, TOKENS)).rejects.toThrow(/roles/);
  });

  it('rechaza un sub o roles que no son texto, por si el valor llega sin tipar de un encabezado', async () => {
    await expect(firmarToken({ sub: undefined as unknown as string, roles: ['CLIENTE'] }, TOKENS)).rejects.toThrow(TokenInvalido);
    await expect(firmarToken({ sub: 12 as unknown as string, roles: ['CLIENTE'] }, TOKENS)).rejects.toThrow(TokenInvalido);
    await expect(firmarToken({ sub: SUB, roles: 'CLIENTE' as unknown as string[] }, TOKENS)).rejects.toThrow(TokenInvalido);
    await expect(firmarToken({ sub: SUB, roles: [7] as unknown as string[] }, TOKENS)).rejects.toThrow(TokenInvalido);
  });

  it('el error no repite el sub ni el rol recibidos', async () => {
    const error = await firmarToken({ sub: '', roles: ['ROL-RARO-123'] }, TOKENS).catch((causa: unknown) => causa);

    expect(error).toBeInstanceOf(TokenInvalido);
    expect((error as Error).message).not.toContain('ROL-RARO-123');
  });

  it('los roles que acepta son exactamente los cuatro del acuerdo', () => {
    expect([...ROLES_DEL_PANEL].sort()).toEqual(['CLIENTE', 'CONDUCTOR', 'OPERADOR', 'SERVICIO']);
  });
});
