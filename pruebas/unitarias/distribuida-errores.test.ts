import { describe, expect, it } from 'vitest';
import { describirRespuesta } from '../distribuida/ayudas/errores.js';

// El texto con el que la prueba distribuida cuenta lo que contestó un módulo (spec 081, T3): el código HTTP y el `code` del
// ErrorResponse de M6, para que una falla diga por qué M6 rechazó el pedido.
const respuesta = (estado: number, cuerpo: unknown, texto = JSON.stringify(cuerpo)) => ({
  estado,
  encabezados: new Headers(),
  texto,
  cuerpo,
});

describe('describirRespuesta (RNF-07.11)', () => {
  it('trae el código HTTP y el code del ErrorResponse', () => {
    const texto = describirRespuesta(respuesta(401, { code: 'UNAUTHENTICATED', title: 'No autenticado', detail: 'Token vencido' }));
    expect(texto).toContain('HTTP 401');
    expect(texto).toContain('code=UNAUTHENTICATED');
    expect(texto).toContain('Token vencido');
  });

  it('si el cuerpo no es un ErrorResponse, muestra el comienzo del texto', () => {
    const texto = describirRespuesta(respuesta(502, undefined, '<html>Bad gateway</html>'));
    expect(texto).toContain('HTTP 502');
    expect(texto).toContain('Bad gateway');
  });

  it('corta los cuerpos largos', () => {
    const largo = 'x'.repeat(5000);
    expect(describirRespuesta(respuesta(500, undefined, largo)).length).toBeLessThan(600);
  });

  it('sin cuerpo dice solo el código', () => {
    expect(describirRespuesta(respuesta(204, undefined, ''))).toBe('HTTP 204');
  });
});
