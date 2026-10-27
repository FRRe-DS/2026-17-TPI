import { useId, useState } from 'react';
import type { ApiM2 } from '../api/m2.js';
import { Aviso } from '../componentes/aviso.js';
import { BotonAccion } from '../componentes/boton-accion.js';
import { ErrorDeM2 } from '../componentes/error-de-m2.js';
import type { FuenteDeViajes } from '../fuentes/viajes-simulados.js';
import { usarAccion } from '../hooks/usar-accion.js';
import { cargarEjemplo, PASOS, pasosIniciales, resumenDeFallo, type EstadoDePaso } from '../logica/ejemplo.js';
import estilos from './cargar-ejemplo.module.css';

type Props = { api: ApiM2; viajes: FuenteDeViajes; clienteId: string };

const TEXTO_DEL_ESTADO: Record<EstadoDePaso, string> = { pendiente: 'pendiente', 'en-curso': 'cargando…', hecho: 'hecho', fallido: 'falló' };

// «Cargar ejemplo» (RF-2.1.10, RF-2.1.11): deja tres direcciones, unas preferencias y dos viajes en el M6 simulado para probar el
// resto de las pantallas. Informa cada paso; si uno falla, lo hecho queda y «Reintentar» lo retoma sin duplicar.
export function CargarEjemplo({ api, viajes, clienteId }: Props) {
  const id = useId();
  const [pasos, setPasos] = useState(pasosIniciales);
  const { estado, esperando, enviar, reintentar } = usarAccion({
    ejecutar: ({ senal }) => cargarEjemplo({ api, viajes }, clienteId, setPasos, senal),
    aviso: 'Ejemplo cargado: tres direcciones, las preferencias y dos viajes en el M6 simulado.',
  });
  const corte = estado.fase === 'fallida' ? resumenDeFallo(pasos) : undefined;

  return (
    <section className={estilos.hoja} aria-labelledby={`${id}-titulo`}>
      <div className={estilos.cabecera}>
        <h2 id={`${id}-titulo`}>Datos de ejemplo</h2>
        <span className={estilos.etiqueta}>M6: {viajes.etiqueta}</span>
      </div>
      <div className={estilos.cuerpo}>
        <p className={estilos.texto}>
          Carga direcciones, preferencias y dos viajes para este cliente, así las demás pantallas tienen con qué trabajar. Se puede repetir: no
          duplica nada.
        </p>
        <ol className={estilos.pasos} aria-label="Pasos de la carga">
          {PASOS.map(({ id: paso, texto }) => {
            const estadoDelPaso = pasos.find((p) => p.id === paso)?.estado ?? 'pendiente';
            return (
              <li key={paso} className={`${estilos.paso} ${estilos[estadoDelPaso === 'en-curso' ? 'enCurso' : estadoDelPaso]}`}>
                <span className={estilos.texto}>{texto}</span>
                <span className={estilos.estado}>{TEXTO_DEL_ESTADO[estadoDelPaso]}</span>
              </li>
            );
          })}
        </ol>
        {estado.fase === 'fallida' && (
          <div role="alert" className={estilos.error}>
            {corte !== undefined && <p className={estilos.corte}>{corte}</p>}
            <ErrorDeM2 error={estado.error} alReintentar={reintentar} esperando={esperando} />
          </div>
        )}
      </div>
      <div className={estilos.pie}>
        <BotonAccion variante="contorno" esperando={esperando} textoEsperando="Cargando…" onClick={() => void enviar()}>
          Cargar ejemplo
        </BotonAccion>
      </div>
      <Aviso estado={estado} />
    </section>
  );
}
