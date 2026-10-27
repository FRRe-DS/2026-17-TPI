import { useEffect, useId, useRef, useState } from 'react';
import type { ApiM2 } from '../api/m2.js';
import { Aviso } from '../componentes/aviso.js';
import { BotonAccion } from '../componentes/boton-accion.js';
import { CamposDeDireccion } from '../componentes/campos-de-direccion.js';
import { DialogoConfirmar } from '../componentes/dialogo-confirmar.js';
import { EstadoPantalla } from '../componentes/estado-pantalla.js';
import { Formulario } from '../componentes/formulario.js';
import { Paginacion } from '../componentes/paginacion.js';
import { Titulo } from '../componentes/titulo.js';
import type { Sesion } from '../fuentes/fuente-de-sesion.js';
import { usarAccion } from '../hooks/usar-accion.js';
import { usarCarga } from '../hooks/usar-carga.js';
import { usarClaveDeIdempotencia } from '../hooks/usar-clave-idempotencia.js';
import { usarConfirmacion } from '../hooks/usar-confirmacion.js';
import type { DatosDeError } from '../api/errores.js';
import type { components } from '../generado/contrato.js';
import {
  camposDeDireccion,
  cuerpoDeDireccion,
  DIRECCION_NUEVA,
  guardarDireccion,
  primerCampoDeDireccionConError,
  TIPOS_DE_DIRECCION,
  validarDireccion,
  type CamposDireccion,
} from '../logica/direcciones.js';
import { TAMANO_DE_PAGINA } from '../logica/paginacion.js';
import { enlace, TITULOS } from '../rutas.js';
import estilos from './direcciones.module.css';

type Direccion = components['schemas']['Direccion'];
type Props = { api: ApiM2; sesion: Sesion; idDireccion?: string | undefined };

// Las direcciones frecuentes del cliente (RF-2.2.6): `#/direcciones` las lista y permite crear una; `#/direcciones/{id}` edita una.
export function Direcciones({ api, sesion, idDireccion }: Props) {
  return idDireccion === undefined ? <ListaDeDirecciones api={api} sesion={sesion} /> : <EdicionDeDireccion api={api} sesion={sesion} idDireccion={idDireccion} />;
}

const nombreDelTipo = (tipo: Direccion['tipo']) => TIPOS_DE_DIRECCION.find(({ valor }) => valor === tipo)?.etiqueta ?? tipo;
// Un 400 se corrige escribiendo otra cosa; repetir el mismo pedido solo sirve si M2 no contestó o falló por su cuenta.
const sePuedeReintentar = (error: DatosDeError | undefined) => error !== undefined && (error.sinRespuesta || error.estado >= 500);

