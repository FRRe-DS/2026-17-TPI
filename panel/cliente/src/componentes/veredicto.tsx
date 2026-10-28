import estilos from './veredicto.module.css';

// ✔ «Correcto» o ✘ «No coincide», con el motivo (uno, en la misma línea) o los motivos (varios, en una lista). Lleva texto además del
// color (RNF-15.3 de la 071). Lo usan el resultado de un caso y las pruebas de integridad de la vista «Demostración».
export function Veredicto({ correcto, motivos = [] }: { correcto: boolean; motivos?: readonly string[] }) {
  return (
    <div className={correcto ? estilos.correcto : estilos.incorrecto}>
      <p className={estilos.titulo}>
        <span className={estilos.marca} aria-hidden="true">
          {correcto ? '✔' : '✘'}
        </span>
        <strong>{correcto ? 'Correcto' : 'No coincide'}</strong>
        {!correcto && motivos.length === 1 && <span className={estilos.motivo}>{motivos[0]}</span>}
      </p>
      {!correcto && motivos.length > 1 && (
        <ul className={estilos.motivos}>
          {motivos.map((motivo) => (
            <li key={motivo}>{motivo}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
