-- Up Migration

CREATE FUNCTION arreglo_sin_repetidos(arr text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$ SELECT cardinality(arr) = (SELECT count(DISTINCT valor) FROM unnest(arr) AS elementos(valor)) $$;

CREATE TABLE preferencias_cliente (
  cliente_id uuid PRIMARY KEY REFERENCES clientes(cliente_id) ON DELETE CASCADE,
  tipos_vehiculo text[] NOT NULL DEFAULT '{}',
  canales text[] NOT NULL DEFAULT '{}',
  accesibilidad text[] NOT NULL DEFAULT '{}',
  observaciones_accesibilidad varchar(255),
  CONSTRAINT preferencias_tipos_validos CHECK (tipos_vehiculo <@ ARRAY['AUTO', 'MOTO']::text[]),
  CONSTRAINT preferencias_canales_validos CHECK (canales <@ ARRAY['EMAIL', 'SMS', 'PUSH']::text[]),
  CONSTRAINT preferencias_accesibilidad_valida CHECK (accesibilidad <@ ARRAY['SILLA_DE_RUEDAS', 'ASISTENCIA_VISUAL', 'ASISTENCIA_AUDITIVA', 'ANIMAL_DE_ASISTENCIA']::text[]),
  CONSTRAINT preferencias_tipos_sin_repetidos CHECK (arreglo_sin_repetidos(tipos_vehiculo)),
  CONSTRAINT preferencias_canales_sin_repetidos CHECK (arreglo_sin_repetidos(canales)),
  CONSTRAINT preferencias_accesibilidad_sin_repetidos CHECK (arreglo_sin_repetidos(accesibilidad))
);

-- Down Migration

DROP TABLE preferencias_cliente;
DROP FUNCTION arreglo_sin_repetidos(text[]);
