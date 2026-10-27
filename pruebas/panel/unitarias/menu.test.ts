import { describe, expect, it } from 'vitest';
import { marcadaEn, menuDe } from '../../../panel/cliente/src/logica/menu.js';
import { inicioDe, PANTALLAS, ROLES, type Pantalla } from '../../../panel/cliente/src/rutas.js';

const VIAJE = '7d44a3b2-1c10-4e6f-9a7b-1c2d3e4f5a6b';
const pantallasDe = (rol: Parameters<typeof menuDe>[0]): Pantalla[] => menuDe(rol).flatMap((grupo) => grupo.elementos.map((e) => e.pantalla));

describe('menuDe: el menú según el rol (T17)', () => {
  it('sin sesión solo está «Ingresar»', () => {
    expect(menuDe(undefined)).toEqual([{ titulo: 'Panel', elementos: [{ pantalla: 'ingresar', etiqueta: 'Ingresar' }] }]);
  });

  it('el CLIENTE ve su cuenta, en el orden del recorrido, y las herramientas', () => {
    expect(menuDe('CLIENTE').map((g) => g.titulo)).toEqual(['Mi cuenta', 'Herramientas']);
    expect(pantallasDe('CLIENTE')).toEqual([
      'perfil',
      'direcciones',
      'preferencias',
      'historial',
      'calificaciones',
      'estado-cuenta',
      'detalle-tecnico',
      'm6-simulado',
    ]);
  });

  it('el OPERADOR ve los bloqueos; el SERVICIO, la consulta de otro módulo; el CONDUCTOR, el perfil', () => {
    expect(pantallasDe('OPERADOR')).toEqual(['operador', 'detalle-tecnico', 'm6-simulado']);
    expect(pantallasDe('SERVICIO')).toEqual(['otro-modulo', 'detalle-tecnico', 'm6-simulado']);
    expect(pantallasDe('CONDUCTOR')).toEqual(['perfil', 'detalle-tecnico', 'm6-simulado']);
  });

  it.each(ROLES)('la pantalla de inicio de %s está en su menú y «Ingresar» no', (rol) => {
    expect(pantallasDe(rol)).toContain(inicioDe(rol));
    expect(pantallasDe(rol)).not.toContain('ingresar');
  });

  it('toda pantalla, salvo «Calificar» (se llega desde el historial), está en algún menú', () => {
    const enAlguno = new Set([undefined, ...ROLES].flatMap((rol) => pantallasDe(rol)));

    expect(PANTALLAS.filter((p) => !enAlguno.has(p))).toEqual(['calificar']);
  });

  it('ninguna etiqueta se repite dentro de un menú', () => {
    for (const rol of ROLES) {
      const etiquetas = menuDe(rol).flatMap((g) => g.elementos.map((e) => e.etiqueta));
      expect(new Set(etiquetas).size).toBe(etiquetas.length);
    }
  });
});

describe('marcadaEn: qué elemento del menú corresponde a la ruta', () => {
  it('la pantalla misma, con o sin id', () => {
    expect(marcadaEn({ pantalla: 'perfil' })).toBe('perfil');
    expect(marcadaEn({ pantalla: 'direcciones', id: VIAJE })).toBe('direcciones');
    expect(marcadaEn({ pantalla: 'calificaciones', id: VIAJE })).toBe('calificaciones');
  });

  it('calificar un viaje marca el historial, desde donde se llega', () => {
    expect(marcadaEn({ pantalla: 'calificar', id: VIAJE })).toBe('historial');
  });

  it('la raíz y una ruta no encontrada no marcan nada', () => {
    expect(marcadaEn({ pantalla: 'raiz' })).toBeUndefined();
    expect(marcadaEn({ pantalla: 'no-encontrada' })).toBeUndefined();
  });
});
