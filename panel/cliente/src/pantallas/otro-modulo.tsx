import { useState } from 'react';
import type { ApiM2 } from '../api/m2.js';
import { BuscarCliente } from '../componentes/buscar-cliente.js';
import { ErrorDeM2 } from '../componentes/error-de-m2.js';
import { EstadoPantalla } from '../componentes/estado-pantalla.js';
import { FichaDeCuenta } from '../componentes/ficha-de-cuenta.js';
import { Titulo } from '../componentes/titulo.js';
import { usarCarga } from '../hooks/usar-carga.js';
import { mensajeDeConsulta } from '../logica/otro-modulo.js';
import { TITULOS } from '../rutas.js';
import estilos from './otro-modulo.module.css';

// La vista de otro módulo (RF-2.6.7): con un token SERVICIO, M2 solo deja una cosa, consultar el estado de cuenta de cualquier
// cliente. La pantalla no ofrece nada más; M5 y M9 la usan para saber si un cliente puede viajar.
export function OtroModulo({ api }: { api: ApiM2 }) {
  const [clienteId, setClienteId] = useState<string | undefined>();

  return (
    <>
      <Titulo>{TITULOS['otro-modulo']}</Titulo>
      <div className={estilos.consulta}>
        <BuscarCliente titulo="Consultar el estado de cuenta" boton="Consultar" alBuscar={setClienteId} />
        {clienteId !== undefined && <Consulta key={clienteId} api={api} clienteId={clienteId} />}
      </div>
    </>
  );
}

function Consulta({ api, clienteId }: { api: ApiM2; clienteId: string }) {
  const { estado, reintentar } = usarCarga((senal) => api.obtenerEstadoCuenta(clienteId, { senal }), [api, clienteId]);

  return (
    <EstadoPantalla
      estado={estado}
      vacio="No hay estado de cuenta para mostrar."
      alReintentar={reintentar}
      errorPropio={(error) => {
        const mensaje = mensajeDeConsulta(error);
        return mensaje === undefined ? undefined : (
          <div role="alert">
            <ErrorDeM2 error={error} mensaje={mensaje} />
          </div>
        );
      }}
    >
      {(cuenta) => <FichaDeCuenta cuenta={cuenta} />}
    </EstadoPantalla>
  );
}
