import { describe, expect, it } from 'vitest';
import { cargarConfigPanel } from '../../../panel/servidor/config.js';

const OIDC = {
  PANEL_MODO_AUTH: 'oidc',
  PANEL_ORIGEN_PUBLICO: 'http://localhost:8083',
  PANEL_OIDC_EMISOR: 'http://localhost:8080/realms/movilidad',
  PANEL_OIDC_URL_INTERNA: 'http://keycloak:8080/realms/movilidad',
};

describe('configuración de sesión real (083/T1, RNF-06.83.1)', () => {
  it('configura OIDC sin claves de desarrollo y deriva retornos del origen exacto', () => {
    expect(cargarConfigPanel(OIDC)).toEqual({ config: {
      modoAuth: 'oidc', puerto: 8083, escucha: '127.0.0.1',
      urlM2: 'http://localhost:8082', urlM2Publica: 'http://localhost:8082',
      origenPublico: 'http://localhost:8083',
      oidcEmisor: OIDC.PANEL_OIDC_EMISOR, oidcUrlInterna: OIDC.PANEL_OIDC_URL_INTERNA,
      oidcCliente: 'm2-front', tiempoIdentidadMs: 2000, m6Simulado: true,
      urlRetorno: 'http://localhost:8083/auth/retorno', urlSalida: 'http://localhost:8083/auth/salida',
    } });
  });

  it('no lee ni conserva claves, base o Docker heredados en modo real', () => {
    const resultado = cargarConfigPanel({ ...OIDC, M2_CLAVE_TOKENS: 'centinela-secreto',
      PANEL_URL_BD: 'centinela-base', PANEL_DOCKER: 'invalido', PANEL_URL_M6_CONTROL: 'invalido' });
    expect(resultado.errores).toBeUndefined();
    for (const campo of ['claveTokens', 'emisorTokens', 'audienciaTokens', 'campoRoles', 'urlBd', 'docker', 'servicioBd', 'urlM6Control']) {
      expect(resultado.config).not.toHaveProperty(campo);
    }
    expect(JSON.stringify(resultado)).not.toContain('centinela');
  });

  it.each(['PANEL_ORIGEN_PUBLICO', 'PANEL_OIDC_EMISOR', 'PANEL_OIDC_URL_INTERNA'])('%s es obligatoria', (variable) => {
    expect(cargarConfigPanel({ ...OIDC, [variable]: '' }).errores?.map((e) => e.variable)).toContain(variable);
  });

  it.each(['http://ejemplo.test', 'http://localhost.ejemplo.test', 'https://usuario:secreto@ejemplo.test',
    'https://ejemplo.test/ajeno', 'https://ejemplo.test?retorno=ajeno', 'https://ejemplo.test#ajeno',
    'https://*.ejemplo.test', '//ejemplo.test', 'ftp://ejemplo.test', ' https://ejemplo.test',
    'https://ejemplo.test/', 'https://ejemplo.test\\@ajeno.test',
  ])('rechaza un origen no exacto o inseguro: %s', (origen) => {
    const resultado = cargarConfigPanel({ ...OIDC, PANEL_ORIGEN_PUBLICO: origen });
    expect(resultado.config).toBeUndefined();
    expect(resultado.errores?.map((e) => e.variable)).toContain('PANEL_ORIGEN_PUBLICO');
    expect(JSON.stringify(resultado)).not.toContain(origen);
  });

  it.each(['http://127.0.0.1:8083', 'http://[::1]:8083', 'https://app.ejemplo.test'])('admite origen local o HTTPS: %s', (origen) => {
    expect(cargarConfigPanel({ ...OIDC, PANEL_ORIGEN_PUBLICO: origen }).config).toMatchObject({
      origenPublico: origen, urlRetorno: `${origen}/auth/retorno`, urlSalida: `${origen}/auth/salida`,
    });
  });

  it.each(['PANEL_OIDC_EMISOR', 'PANEL_OIDC_URL_INTERNA'])('valida el realm de %s sin revelar valores', (variable) => {
    for (const valor of ['https://usuario:secreto@id.test/realms/movilidad', 'https://id.test/realms/movilidad?secreto=1',
      'https://id.test/realms/movilidad#secreto', 'https://*.test/realms/movilidad', 'ftp://id.test/realms/movilidad',
      'https://id.test/otro', ' https://id.test/realms/movilidad']) {
      const resultado = cargarConfigPanel({ ...OIDC, [variable]: valor });
      expect(resultado.config).toBeUndefined();
      expect(resultado.errores?.map((e) => e.variable)).toContain(variable);
      expect(JSON.stringify(resultado)).not.toContain('secreto');
    }
  });

  it('exige el mismo realm público e interno', () => {
    expect(cargarConfigPanel({ ...OIDC, PANEL_OIDC_URL_INTERNA: 'http://keycloak:8080/realms/otro' }).errores)
      .toEqual([{ variable: 'PANEL_OIDC_URL_INTERNA', motivo: 'no corresponde al realm del emisor público' }]);
  });

  it('permite configurar cliente, plazo y etiqueta del simulador', () => {
    expect(cargarConfigPanel({ ...OIDC, PANEL_OIDC_CLIENTE: 'otro-front', PANEL_TIEMPO_IDENTIDAD_MS: '3500', PANEL_M6_SIMULADO: 'no' }).config)
      .toMatchObject({ oidcCliente: 'otro-front', tiempoIdentidadMs: 3500, m6Simulado: false });
  });

  it.each(['0', '-1', '2e3', '2147483648'])('rechaza plazo inválido %s', (valor) => {
    expect(cargarConfigPanel({ ...OIDC, PANEL_TIEMPO_IDENTIDAD_MS: valor }).errores?.map((e) => e.variable))
      .toContain('PANEL_TIEMPO_IDENTIDAD_MS');
  });

  it.each(['PANEL_OIDC_CLIENTE', 'PANEL_M6_SIMULADO', 'PANEL_MODO_AUTH'])('rechaza valor inválido de %s', (variable) => {
    expect(cargarConfigPanel({ ...OIDC, [variable]: ' invalido ' }).config).toBeUndefined();
  });

  it('un modo desconocido no cae al desarrollo aunque haya claves válidas', () => {
    expect(cargarConfigPanel({ PANEL_MODO_AUTH: 'oicd', M2_CLAVE_TOKENS: 'x'.repeat(32),
      M2_EMISOR_TOKENS: 'm1', M2_AUDIENCIA_TOKENS: 'm2-clientes' }).errores)
      .toEqual([{ variable: 'PANEL_MODO_AUTH', motivo: 'no es «desarrollo» ni «oidc»' }]);
  });
});
