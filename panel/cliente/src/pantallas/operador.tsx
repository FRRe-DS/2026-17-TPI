import { useEffect, useId, useState, type ReactNode } from 'react';
import { ErrorDeApi, type DatosDeError } from '../api/errores.js';
import type { ApiM2 } from '../api/m2.js';
import { Aviso } from '../componentes/aviso.js';
import { BotonAccion } from '../componentes/boton-accion.js';
import { ErrorDeM2 } from '../componentes/error-de-m2.js';
import { EstadoPantalla } from '../componentes/estado-pantalla.js';
import { FichaDeCuenta } from '../componentes/ficha-de-cuenta.js';
import { Campo, Formulario } from '../componentes/formulario.js';
import { Paginacion } from '../componentes/paginacion.js';
import { Titulo } from '../componentes/titulo.js';
import { usarAccion } from '../hooks/usar-accion.js';
import { usarCarga } from '../hooks/usar-carga.js';
import { usarClaveDeIdempotencia } from '../hooks/usar-clave-idempotencia.js';
import type { components } from '../generado/contrato.js';
import {
  BLOQUEO_NUEVO,
  cuerpoDeBloqueo,
  cuerpoDeLevantamiento,
  LARGO_MAXIMO_MOTIVO,
  mensajeDeBloqueo,
  validarBloqueo,
  validarBusqueda,
  validarLevantamiento,
  type CamposBloqueo,
} from '../logica/bloqueos.js';
import { estadoDeBloqueo } from '../logica/cuenta.js';
import { instante } from '../logica/historial.js';
import { TAMANO_DE_PAGINA } from '../logica/paginacion.js';
import { TITULOS } from '../rutas.js';
import estilos from './operador.module.css';

type Bloqueo = components['schemas']['Bloqueo'];

// Un `400` o un `409` se corrige o se abandona; repetir el mismo pedido solo sirve si M2 no contestó o falló por su cuenta.
const sePuedeReintentar = (error: DatosDeError | undefined) => error !== undefined && (error.sinRespuesta || error.estado >= 500);

// La vista del operador (RF-2.6.6): busca un cliente por su UUID, muestra su estado de cuenta y su historial de bloqueos, bloquea y
// levanta. Tras cada acción vuelve a pedir el estado a M2, así lo que se ve es lo que M2 tiene.
export function Operador({ api }: { api: ApiM2 }) {
  const id = useId();
  const [texto, setTexto] = useState('');
  const [intentado, setIntentado] = useState(false);
  const [clienteId, setClienteId] = useState<string | undefined>();
  const errorDeBusqueda = intentado ? validarBusqueda(texto) : undefined;

  const buscar = () => {
    setIntentado(true);
    if (validarBusqueda(texto) !== undefined) return document.getElementById(`${id}-cliente`)?.focus();
    setClienteId(texto.trim().toLowerCase());
  };

  return (
    <>
      <Titulo>{TITULOS.operador}</Titulo>
      <div className={estilos.operador}>
        <Formulario
          titulo="Buscar un cliente"
          alEnviar={buscar}
          acciones={
            <BotonAccion tipo="submit" esperando={false}>
              Buscar
            </BotonAccion>
          }
        >
          <Campo
            id={`${id}-cliente`}
            numero={1}
            etiqueta="UUID del cliente"
            valor={texto}
            alCambiar={setTexto}
            error={errorDeBusqueda}
            ayuda="El identificador que M2 le dio al crear su perfil."
            autoComplete="off"
            completo
          />
        </Formulario>
        {clienteId !== undefined && <BloqueosDelCliente key={clienteId} api={api} clienteId={clienteId} />}
      </div>
    </>
  );
}

