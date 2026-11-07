import { describe, expect, it } from 'vitest';
import { crearContador, LIMITE_PRUEBA_M6 } from '../distribuida/ayudas/contador.js';
import { descripcionDeFalla } from '../distribuida/ayudas/entorno.js';

// El contador de pedidos a M6 de la prueba distribuida (spec 081, plan «Límite de M6»). M6 limita a 1200 por minuto; la prueba
// se queda en la mitad.
describe('el contador de pedidos a M6 de la prueba distribuida (RNF-07.7)', () => {
  it('empieza en cero', () => {
    expect(crearContador().totalM6()).toBe(0);
  });

  it('suma cada pedido hecho directo a M6', () => {
    const contador = crearContador();
    contador.pedidoAM6();
    contador.pedidoAM6();
    expect(contador.totalM6()).toBe(2);
  });

  it('un pedido a M2 que consulta a M6 suma el pedido más los reintentos posibles', () => {
    const contador = crearContador({ reintentosM2: 1 });
    contador.pedidoAM2QueConsultaM6();
    expect(contador.totalM6()).toBe(2);
    contador.pedidoAM2QueConsultaM6();
    expect(contador.totalM6()).toBe(4);
  });

  it('con cero reintentos cada pedido a M2 suma uno', () => {
    const contador = crearContador({ reintentosM2: 0 });
    contador.pedidoAM2QueConsultaM6();
    expect(contador.totalM6()).toBe(1);
  });

  it('un pedido a M2 que no consulta a M6 no suma', () => {
    const contador = crearContador();
    contador.pedidoAM2();
    expect(contador.totalM6()).toBe(0);
    expect(contador.totalM2()).toBe(1);
  });

  it('el límite de la prueba es la mitad del de M6', () => {
    expect(LIMITE_PRUEBA_M6).toBe(600);
  });

  it('dice si se pasó del límite', () => {
    const contador = crearContador({ reintentosM2: 0 });
    for (let i = 0; i < LIMITE_PRUEBA_M6; i++) contador.pedidoAM6();
    expect(contador.superaElLimite()).toBe(false);
    contador.pedidoAM6();
    expect(contador.superaElLimite()).toBe(true);
  });
});

describe('el mensaje cuando el entorno distribuido no levanta (RNF-07.7)', () => {
  it('dice que falta docker si el comando no existe', () => {
    const error = Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' });
    expect(descripcionDeFalla('docker compose up', error)).toContain('No se encontró el comando «docker»');
  });

  it('trae el comando y la cola de la salida si el build falla', () => {
    const error = Object.assign(new Error('x'), { stderr: 'fatal: reference is not a tree' });
    const texto = descripcionDeFalla('docker compose up', error);
    expect(texto).toContain('docker compose up');
    expect(texto).toContain('reference is not a tree');
  });

  it('dice que pasó el tiempo máximo si se cortó', () => {
    const error = Object.assign(new Error('x'), { killed: true });
    expect(descripcionDeFalla('docker compose up', error)).toContain('pasó el tiempo máximo');
  });
});
