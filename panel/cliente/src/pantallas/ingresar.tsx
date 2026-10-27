import { useId, useRef, useState } from 'react';
import { Aviso } from '../componentes/aviso.js';
import { BotonAccion } from '../componentes/boton-accion.js';
import { ErrorDeM2 } from '../componentes/error-de-m2.js';
import { CamposDeCliente } from '../componentes/campos-de-cliente.js';
import { Campo, Formulario } from '../componentes/formulario.js';
import { Titulo } from '../componentes/titulo.js';
import type { Sesion } from '../fuentes/fuente-de-sesion.js';
import { usarAccion } from '../hooks/usar-accion.js';
import { usarClaveDeIdempotencia } from '../hooks/usar-clave-idempotencia.js';
import { CLIENTE_DE_EJEMPLO, primerCampoConError, validarCamposCliente, type CamposCliente } from '../logica/campos-cliente.js';
import {
  entrarComoNuevo,
  entrarConRol,
  IDENTIFICADOR_DE_EJEMPLO,
  validarIdentificador,
  volverAEntrar,
  type Ingreso,
} from '../logica/ingresar.js';
import { MAXIMO_RECORDADOS, type Recordado } from '../logica/recordados.js';
import { ROLES, TITULOS, type Rol } from '../rutas.js';
import estilos from './ingresar.module.css';

type Props = { ingreso: Ingreso; alEntrar: (sesion: Sesion) => void };

// La pantalla sin sesión (RNF-12.9): entrar como cliente nuevo (RF-2.1.5), volver a entrar como un cliente recordado (RF-2.1.6,
// RF-2.1.7) o entrar con otro rol. Lo que decide está en `logica/ingresar.ts`; `alEntrar` abre las pantallas del rol.
export function Ingresar({ ingreso, alEntrar }: Props) {
  return (
    <>
      <Titulo>{TITULOS.ingresar}</Titulo>
      <p className={estilos.intro}>
        La sesión es simulada: se elige con quién entrar y el panel firma un token de prueba en cada pedido a M2.
      </p>
      <div className={estilos.hojas}>
        <ClienteNuevo ingreso={ingreso} alEntrar={alEntrar} />
        <Recordados ingreso={ingreso} alEntrar={alEntrar} />
        <OtroRol ingreso={ingreso} alEntrar={alEntrar} />
      </div>
    </>
  );
}

// El alta con valores de ejemplo editables. El UUID y la clave se generan al abrir la pantalla y se conservan hasta que M2
// contesta bien: «Reintentar» o un segundo envío tras un error mandan los mismos y no crean otro cliente.
function ClienteNuevo({ ingreso, alEntrar }: Props) {
  const id = useId();
  const [clienteId] = useState(() => crypto.randomUUID());
  const clave = usarClaveDeIdempotencia();
  const [campos, setCampos] = useState<CamposCliente>(CLIENTE_DE_EJEMPLO);
  const [intentado, setIntentado] = useState(false);
  const errores = intentado ? validarCamposCliente(campos) : {};

  const { estado, esperando, enviar, reintentar } = usarAccion({
    ejecutar: async ({ clave: idempotencia, senal }, datos: CamposCliente) => {
      const sesion = await entrarComoNuevo(ingreso, { clienteId, campos: datos, clave: idempotencia! }, { senal });
      alEntrar(sesion);
      return sesion;
    },
    aviso: 'Cliente creado. Entrando…',
    clave,
  });

  const alEnviar = () => {
    setIntentado(true);
    const primero = primerCampoConError(validarCamposCliente(campos));
    if (primero !== undefined) return document.getElementById(`${id}-${primero}`)?.focus();
    void enviar(campos);
  };

  return (
    <div className={estilos.nuevo}>
      <Formulario
        titulo="Entrar como cliente nuevo"
        alEnviar={alEnviar}
        error={estado.fase === 'fallida' ? estado.error : undefined}
        alReintentar={reintentar}
        acciones={
          <>
            <p className={estilos.identificador}>
              Se crea con el identificador <code>{clienteId}</code>
            </p>
            <BotonAccion tipo="submit" esperando={esperando} textoEsperando="Creando…">
              Entrar como cliente nuevo
            </BotonAccion>
          </>
        }
      >
        <CamposDeCliente id={id} campos={campos} errores={errores} alCambiar={(campo, valor) => setCampos((previos) => ({ ...previos, [campo]: valor }))} />
      </Formulario>
      <Aviso estado={estado} />
    </div>
  );
}