function BloqueosDelCliente({ api, clienteId }: { api: ApiM2; clienteId: string }) {
  const [version, setVersion] = useState(0);
  const [pagina, setPagina] = useState(0);
  const recargar = () => setVersion((actual) => actual + 1);

  const cuenta = usarCarga((senal) => api.obtenerEstadoCuenta(clienteId, { senal }), [api, clienteId, version]);
  const historial = usarCarga(
    (senal) => api.listarBloqueos(clienteId, { page: pagina, size: TAMANO_DE_PAGINA }, { senal }),
    [api, clienteId, pagina, version],
    (datos) => datos.totalElementos === 0,
  );

  // «Levantar»: un solo formulario abierto a la vez, dentro de la fila del bloqueo. Su aviso y su error viven acá, no en la fila,
  // porque la fila desaparece al recargar la lista.
  const [levantando, setLevantando] = useState<string | undefined>();
  const [motivo, setMotivo] = useState('');
  const [intentado, setIntentado] = useState(false);
  const levantar = usarAccion({
    ejecutar: async ({ senal }, bloqueoId: string, escrito: string) => {
      try {
        const levantado = await api.levantarBloqueo(clienteId, bloqueoId, cuerpoDeLevantamiento({ motivo: escrito }), { senal });
        setLevantando(undefined);
        setMotivo('');
        setIntentado(false);
        recargar();
        return levantado;
      } catch (error) {
        // Un 409 o un 404 dicen que lo que se ve está viejo: se vuelve a pedir, y el error queda a la vista.
        if (error instanceof ErrorDeApi && (error.estado === 409 || error.estado === 404)) recargar();
        throw error;
      }
    },
    aviso: 'Bloqueo levantado.',
  });
  const errorAlLevantar = levantar.estado.fase === 'fallida' ? levantar.estado.error : undefined;

  const abrirLevantar = (bloqueoId: string) => {
    levantar.reiniciar();
    setMotivo('');
    setIntentado(false);
    setLevantando(bloqueoId);
  };
  const cerrarLevantar = () => {
    if (levantar.esperando) return;
    levantar.reiniciar();
    setLevantando(undefined);
  };
  const enviarLevantar = () => {
    setIntentado(true);
    if (levantando === undefined || validarLevantamiento({ motivo }).motivo !== undefined) return;
    void levantar.enviar(levantando, motivo);
  };

  return (
    <div className={estilos.cliente}>
      <EstadoPantalla
        estado={cuenta.estado}
        vacio="No hay estado de cuenta para mostrar."
        alReintentar={cuenta.reintentar}
        errorPropio={(error) =>
          error.estado === 404 ? (
            <div role="alert">
              <ErrorDeM2 error={error} mensaje="No hay un cliente con ese UUID." />
            </div>
          ) : undefined
        }
      >
        {(datos) => <FichaDeCuenta cuenta={datos} />}
      </EstadoPantalla>

      {cuenta.estado.fase !== 'error' && (
        <>
          <NuevoBloqueo
            api={api}
            clienteId={clienteId}
            alCrear={() => {
              setPagina(0);
              recargar();
            }}
          />
          <Aviso estado={levantar.estado} />
          {errorAlLevantar !== undefined && (
            <div role="alert" className={estilos.errorAlLevantar}>
              <ErrorDeM2
                error={errorAlLevantar}
                mensaje={mensajeDeBloqueo(errorAlLevantar)}
                alReintentar={sePuedeReintentar(errorAlLevantar) ? levantar.reintentar : undefined}
              />
            </div>
          )}
          <h2 className={estilos.subtitulo}>Historial de bloqueos</h2>
          <EstadoPantalla estado={historial.estado} vacio="Este cliente nunca tuvo bloqueos." alReintentar={historial.reintentar}>
            {(datos) => (
              <section className={estilos.hoja} aria-label="Bloqueos">
                {datos.items.length === 0 ? (
                  <div className={estilos.vacia}>
                    <p>Esta página quedó vacía.</p>
                    <BotonAccion esperando={false} variante="contorno" onClick={() => setPagina(0)}>
                      Ir a la primera página
                    </BotonAccion>
                  </div>
                ) : (
                  <ul className={estilos.lista}>
                    {datos.items.map((bloqueo) => (
                      <FilaDeBloqueo
                        key={bloqueo.bloqueoId}
                        bloqueo={bloqueo}
                        abierta={levantando === bloqueo.bloqueoId}
                        alAbrir={() => abrirLevantar(bloqueo.bloqueoId)}
                        formulario={
                          <FormularioDeLevantar
                            motivo={motivo}
                            alCambiar={setMotivo}
                            error={intentado ? validarLevantamiento({ motivo }).motivo : undefined}
                            esperando={levantar.esperando}
                            alEnviar={enviarLevantar}
                            alCancelar={cerrarLevantar}
                          />
                        }
                      />
                    ))}
                  </ul>
                )}
                <Paginacion pagina={datos} alCambiar={setPagina} nombre="bloqueos" />
              </section>
            )}
          </EstadoPantalla>
        </>
      )}
    </div>
  );
}

const NOMBRE_DEL_ESTADO = { vigente: 'VIGENTE', levantado: 'LEVANTADO', vencido: 'VENCIDO' } as const;

function FilaDeBloqueo({ bloqueo, abierta, alAbrir, formulario }: { bloqueo: Bloqueo; abierta: boolean; alAbrir: () => void; formulario: ReactNode }) {
  const estado = estadoDeBloqueo(bloqueo);
  return (
    <li className={estilos.bloqueo}>
      <div className={estilos.cabeza}>
        <div className={estilos.contenido}>
          <p className={estilos.nombre}>
            <span className={estado === 'vigente' ? estilos.vigente : estilos.cerrado}>{NOMBRE_DEL_ESTADO[estado]}</span>
            <span>{bloqueo.motivo}</span>
          </p>
          <p className={estilos.dato}>
            Desde {instante(bloqueo.desde ?? bloqueo.creadoEn)}
            {bloqueo.hasta !== undefined && ` · hasta ${instante(bloqueo.hasta)}`} · registrado por {bloqueo.creadoPor}
          </p>
          {bloqueo.levantadoEn !== undefined && (
            <p className={estilos.dato}>
              Levantado el {instante(bloqueo.levantadoEn)} por {bloqueo.levantadoPor ?? 'sin dato'}
              {bloqueo.motivoLevantamiento !== undefined && ` · ${bloqueo.motivoLevantamiento}`}
            </p>
          )}
        </div>
        {estado === 'vigente' && !abierta && (
          <BotonAccion esperando={false} variante="peligro" onClick={alAbrir}>
            Levantar<span className={estilos.oculto}> el bloqueo «{bloqueo.motivo}»</span>
          </BotonAccion>
        )}
      </div>
      {abierta && formulario}
    </li>
  );
}

