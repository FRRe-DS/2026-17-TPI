import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Caso } from '../../../panel/cliente/src/logica/casos.js';
import type { ResultadoDeCaso } from '../../../panel/cliente/src/logica/ejecutar-caso.js';

// El resultado de un caso en la vista «Demostración» (spec 072, T14): pedido, respuesta, esperado y ✔ «Correcto» o ✘ «No coincide».
// Se dibuja con `renderToStaticMarkup`, como los demás componentes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cualquiera = ComponentType<any>;
async function ResultadoCaso(): Promise<Cualquiera> {
  const ruta: string = new URL('../../../panel/cliente/src/componentes/resultado-caso.tsx', import.meta.url).pathname;
  return ((await import(ruta)) as Record<string, Cualquiera>).ResultadoCaso!;
}

const CASO: Pick<Caso, 'id' | 'titulo'> = { id: 'perfil-crear', titulo: 'Crear el perfil' };
const CORRECTO: ResultadoDeCaso = {
  casoId: 'perfil-crear',
  pedido: { metodo: 'POST', ruta: '/api/v1/clientes', identidad: { rol: 'CLIENTE', sub: 'c-1' }, clave: 'k-1', cuerpo: { nombre: 'Ana' } },
  respuesta: { estado: 201, encabezados: { location: '/api/v1/clientes/c-1', 'x-request-id': 'panel-7' }, cuerpo: { clienteId: 'c-1' } },
  esperado: { estado: 201, conLocation: true },
  veredicto: { correcto: true },
};
const INCORRECTO: ResultadoDeCaso = {
  casoId: 'perfil-crear',
  pedido: CORRECTO.pedido!,
  respuesta: { estado: 500, encabezados: { 'content-type': 'application/problem+json' }, type: '/errores/interno', cuerpo: { type: '/errores/interno', detail: '<img src=x onerror=alert(1)>' } },
  esperado: { estado: 201, conLocation: true },
  veredicto: { correcto: false, motivo: 'se esperaba 201, llegó 500' },
};

const dibujar = async (resultado: ResultadoDeCaso) => renderToStaticMarkup(createElement(await ResultadoCaso(), { caso: CASO, resultado }));

describe('ResultadoCaso', () => {
  it('✔ dice «Correcto» con texto, no solo con color', async () => {
    const html = await dibujar(CORRECTO);

    expect(html).toContain('Correcto');
    expect(html).not.toContain('No coincide');
  });

  it('✘ dice «No coincide» y el motivo en una línea', async () => {
    const html = await dibujar(INCORRECTO);

    expect(html).toContain('No coincide');
    expect(html).toContain('se esperaba 201, llegó 500');
    expect(html).not.toContain('>Correcto<');
  });

  it('muestra el pedido: método, ruta, quién lo hizo, la clave y el cuerpo', async () => {
    const html = await dibujar(CORRECTO);

    expect(html).toContain('POST /api/v1/clientes');
    expect(html).toContain('CLIENTE (c-1)');
    expect(html).toContain('k-1');
    expect(html).toContain('&quot;nombre&quot;: &quot;Ana&quot;');
  });

  it('muestra la respuesta: el código, el type, los encabezados y el cuerpo', async () => {
    const html = await dibujar(INCORRECTO);

    expect(html).toContain('500');
    expect(html).toContain('/errores/interno');
    expect(html).toContain('application/problem+json');
  });

  it('muestra los encabezados relevantes de un éxito, entre ellos X-Request-Id para buscarlo en los logs', async () => {
    const html = await dibujar(CORRECTO);

    expect(html).toContain('location');
    expect(html).toContain('/api/v1/clientes/c-1');
    expect(html).toContain('panel-7');
  });

  it('muestra lo esperado, con el aviso de que un error es application/problem+json', async () => {
    const html = await dibujar(INCORRECTO);

    expect(html).toContain('201, con el encabezado Location');
  });

  it('el mensaje de un error se pone como texto: ninguna etiqueta del servidor llega como HTML', async () => {
    const html = await dibujar(INCORRECTO);

    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('sin respuesta (M2 no contestó) lo dice y no inventa un código', async () => {
    const html = await dibujar({ casoId: 'perfil-crear', pedido: CORRECTO.pedido!, esperado: { estado: 201 }, veredicto: { correcto: false, motivo: 'sin respuesta: no respondió en 10 s' } });

    expect(html).toContain('Sin respuesta');
    expect(html).toContain('sin respuesta: no respondió en 10 s');
  });

  it('sin pedido (no se pudo ni armar) muestra solo el veredicto', async () => {
    const html = await dibujar({ casoId: 'perfil-crear', esperado: { estado: 201 }, veredicto: { correcto: false, motivo: 'error inesperado: sin crypto' } });

    expect(html).toContain('error inesperado: sin crypto');
    expect(html).not.toContain('Pedido');
  });

  it('el pedido muestra el Authorization enmascarado, y el token ni nada parecido (RNF-19.4)', async () => {
    const html = await dibujar(CORRECTO);

    expect(html).toMatch(/<dt>Authorization<\/dt><dd>Bearer ••••<\/dd>/);
    expect(html).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
  });

  it('sin token no hay Authorization que mostrar', async () => {
    const html = await dibujar({ ...CORRECTO, pedido: { ...CORRECTO.pedido!, identidad: null } });

    expect(html).not.toContain('Authorization');
  });

  it('el pedido sin token lo dice', async () => {
    const html = await dibujar({ ...CORRECTO, pedido: { ...CORRECTO.pedido!, identidad: null } });

    expect(html).toContain('sin token');
  });

  it('lleva un nombre accesible con el título del caso', async () => {
    const html = await dibujar(CORRECTO);

    expect(html).toContain('aria-label="Resultado: Crear el perfil"');
  });
});
