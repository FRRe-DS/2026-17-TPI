import { useId, type FormEvent, type ReactNode } from 'react';
import type { DatosDeError } from '../api/errores.js';
import { atributosDeCampo } from '../logica/presentacion.js';
import { ErrorDeM2 } from './error-de-m2.js';
import estilos from './formulario.module.css';

type PropsFormulario = {
  titulo: string;
  // El folio de la última respuesta de M2, si la pantalla lo tiene: queda en la cabecera de la hoja.
  folio?: string | undefined;
  alEnviar: () => void;
  // El error de M2 al enviar: se muestra completo junto a los campos, que conservan lo escrito.
  error?: DatosDeError | undefined;
  alReintentar?: (() => void) | undefined;
  // La frase de la pantalla para ese error, encima del error de M2.
  mensajeDelError?: string | undefined;
  // Los botones del pie: «Descartar», «Guardar».
  acciones?: ReactNode;
  children: ReactNode;
};

// Una hoja del formulario: cabecera con título y folio, los casilleros y el pie con las acciones. La validación es del panel
// (cada error con su campo), no la del navegador, que no se puede leer igual en todos.
export function Formulario({ titulo, folio, alEnviar, error, alReintentar, mensajeDelError, acciones, children }: PropsFormulario) {
  const id = useId();
  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    alEnviar();
  };

  return (
    <form className={estilos.hoja} noValidate aria-labelledby={`${id}-titulo`} onSubmit={enviar}>
      <div className={estilos.cabecera}>
        <h2 id={`${id}-titulo`}>{titulo}</h2>
        {folio !== undefined && (
          <span className={estilos.folio}>
            última respuesta · folio <b>{folio}</b>
          </span>
        )}
      </div>
      <div className={estilos.campos}>{children}</div>
      {error !== undefined && (
        <div role="alert" className={estilos.error}>
          <ErrorDeM2 error={error} alReintentar={alReintentar} mensaje={mensajeDelError} />
        </div>
      )}
      {acciones !== undefined && <div className={estilos.pie}>{acciones}</div>}
    </form>
  );
}

type PropsCampo = {
  id: string;
  etiqueta: string;
  // El número del casillero (01, 02…): el formulario se recorre y se nombra por número.
  numero?: number | undefined;
  ayuda?: string | undefined;
  error?: string | undefined;
  valor: string;
  alCambiar: (valor: string) => void;
  tipo?: 'text' | 'tel' | 'date' | 'email' | 'datetime-local';
  // Con `opciones` el casillero es un selector y `valor` es el de la opción elegida.
  opciones?: { valor: string; etiqueta: string }[];
  // El teclado que ofrece el teléfono: `decimal` para coordenadas y otros números con coma.
  teclado?: 'decimal';
  multilinea?: boolean;
  maximo?: number | undefined;
  requerido?: boolean;
  autoComplete?: string | undefined;
  // Ocupa las dos columnas de la hoja (textos largos).
  completo?: boolean;
};

// Un casillero: `<label>` del control, la ayuda y el error asociados con `aria-describedby` y `aria-invalid` (RNF-15.3).
export function Campo({ id, etiqueta, numero, ayuda, error, valor, alCambiar, tipo = 'text', opciones, teclado, multilinea = false, maximo, requerido, autoComplete, completo }: PropsCampo) {
  const atributos = atributosDeCampo(id, { ayuda, error });
  const comunes = {
    id,
    value: valor,
    maxLength: maximo,
    required: requerido,
    autoComplete,
    'aria-describedby': atributos.describidoPor,
    'aria-invalid': atributos.invalido || undefined,
    className: estilos.control,
  };

  return (
    <div className={completo || multilinea ? `${estilos.campo} ${estilos.completo}` : estilos.campo}>
      <label htmlFor={id} className={estilos.etiqueta}>
        {numero !== undefined && (
          <span className={estilos.numero} aria-hidden="true">
            {String(numero).padStart(2, '0')}
          </span>
        )}
        {etiqueta}
      </label>
      {opciones !== undefined ? (
        <select
          id={id}
          value={valor}
          required={requerido}
          aria-describedby={comunes['aria-describedby']}
          aria-invalid={comunes['aria-invalid']}
          className={estilos.control}
          onChange={(evento) => alCambiar(evento.target.value)}
        >
          {opciones.map((opcion) => (
            <option key={opcion.valor} value={opcion.valor}>
              {opcion.etiqueta}
            </option>
          ))}
        </select>
      ) : multilinea ? (
        <textarea {...comunes} rows={4} onChange={(evento) => alCambiar(evento.target.value)} />
      ) : (
        <input {...comunes} type={tipo} inputMode={teclado} onChange={(evento) => alCambiar(evento.target.value)} />
      )}
      {atributos.idAyuda !== undefined && (
        <p id={atributos.idAyuda} className={estilos.ayuda}>
          {ayuda}
        </p>
      )}
      {atributos.idError !== undefined && (
        <p id={atributos.idError} className={estilos.mensajeDeError}>
          {error}
        </p>
      )}
    </div>
  );
}

type PropsGrupo = {
  id: string;
  etiqueta: string;
  numero?: number | undefined;
  ayuda?: string | undefined;
  opciones: { valor: string; etiqueta: string }[];
  seleccionados: readonly string[];
  alCambiar: (valor: string, marcado: boolean) => void;
  // Se elige una sola: casillas redondas (`radio`) que se recorren con las flechas, en vez de marcar varias.
  unica?: boolean;
  error?: string | undefined;
};

// Un casillero con varias casillas para marcar (RF-2.3.6): un `<fieldset>` con su `<legend>`, de ancho completo. Cada casilla es un
// `<label>` de al menos 44 px (RNF-15.1) y la ayuda se asocia al grupo con `aria-describedby` (RNF-15.3).
export function GrupoDeOpciones({ id, etiqueta, numero, ayuda, opciones, seleccionados, alCambiar, unica = false, error }: PropsGrupo) {
  const idAyuda = ayuda ? `${id}-ayuda` : undefined;
  const idError = error ? `${id}-error` : undefined;
  return (
    <fieldset className={`${estilos.campo} ${estilos.completo} ${estilos.grupo}`} aria-describedby={[idAyuda, idError].filter(Boolean).join(' ') || undefined}>
      <legend className={estilos.leyenda}>
        {numero !== undefined && (
          <span className={estilos.numero} aria-hidden="true">
            {String(numero).padStart(2, '0')}
          </span>
        )}
        {etiqueta}
      </legend>
      <div className={unica ? `${estilos.opciones} ${estilos.enFila}` : estilos.opciones}>
        {opciones.map((opcion) => (
          <label key={opcion.valor} className={estilos.opcion}>
            <input
              type={unica ? 'radio' : 'checkbox'}
              name={unica ? id : undefined}
              checked={seleccionados.includes(opcion.valor)}
              onChange={(evento) => alCambiar(opcion.valor, evento.target.checked)}
            />
            <span>{opcion.etiqueta}</span>
          </label>
        ))}
      </div>
      {idAyuda !== undefined && (
        <p id={idAyuda} className={estilos.ayuda}>
          {ayuda}
        </p>
      )}
      {idError !== undefined && (
        <p id={idError} className={estilos.mensajeDeError}>
          {error}
        </p>
      )}
    </fieldset>
  );
}
