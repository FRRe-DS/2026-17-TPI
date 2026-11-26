import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compose, esperarSano, URL_CONTROL_M6, URL_M2, URL_REALM } from './ayudas/entorno.js';
import { pedirM2, tokenDePersona, usuarioDeEjemplo } from './ayudas/pedir.js';

// El token de servicio ante M6 con Keycloak real (spec 125, RNF-07, RNF-12, RNF-14.14, RNF-14.15). M2 pide su token a Keycloak con
// el cliente grupo-17, y el M6 simulado del perfil keycloak lo valida con el JWKS de ese Keycloak. Reinicia M2 al empezar, para
// que no tenga ningún token guardado, y detiene Keycloak en el último paso: deja todo andando al terminar. Los pasos van en orden.
const cliente = usuarioDeEjemplo('cliente2');
const SCOPES = ['clientes:read', 'clientes:write'];
const HISTORIAL = `/api/v1/clientes/${cliente.id}/viajes`;

type Linea = { msg?: string; modulo?: string; estado?: number | null; intentos?: number; idCorrelacion?: string; tokenServicioM6?: string };

// Las líneas JSON del log de M2, de todos los arranques del contenedor.
async function logDeM2(): Promise<{ texto: string; lineas: Linea[] }> {
  const texto = await compose(['logs', 'm2', '--no-log-prefix'], { tiempoMs: 30_000 });
  const lineas = texto.split('\n').flatMap((linea): Linea[] => {
    try {
      return [JSON.parse(linea) as Linea];
    } catch {
      return [];
    }
  });
  return { texto, lineas };
}

const deKeycloak = (lineas: Linea[], idCorrelacion: string) =>
  lineas.filter((l) => l.msg === 'llamada a Keycloak' && l.idCorrelacion === idCorrelacion);

async function reiniciarM2(): Promise<void> {
  await compose(['restart', 'm2'], { tiempoMs: 60_000 });
  await esperarSano('M2', `${URL_M2}/health`);
}

async function keycloakAndando(): Promise<void> {
  await compose(['start', 'keycloak'], { tiempoMs: 60_000 });
  await esperarSano('Keycloak', `${URL_REALM}/.well-known/openid-configuration`);
}

describe('M2 se presenta ante M6 con el token de Keycloak de grupo-17 (spec 125)', () => {
  let viajeCompletado = '';

  beforeAll(async () => {
    await reiniciarM2();
    // El perfil de cliente2, si no está, y sus viajes de ejemplo en el M6 simulado: uno completado, para calificarlo.
    const token = await tokenDePersona('cliente2', SCOPES);
    const alta = await pedirM2(token, 'POST', '/api/v1/clientes', {
      cuerpo: { nombre: 'Cliente', apellido: 'Dos', telefono: '+5493624222222' },
      encabezados: { 'idempotency-key': randomUUID() },
    });
    if (![201, 409].includes(alta.estado)) throw new Error(`Crear el perfil de cliente2 falló: HTTP ${alta.estado} ${alta.texto}`);
    const ejemplo = await fetch(`${URL_CONTROL_M6}/control/clientes/${cliente.id}/ejemplo`, {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
    });
    if (!ejemplo.ok) throw new Error(`Cargar los viajes de ejemplo en el M6 simulado falló: HTTP ${ejemplo.status}`);
    const { escenarios } = (await ejemplo.json()) as { escenarios: { nombre: string; viajeId: string }[] };
    viajeCompletado = escenarios.find((e) => e.nombre === 'completado')?.viajeId ?? '';
  });

  // Si un paso falla con Keycloak detenido, los archivos que siguen lo necesitan andando.
  afterAll(async () => {
    await keycloakAndando();
  });

  it('la línea de arranque dice keycloak (RNF-14.14)', async () => {
    const { lineas, texto } = await logDeM2();

    const arranques = lineas.filter((l) => l.msg === 'Token de servicio ante M6');
    expect(arranques.length).toBeGreaterThan(0);
    for (const linea of arranques) expect(linea.tokenServicioM6).toBe('keycloak');
    expect(texto).not.toContain('d51a8e72');
  });

  it('el historial responde 200 dos veces seguidas, y solo la primera consulta pide el token a Keycloak (RNF-14.15)', async () => {
    const token = await tokenDePersona('cliente2', SCOPES);
    const [primera, segunda] = [randomUUID(), randomUUID()];

    const r1 = await pedirM2(token, 'GET', HISTORIAL, { encabezados: { 'x-request-id': primera } });
    const r2 = await pedirM2(token, 'GET', HISTORIAL, { encabezados: { 'x-request-id': segunda } });

    expect(r1.estado, r1.texto).toBe(200);
    expect(r2.estado, r2.texto).toBe(200);
    expect((r1.cuerpo as { items: { viajeId: string }[] }).items.map((v) => v.viajeId)).toContain(viajeCompletado);
    const { lineas, texto } = await logDeM2();
    expect(deKeycloak(lineas, primera)).toEqual([expect.objectContaining({ modulo: 'Keycloak', estado: 200, intentos: 1 })]);
    expect(deKeycloak(lineas, segunda)).toEqual([]);
    // Ni el token de la persona ni el de servicio llegan al log (RNF-19).
    expect(texto).not.toContain(token);
    expect(texto).not.toContain('eyJ');
  });

  it('la calificación del viaje completado responde 201 con el mismo token (RF-2.4.11.9)', async () => {
    const token = await tokenDePersona('cliente2', SCOPES);
    const id = randomUUID();

    const respuesta = await pedirM2(token, 'POST', `/api/v1/clientes/${cliente.id}/calificaciones`, {
      cuerpo: { viajeId: viajeCompletado, puntaje: 5 },
      encabezados: { 'idempotency-key': randomUUID(), 'x-request-id': id },
    });

    expect(respuesta.estado, respuesta.texto).toBe(201);
    expect(deKeycloak((await logDeM2()).lineas, id)).toEqual([]);
  });

  it('con Keycloak detenido y sin token guardado, el historial da 503 con Retry-After; cuando vuelve, 200 (RF-2.4.11.6)', async () => {
    // M2 sin token de servicio guardado, pero con las claves para validar el token de la persona: la consulta del perfil no
    // llama a M6.
    await reiniciarM2();
    const token = await tokenDePersona('cliente2', SCOPES);
    const perfil = await pedirM2(token, 'GET', `/api/v1/clientes/${cliente.id}`);
    expect(perfil.estado, perfil.texto).toBe(200);

    await compose(['stop', 'keycloak'], { tiempoMs: 60_000 });
    const id = randomUUID();
    const caido = await pedirM2(token, 'GET', HISTORIAL, { encabezados: { 'x-request-id': id } });

    expect(caido.estado, caido.texto).toBe(503);
    expect(caido.encabezados.get('content-type')).toMatch(/^application\/problem\+json/);
    expect(caido.encabezados.get('retry-after')).toMatch(/^\d+$/);
    expect(caido.cuerpo).toMatchObject({ type: 'about:blank', status: 503, detail: 'Keycloak no está disponible' });
    expect(deKeycloak((await logDeM2()).lineas, id)).toEqual([expect.objectContaining({ estado: null, intentos: 2 })]);

    await keycloakAndando();
    const vuelta = await pedirM2(token, 'GET', HISTORIAL);
    expect(vuelta.estado, vuelta.texto).toBe(200);
  });
});