// Los clientes usados antes en este navegador, para volver a entrar con un clic. Si M2 ya no tiene a uno, se marca «ya no existe»
// y el foco pasa a «Quitar».
function Recordados({ ingreso, alEntrar }: Props) {
  const id = useId();
  const titulo = useRef<HTMLHeadingElement>(null);
  const [lista, setLista] = useState(() => ingreso.recordados.lista());
  const [yaNoExisten, setYaNoExisten] = useState<ReadonlySet<string>>(() => new Set());
  const [elegido, setElegido] = useState<string | undefined>(undefined);

  const { estado, esperando, enviar, reintentar } = usarAccion({
    ejecutar: async ({ senal }, recordado: Recordado) => {
      const reingreso = await volverAEntrar(ingreso, recordado, { senal });
      if (reingreso.tipo === 'entro') alEntrar(reingreso.sesion);
      else {
        setYaNoExisten((previos) => new Set(previos).add(reingreso.id));
        // Después de dibujar la marca: el botón «Quitar» de esa fila recién existe ahí.
        requestAnimationFrame(() => document.getElementById(`${id}-quitar-${reingreso.id}`)?.focus());
      }
      return reingreso;
    },
    aviso: '',
  });

  const entrar = (recordado: Recordado) => {
    if (esperando) return;
    setElegido(recordado.id);
    void enviar(recordado);
  };

  const quitar = (clienteId: string) => {
    setLista(ingreso.recordados.quitar(clienteId));
    titulo.current?.focus();
  };

  return (
    <section className={`${estilos.hoja} ${estilos.recordados}`} aria-labelledby={`${id}-titulo`}>
      <div className={estilos.cabecera}>
        <h2 id={`${id}-titulo`} ref={titulo} tabIndex={-1}>
          Clientes recordados
        </h2>
        <span className={estilos.cuenta}>
          {lista.length} de {MAXIMO_RECORDADOS}
        </span>
      </div>
      {lista.length === 0 ? (
        <p className={estilos.vacio}>Todavía no entraste como ningún cliente en este navegador. Los que crees quedan acá para volver a entrar con un clic.</p>
      ) : (
        <ul className={estilos.lista}>
          {lista.map((recordado) => {
            const yaNoExiste = yaNoExisten.has(recordado.id);
            return (
              <li key={recordado.id} className={estilos.recordado}>
                <div className={estilos.quien}>
                  <span className={estilos.nombre}>{recordado.nombre}</span>
                  <span className={estilos.uuid}>{recordado.id}</span>
                </div>
                {yaNoExiste ? (
                  <div className={estilos.acciones}>
                    <span className={estilos.marca}>ya no existe</span>
                    <button
                      id={`${id}-quitar-${recordado.id}`}
                      type="button"
                      className={estilos.quitar}
                      aria-label={`Quitar a ${recordado.nombre}, que ya no existe en M2`}
                      onClick={() => quitar(recordado.id)}
                    >
                      Quitar
                    </button>
                  </div>
                ) : (
                  <BotonAccion esperando={esperando && elegido === recordado.id} variante="contorno" textoEsperando="Entrando…" onClick={() => entrar(recordado)}>
                    Entrar<span className={estilos.oculto}> como {recordado.nombre}</span>
                  </BotonAccion>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {estado.fase === 'fallida' && (
        <div role="alert" className={estilos.error}>
          <ErrorDeM2 error={estado.error} alReintentar={reintentar} esperando={esperando} />
        </div>
      )}
    </section>
  );
}

const DESCRIPCION: Record<Rol, string> = {
  CLIENTE: 'Un cliente que ya existe, por su UUID.',
  OPERADOR: 'Bloquea y levanta bloqueos de clientes.',
  SERVICIO: 'Otro módulo: consulta el estado de cuenta.',
  CONDUCTOR: 'No tiene pantallas en M2: ve el 403.',
};

// Elegir rol e identificador: entra sin preguntar a M2. Al cambiar de rol, el identificador de ejemplo cambia con él, salvo que
// se haya escrito otro.
function OtroRol({ ingreso, alEntrar }: Props) {
  const id = useId();
  const [rol, setRol] = useState<Rol>('OPERADOR');
  const [identificador, setIdentificador] = useState(IDENTIFICADOR_DE_EJEMPLO.OPERADOR);
  const [intentado, setIntentado] = useState(false);
  const error = intentado ? validarIdentificador(rol, identificador) : undefined;

  const elegir = (nuevo: Rol) => {
    if (identificador === IDENTIFICADOR_DE_EJEMPLO[rol]) setIdentificador(IDENTIFICADOR_DE_EJEMPLO[nuevo]);
    setRol(nuevo);
  };

  const alEnviar = () => {
    setIntentado(true);
    if (validarIdentificador(rol, identificador) !== undefined) return document.getElementById(`${id}-identificador`)?.focus();
    alEntrar(entrarConRol(ingreso, rol, identificador));
  };

  return (
    <div className={estilos.rol}>
      <Formulario
        titulo="Entrar con un rol"
        alEnviar={alEnviar}
        acciones={
          <BotonAccion tipo="submit" esperando={false} variante="contorno">
            Entrar como {rol}
          </BotonAccion>
        }
      >
        <fieldset className={estilos.roles}>
          <legend className={estilos.leyenda}>
            <span className={estilos.numero} aria-hidden="true">
              01
            </span>
            Rol
          </legend>
          <div className={estilos.opciones}>
            {ROLES.map((opcion) => (
              <label key={opcion} className={estilos.opcion}>
                <input type="radio" name={`${id}-rol`} value={opcion} checked={rol === opcion} onChange={() => elegir(opcion)} />
                <span className={estilos.textoOpcion}>
                  <span className={estilos.nombreRol}>{opcion}</span>
                  <span className={estilos.descripcion}>{DESCRIPCION[opcion]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Campo
          id={`${id}-identificador`}
          numero={2}
          etiqueta="Identificador"
          valor={identificador}
          alCambiar={setIdentificador}
          error={error}
          ayuda={rol === 'CLIENTE' ? 'El UUID de un cliente que ya existe.' : 'El sub del token: de 1 a 128 caracteres.'}
          maximo={128}
          requerido
          autoComplete="off"
          completo
        />
      </Formulario>
    </div>
  );
}
