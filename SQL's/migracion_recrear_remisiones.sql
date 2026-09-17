-- ============================================================================
-- RECREACIÓN DE REMISIONES: remisiones + remisiones_filas
-- ----------------------------------------------------------------------------
-- Ejecutar MANUALMENTE en el SQL Editor de Supabase. No la corre la app.
--
-- ⚠️ CORRERLA ANTES DE USAR REMISIONES: sin estas dos tablas la pantalla no
--    puede ni listar ni guardar nada (mismo aviso que la migración original).
--
-- ── CONTEXTO ─────────────────────────────────────────────────────────────
-- SQL's/eliminacion_remisiones.sql había hecho DROP de estas dos tablas al
-- retirarse la funcionalidad. Rafa confirmó que sí se usa, así que se
-- restauró el código (revert del commit "Remisiones: eliminación completa de
-- la funcionalidad") y hace falta recrear las tablas con el MISMO esquema que
-- tenían antes de borrarse: mismas columnas, UNIQUE, CASCADE y RLS. El RLS de
-- acá es el viejo (auth.role() = 'authenticated', sin distinguir usuarios) a
-- propósito — va a cambiar en un paso aparte del proyecto, no en este.
--
-- Mismo esquema que SQL's/migracion_remisiones.sql + SQL's/migracion_
-- remision_cedula.sql combinadas (los dos archivos históricos se dejan
-- intactos como registro, no se editan). Ver esos dos para el detalle de cada
-- decisión de diseño (por qué INTEGER+UNIQUE en numero, por qué toda celda de
-- fila es TEXT, por qué es_total es una fila y no una columna calculada, etc).
-- ============================================================================

-- ── ENCABEZADO ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS remisiones (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero            INTEGER     NOT NULL UNIQUE,
  fecha             DATE        NOT NULL,
  conductor         TEXT,
  cedula            TEXT,
  placa             TEXT,
  firma_responsable TEXT,
  firma_conductor   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS remisiones_fecha_idx ON remisiones (fecha);

-- ── FILAS DE LA TABLA DE LA REMISIÓN ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS remisiones_filas (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  remision_id    UUID    NOT NULL REFERENCES remisiones(id) ON DELETE CASCADE,
  orden          INTEGER NOT NULL,
  cliente        TEXT,
  producto       TEXT,
  und_kg         TEXT,
  canastillas    TEXT,
  destino        TEXT,
  firma_recibido TEXT,
  es_total       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS remisiones_filas_remision_orden_idx
  ON remisiones_filas (remision_id, orden);

-- ── RLS (la misma de antes de borrarse; se revisa aparte) ───────────────────
ALTER TABLE remisiones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS remisiones_auth ON remisiones;
CREATE POLICY remisiones_auth ON remisiones
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

ALTER TABLE remisiones_filas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS remisiones_filas_auth ON remisiones_filas;
CREATE POLICY remisiones_filas_auth ON remisiones_filas
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ── VERIFICACIÓN (opcional, no modifica nada) ───────────────────────────────
--   -- Las dos tablas y sus columnas (cedula debe aparecer en remisiones):
--   SELECT table_name, column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_name IN ('remisiones', 'remisiones_filas')
--   ORDER BY table_name, ordinal_position;
--
--   -- El UNIQUE de numero:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'remisiones'::regclass AND contype = 'u';
--   -- UNIQUE (numero)
--
--   -- La FK con CASCADE:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'remisiones_filas'::regclass AND contype = 'f';
--   -- FOREIGN KEY (remision_id) REFERENCES remisiones(id) ON DELETE CASCADE
--
--   -- Las policies (cmd = 'ALL', qual Y with_check con auth.role()):
--   SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies
--   WHERE tablename IN ('remisiones', 'remisiones_filas');
