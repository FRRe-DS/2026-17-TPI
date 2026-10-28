import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { ConfigPanel } from '../config.js';
import { responderProblema, type Problema } from '../problemas.js';
import { crearBaseDemo, type BaseDemo } from './base.js';
import { altasSimultaneas, calificacionesSimultaneas, crearClienteDeEjemplo, PreparacionFallida } from './concurrencia.js';
import { ComandoDockerFallido, crearControlDocker, DockerNoDisponible, type ControlDocker } from './docker.js';
import { idDePedido, m2Directo } from './m2-directo.js';
import { probarRestriccion } from './restriccion.js';

// Las rutas de la vista de demostración (spec 072, plan «Contrato», rutas propias del panel). Todas pasan por el hook de
// seguridad de la 071, que rechaza `Host` y `Origin` ajenos antes de llegar acá (RNF-12.10). Los cuerpos se validan con un esquema
// cerrado: lo que no está en la lista, `400` `/panel/errores/pedido-invalido` (el manejador de errores de la app).

// Cuánto se espera a M2 en el sondeo de salud. Es una máquina propia: si no contesta en 3 s, no va a contestar. Sin reintento.
export const ESPERA_SALUD_MS = 3000;

// Lo que las rutas necesitan de afuera: la base de M2 y Docker. Las pruebas pasan los suyos de mentira.
export type DependenciasDemo = {
  base: Pick<BaseDemo, 'pool' | 'contarClientes' | 'contarCalificaciones' | 'disponibilidad'>;
  docker: Pick<ControlDocker, 'disponibilidad' | 'apagar' | 'encender'>;
  esperaSaludMs?: number | undefined;
};

// Las de verdad, desde la configuración. `cerrar` suelta el pool de la base.
export function crearDependenciasDemo(config: Pick<ConfigPanel, 'urlBd' | 'docker' | 'servicioBd'>) {
  const base = crearBaseDemo(config.urlBd);
  const docker = crearControlDocker({ docker: config.docker, servicio: config.servicioBd });
  return { base, docker, cerrar: () => base.cerrar() };
}

const DOCKER_NO_DISPONIBLE = 'docker-no-disponible';

const problemaDeDocker = (detail: string | undefined): Problema => ({
  type: `/panel/errores/${DOCKER_NO_DISPONIBLE}`,
  title: 'Docker no disponible',
  status: 409,
  ...(detail === undefined ? {} : { detail }),
});

const COMANDO_DOCKER_FALLO = (detail: string): Problema => ({
  type: '/panel/errores/docker-fallo',
  title: 'El comando de Docker falló',
  status: 502,
  detail,
});

const PREPARACION_FALLIDA = (detail: string): Problema => ({
  type: '/panel/errores/preparacion-fallida',
  title: 'No se pudo preparar la prueba',
  status: 502,
  detail,
});

// De 2 a 50: con 1 no hay concurrencia, y 50 son los pedidos que M2 aguanta en una prueba de demostración (spec 072).
const N_SIMULTANEOS = { type: 'integer', minimum: 2, maximum: 50 } as const;
const SIN_CAMPOS = { body: { type: 'object', additionalProperties: false, properties: {} } } as const;

export type OpcionesRutasDemo = {
  config: ConfigPanel;
  demo: DependenciasDemo;
  // Cuánto se espera a cada pedido directo a M2 (las pruebas simultáneas). Solo las pruebas lo cambian.
  esperaM2Ms?: number | undefined;
};

export async function registrarDemo(app: FastifyInstance, { config, demo, esperaM2Ms }: OpcionesRutasDemo): Promise<void> {
  const { base, docker } = demo;
  const dependencias = { config, base, esperaMs: esperaM2Ms };

  // Una falla de preparación o de Docker es del entorno y no un error del panel: se responde con su motivo y no se registra como
  // error interno. Lo demás (un cuerpo inválido, un error de verdad) sigue al manejador de errores de la app.
  const conProblemas =
    <T>(ruta: (request: FastifyRequest) => Promise<T>) =>
    async (request: FastifyRequest, reply: FastifyReply): Promise<T | FastifyReply> => {
      try {
        return await ruta(request);
      } catch (error) {
        if (error instanceof PreparacionFallida) return responderProblema(reply, PREPARACION_FALLIDA(error.message));
        if (error instanceof DockerNoDisponible) return responderProblema(reply, problemaDeDocker(error.disponibilidad.motivo));
        if (error instanceof ComandoDockerFallido) return responderProblema(reply, COMANDO_DOCKER_FALLO(error.message));
        throw error;
      }
    };

  app.get('/panel/demo/estado', async () => ({ base: await base.disponibilidad(), docker: await docker.disponibilidad() }));

  app.post(
    '/panel/demo/altas-simultaneas',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['n', 'modo'],
          properties: { n: N_SIMULTANEOS, modo: { enum: ['misma-clave', 'claves-distintas'] } },
        },
      },
    },
    conProblemas(async (request) => altasSimultaneas(dependencias, request.body as { n: number; modo: 'misma-clave' | 'claves-distintas' })),
  );

  app.post(
    '/panel/demo/calificaciones-simultaneas',
    {
      schema: { body: { type: 'object', additionalProperties: false, required: ['n'], properties: { n: N_SIMULTANEOS } } },
    },
    conProblemas(async (request) => calificacionesSimultaneas(dependencias, request.body as { n: number })),
  );

  // La calificación necesita un cliente que exista: se lo crea por M2, como lo haría la persona, y después se prueba la base.
  app.post(
    '/panel/demo/restriccion-puntaje',
    { schema: SIN_CAMPOS },
    conProblemas(async () => {
      const clienteId = randomUUID();
      await crearClienteDeEjemplo(dependencias, clienteId, idDePedido(randomUUID().slice(0, 8), 'cliente'));
      return probarRestriccion(base, clienteId);
    }),
  );

  app.post(
    '/panel/demo/base/apagar',
    { schema: SIN_CAMPOS },
    conProblemas(async () => {
      await docker.apagar();
      return { ejecutado: true };
    }),
  );

  app.post(
    '/panel/demo/base/encender',
    { schema: SIN_CAMPOS },
    conProblemas(async () => {
      await docker.encender();
      return { ejecutado: true };
    }),
  );

  // El sondeo de la salud en vivo: no pasa por el reenvío porque un pedido cada 2 s llenaría el detalle técnico.
  app.get('/panel/demo/salud', async (request) => {
    const inicio = performance.now();
    const { estado } = await m2Directo(config, { metodo: 'GET', ruta: '/health', requestId: request.id }, demo.esperaSaludMs ?? ESPERA_SALUD_MS);
    return { estado: estado === 0 ? null : estado, duracionMs: Math.round(performance.now() - inicio) };
  });
}
