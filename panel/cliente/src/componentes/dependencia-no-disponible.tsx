import type { ErrorDeApi } from '../api/errores.js';
import { usarCuentaRegresiva } from '../hooks/usar-cuenta-regresiva.js';
import { segundosDeCuenta, textoDeEspera } from '../logica/cuenta-regresiva.js';
import { ErrorDeM2 } from './error-de-m2.js';
import estilos from './dependencia-no-disponible.module.css';

type Props = { error: ErrorDeApi; que: string; alReintentar: () => void };

// El `503` de M2 porque otro módulo no contestó (RF-2.4.13, RF-2.5.16): dice de quién depende `que`, cuenta los segundos del
// `Retry-After` si vinieron y deja «Reintentar» siempre a mano (no se reintenta sola). El error de M2 sigue completo debajo.
// El resto del panel no se toca: el menú y las demás pantallas son del marco.
export function DependenciaNoDisponible({ error, que, alReintentar }: Props) {
  const restantes = usarCuentaRegresiva(segundosDeCuenta(error), error);

  return (
    <div className={estilos.aviso} role="alert">
      <p className={estilos.explicacion}>
        {que} depende del módulo de viajes (M6), que no contestó. El resto del panel sigue funcionando.
      </p>
      {restantes !== undefined && (
        // Un temporizador no se anuncia cada segundo: `role="timer"` lo deja fuera de la lectura automática.
        <p className={estilos.cuenta} role="timer" aria-live="off">
          {textoDeEspera(restantes)}
        </p>
      )}
      <ErrorDeM2 error={error} alReintentar={alReintentar} />
    </div>
  );
}
