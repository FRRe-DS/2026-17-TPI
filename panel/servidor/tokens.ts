import { SignJWT } from 'jose';
import type { ConfigTokens } from './config.js';

// Los tokens que el panel le pone a cada pedido a M2. Los firma el servidor del panel con la clave de desarrollo y nunca salen
// de su proceso: el navegador solo dice con qué identidad quiere probar (rol y sub) y recibe la respuesta de M2 (RNF-19.3).
// Mismo formato que valida M2 (ADR 009): JWT HS256 con `iss`, `aud`, `sub`, `exp` y la lista de roles.

// Los roles que reconoce M2, escritos exactamente así.
export const ROLES_DEL_PANEL = ['CLIENTE', 'OPERADOR', 'SERVICIO', 'CONDUCTOR'] as const;
export type RolDelPanel = (typeof ROLES_DEL_PANEL)[number];

export type DatosToken = { sub: string; roles: readonly string[] };

const LARGO_MAXIMO_SUB = 128;
// Un token por pedido y de vida corta: si se copiara de algún lado, dura poco (plan, Token por pedido).
const VIDA_SEGUNDOS = 300;

// La identidad pedida no sirve para firmar. El mensaje dice qué campo falla y no repite lo recibido. El reenvío lo responde con 400.
export class TokenInvalido extends Error {
  override readonly name = 'TokenInvalido';
}

const esRol = (valor: unknown): valor is RolDelPanel => (ROLES_DEL_PANEL as readonly unknown[]).includes(valor);

// Lo que llega de un encabezado no tiene tipo: se comprueba todo, no solo lo que dice el tipo de TypeScript.
function validar({ sub, roles }: DatosToken): { sub: string; roles: RolDelPanel[] } {
  if (typeof sub !== 'string' || sub.trim() === '' || sub.length > LARGO_MAXIMO_SUB) {
    throw new TokenInvalido(`El sub tiene que ser un texto de 1 a ${LARGO_MAXIMO_SUB} caracteres`);
  }
  if (!Array.isArray(roles) || roles.length === 0 || !roles.every(esRol)) {
    throw new TokenInvalido(`Los roles tienen que ser una lista no vacía de ${ROLES_DEL_PANEL.join(', ')}`);
  }
  return { sub, roles: [...new Set(roles)] };
}

// Firma el token de un pedido. `ahoraMs` es el reloj, para poder probar el vencimiento.
export async function firmarToken(datos: DatosToken, config: ConfigTokens, ahoraMs = Date.now()): Promise<string> {
  const { sub, roles } = validar(datos);
  const emitidoEn = Math.floor(ahoraMs / 1000);
  return new SignJWT({ [config.campoRoles]: roles })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(config.emisorTokens)
    .setAudience(config.audienciaTokens)
    .setSubject(sub)
    .setIssuedAt(emitidoEn)
    .setExpirationTime(emitidoEn + VIDA_SEGUNDOS)
    .sign(new TextEncoder().encode(config.claveTokens));
}
