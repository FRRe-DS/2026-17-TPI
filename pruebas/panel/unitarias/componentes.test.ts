import { createElement, type ComponentType, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ErrorDeApi, m2NoResponde } from '../../../panel/cliente/src/api/errores.js';
import type { EstadoAccion, EstadoCarga } from '../../../panel/cliente/src/logica/estados.js';
import {
  atributosDeCampo,
  debeEnfocarTitulo,
  filasDelError,
  modeloBoton,
  modeloDialogo,
  textoDelAviso,
} from '../../../panel/cliente/src/logica/presentacion.js';
import { claveDeRuta } from '../../../panel/cliente/src/rutas.js';

// Los componentes base (T18). La lógica de cada uno está en `logica/presentacion.ts` y se prueba con tipos; además se dibuja
// cada componente con `renderToStaticMarkup` para comprobar los elementos y atributos que entrega (`<button>`, `<label>`,
// `<dialog>`, `aria-describedby`, la región `aria-live`). Los `.tsx` se importan por ruta: el tsconfig de la raíz no tiene JSX
// ni el DOM, y el cliente ya lo comprueba `npm run panel:build`.

const RECHAZO = new ErrorDeApi({
  sinRespuesta: false,
  estado: 400,
  type: '/errores/validacion',
  title: 'Solicitud inválida',
  detail: 'telefono: tiene que estar en formato E.164.',
  requestId: 'panel-4f1c9a',
});
const NO_RESPONDE = m2NoResponde('panel-77b2c0');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cualquiera = ComponentType<any>;
async function componente(archivo: string, nombre: string): Promise<Cualquiera> {
  const ruta: string = new URL(`../../../panel/cliente/src/componentes/${archivo}`, import.meta.url).pathname;
  const modulo = (await import(ruta)) as Record<string, Cualquiera>;
  return modulo[nombre]!;
}
const dibujar = (tipo: Cualquiera, props: Record<string, unknown>, ...hijos: ReactNode[]) => renderToStaticMarkup(createElement(tipo, props, ...hijos));
const nada = () => undefined;

describe('modeloBoton: el botón que envía (RNF-15.2, RF-2.5.15)', () => {
  it('quieto, habilitado y con su texto', () => {
    expect(modeloBoton(false, 'Guardar cambios')).toEqual({ deshabilitado: false, etiqueta: 'Guardar cambios', esperando: false });
  });

  it('mientras espera, deshabilitado y con el texto de espera', () => {
    expect(modeloBoton(true, 'Guardar cambios')).toEqual({ deshabilitado: true, etiqueta: 'Enviando…', esperando: true });
    expect(modeloBoton(true, 'Calificar', 'Calificando…').etiqueta).toBe('Calificando…');
  });
});

describe('textoDelAviso: lo que lee la región aria-live (RNF-15.2)', () => {
  it.each<[string, EstadoAccion<unknown>, ReturnType<typeof textoDelAviso>]>([
    ['sin acción, nada', { fase: 'inactiva' }, { tono: 'ninguno', texto: '' }],
    ['esperando, que se está enviando', { fase: 'esperando' }, { tono: 'espera', texto: 'Enviando…' }],
    ['hecha, el aviso de lo que se hizo', { fase: 'hecha', aviso: 'Dirección guardada.', resultado: {} }, { tono: 'hecho', texto: 'Dirección guardada.' }],
    [
      'fallida, el título, el código y el detalle de M2',
      { fase: 'fallida', error: RECHAZO },
      { tono: 'error', texto: 'Solicitud inválida (400). telefono: tiene que estar en formato E.164.' },
    ],
    ['M2 no responde, eso y que se puede reintentar', { fase: 'fallida', error: NO_RESPONDE }, { tono: 'error', texto: 'M2 no responde. Se puede reintentar.' }],
  ])('%s', (_caso, estado, esperado) => {
    expect(textoDelAviso(estado)).toEqual(esperado);
  });
});

