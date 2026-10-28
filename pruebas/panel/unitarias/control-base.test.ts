import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ErrorDeApi } from '../../../panel/cliente/src/api/errores.js';
import type { EstadoSalud } from '../../../panel/cliente/src/logica/salud-en-vivo.js';

// La sección «Base de datos» de la vista «Demostración» (spec 072, T16, RNF-13.4, RNF-13.6, RNF-15.6), dibujada con
// `renderToStaticMarkup`: los dos botones, la salud en vivo o, sin Docker, el motivo y cómo activarlos. Los clics (la confirmación,
// «Cancelar» que no llama a nada) los recorre la prueba en navegador `control-base.test.ts`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cualquiera = ComponentType<any>;
async function ControlBase(): Promise<Cualquiera> {
  const ruta: string = new URL('../../../panel/cliente/src/componentes/control-base.tsx', import.meta.url).pathname;
  return ((await import(ruta)) as Record<string, Cualquiera>).ControlBase!;
}

const DISPONIBLE = { disponible: true };
const SIN_DOCKER = {
  disponible: false,
  motivo: 'el panel corre en un contenedor y no tiene acceso a Docker',
  comoActivar: 'Levantá el panel en la máquina con npm run panel (con el perfil panel de compose arriba).',
};
const base = { docker: DISPONIBLE, salud: { fase: 'quieto' } as EstadoSalud, activa: undefined, alApagar: () => undefined, alEncender: () => undefined };
const dibujar = async (props: Record<string, unknown>) => renderToStaticMarkup(createElement(await ControlBase(), { ...base, ...props }));
const boton = (html: string, texto: string) => [...html.matchAll(/<button\b[^>]*>(?:(?!<\/button>).)*<\/button>/g)].map((m) => m[0]).find((b) => b.includes(texto));

describe('ControlBase con Docker', () => {
  it('el título «Base de datos», qué hace cada botón y los dos botones habilitados', async () => {
    const html = await dibujar({});

    expect(html).toMatch(/<h2 id="demo-base"[^>]*>Base de datos<\/h2>/);
    expect(html).toContain('docker compose stop');
    expect(html).toContain('docker compose start');
    expect(boton(html, 'Apagar la base')).not.toMatch(/disabled/);
    expect(boton(html, 'Encender la base')).not.toMatch(/disabled/);
  });

  it('la salud en vivo en una región que se anuncia sola', async () => {
    const html = await dibujar({ salud: { fase: 'observando', ultimo: 503 } });

    expect(html).toMatch(/<p[^>]*role="status"[^>]*>Base apagada\. M2 responde 503: no puede atender sin su base\.<\/p>/);
  });

  it('la región de la salud existe desde el principio, para que el lector la registre antes de que cambie', async () => {
    const html = await dibujar({});

    expect(html).toMatch(/role="status"[^>]*>Todavía no apagaste ni encendiste la base desde esta vista\.</);
  });

  it('apagando: «Apagar la base» espera con «Apagando…»', async () => {
    const html = await dibujar({ salud: { fase: 'apagando' }, activa: 'base:apagar' });

    expect(boton(html, 'Apagando…')).toMatch(/disabled/);
    expect(boton(html, 'Apagando…')).toContain('aria-busy="true"');
    expect(boton(html, 'Encender la base')).toMatch(/disabled/);
  });

  it('encendiendo: «Encender la base» espera con «Encendiendo…» hasta que M2 conteste', async () => {
    const html = await dibujar({ salud: { fase: 'encendiendo', desde: 0, ultimo: 503 } });

    expect(boton(html, 'Encendiendo…')).toContain('aria-busy="true"');
    expect(html).toContain('Encendiendo la base. M2 responde 503; esperando el 200 (hasta 60 s)…');
  });

  it('M2 no volvió: lo dice con el último estado', async () => {
    const html = await dibujar({ salud: { fase: 'no-volvio', ultimo: 503 } });

    expect(html).toContain('M2 no volvió a responder 200 en 60 s (último estado: 503).');
    expect(boton(html, 'Encender la base')).not.toMatch(/disabled/);
  });

  it('el comando de encender falló: el error completo y «Reintentar»', async () => {
    const error = new ErrorDeApi({ sinRespuesta: false, estado: 502, type: '/panel/errores/docker-fallo', title: 'El comando de Docker falló', detail: 'no such service: bd' });
    const html = await dibujar({ error });

    expect(html).toMatch(/role="alert"/);
    expect(html).toContain('No se pudo encender la base.');
    expect(html).toContain('El comando de Docker falló');
    expect(html).toContain('no such service: bd');
    expect(html).toContain('Reintentar');
  });
});

describe('ControlBase sin Docker (RNF-13.6)', () => {
  it('los dos botones deshabilitados, con el motivo y cómo activarlos', async () => {
    const html = await dibujar({ docker: SIN_DOCKER });

    expect(boton(html, 'Apagar la base')).toMatch(/disabled/);
    expect(boton(html, 'Encender la base')).toMatch(/disabled/);
    expect(html).toContain('Apagar y encender la base no están disponibles: el panel corre en un contenedor y no tiene acceso a Docker.');
    expect(html).toContain('Levantá el panel en la máquina con npm run panel');
  });

  it('deshabilitados sin esperar: no es que estén trabajando', async () => {
    const html = await dibujar({ docker: SIN_DOCKER });

    expect(html).not.toContain('aria-busy');
  });

  it('mientras se consulta, los dos deshabilitados y lo dice', async () => {
    const html = await dibujar({ docker: undefined });

    expect(boton(html, 'Apagar la base')).toMatch(/disabled/);
    expect(html).toContain('Consultando si el panel puede usar Docker…');
  });
});