function ListaDeDirecciones({ api, sesion }: { api: ApiM2; sesion: Sesion }) {
  const [pagina, setPagina] = useState(0);
  // Sube al crear una dirección: la lista se vuelve a pedir desde la primera página.
  const [version, setVersion] = useState(0);
  const [creando, setCreando] = useState(false);
  const { estado, reintentar } = usarCarga(
    (senal) => api.listarDirecciones(sesion.sub, { page: pagina, size: TAMANO_DE_PAGINA }, { senal }),
    [api, sesion.sub, pagina, version],
    (datos) => datos.totalElementos === 0,
  );

  // «Eliminar» (RF-2.2.7): pide confirmación y solo al confirmar llama a M2. Si era la única de una página que no es la primera, vuelve
  // a la anterior; si no, la lista se pide de nuevo en la misma página.
  const eliminacion = usarConfirmacion<Direccion, void>({
    ejecutar: async (direccion, senal) => {
      await api.eliminarDireccion(sesion.sub, direccion.direccionId, { senal });
      if (pagina > 0 && estado.fase === 'listo' && estado.datos.items.length === 1) setPagina(pagina - 1);
      else setVersion((actual) => actual + 1);
    },
    aviso: 'Dirección eliminada.',
  });
  const barra = useRef<HTMLDivElement>(null);
  // La dirección que tenía el foco desaparece: el foco vuelve al primer botón de la pantalla, no se pierde.
  const hecha = eliminacion.accion.fase === 'hecha';
  useEffect(() => {
    if (hecha) barra.current?.querySelector('button')?.focus();
  }, [hecha]);
  const cancelarEliminacion = () => {
    // Si M2 dijo que ya no existe, lo que se ve está viejo: la lista se pide de nuevo.
    if (eliminacion.accion.fase === 'fallida') setVersion((actual) => actual + 1);
    eliminacion.cancelar();
  };

  return (
    <>
      <Titulo>{TITULOS.direcciones}</Titulo>
      <div className={estilos.barra} ref={barra}>
        <BotonAccion esperando={false} variante={creando ? 'contorno' : 'principal'} onClick={() => setCreando(!creando)}>
          {creando ? 'Cerrar el formulario' : 'Agregar una dirección'}
        </BotonAccion>
      </div>
      <Aviso estado={eliminacion.accion} />
      {creando && (
        <NuevaDireccion
          api={api}
          sesion={sesion}
          alCrear={() => {
            setPagina(0);
            setVersion((actual) => actual + 1);
          }}
        />
      )}
      <EstadoPantalla estado={estado} vacio="Todavía no hay direcciones guardadas. Agregá una, o cargá el ejemplo desde el perfil." alReintentar={reintentar}>
        {(datos) => (
          <section className={estilos.hoja} aria-label="Direcciones guardadas">
            {datos.items.length === 0 ? (
              <div className={estilos.vacia}>
                <p>Esta página quedó vacía.</p>
                <BotonAccion esperando={false} variante="contorno" onClick={() => setPagina(0)}>
                  Ir a la primera página
                </BotonAccion>
              </div>
            ) : (
              <ul className={estilos.lista}>
                {datos.items.map((direccion) => (
                  <li key={direccion.direccionId} className={estilos.direccion}>
                    <div className={estilos.contenido}>
                      <p className={estilos.nombre}>
                        <span className={direccion.tipo === 'FAVORITA' ? estilos.favorita : estilos.reciente}>{nombreDelTipo(direccion.tipo)}</span>
                        {direccion.alias !== undefined && direccion.alias !== '' && <span>{direccion.alias}</span>}
                      </p>
                      <p className={estilos.texto}>{direccion.texto}</p>
                      {direccion.coordenadas !== undefined && (
                        <p className={estilos.dato}>
                          {direccion.coordenadas.latitud}, {direccion.coordenadas.longitud}
                        </p>
                      )}
                    </div>
                    <div className={estilos.acciones}>
                      <a className={estilos.editar} href={enlace('direcciones', direccion.direccionId)}>
                        Editar<span className={estilos.oculto}> {direccion.alias || direccion.texto}</span>
                      </a>
                      <BotonAccion esperando={false} variante="peligro" onClick={() => eliminacion.pedir(direccion)}>
                        Eliminar<span className={estilos.oculto}> {direccion.alias || direccion.texto}</span>
                      </BotonAccion>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Paginacion pagina={datos} alCambiar={setPagina} nombre="direcciones" />
          </section>
        )}
      </EstadoPantalla>
      <DialogoConfirmar
        abierto={eliminacion.objetivo !== undefined}
        titulo="Eliminar dirección"
        confirmar="Eliminar"
        estado={eliminacion.accion}
        alConfirmar={eliminacion.confirmar}
        alCancelar={cancelarEliminacion}
      >
        <p>
          ¿Eliminar {eliminacion.objetivo?.alias ? <b>«{eliminacion.objetivo.alias}»</b> : null} {eliminacion.objetivo?.texto}?
        </p>
        <p>Esta acción no se puede deshacer.</p>
      </DialogoConfirmar>
    </>
  );
}

// El alta: la `Idempotency-Key` se genera al abrir el formulario y se conserva ante un error o un tiempo agotado, así «Reintentar» no crea
// dos direcciones. Tras guardar, el formulario queda vacío para otra y la lista de abajo se actualiza.
function NuevaDireccion({ api, sesion, alCrear }: { api: ApiM2; sesion: Sesion; alCrear: () => void }) {
  const id = useId();
  const clave = usarClaveDeIdempotencia();
  const [campos, setCampos] = useState<CamposDireccion>(DIRECCION_NUEVA);
  const [intentado, setIntentado] = useState(false);
  const errores = intentado ? validarDireccion(campos) : {};

  const { estado, esperando, enviar, reintentar, reiniciar } = usarAccion({
    ejecutar: async ({ clave: idempotencia, senal }, escritos: CamposDireccion) => {
      const creada = await api.crearDireccion(sesion.sub, cuerpoDeDireccion(escritos), idempotencia!, { senal });
      setCampos(DIRECCION_NUEVA);
      setIntentado(false);
      alCrear();
      return creada;
    },
    aviso: 'Dirección guardada.',
    clave,
  });

  const alEnviar = () => {
    setIntentado(true);
    const primero = primerCampoDeDireccionConError(validarDireccion(campos));
    if (primero !== undefined) return document.getElementById(`${id}-${primero}`)?.focus();
    void enviar(campos);
  };
  const alCambiar = (campo: keyof CamposDireccion, valor: string) => {
    if (estado.fase === 'hecha') reiniciar();
    setCampos((previos) => ({ ...previos, [campo]: valor }));
  };
  const error = estado.fase === 'fallida' ? estado.error : undefined;

  return (
    <div className={estilos.formulario}>
      <Formulario
        titulo="Nueva dirección"
        alEnviar={alEnviar}
        error={error}
        alReintentar={sePuedeReintentar(error) ? reintentar : undefined}
        acciones={
          <BotonAccion tipo="submit" esperando={esperando} textoEsperando="Guardando…">
            Guardar dirección
          </BotonAccion>
        }
      >
        <CamposDeDireccion id={id} campos={campos} errores={errores} alCambiar={alCambiar} />
      </Formulario>
      <Aviso estado={estado} />
    </div>
  );
}

function EdicionDeDireccion({ api, sesion, idDireccion }: { api: ApiM2; sesion: Sesion; idDireccion: string }) {
  const { estado, reintentar } = usarCarga((senal) => api.obtenerDireccion(sesion.sub, idDireccion, { senal }), [api, sesion.sub, idDireccion]);

  return (
    <>
      <Titulo>Editar dirección</Titulo>
      <p className={estilos.volver}>
        <a href={enlace('direcciones')}>← Volver a las direcciones</a>
      </p>
      <EstadoPantalla estado={estado} vacio="No hay dirección para mostrar." alReintentar={reintentar}>
        {(direccion) => <EditarDireccion key={direccion.direccionId} api={api} sesion={sesion} inicial={direccion} />}
      </EstadoPantalla>
    </>
  );
}

function EditarDireccion({ api, sesion, inicial }: { api: ApiM2; sesion: Sesion; inicial: Direccion }) {
  const id = useId();
  // La dirección de M2: la que se cargó, o la que devolvió el último guardado.
  const [direccion, setDireccion] = useState(inicial);
  const [campos, setCampos] = useState<CamposDireccion>(() => camposDeDireccion(inicial));
  const [intentado, setIntentado] = useState(false);
  const errores = intentado ? validarDireccion(campos, direccion) : {};

  const { estado, esperando, enviar, reintentar, reiniciar } = usarAccion({
    ejecutar: async ({ senal }, escritos: CamposDireccion) => {
      const resultado = await guardarDireccion(api, sesion.sub, direccion, escritos, { senal });
      if (resultado.tipo === 'guardada') {
        setDireccion(resultado.direccion);
        setCampos(camposDeDireccion(resultado.direccion));
        setIntentado(false);
      }
      return resultado;
    },
    aviso: (resultado) => (resultado.tipo === 'guardada' ? 'Dirección guardada.' : 'No hay cambios que guardar.'),
  });

  const alEnviar = () => {
    setIntentado(true);
    const primero = primerCampoDeDireccionConError(validarDireccion(campos, direccion));
    if (primero !== undefined) return document.getElementById(`${id}-${primero}`)?.focus();
    void enviar(campos);
  };
  const alCambiar = (campo: keyof CamposDireccion, valor: string) => {
    if (estado.fase === 'hecha') reiniciar();
    setCampos((previos) => ({ ...previos, [campo]: valor }));
  };
  const descartar = () => {
    if (esperando) return;
    reiniciar();
    setIntentado(false);
    setCampos(camposDeDireccion(direccion));
  };
  const error = estado.fase === 'fallida' ? estado.error : undefined;

  return (
    <div className={estilos.formulario}>
      <Formulario
        titulo="Datos de la dirección"
        alEnviar={alEnviar}
        error={error}
        alReintentar={sePuedeReintentar(error) ? reintentar : undefined}
        acciones={
          <>
            <BotonAccion variante="contorno" esperando={false} onClick={descartar}>
              Restablecer
            </BotonAccion>
            <BotonAccion tipo="submit" esperando={esperando} textoEsperando="Guardando…">
              Guardar cambios
            </BotonAccion>
          </>
        }
      >
        <CamposDeDireccion id={id} campos={campos} errores={errores} alCambiar={alCambiar} />
      </Formulario>
      <Aviso estado={estado} />
    </div>
  );
}
