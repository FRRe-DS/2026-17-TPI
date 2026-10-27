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
  // Los botones del pie: «Descartar», «Guardar».
  acciones?: ReactNode;
  children: ReactNode;
};

// Una hoja del formulario: cabecera con título y folio, los casilleros y el pie con las acciones. La validación es del panel
// (cada error con su campo), no la del navegador, que no se puede leer igual en todos.
export function Formulario({ titulo, folio, alEnviar, error, alReintentar, acciones, children }: PropsFormulario) {
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
          <ErrorDeM2 error={error} alReintentar={alReintentar} />
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
  tipo?: 'text' | 'tel' | 'date' | 'email';
  multilinea?: boolean;
  maximo?: number | undefined;
  requerido?: boolean;
  autoComplete?: string | undefined;
  // Ocupa las dos columnas de la hoja (textos largos).
  completo?: boolean;
};

// Un casillero: `<label>` del control, la ayuda y el error asociados con `aria-describedby` y `aria-invalid` (RNF-15.3).
export function Campo({ id, etiqueta, numero, ayuda, error, valor, alCambiar, tipo = 'text', multilinea = false, maximo, requerido, autoComplete, completo }: PropsCampo) {
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
      {multilinea ? (
        <textarea {...comunes} rows={4} onChange={(evento) => alCambiar(evento.target.value)} />
      ) : (
        <input {...comunes} type={tipo} onChange={(evento) => alCambiar(evento.target.value)} />
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
