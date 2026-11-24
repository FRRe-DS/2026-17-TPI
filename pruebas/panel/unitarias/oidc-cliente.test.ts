import { it, expect } from 'vitest';
import { crearClienteOidc, SesionRechazada } from '../../../panel/servidor/auth/oidc.js';
import { cargarConfigPanel, type ConfigPanelOidc } from '../../../panel/servidor/config.js';
import { crearClave, armarTokenRsa, jwksDe } from '../../ayudas/jwks.js';
const config = cargarConfigPanel({ PANEL_MODO_AUTH: 'oidc', PANEL_ORIGEN_PUBLICO: 'http://localhost:8083',
  PANEL_OIDC_EMISOR: 'http://localhost:8080/realms/prueba', PANEL_OIDC_URL_INTERNA: 'http://localhost:8080/realms/prueba' }).config as ConfigPanelOidc;
it('JWKS comparte carga y un único reintento GET; el POST no se repite', async () => {
  const clave = crearClave(); const ahora = Math.floor(Date.now() / 1000); let certs = 0; let posts = 0;
  const token = (typ: string) => armarTokenRsa(clave, { claims: { iss: config.oidcEmisor, aud: typ === 'ID' ? 'm2-front' : 'm2-clientes',
    iat: ahora, exp: ahora + 300, sub: 'usuario', nonce: 'nonce', typ } });
  const oidc = crearClienteOidc(config, async (url) => {
    if (String(url).endsWith('/certs')) { if (++certs === 1) throw new Error('secreto'); return Response.json(jwksDe(clave)); }
    posts++; return Response.json({ id_token: token('ID'), access_token: token('Bearer'), refresh_token: 'secreto', refresh_expires_in: 600, token_type: 'Bearer' });
  });
  const resultado = await Promise.all([oidc.ingresar('code', 'verifier', 'nonce'), oidc.ingresar('code', 'verifier', 'nonce')]);
  expect(resultado.map(s => s.sub)).toEqual(['usuario', 'usuario']); expect(certs).toBe(2); expect(posts).toBe(2);
  let intentos = 0; const rechazado = crearClienteOidc(config, async () => { intentos++; return Response.json({ error: 'invalid_grant', error_description: 'secreto' }, { status: 400 }); });
  await expect(rechazado.renovar('secreto', 'usuario')).rejects.toBeInstanceOf(SesionRechazada); expect(intentos).toBe(1);
});
