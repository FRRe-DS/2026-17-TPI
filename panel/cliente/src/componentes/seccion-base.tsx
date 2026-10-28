import { useEffect, useReducer, useRef, useState } from 'react';
import { ErrorDeApi, m2NoResponde } from '../api/errores.js';
import type { ApiPanel, Disponibilidad } from '../api/panel.js';
import { usarSondeo } from '../hooks/usar-sondeo.js';
import type { Cerrojo } from '../logica/cerrojo.js';
import type { EstadoAccion } from '../logica/estados.js';
import { debeSondear, estadoInicial, reducir } from '../logica/salud-en-vivo.js';
import { ControlBase } from './control-base.js';
import { DialogoConfirmar } from './dialogo-confirmar.js';

type Props = { apiPanel: ApiPanel; cerrojo: Cerrojo; activa: string | undefined };

// Si el panel no contesta la consulta de Docker, la sección lo dice en vez de quedarse consultando.
const SIN_ESTADO: Disponibilidad = {
  disponible: false,
  motivo: 'el panel no respondió al consultar si puede usar Docker',
  comoActivar: 'Volvé a abrir la vista. Si sigue igual, mirá los logs del panel.',
};

const comoError = (error: unknown): ErrorDeApi => (error instanceof ErrorDeApi ? error : m2NoResponde());

// La sección «Base de datos» de la vista «Demostración» (spec 072, T16, RNF-13.4, RNF-13.6, RNF-15.6): apaga y enciende la base de M2
// con Docker y sigue su salud cada 2 s con `usar-sondeo`. Apagar pide confirmación y, como encender, toma el cerrojo de la vista
// mientras corre el comando: nada más arranca a la vez. La espera de los 60 s no toma el cerrojo; se ve en «Encender la base».
export function SeccionBase({ apiPanel, cerrojo, activa }: Props) {
  const [docker, setDocker] = useState<Disponibilidad | undefined>(undefined);
  const [salud, despachar] = useReducer(reducir, estadoInicial);
  const [confirmando, setConfirmando] = useState(false);
  const [errorDeApagar, setErrorDeApagar] = useState<ErrorDeApi | undefined>(undefined);
  const [errorDeEncender, setErrorDeEncender] = useState<ErrorDeApi | undefined>(undefined);

  // El comando en curso: se cancela al salir de la vista.
  const control = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => control.current?.abort(), []);

  useEffect(() => {
    const consulta = new AbortController();
    apiPanel.obtenerEstadoDemo(consulta.signal).then(
      (estado) => setDocker(estado.docker),
      () => {
        if (!consulta.signal.aborted) setDocker(SIN_ESTADO);
      },
    );
    return () => consulta.abort();
  }, [apiPanel]);

  // Una salud que no llega (el panel no contestó) es «M2 no responde», un dato más de la secuencia.
  usarSondeo(debeSondear(salud), async (senal) => {
    let estado: number | null = null;
    try {
      estado = (await apiPanel.consultarSaludDeM2(senal)).estado;
    } catch {
      if (senal.aborted) return;
    }
    despachar({ tipo: 'salud', estado, ahora: Date.now() });
  });

  const nuevoControl = () => {
    control.current = new AbortController();
    return control.current.signal;
  };

  const apagar = () =>
    cerrojo.ejecutar('base:apagar', async () => {
      const senal = nuevoControl();
      setErrorDeApagar(undefined);
      setErrorDeEncender(undefined);
      despachar({ tipo: 'apagar-pulsado' });
      try {
        await apiPanel.apagarBase(senal);
        despachar({ tipo: 'apagada' });
        setConfirmando(false);
      } catch (error) {
        if (senal.aborted) return;
        despachar({ tipo: 'fallo' });
        setErrorDeApagar(comoError(error));
      }
    });

  const encender = () =>
    cerrojo.ejecutar('base:encender', async () => {
      const senal = nuevoControl();
      setErrorDeEncender(undefined);
      despachar({ tipo: 'encender-pulsado', ahora: Date.now() });
      try {
        await apiPanel.encenderBase(senal);
      } catch (error) {
        if (senal.aborted) return;
        despachar({ tipo: 'fallo' });
        setErrorDeEncender(comoError(error));
      }
    });

  // «Cancelar» solo cierra: no llama a nada.
  const cancelar = () => {
    setConfirmando(false);
    setErrorDeApagar(undefined);
  };

  const estadoDelDialogo: EstadoAccion<unknown> =
    activa === 'base:apagar' ? { fase: 'esperando' } : errorDeApagar !== undefined ? { fase: 'fallida', error: errorDeApagar } : { fase: 'inactiva' };

  return (
    <>
      <ControlBase docker={docker} salud={salud} activa={activa} error={errorDeEncender} alApagar={() => setConfirmando(true)} alEncender={() => void encender()} />
      <DialogoConfirmar
        abierto={confirmando}
        titulo="Apagar la base de M2"
        confirmar="Apagar"
        estado={estadoDelDialogo}
        alConfirmar={() => void apagar()}
        alCancelar={cancelar}
      >
        <p>
          Se ejecuta <code>docker compose stop bd</code>. M2 queda sin base para cualquiera que lo esté usando, no solo para esta vista, hasta que
          pulses «Encender la base».
        </p>
      </DialogoConfirmar>
    </>
  );
}
