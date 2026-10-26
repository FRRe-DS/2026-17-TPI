-- Up Migration
-- Spec 008 (plan, Datos): calificaciones del conductor. Del viaje y del conductor se guardan solo los identificadores que
-- informó M6, sin clave foránea ni más datos (RNF-05). La restricción única es la que impide calificar dos veces el mismo viaje,
-- también con claves de idempotencia distintas o solicitudes a la vez (RNF-08, RF-2.5.3).

CREATE TABLE calificaciones (
  calificacion_id uuid PRIMARY KEY,
  -- Si se borra el perfil, se van sus calificaciones.
  cliente_id uuid NOT NULL REFERENCES clientes (cliente_id) ON DELETE CASCADE,
  viaje_id uuid NOT NULL,
  conductor_id uuid NOT NULL,
  puntaje smallint NOT NULL CONSTRAINT calificaciones_puntaje_valido CHECK (puntaje BETWEEN 1 AND 5),
  -- El comentario vacío es válido: el contrato no fija longitud mínima y no equivale a un comentario ausente.
  comentario varchar(500),
  creado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Una calificación por viaje y cliente. Su índice sirve también a la búsqueda por cliente y viaje (RF-2.5.3, RF-2.5.14).
  CONSTRAINT calificaciones_cliente_viaje_unica UNIQUE (cliente_id, viaje_id)
);

-- El listado de un cliente, del más nuevo al más viejo; el id desempata para que la paginación sea estable (RF-2.5.8).
CREATE INDEX calificaciones_listado ON calificaciones (cliente_id, creado_en DESC, calificacion_id DESC);

-- Down Migration
DROP TABLE calificaciones;
