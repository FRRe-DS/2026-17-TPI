import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { compose, docker, esperarSano, PROYECTO, URL_M2, URL_REALM } from './ayudas/entorno.js';
import { pedirM2, tokenDePersona, usuarioDeEjemplo } from './ayudas/pedir.js';

// Keycloak caído (spec 080, RNF-13.9 a RNF-13.13, RNF-07.13). Detiene Keycloak y reinicia M2, así que corre al final de su proyecto
// (`OrdenDeArchivos`) y deja todo andando. Los pasos dependen del anterior: van en orden, en un solo describe.
// El token se pide justo antes de detener Keycloak, porque dura 300 s y todo el recorrido tiene que entrar en ese tiempo.
const cliente2 = usuarioDeEjemplo('cliente2');
const RUTA = `/api/v1/clientes/${cliente2.id}`;

async function inicioDe(servicio: string): Promise<string> {
  const id = (await compose(['ps', '-q', servicio], { tiempoMs: 30_000 })).trim();
  if (id === '') throw new Error(`No hay un contenedor de ${servicio} en el proyecto «${PROYECTO}».`);
  return (await docker(['inspect', '-f', '{{.State.StartedAt}}', id], { tiempoMs: 30_000 })).trim();
}

async function estaCorriendo(servicio: string): Promise<boolean> {
  return (await compose(['ps', '-q', '--status', 'running', servicio], { tiempoMs: 30_000 })).trim() !== '';
}

describe('M2 con Keycloak caído (RNF-13.9 a RNF-13.13)', () => {
  let token = '';

  // El archivo no depende de los otros: si el perfil de cliente2 no está, lo crea.
  beforeAll(async () => {
    const propio = await tokenDePersona('cliente2', ['clientes:read', 'clientes:write']);
    const alta = await pedirM2(propio, 'POST', '/api/v1/clientes', {
      cuerpo: { nombre: 'Cliente', apellido: 'Dos', telefono: '+5493624222222' },
      encabezados: { 'idempotency-key': randomUUID() },
    });
    if (![201, 409].includes(alta.estado)) throw new Error(`Crear el perfil de cliente2 falló: HTTP ${alta.estado} ${alta.texto}`);
  });

  it('con Keycloak detenido, un token cuya clave M2 ya tiene sigue dando 200 (RNF-13.11)', async () => {
    token = await tokenDePersona('cliente2', ['clientes:read', 'clientes:write']);
    // M2 trae la clave con este pedido, si no la tenía.
    const antes = await pedirM2(token, 'GET', RUTA);
    expect(antes.estado, antes.texto).toBe(200);

    await compose(['stop', 'keycloak'], { tiempoMs: 60_000 });
    expect(await estaCorriendo('keycloak')).toBe(false);

    const durante = await pedirM2(token, 'GET', RUTA);
    expect(durante.estado, durante.texto).toBe(200);
  });

  it('reiniciado M2 con Keycloak detenido, M2 arranca, /health da 200 y ese token da 503 con Retry-After (RNF-13.9, 13.10, 13.12)', async () => {
    const inicio = await inicioDe('m2');
    await compose(['restart', 'm2'], { tiempoMs: 60_000 });
    await esperarSano('M2', `${URL_M2}/health`);
    expect(await inicioDe('m2')).not.toBe(inicio);
    expect(await estaCorriendo('keycloak')).toBe(false);

    const salud = await fetch(`${URL_M2}/health`, { signal: AbortSignal.timeout(5000) });
    expect(salud.status).toBe(200);

    const sinClaves = await pedirM2(token, 'GET', RUTA);
    expect(sinClaves.estado, sinClaves.texto).toBe(503);
    expect(sinClaves.encabezados.get('retry-after')).toMatch(/^\d+$/);
    expect(sinClaves.encabezados.get('content-type')).toMatch(/^application\/problem\+json/);
    expect(sinClaves.cuerpo).toMatchObject({ type: 'about:blank', status: 503 });
  });

  it('cuando Keycloak vuelve, el mismo pedido da 200 sin reiniciar M2 (RNF-13.13)', async () => {
    const inicio = await inicioDe('m2');
    await compose(['start', 'keycloak'], { tiempoMs: 60_000 });
    await esperarSano('Keycloak', `${URL_REALM}/.well-known/openid-configuration`);

    // El primer pedido: M2 nunca obtuvo las claves desde que arrancó, así que no hay plazo de 30 s que esperar (RNF-12.16).
    const despues = await pedirM2(token, 'GET', RUTA);
    expect(despues.estado, despues.texto).toBe(200);
    expect(await inicioDe('m2')).toBe(inicio);
  });
});
