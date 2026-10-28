import type { ApiM2 } from '../api/m2.js';
import { EstadoPantalla } from '../componentes/estado-pantalla.js';
import { FichaDeCuenta } from '../componentes/ficha-de-cuenta.js';
import { Titulo } from '../componentes/titulo.js';
import type { Sesion } from '../fuentes/fuente-de-sesion.js';
import { usarCarga } from '../hooks/usar-carga.js';
import { estaBloqueado } from '../logica/cuenta.js';
import { TITULOS } from '../rutas.js';
import estilos from './estado-cuenta.module.css';

type Props = { api: ApiM2; sesion: Sesion };

// El estado de cuenta del cliente (RF-2.6.5): `obtenerEstadoCuenta` dice si está activo o bloqueado y cuáles son sus bloqueos
// vigentes. Un bloqueo impide pedir viajes, no usar el panel: las demás pantallas siguen funcionando.
export function EstadoDeCuenta({ api, sesion }: Props) {
  const { estado, reintentar } = usarCarga((senal) => api.obtenerEstadoCuenta(sesion.sub, { senal }), [api, sesion.sub]);

  return (
    <>
      <Titulo>{TITULOS['estado-cuenta']}</Titulo>
      <EstadoPantalla estado={estado} vacio="No hay estado de cuenta para mostrar." alReintentar={reintentar}>
        {(cuenta) => (
          <div className={estilos.cuenta}>
            <FichaDeCuenta cuenta={cuenta} />
            {estaBloqueado(cuenta) && (
              <p className={estilos.nota}>
                Tu cuenta tiene un bloqueo administrativo. El resto del panel sigue disponible: podés ver tu perfil, tus direcciones, tu historial y tus
                calificaciones.
              </p>
            )}
          </div>
        )}
      </EstadoPantalla>
    </>
  );
}
