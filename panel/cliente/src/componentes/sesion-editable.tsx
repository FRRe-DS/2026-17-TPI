import { createContext, useState } from 'react';
export const ContextoSesionEditable = createContext(true);
export function AvisoReingreso({ dependenciaCaida, reintentar }: { dependenciaCaida: boolean; reintentar: () => void }) {
  const [copia, guardarCopia] = useState<string | undefined>();
  const [mensaje, informar] = useState('');
  const copiar = async () => {
    const controles = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('main input, main textarea, main select')];
    const texto = controles.filter(campo => !['password', 'hidden', 'submit', 'button'].includes(campo.type) && !campo.hasAttribute('data-copia'))
      .map(campo => `${campo.labels?.[0]?.textContent?.trim() ?? 'Dato'}: ${campo.value}`).join('\n');
    guardarCopia(texto);
    try { await navigator.clipboard.writeText(texto); informar('Datos copiados.'); }
    catch { informar('Seleccioná el texto para copiarlo manualmente.'); }
  };
  return <section role="alert" aria-label="Sesión y datos del formulario">
    <h2>{dependenciaCaida ? 'Identidad no disponible' : 'Tu sesión venció'}</h2>
    <p>Conservamos lo escrito en esta pantalla. El envío está deshabilitado.</p>
    <button type="button" onClick={() => void copiar()}>Copiar datos</button>
    {dependenciaCaida && <button type="button" onClick={reintentar}>Comprobar sesión</button>}
    {copia !== undefined && <label>Datos para copiar<textarea data-copia readOnly value={copia} onFocus={evento => evento.target.select()} /></label>}
    <p role="status">{mensaje}</p>
    <p>Al volver a ingresar se puede perder lo escrito. Copialo antes de continuar. No se enviará automáticamente.</p>
    <form method="post" action="/auth/iniciar"><button type="submit">Volver a ingresar</button></form>
  </section>;
}
