import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearApiPanel } from '../../../panel/cliente/src/api/panel.js';
import { DockerNoDisponible } from '../../../panel/servidor/demo/docker.js';
import { crearAppPanel, DESDE_EL_PANEL, DESDE_EL_PANEL_CON_ORIGEN } from '../ayudas/app.js';
import { m2YControl } from '../ayudas/m2-y-control.js';

// `crearApiPanel` contra las rutas reales `/panel/demo/…` del servidor (spec 072, T13): lo que el navegador manda es lo que el
// servidor acepta, con sus esquemas cerrados. Con la base, Docker y M2 de mentira; el `fetch` entrega cada pedido a `inject`.
const abiertos: { close?: () => Promise<unknown>; cerrar?: () => Promise<unknown> }[] = [];
afterEach(async () => {
  for (const abierto of abiertos.splice(0)) await (abierto.close ?? abierto.cerrar)?.call(abierto);
});

async function levantar() {
  const m2 = m2YControl('normal');
  abiertos.push(m2);
  const url = await m2.levantar();
  const base = {
    pool: undefined,
    contarClientes: vi.fn(async () => ({ filas: 1 })),
    contarCalificaciones: vi.fn(async () => ({ filas: 1 })),
    disponibilidad: vi.fn(async () => ({ disponible: true })),
  };
  // Como el control real: sin Docker, apagar y encender no ejecutan nada y lanzan `DockerNoDisponible`.
  const docker = {
    disponibilidad: vi.fn(async () => ({ disponible: false, motivo: 'Docker no está instalado en esta máquina', comoActivar: 'Levantá el panel con npm run panel' }) as { disponible: boolean; motivo?: string; comoActivar?: string }),
    apagar: vi.fn(async () => {
      const estado = await docker.disponibilidad();
      if (!estado.disponible) throw new DockerNoDisponible(estado);
    }),
    encender: vi.fn(async () => {
      const estado = await docker.disponibilidad();
      if (!estado.disponible) throw new DockerNoDisponible(estado);
    }),
  };
  const app = crearAppPanel({ config: { urlM2: url, urlM6Control: url }, demo: { base: base as never, docker: docker as never } });
  abiertos.push(app);
  // El `fetch` de la página: lo que no es consulta lleva `Origin`, como en Chrome.
  const porElPanel: typeof fetch = async (entrada, init = {}) => {
    const metodo = (init.method ?? 'GET').toUpperCase();
    const respuesta = await app.inject({
      method: metodo as 'GET' | 'POST',
      url: String(entrada),
      headers: { ...(metodo === 'GET' ? DESDE_EL_PANEL : DESDE_EL_PANEL_CON_ORIGEN), ...(init.headers as Record<string, string>) },
      payload: init.body as string | undefined,
    });
    return new Response(respuesta.body, { status: respuesta.statusCode, headers: respuesta.headers as Record<string, string> });
  };
  return { api: crearApiPanel({ fetch: porElPanel }), m2, base, docker };
}

describe('crearApiPanel contra las rutas /panel/demo/…', () => {
  it('el estado informa la base y Docker con su motivo y cómo activarlo', async () => {
    const { api } = await levantar();

    expect(await api.obtenerEstadoDemo()).toEqual({
      base: { disponible: true },
      docker: { disponible: false, motivo: 'Docker no está instalado en esta máquina', comoActivar: 'Levantá el panel con npm run panel' },
    });
  });

  it('la salud de M2 devuelve el código de /health', async () => {
    const { api, m2 } = await levantar();
    m2.responderCon?.({ tipo: 'ok' } as never);

    expect(await api.consultarSaludDeM2()).toEqual({ estado: expect.any(Number), duracionMs: expect.any(Number) });
  });

  it('las altas y las calificaciones simultáneas, con N en el límite, las acepta el esquema', async () => {
    const { api } = await levantar();

    for (const n of [2, 50]) {
      expect(await api.lanzarAltasSimultaneas(n, 'misma-clave')).toMatchObject({ n });
      expect(await api.lanzarAltasSimultaneas(n, 'claves-distintas')).toMatchObject({ n });
    }
  });

  it('un N fuera de rango es un 400 que llega como ErrorDeApi, sin lanzar ningún pedido', async () => {
    const { api, base } = await levantar();

    await expect(api.lanzarAltasSimultaneas(51, 'misma-clave')).rejects.toMatchObject({ estado: 400, type: '/panel/errores/pedido-invalido' });
    await expect(api.lanzarCalificacionesSimultaneas(1)).rejects.toMatchObject({ estado: 400 });
    expect(base.contarClientes).not.toHaveBeenCalled();
  });

  it('apagar y encender (cuerpo «{}») se ejecutan una vez cada uno; sin Docker, el 409 trae el motivo', async () => {
    const { api, docker } = await levantar();

    await expect(api.apagarBase()).rejects.toMatchObject({ estado: 409, type: '/panel/errores/docker-no-disponible', detail: 'Docker no está instalado en esta máquina' });
    await expect(api.encenderBase()).rejects.toMatchObject({ estado: 409, type: '/panel/errores/docker-no-disponible' });

    docker.disponibilidad.mockResolvedValue({ disponible: true });
    docker.apagar.mockClear();
    docker.encender.mockClear();
    expect(await api.apagarBase()).toEqual({ ejecutado: true });
    expect(await api.encenderBase()).toEqual({ ejecutado: true });
    expect(docker.apagar).toHaveBeenCalledTimes(1);
    expect(docker.encender).toHaveBeenCalledTimes(1);
  });

  it('la restricción del puntaje (cuerpo «{}») la acepta el esquema', async () => {
    const { api } = await levantar();

    const resultado = await api.probarRestriccionDelPuntaje();

    // Sin pool, la base de mentira no puede probar: el resultado llega igual, con ✘ y el motivo.
    expect(resultado).toMatchObject({ cumple: false });
  });
});
