-- Up Migration
-- Spec 005 (plan, Datos): direcciones frecuentes. Una instantánea propia del texto y las coordenadas, sin referencia a M4
-- (RNF-05); lo que el contrato exige de cada campo lo vuelve a exigir la base.

CREATE TABLE direcciones_cliente (
  direccion_id uuid PRIMARY KEY,
  -- Si se borra el perfil, se van sus direcciones.
  cliente_id uuid NOT NULL REFERENCES clientes (cliente_id) ON DELETE CASCADE,
  tipo text NOT NULL CONSTRAINT direcciones_cliente_tipo_valido CHECK (tipo IN ('FAVORITA', 'RECIENTE')),
  -- El alias vacío es válido: el contrato no fija longitud mínima y no equivale a un alias ausente.
  alias varchar(50),
  texto varchar(255) NOT NULL CONSTRAINT direcciones_cliente_texto_no_vacio CHECK (texto <> ''),
  latitud numeric,
  longitud numeric,
  -- Las dos o ninguna, dentro de los rangos del contrato. Con IS NOT NULL explícito: un CHECK que da NULL se acepta, y
  -- `NULL BETWEEN ...` da NULL.
  CONSTRAINT direcciones_cliente_coordenadas_validas CHECK (
    (latitud IS NULL AND longitud IS NULL)
    OR (latitud IS NOT NULL AND longitud IS NOT NULL AND latitud BETWEEN -90 AND 90 AND longitud BETWEEN -180 AND 180)
  ),
  -- No hay actualizado_en: el contrato no lo expone ni hay requisito de auditoría para direcciones.
  creado_en timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- El listado de un cliente, del más nuevo al más viejo; el id desempata para que la paginación sea estable (RF-2.2.1).
CREATE INDEX direcciones_cliente_listado ON direcciones_cliente (cliente_id, creado_en DESC, direccion_id DESC);

-- El mismo listado filtrado por tipo.
CREATE INDEX direcciones_cliente_listado_por_tipo ON direcciones_cliente (cliente_id, tipo, creado_en DESC, direccion_id DESC);

-- Down Migration
DROP TABLE direcciones_cliente;