describe('filasDelError: el error de M2 tal como vino (RNF-03.6)', () => {
  it('código, tipo, detalle, instancia y folio, sin las que faltan', () => {
    expect(filasDelError(RECHAZO)).toEqual([
      ['Código', '400'],
      ['Tipo', '/errores/validacion'],
      ['Detalle', 'telefono: tiene que estar en formato E.164.'],
      ['Folio', 'panel-4f1c9a'],
    ]);
    expect(filasDelError(new ErrorDeApi({ sinRespuesta: false, estado: 404, type: 'about:blank', title: 'No encontrado', instance: '/x' }))).toEqual([
      ['Código', '404'],
      ['Tipo', 'about:blank'],
      ['Instancia', '/x'],
    ]);
  });

  it('con Retry-After, cuántos segundos esperar', () => {
    const error = new ErrorDeApi({ sinRespuesta: false, estado: 503, type: '/errores/m6-no-disponible', title: 'Servicio no disponible', reintentarEnS: 30 });
    expect(filasDelError(error)).toContainEqual(['Reintentar en', '30 s']);
  });
});

describe('atributosDeCampo: cada error con su campo (RNF-15.3)', () => {
  it('sin ayuda ni error, no describe nada', () => {
    expect(atributosDeCampo('telefono', {})).toEqual({ idAyuda: undefined, idError: undefined, describidoPor: undefined, invalido: false });
  });

  it('la ayuda y el error describen el campo, en ese orden, y el error lo marca inválido', () => {
    expect(atributosDeCampo('telefono', { ayuda: 'Con +54…', error: 'Falta el +.' })).toEqual({
      idAyuda: 'telefono-ayuda',
      idError: 'telefono-error',
      describidoPor: 'telefono-ayuda telefono-error',
      invalido: true,
    });
  });

  it('un error vacío no cuenta como error', () => {
    expect(atributosDeCampo('nombre', { error: '' }).invalido).toBe(false);
  });
});

describe('modeloDialogo: la confirmación de lo que no se deshace (RF-2.2.7, RNF-15.4)', () => {
  it('mientras espera, ni confirmar ni cancelar ni cerrar con Escape', () => {
    expect(modeloDialogo({ fase: 'esperando' })).toEqual({ confirmarDeshabilitado: true, cancelarDeshabilitado: true, cierraConEscape: false });
  });

  it.each<[string, EstadoAccion<unknown>]>([
    ['sin acción', { fase: 'inactiva' }],
    ['tras un rechazo', { fase: 'fallida', error: RECHAZO }],
    ['tras «M2 no responde»', { fase: 'fallida', error: NO_RESPONDE }],
  ])('%s, todo habilitado', (_caso, estado) => {
    expect(modeloDialogo(estado)).toEqual({ confirmarDeshabilitado: false, cancelarDeshabilitado: false, cierraConEscape: true });
  });
});

describe('el foco al título al cambiar de pantalla (RNF-15.3)', () => {
  it('no en la primera pantalla; sí al pasar a otra o a otro id; no si la ruta es la misma', () => {
    expect(debeEnfocarTitulo(undefined, 'perfil')).toBe(false);
    expect(debeEnfocarTitulo('perfil', 'direcciones')).toBe(true);
    expect(debeEnfocarTitulo('direcciones', 'direcciones/7d44a3b2-1c10-4e6f-9a7b-1c2d3e4f5a6b')).toBe(true);
    expect(debeEnfocarTitulo('perfil', 'perfil')).toBe(false);
  });

  it('claveDeRuta distingue la pantalla y su id', () => {
    expect(claveDeRuta({ pantalla: 'perfil' })).toBe('perfil');
    expect(claveDeRuta({ pantalla: 'calificar', id: '7d44a3b2-1c10-4e6f-9a7b-1c2d3e4f5a6b' })).toBe('calificar/7d44a3b2-1c10-4e6f-9a7b-1c2d3e4f5a6b');
  });
});

