import type { FastifyReply } from 'fastify';

// Las respuestas de error propias del panel, en application/problem+json como las de M2 (RNF-03.6). El `type` es una ruta bajo
// /panel/errores/ para que no se confunda con los de M2, que reenvía tal cual.
export type Problema = { type: string; title: string; status: number; detail?: string };

export function responderProblema(reply: FastifyReply, problema: Problema): FastifyReply {
  return reply.code(problema.status).header('content-type', 'application/problem+json').send(JSON.stringify(problema));
}
