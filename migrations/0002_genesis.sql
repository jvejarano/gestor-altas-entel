-- Altas realizadas segun el sistema Genesis (export MHT de /altasRealizadas)
CREATE TABLE IF NOT EXISTS genesis (
  cuenta      TEXT PRIMARY KEY,
  fecha_alta  TEXT,              -- YYYY-MM-DD
  carnet      TEXT,
  nombre      TEXT NOT NULL,
  nombre_norm TEXT NOT NULL,
  solicitud   TEXT,
  reserva     TEXT,
  plan        TEXT,
  direccion   TEXT,
  archivo     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_genesis_fecha  ON genesis(fecha_alta);
CREATE INDEX IF NOT EXISTS idx_genesis_nombre ON genesis(nombre_norm);