describe('lo que dibuja cada componente', () => {
  it('BotonAccion: un <button>, deshabilitado y con aria-busy solo mientras espera', async () => {
    const BotonAccion = await componente('boton-accion.tsx', 'BotonAccion');

    const quieto = dibujar(BotonAccion, { esperando: false, onClick: nada }, 'Guardar cambios');
    expect(quieto).toMatch(/^<button type="button"/);
    expect(quieto).not.toContain('disabled');
    expect(quieto).toContain('Guardar cambios');

    const esperando = dibujar(BotonAccion, { esperando: true, onClick: nada }, 'Guardar cambios');
    expect(esperando).toContain('disabled=""');
    expect(esperando).toContain('aria-busy="true"');
    expect(esperando).toContain('Enviando…');

    expect(dibujar(BotonAccion, { esperando: false, tipo: 'submit' }, 'Guardar')).toMatch(/^<button type="submit"/);
  });

  it('Aviso: la región aria-live existe siempre y lee el texto del estado', async () => {
    const Aviso = await componente('aviso.tsx', 'Aviso');

    expect(dibujar(Aviso, { estado: { fase: 'inactiva' } })).toMatch(/role="status"[^>]*aria-live="polite"[^>]*><\/div>|aria-live="polite"[^>]*role="status"[^>]*><\/div>/);
    expect(dibujar(Aviso, { estado: { fase: 'hecha', aviso: 'Preferencias guardadas.', resultado: {} } })).toContain('Preferencias guardadas.');
  });

  it('ErrorDeM2: título, código, detalle y folio, y «Reintentar» habilitado', async () => {
    const ErrorDeM2 = await componente('error-de-m2.tsx', 'ErrorDeM2');

    const html = dibujar(ErrorDeM2, { error: RECHAZO, alReintentar: nada });
    for (const parte of ['Solicitud inválida', '400', '/errores/validacion', 'telefono: tiene que estar en formato E.164.', 'panel-4f1c9a']) {
      expect(html).toContain(parte);
    }
    // El texto va dentro del contenido del botón (el que se funde al cambiar de estado).
    expect(html).toMatch(/<button type="button"[^>]*><span[^>]*>Reintentar<\/span><\/button>/);
    expect(html).not.toContain('disabled');

    const sinRespuesta = dibujar(ErrorDeM2, { error: NO_RESPONDE, alReintentar: nada });
    expect(sinRespuesta).toContain('M2 no responde');
    expect(sinRespuesta).toContain('Reintentar');
    expect(sinRespuesta).not.toContain('disabled');
  });

  it('EstadoPantalla: cargando, vacío, error con «Reintentar» y los datos', async () => {
    const EstadoPantalla = await componente('estado-pantalla.tsx', 'EstadoPantalla');
    const hijos = (datos: { nombre: string }) => createElement('p', null, `Hola, ${datos.nombre}`);
    const con = (estado: EstadoCarga<{ nombre: string }>) => dibujar(EstadoPantalla, { estado, vacio: 'Todavía no hay direcciones.', alReintentar: nada, children: hijos });

    expect(con({ fase: 'cargando', pedido: 1 })).toContain('aria-busy="true"');
    expect(con({ fase: 'cargando', pedido: 1 })).toContain('Cargando…');
    expect(con({ fase: 'vacio', pedido: 1 })).toContain('Todavía no hay direcciones.');
    expect(con({ fase: 'error', error: NO_RESPONDE, pedido: 1 })).toContain('M2 no responde');
    expect(con({ fase: 'error', error: NO_RESPONDE, pedido: 1 })).toContain('Reintentar');
    expect(con({ fase: 'listo', datos: { nombre: 'Ana' }, pedido: 1 })).toContain('Hola, Ana');
    expect(con({ fase: 'listo', datos: { nombre: 'Ana' }, pedido: 1 })).not.toContain('aria-busy="true"');
  });

  it('DialogoConfirmar: un <dialog> con título y mensaje asociados, «Cancelar» y la acción', async () => {
    const DialogoConfirmar = await componente('dialogo-confirmar.tsx', 'DialogoConfirmar');
    const props = { abierto: true, titulo: 'Eliminar la dirección', confirmar: 'Eliminar', alConfirmar: nada, alCancelar: nada };

    const html = dibujar(DialogoConfirmar, { ...props, estado: { fase: 'inactiva' } }, 'Se borra «Casa» de tus direcciones.');
    const [, etiquetadoPor] = /<dialog[^>]*aria-labelledby="([^"]+)"/.exec(html) ?? [];
    const [, descriptoPor] = /<dialog[^>]*aria-describedby="([^"]+)"/.exec(html) ?? [];
    expect(html).toContain(`id="${etiquetadoPor}"`);
    expect(html).toContain(`id="${descriptoPor}"`);
    expect(html).toContain('Eliminar la dirección');
    expect(html).toContain('Se borra «Casa» de tus direcciones.');
    expect(html).toMatch(/<button type="button"[^>]*>Cancelar<\/button>/);
    expect(html).not.toContain('disabled');

    const esperando = dibujar(DialogoConfirmar, { ...props, estado: { fase: 'esperando' } }, 'x');
    expect(esperando.match(/disabled=""/g)).toHaveLength(2);

    const fallida = dibujar(DialogoConfirmar, { ...props, estado: { fase: 'fallida', error: NO_RESPONDE } }, 'x');
    expect(fallida).toContain('M2 no responde');
    expect(fallida).not.toContain('disabled');
  });

  it('Campo: <label> del control, ayuda y error en aria-describedby, aria-invalid con error', async () => {
    const Campo = await componente('formulario.tsx', 'Campo');

    const html = dibujar(Campo, { id: 'telefono', numero: 3, etiqueta: 'Teléfono', ayuda: 'Con + y código de país.', error: 'Falta el +.', valor: '3624', alCambiar: nada });
    expect(html).toMatch(/<label[^>]*for="telefono"/);
    expect(html).toMatch(/<input[^>]*id="telefono"/);
    expect(html).toMatch(/<input[^>]*aria-describedby="telefono-ayuda telefono-error"/);
    expect(html).toMatch(/<input[^>]*aria-invalid="true"/);
    expect(html).toMatch(/id="telefono-error"[^>]*>Falta el \+\.</);
    expect(html).toContain('03');

    const limpio = dibujar(Campo, { id: 'nombre', etiqueta: 'Nombre', valor: 'Ana', alCambiar: nada });
    expect(limpio).not.toContain('aria-invalid');
    expect(limpio).not.toContain('aria-describedby');

    const largo = dibujar(Campo, { id: 'comentario', etiqueta: 'Comentario', multilinea: true, maximo: 500, valor: '', alCambiar: nada });
    expect(largo).toMatch(/<textarea[^>]*maxLength="500"|<textarea[^>]*maxlength="500"/);
  });

  it('Formulario: un <form> con el error de M2 junto a los campos', async () => {
    const Formulario = await componente('formulario.tsx', 'Formulario');

    const html = dibujar(Formulario, { titulo: 'Datos personales', alEnviar: nada, error: RECHAZO, alReintentar: nada }, createElement('p', null, 'campos'));
    expect(html).toMatch(/^<form[^>]*novalidate=""/i);
    expect(html).toContain('Datos personales');
    expect(html).toContain('telefono: tiene que estar en formato E.164.');
    expect(html).toContain('campos');
  });

  it('Titulo: un <h1> que puede recibir el foco', async () => {
    const Titulo = await componente('titulo.tsx', 'Titulo');

    expect(dibujar(Titulo, {}, 'Mi perfil')).toBe('<h1 tabindex="-1">Mi perfil</h1>');
  });
});

