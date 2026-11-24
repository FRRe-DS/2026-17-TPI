import { describe, it, expect } from 'vitest';
import { construirApp } from '../../../panel/servidor/app.js';
import { cargarConfigPanel } from '../../../panel/servidor/config.js';
import { crearAlmacenSesiones } from '../../../panel/servidor/auth/sesiones.js';
import { crearAlmacenTransacciones } from '../../../panel/servidor/auth/transacciones.js';
import { armarTokenRsa, crearClave, jwksDe } from '../../ayudas/jwks.js';
import { capturarLogs } from '../../ayudas/logs.js';
import { CredencialInvalida, IdentidadNoDisponible } from '../../../panel/servidor/auth/validacion.js';
import { SesionRechazada } from '../../../panel/servidor/auth/oidc.js';

const clave = crearClave();
const emisor = 'http://localhost:8080/realms/prueba';
const sub = 'c1e00000-0000-4000-8000-000000000001';
const configOidc = () => cargarConfigPanel({ PANEL_MODO_AUTH: 'oidc', PANEL_ORIGEN_PUBLICO: 'http://localhost:8083',
  PANEL_OIDC_EMISOR: emisor, PANEL_OIDC_URL_INTERNA: emisor }).config!;

describe('retorno OIDC', () => {
  it.each([
    ['credencial rechazada', new CredencialInvalida(), '/?acceso=invalido'],
    ['código rechazado', new SesionRechazada(), '/?acceso=invalido'],
    ['proveedor caído', new IdentidadNoDisponible(), '/?acceso=no-disponible'],
  ] as const)('vuelve a una pantalla recuperable con %s', async (_caso, error, destino) => {
    const sesiones = crearAlmacenSesiones(); const transacciones = crearAlmacenTransacciones();
    const tx = transacciones.crear({ tipo: 'ingreso', nonce: 'nonce', verifier: 'verifier', retorno: '/' });
    const app = construirApp({ config: configOidc(), auth: { sesiones, transacciones, oidc: {
      ingresar: async () => { throw error; }, renovar: async () => { throw new Error('No debe renovar'); },
    } } });
    try {
      const respuesta = await app.inject({ url: `/auth/retorno?code=codigo-secreto&state=${tx.state}`,
        headers: { host: 'localhost:8083', cookie: `m2_transaccion=${tx.vinculo}` } });
      expect(respuesta.statusCode).toBe(303); expect(respuesta.headers.location).toBe(destino);
      expect(respuesta.body).toBe(''); expect(respuesta.headers['cache-control']).toBe('no-store');
      expect(sesiones.cantidad()).toBe(0); expect(transacciones.cantidad()).toBe(0);
      expect(respuesta.cookies.some(cookie => cookie.name === 'm2_sesion')).toBe(false);
    } finally { await app.close(); }
  });

  it.each(['cancelada', 'expirada'])('recupera una transacción %s sin intercambiar el código', async (caso) => {
    let ahora = Date.now(); const transacciones = crearAlmacenTransacciones(() => ahora);
    const tx = transacciones.crear({ tipo: 'ingreso', nonce: 'nonce', verifier: 'verifier', retorno: '/' });
    if (caso === 'expirada') ahora += 300_000;
    let pedidos = 0;
    const app = construirApp({ config: configOidc(), auth: { transacciones, pedir: async () => { pedidos++; throw new Error('No debe pedir'); } } });
    try {
      const respuesta = await app.inject({ url: `/auth/retorno?state=${tx.state}&${caso === 'cancelada' ? 'error=access_denied' : 'code=codigo-secreto'}`,
        headers: { host: 'localhost:8083', cookie: `m2_transaccion=${tx.vinculo}` } });
      expect(respuesta.statusCode).toBe(303); expect(respuesta.headers.location).toBe('/?acceso=invalido');
      expect(respuesta.body).toBe(''); expect(pedidos).toBe(0);
    } finally { await app.close(); }
  });
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
    const logs = capturarLogs();
    const app = construirApp({ config: configOidc(), flujoLog: logs.flujo, auth: { sesiones, transacciones, pedir } });
    try {
      const url = `/auth/retorno?state=${tx.state}&code=codigo-secreto`;
      const headers = { host: 'localhost:8083', cookie: `m2_transaccion=${tx.vinculo}` };
      const ajeno = await app.inject({ url, headers: { ...headers, cookie: 'm2_transaccion=otro' } });
      expect(ajeno.headers).toMatchObject({ location: '/?acceso=invalido' }); expect(pedidos).toHaveLength(0);
      const respuesta = await app.inject({ url, headers });
      expect(respuesta.statusCode).toBe(303); expect(respuesta.headers.location).toBe('/');
      expect(respuesta.cookies.find(c => c.name === 'm2_sesion')?.value).toHaveLength(43);
      expect(JSON.stringify(respuesta.headers)).not.toContain('secreto'); expect(sesiones.cantidad()).toBe(1);
      const repetida = await app.inject({ url, headers }); expect(repetida.headers).toMatchObject({ location: '/?acceso=invalido' });
      expect(pedidos).toHaveLength(2);
      for (const secreto of ['codigo-secreto', 'refresh-secreto', tx.state, tx.vinculo, 'verifier', firmar('ID'), firmar('Bearer')]) {
        expect(logs.texto().includes(secreto)).toBe(false);
      }
    } finally { await app.close(); }
  });

  it.each(['error=access_denied', 'code=a&code=b', 'code=a&retorno=https://ajeno.test'])('no intercambia un retorno cancelado o ambiguo: %s', async (parametros) => {
    const app = construirApp({ config: configOidc(), auth: { pedir: async () => { throw new Error('No debe pedir'); } } });
    try {
      const respuesta = await app.inject({ url: `/auth/retorno?state=desconocido&${parametros}`, headers: { host: 'localhost:8083' } });
      expect(respuesta.statusCode).toBe(303); expect(respuesta.headers.location).toBe('/?acceso=invalido');
    }
    finally { await app.close(); }
  });
});
