import { useId, useState } from 'react';
import type { ApiM2 } from '../api/m2.js';
import { Aviso } from '../componentes/aviso.js';
import { BotonAccion } from '../componentes/boton-accion.js';
import { CamposDeCliente } from '../componentes/campos-de-cliente.js';
import { EstadoPantalla } from '../componentes/estado-pantalla.js';
import { Formulario } from '../componentes/formulario.js';
import { Titulo } from '../componentes/titulo.js';
import type { Sesion } from '../fuentes/fuente-de-sesion.js';
import type { FuenteDeViajes } from '../fuentes/viajes-simulados.js';
import { usarAccion } from '../hooks/usar-accion.js';
import { usarCarga } from '../hooks/usar-carga.js';
import { calcularCambios, camposDePerfil, guardarCambios, validarEdicion } from '../logica/cambios.js';
import { primerCampoConError, type CamposCliente } from '../logica/campos-cliente.js';
import type { components } from '../generado/contrato.js';
import { TITULOS } from '../rutas.js';
import { CargarEjemplo } from './cargar-ejemplo.js';
import estilos from './perfil.module.css';

type Cliente = components['schemas']['Cliente'];
type Props = { api: ApiM2; viajes: FuenteDeViajes; sesion: Sesion };

// El perfil de quien tiene la sesión (RF-2.1.8, RF-2.1.9): se carga con `obtenerCliente` y se edita con `actualizarCliente`,
// que recibe solo lo modificado. El CONDUCTOR llega acá también y ve el error de M2.
export function Perfil({ api, viajes, sesion }: Props) {
  const { estado, reintentar } = usarCarga((senal) => api.obtenerCliente(sesion.sub, { senal }), [api, sesion.sub]);

  return (
    <>
      <Titulo>{TITULOS.perfil}</Titulo>
      <EstadoPantalla estado={estado} vacio="No hay perfil para mostrar." alReintentar={reintentar}>
        {(perfil) => <EditarPerfil key={perfil.clienteId} api={api} viajes={viajes} inicial={perfil} />}
      </EstadoPantalla>
    </>
  );
}

const FECHA_Y_HORA = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/;
// El instante tal como lo trae M2, en UTC y sin milisegundos: es un dato, no una fecha para leer en voz alta.
const instante = (iso: string) => FECHA_Y_HORA.exec(iso)?.slice(1).join(' ') ?? iso;

function EditarPerfil({ api, viajes, inicial }: { api: ApiM2; viajes: FuenteDeViajes; inicial: Cliente }) {
  const id = useId();
  // El perfil de M2: el que se cargó, o el que devolvió el último guardado.
  const [perfil, setPerfil] = useState(inicial);
  const [campos, setCampos] = useState<CamposCliente>(() => camposDePerfil(inicial));
  const [intentado, setIntentado] = useState(false);
  const errores = intentado ? validarEdicion(perfil, campos) : {};

  const { estado, esperando, enviar, reintentar, reiniciar } = usarAccion({
    ejecutar: async ({ senal }, escritos: CamposCliente) => {
      const resultado = await guardarCambios(api, perfil, escritos, { senal });
      if (resultado.tipo === 'guardado') {
        setPerfil(resultado.perfil);
        setCampos(camposDePerfil(resultado.perfil));
        setIntentado(false);
      }
      return resultado;
    },
    aviso: (resultado) => (resultado.tipo === 'guardado' ? 'Perfil guardado.' : 'No hay cambios que guardar.'),
  });

  const alEnviar = () => {
    setIntentado(true);
    const primero = primerCampoConError(validarEdicion(perfil, campos));
    if (primero !== undefined) return document.getElementById(`${id}-${primero}`)?.focus();
    void enviar(campos);
  };

  // Seguir escribiendo después de guardar borra el aviso viejo; lo escrito no se toca.
  const alCambiar = (campo: keyof CamposCliente, valor: string) => {
    if (estado.fase === 'hecha') reiniciar();
    setCampos((previos) => ({ ...previos, [campo]: valor }));
  };

  const descartar = () => {
    if (esperando) return;
    reiniciar();
    setIntentado(false);
    setCampos(camposDePerfil(perfil));
  };

  const hayCambios = calcularCambios(perfil, campos) !== undefined;
  // Un 400 se corrige escribiendo otra cosa; repetir el mismo pedido solo sirve si M2 no contestó o falló por su cuenta.
  const error = estado.fase === 'fallida' ? estado.error : undefined;
  const sePuedeReintentar = error !== undefined && (error.sinRespuesta || error.estado >= 500);

  return (
    <div className={estilos.perfil}>
      <section className={estilos.datos} aria-label="Datos de M2">
        <dl className={estilos.filas}>
          <div className={estilos.fila}>
            <dt>Estado</dt>
            <dd>
              <span className={perfil.estado === 'ACTIVO' ? estilos.activo : estilos.bloqueado}>{perfil.estado}</span>
            </dd>
          </div>
          <div className={estilos.fila}>
            <dt>Identificador</dt>
            <dd className={estilos.dato}>{perfil.clienteId}</dd>
          </div>
          <div className={estilos.fila}>
            <dt>Creado</dt>
            <dd className={estilos.dato}>{instante(perfil.creadoEn)}</dd>
          </div>
          <div className={estilos.fila}>
            <dt>Actualizado</dt>
            <dd className={estilos.dato}>{instante(perfil.actualizadoEn)}</dd>
          </div>
        </dl>
      </section>

      <Formulario
        titulo="Datos del perfil"
        alEnviar={alEnviar}
        error={error}
        alReintentar={sePuedeReintentar ? reintentar : undefined}
        acciones={
          <>
            <BotonAccion variante="contorno" esperando={false} onClick={descartar}>
              {hayCambios ? 'Descartar cambios' : 'Restablecer'}
            </BotonAccion>
            <BotonAccion tipo="submit" esperando={esperando} textoEsperando="Guardando…">
              Guardar cambios
            </BotonAccion>
          </>
        }
      >
        <CamposDeCliente id={id} campos={campos} errores={errores} alCambiar={alCambiar} />
      </Formulario>
      <Aviso estado={estado} />
      <CargarEjemplo api={api} viajes={viajes} clienteId={perfil.clienteId} />
    </div>
  );
}