describe('GrupoDeOpciones: casillas para marcar (T24, RF-2.3.6)', () => {
  const OPCIONES = [{ valor: 'EMAIL', etiqueta: 'Correo electrónico' }, { valor: 'SMS', etiqueta: 'SMS' }, { valor: 'PUSH', etiqueta: 'Notificación' }];

  it('un fieldset con su legend y una casilla por opción, cada una con su label', async () => {
    const Grupo = await componente('formulario.tsx', 'GrupoDeOpciones');

    const html = dibujar(Grupo, { id: 'canales', etiqueta: 'Avisos por', numero: 2, opciones: OPCIONES, seleccionados: ['SMS'], alCambiar: nada });

    expect(html).toMatch(/^<fieldset[^>]*>\s*<legend[^>]*>/);
    expect(html).toContain('Avisos por');
    expect(html.match(/<input type="checkbox"/g)).toHaveLength(3);
    expect(html.match(/<label/g)).toHaveLength(3);
    expect(html).toContain('Correo electrónico');
  });

  it('marca solo las seleccionadas', async () => {
    const Grupo = await componente('formulario.tsx', 'GrupoDeOpciones');

    const html = dibujar(Grupo, { id: 'canales', etiqueta: 'Avisos por', opciones: OPCIONES, seleccionados: ['SMS'], alCambiar: nada });

    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toMatch(/checked=""[^>]*\/><span>SMS<\/span>/);
  });

  it('la ayuda se asocia al grupo con aria-describedby', async () => {
    const Grupo = await componente('formulario.tsx', 'GrupoDeOpciones');

    const html = dibujar(Grupo, { id: 'canales', etiqueta: 'Avisos por', ayuda: 'Sin marcar, ninguno.', opciones: OPCIONES, seleccionados: [], alCambiar: nada });

    expect(html).toContain('aria-describedby="canales-ayuda"');
    expect(html).toContain('<p id="canales-ayuda"');
  });
});

