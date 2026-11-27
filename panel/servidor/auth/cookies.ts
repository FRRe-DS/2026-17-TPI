import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ConfigPanelOidc } from '../config.js';
import { identificadorValido } from './almacen.js';
import type { crearAlmacenSesiones, DatosSesion, Sesion } from './sesiones.js';

const SESION = 'm2_sesion';
const TRANSACCION = 'm2_transaccion';
type AlmacenSesiones = ReturnType<typeof crearAlmacenSesiones>;

// Solo se aceptan nuestros identificadores base64url, sin decodificar ni elegir entre cookies repetidas.
function leerCookie(request: FastifyRequest, nombre: string): string | undefined {
  const coincidencias = (request.headers.cookie ?? '').split(';').filter((parte) => parte.split('=', 1)[0].trim() === nombre);
  if (coincidencias.length !== 1) return undefined;
  const parte = coincidencias[0];
  const separador = parte.indexOf('=');
  const valor = separador === -1 ? undefined : parte.slice(separador + 1).trim();
  return identificadorValido(valor) ? valor : undefined;
}

// Fastify acumula Set-Cookie: cada llamada agrega solo la cookie nueva.
function agregarCookie(reply: FastifyReply, cookie: string): void {
  reply.header('set-cookie', cookie);
}

export function crearCookiesAuth({ origenPublico }: Pick<ConfigPanelOidc, 'origenPublico'>) {
  // La configuración ya validada manda; Host o X-Forwarded-Proto nunca eligen los atributos de una cookie.
  const atributos = `Path=/; HttpOnly; SameSite=Lax${new URL(origenPublico).protocol === 'https:' ? '; Secure' : ''}`;
  const establecer = (reply: FastifyReply, nombre: string, valor: string, maxAge: number) => {
    if (!identificadorValido(valor)) throw new Error('Identificador de cookie inválido');
    agregarCookie(reply, `${nombre}=${valor}; ${atributos}; Max-Age=${maxAge}`);
  };
  const borrar = (reply: FastifyReply, nombre: string) =>
    agregarCookie(reply, `${nombre}=; ${atributos}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);

  return {
    // El llamador entrega identidad ya validada. No hay parámetro para fijar o reutilizar un ID del navegador.
    emitirSesion(reply: FastifyReply, datos: DatosSesion, almacen: AlmacenSesiones): string {
      const id = almacen.crear(datos);
      establecer(reply, SESION, id, 8 * 60 * 60);
      return id;
    },
    leerSesion(request: FastifyRequest, almacen: AlmacenSesiones): { id: string; sesion: Sesion } | undefined {
      const id = leerCookie(request, SESION);
      if (id === undefined) return undefined;
      const sesion = almacen.obtener(id);
      return sesion === undefined ? undefined : { id, sesion };
    },
    establecerTransaccion(reply: FastifyReply, vinculo: string): void {
      establecer(reply, TRANSACCION, vinculo, 5 * 60);
    },
    leerTransaccion: (request: FastifyRequest) => leerCookie(request, TRANSACCION),
    // El logout invalidará primero el registro del servidor (T9); borrar la cookie es una operación separada.
    borrarSesion: (reply: FastifyReply) => borrar(reply, SESION),
    borrarTransaccion: (reply: FastifyReply) => borrar(reply, TRANSACCION),
  };
}
