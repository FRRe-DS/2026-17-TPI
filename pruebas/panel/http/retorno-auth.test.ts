import { describe, it, expect } from 'vitest';
import { construirApp } from '../../../panel/servidor/app.js';
import { cargarConfigPanel } from '../../../panel/servidor/config.js';
import { crearAlmacenSesiones } from '../../../panel/servidor/auth/sesiones.js';
import { crearAlmacenTransacciones } from '../../../panel/servidor/auth/transacciones.js';
import { armarTokenRsa, crearClave, jwksDe } from '../../ayudas/jwks.js';

const clave = crearClave();
const emisor = 'http://localhost:8080/realms/prueba';
const sub = 'c1e00000-0000-4000-8000-000000000001';
const configOidc = () => cargarConfigPanel({ PANEL_MODO_AUTH: 'oidc', PANEL_ORIGEN_PUBLICO: 'http://localhost:8083',
  PANEL_OIDC_EMISOR: emisor, PANEL_OIDC_URL_INTERNA: emisor }).config!;

describe('retorno OIDC', () => {
  it('consume una vez, emite cookie nueva y limpia la URL sin divulgar código ni tokens', async () => {
    const sesiones = crearAlmacenSesiones(); const transacciones = crearAlmacenTransacciones();
    const tx = transacciones.crear({ tipo: 'ingreso', nonce: 'nonce', verifier: 'verifier', retorno: '/' });
    const ahora = Math.floor(Date.now() / 1000);
    const firmar = (tipo: 'ID' | 'Bearer') => armarTokenRsa(clave, { claims: { iss: emisor, sub, iat: ahora, exp: ahora + 300,
      aud: tipo === 'ID' ? 'm2-front' : 'm2-clientes', typ: tipo, nonce: 'nonce', roles: ['CLIENTE'], scope: 'clientes:read' } });
    const pedidos: string[] = [];
    const pedir: typeof fetch = async (url, opciones) => {
      pedidos.push(String(url));
      if (String(url).endsWith('/certs')) return Response.json(jwksDe(clave));
      expect(String(opciones?.body)).toContain('code_verifier=verifier');
      return Response.json({ id_token: firmar('ID'), access_token: firmar('Bearer'), refresh_token: 'refresh-secreto', refresh_expires_in: 600, token_type: 'Bearer' });
    };
    const app = construirApp({ config: configOidc(), auth: { sesiones, transacciones, pedir } });
    try {
      const url = `/auth/retorno?state=${tx.state}&code=codigo-secreto`;
      const headers = { host: 'localhost:8083', cookie: `m2_transaccion=${tx.vinculo}` };
      const ajeno = await app.inject({ url, headers: { ...headers, cookie: 'm2_transaccion=otro' } });
      expect(ajeno.headers.location).toBe('/?acceso=invalido'); expect(pedidos).toHaveLength(0);
      const respuesta = await app.inject({ url, headers });
      expect(respuesta.statusCode).toBe(303); expect(respuesta.headers.location).toBe('/');
      expect(respuesta.cookies.find(c => c.name === 'm2_sesion')?.value).toHaveLength(43);
      expect(JSON.stringify(respuesta.headers)).not.toContain('secreto'); expect(sesiones.cantidad()).toBe(1);
      const repetida = await app.inject({ url, headers }); expect(repetida.headers.location).toBe('/?acceso=invalido');
      expect(pedidos).toHaveLength(2);
    } finally { await app.close(); }
  });

  it.each(['error=access_denied', 'code=a&code=b', 'code=a&retorno=https://ajeno.test'])('no intercambia un retorno cancelado o ambiguo: %s', async (parametros) => {
    const app = construirApp({ config: configOidc(), auth: { pedir: async () => { throw new Error('No debe pedir'); } } });
    try { expect((await app.inject({ url: `/auth/retorno?state=desconocido&${parametros}`, headers: { host: 'localhost:8083' } })).headers.location).toBe('/?acceso=invalido'); }
    finally { await app.close(); }
  });
});
