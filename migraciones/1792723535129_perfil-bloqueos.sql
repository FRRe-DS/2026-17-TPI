-- Up Migration
-- Spec 004 (plan, Datos): perfiles, bloqueos e idempotencia de las altas. Lo que no puede duplicarse lo garantiza la base
-- (RNF-08.1); el estado de la cuenta no se guarda, se calcula desde los bloqueos vigentes.

-- Un perfil por sub: el cliente_id es el sub del token CLIENTE que lo crea (RF-2.1, RF-2.1.3).
CREATE TABLE clientes (
  cliente_id uuid PRIMARY KEY,
  nombre varchar(100) NOT NULL,
  apellido varchar(100) NOT NULL,
  telefono varchar(16) NOT NULL CONSTRAINT clientes_telefono_e164 CHECK (telefono ~ '^\+[1-9][0-9]{6,14}$'),
  fecha_nacimiento date,
  creado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Lo cambia cada actualización, de forma explícita.
  actualizado_en timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Bloqueos administrativos (RF-2.6). Levantar uno completa sus tres datos de levantamiento y no borra la fila (RF-2.6.3).
-- El `desde` del contrato es creado_en.
CREATE TABLE bloqueos_cliente (
  bloqueo_id uuid PRIMARY KEY,
  cliente_id uuid NOT NULL REFERENCES clientes (cliente_id),
  motivo varchar(500) NOT NULL CONSTRAINT bloqueos_cliente_motivo_no_vacio CHECK (motivo <> ''),
  -- Sin valor, vigente hasta que se levante. Que sea futura se valida antes de insertar.
  hasta timestamptz,
  creado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  creado_por text NOT NULL,
  levantado_en timestamptz,
  levantado_por text,
  motivo_levantamiento varchar(500) CONSTRAINT bloqueos_cliente_motivo_levantamiento_no_vacio CHECK (motivo_levantamiento <> ''),
  CONSTRAINT bloqueos_cliente_levantamiento_completo CHECK (
    (levantado_en IS NULL AND levantado_por IS NULL AND motivo_levantamiento IS NULL)
    OR (levantado_en IS NOT NULL AND levantado_por IS NOT NULL AND motivo_levantamiento IS NOT NULL)
  )
);

-- El historial de un cliente, del más nuevo al más viejo (RF-2.6.2).
CREATE INDEX bloqueos_cliente_historial ON bloqueos_cliente (cliente_id, creado_en DESC, bloqueo_id DESC);

-- Los que pueden estar vigentes. La condición sobre `hasta` va en la consulta: now() no puede ir en un índice parcial.
CREATE INDEX bloqueos_cliente_sin_levantar ON bloqueos_cliente (cliente_id) WHERE levantado_en IS NULL;

-- Una fila por alta con Idempotency-Key, en la misma transacción que el alta. estado, ubicacion y respuesta se completan al
-- terminar el alta. crearCliente no tiene cliente en la ruta y guarda cliente_id nulo: con NULLS NOT DISTINCT, la misma clave
-- del mismo sujeto choca igual (23505). crearBloqueo guarda siempre el cliente de la ruta, así la misma clave sirve para
-- otro cliente.
CREATE TABLE idempotencias (
  operacion text NOT NULL,
  sujeto text NOT NULL,
  cliente_id uuid,
  clave varchar(255) NOT NULL,
  hash_solicitud text NOT NULL,
  estado smallint,
  ubicacion text,
  respuesta jsonb,
  creado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT idempotencias_unica UNIQUE NULLS NOT DISTINCT (operacion, sujeto, cliente_id, clave),
  CONSTRAINT idempotencias_crear_bloqueo_con_cliente CHECK (operacion <> 'crearBloqueo' OR cliente_id IS NOT NULL)
);

-- Down Migration
DROP TABLE idempotencias;
DROP TABLE bloqueos_cliente;
DROP TABLE clientes;
