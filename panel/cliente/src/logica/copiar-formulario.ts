type ControlCopiable = { type: string; value: string; checked?: boolean;
  labels?: ArrayLike<{ textContent: string | null }> | null; hasAttribute: (nombre: string) => boolean };
export function textoDeControles(controles: readonly ControlCopiable[]): string {
  return controles.filter(campo => !['password', 'hidden', 'submit', 'button'].includes(campo.type) && !campo.hasAttribute('data-copia')
    && (!['radio', 'checkbox'].includes(campo.type) || campo.checked === true))
    .map(campo => `${campo.labels?.[0]?.textContent?.trim() ?? 'Dato'}: ${campo.value}`).join('\n');
}