type PropsLevantar = {
  motivo: string;
  alCambiar: (motivo: string) => void;
  error: string | undefined;
  esperando: boolean;
  alEnviar: () => void;
  alCancelar: () => void;
};

function FormularioDeLevantar({ motivo, alCambiar, error, esperando, alEnviar, alCancelar }: PropsLevantar) {
  const id = useId();
  // El foco pasa al campo al abrirse: quien tocó «Levantar» sigue donde estaba, no se pierde.
  useEffect(() => document.getElementById(`${id}-motivo`)?.focus(), [id]);
  return (
    <Formulario
      titulo="Levantar el bloqueo"
      alEnviar={alEnviar}
      acciones={
        <>
          <BotonAccion variante="contorno" esperando={false} onClick={alCancelar}>
            Cancelar
          </BotonAccion>
          <BotonAccion tipo="submit" variante="peligro" esperando={esperando} textoEsperando="Levantando…">
            Levantar bloqueo
          </BotonAccion>
        </>
      }
    >
      <Campo
        id={`${id}-motivo`}
        numero={1}
        etiqueta="Motivo del levantamiento"
        valor={motivo}
        alCambiar={alCambiar}
        error={error}
        ayuda={`${motivo.trim().length} de ${LARGO_MAXIMO_MOTIVO} caracteres.`}
        multilinea
        autoComplete="off"
      />
    </Formulario>
  );
}

// El alta de un bloqueo: la `Idempotency-Key` se genera al abrir el formulario y se conserva ante un error o un tiempo agotado, así
// «Reintentar» no registra dos bloqueos. Tras guardar, el formulario queda vacío y la cuenta se vuelve a pedir.
function NuevoBloqueo({ api, clienteId, alCrear }: { api: ApiM2; clienteId: string; alCrear: () => void }) {
  const id = useId();
  const clave = usarClaveDeIdempotencia();
  const [campos, setCampos] = useState<CamposBloqueo>(BLOQUEO_NUEVO);
  const [intentado, setIntentado] = useState(false);
  const errores = intentado ? validarBloqueo(campos) : {};

  const { estado, esperando, enviar, reintentar, reiniciar } = usarAccion({
    ejecutar: async ({ clave: idempotencia, senal }, escritos: CamposBloqueo) => {
      const creado = await api.crearBloqueo(clienteId, cuerpoDeBloqueo(escritos), idempotencia!, { senal });
      setCampos(BLOQUEO_NUEVO);
      setIntentado(false);
      alCrear();
      return creado;
    },
    aviso: 'Bloqueo registrado.',
    clave,
  });

  const alEnviar = () => {
    setIntentado(true);
    const { motivo, hasta } = validarBloqueo(campos);
    if (motivo !== undefined) return document.getElementById(`${id}-motivo`)?.focus();
    if (hasta !== undefined) return document.getElementById(`${id}-hasta`)?.focus();
    void enviar(campos);
  };
  const cambiar = (nuevos: Partial<CamposBloqueo>) => {
    if (estado.fase === 'hecha') reiniciar();
    setCampos((previos) => ({ ...previos, ...nuevos }));
  };
  const error = estado.fase === 'fallida' ? estado.error : undefined;

  return (
    <>
      <Formulario
        titulo="Bloquear al cliente"
        alEnviar={alEnviar}
        error={error}
        mensajeDelError={error === undefined ? undefined : mensajeDeBloqueo(error)}
        alReintentar={sePuedeReintentar(error) ? reintentar : undefined}
        acciones={
          <BotonAccion tipo="submit" variante="peligro" esperando={esperando} textoEsperando="Bloqueando…">
            Bloquear cliente
          </BotonAccion>
        }
      >
        <Campo
          id={`${id}-motivo`}
          numero={1}
          etiqueta="Motivo"
          valor={campos.motivo}
          alCambiar={(motivo) => cambiar({ motivo })}
          error={errores.motivo}
          ayuda={`${campos.motivo.trim().length} de ${LARGO_MAXIMO_MOTIVO} caracteres.`}
          multilinea
          autoComplete="off"
        />
        <Campo
          id={`${id}-hasta`}
          numero={2}
          etiqueta="Fin del bloqueo (opcional, hora local)"
          valor={campos.hasta}
          alCambiar={(hasta) => cambiar({ hasta })}
          error={errores.hasta}
          ayuda="Sin fecha, el bloqueo dura hasta que se levante."
          tipo="datetime-local"
          autoComplete="off"
        />
      </Formulario>
      <Aviso estado={estado} />
    </>
  );
}