describe('GrupoDeOpciones de una sola elección y con error (T26, RF-2.5.15)', () => {
  const PUNTOS = [1, 2, 3].map((n) => ({ valor: String(n), etiqueta: String(n) }));

  it('con `unica` son casillas redondas del mismo nombre: se recorren con las flechas y se elige una', async () => {
    const Grupo = await componente('formulario.tsx', 'GrupoDeOpciones');

    const html = dibujar(Grupo, { id: 'puntaje', etiqueta: 'Puntaje', opciones: PUNTOS, seleccionados: ['2'], alCambiar: nada, unica: true });

    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html.match(/name="puntaje"/g)).toHaveLength(3);
    expect(html).not.toContain('type="checkbox"');
    expect(html.match(/checked=""/g)).toHaveLength(1);
  });

  it('sin `unica` siguen siendo casillas para marcar, sin nombre', async () => {
    const Grupo = await componente('formulario.tsx', 'GrupoDeOpciones');

    const html = dibujar(Grupo, { id: 'puntaje', etiqueta: 'Puntaje', opciones: PUNTOS, seleccionados: [], alCambiar: nada });

    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('name=');
  });

  it('el error se asocia al grupo junto con la ayuda', async () => {
    const Grupo = await componente('formulario.tsx', 'GrupoDeOpciones');

    const html = dibujar(Grupo, { id: 'puntaje', etiqueta: 'Puntaje', ayuda: 'De 1 a 3.', error: 'Elegí uno.', opciones: PUNTOS, seleccionados: [], alCambiar: nada, unica: true });

    expect(html).toContain('aria-describedby="puntaje-ayuda puntaje-error"');
    expect(html).toContain('<p id="puntaje-error"');
    expect(html).toContain('Elegí uno.');
  });
});

describe('ErrorDeM2 con la frase de la pantalla (T26, RF-2.5.16)', () => {
  const error = new ErrorDeApi({ sinRespuesta: false, estado: 409, type: '/errores/calificacion-duplicada', title: 'El viaje ya fue calificado', detail: 'Ya existe una calificación de este viaje' });

  it('la frase va primero y el error de M2 sigue completo debajo', async () => {
    const Error = await componente('error-de-m2.tsx', 'ErrorDeM2');

    const html = dibujar(Error, { error, mensaje: 'Ya calificaste este viaje.' });

    expect(html.indexOf('Ya calificaste este viaje.')).toBeLessThan(html.indexOf('El viaje ya fue calificado'));
    for (const dato of ['409', '/errores/calificacion-duplicada', 'Ya existe una calificación de este viaje']) expect(html).toContain(dato);
  });

  it('sin frase, es el de siempre', async () => {
    const Error = await componente('error-de-m2.tsx', 'ErrorDeM2');

    expect(dibujar(Error, { error })).not.toContain('Ya calificaste');
  });
});
