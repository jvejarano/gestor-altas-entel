CREATE TABLE IF NOT EXISTS altas (
  cuenta            TEXT PRIMARY KEY,
  fecha_instalacion TEXT,            -- YYYY-MM-DD
  nombre            TEXT NOT NULL,
  nombre_norm       TEXT NOT NULL,   -- MAYUS sin tildes, para busqueda
  email             TEXT,
  telefono1         TEXT,
  telefono2         TEXT,
  hoja              TEXT,            -- mes/hoja de origen
  archivo           TEXT,            -- archivo de origen
  fuente            TEXT NOT NULL DEFAULT 'planilla',  -- planilla | ventas_cerradas | html
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_altas_fecha  ON altas(fecha_instalacion);
CREATE INDEX IF NOT EXISTS idx_altas_nombre ON altas(nombre_norm);
CREATE INDEX IF NOT EXISTS idx_altas_hoja   ON altas(hoja);

CREATE TABLE IF NOT EXISTS pagos (
  cuenta  TEXT NOT NULL REFERENCES altas(cuenta) ON DELETE CASCADE,
  periodo TEXT NOT NULL,             -- YYYY-MM
  monto   REAL NOT NULL,
  PRIMARY KEY (cuenta, periodo)
);
CREATE INDEX IF NOT EXISTS idx_pagos_periodo ON pagos(periodo);
