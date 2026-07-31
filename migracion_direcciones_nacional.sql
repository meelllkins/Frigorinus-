-- ============================================================================
-- DIRECCIONES DE DESPACHO NACIONAL
-- ----------------------------------------------------------------------------
-- Ejecutar MANUALMENTE en el SQL Editor de Supabase. No la corre la app.
-- ⚠️ CORRERLA ANTES DE DESPLEGAR: el despacho a Nacional escribe la columna
--    `despachos.direccion`; si no existe, el INSERT del despacho FALLA.
--
-- ── QUÉ RESUELVE ────────────────────────────────────────────────────────────
-- Hoy la dirección de un despacho nacional se escribe a mano cada vez. Rafa
-- quiere elegirla de una lista guardada por código ("no estar mete y mete
-- dirección"), y que un mismo código pueda tener VARIOS puntos de entrega.
--
-- ── POR QUÉ DOS COSAS Y NO UNA ──────────────────────────────────────────────
--   1. `direcciones_nacional` = el CATÁLOGO: qué direcciones conoce cada código.
--      Es lo que alimenta la lista desplegable al despachar.
--   2. `despachos.direccion` = el TEXTO que se usó en ESE despacho.
--
-- Se guarda el texto y NO una llave al catálogo, a propósito:
--   · Si mañana se corrige o se borra una dirección del catálogo, el documento
--     de un despacho viejo debe seguir diciendo lo que decía ese día.
--   · El archivado mueve las filas a `despachos_archivo` a los 15 días; con el
--     texto adentro, el histórico se explica solo, sin depender del catálogo.
-- ============================================================================

-- ── PASO 1: catálogo de direcciones por código ──────────────────────────────
CREATE TABLE IF NOT EXISTS direcciones_nacional (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo     TEXT NOT NULL,   -- codigo_cliente, TEXT como en el resto del sistema
  direccion  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Varias direcciones por código SÍ; la misma dos veces NO.
CREATE UNIQUE INDEX IF NOT EXISTS direcciones_nacional_uk
  ON direcciones_nacional (codigo, direccion);

-- Búsqueda por código (la que hace el desplegable al despachar).
CREATE INDEX IF NOT EXISTS direcciones_nacional_codigo_idx
  ON direcciones_nacional (codigo);

ALTER TABLE direcciones_nacional ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS direcciones_nacional_auth ON direcciones_nacional;
CREATE POLICY direcciones_nacional_auth ON direcciones_nacional
  FOR ALL USING (auth.role() = 'authenticated');

-- ── PASO 2: la dirección usada en cada despacho ─────────────────────────────
-- Nullable: solo la llevan los despachos a 'Nacional'; el resto queda en NULL.
ALTER TABLE despachos
  ADD COLUMN IF NOT EXISTS direccion TEXT;

-- ── PASO 3: que el archivado no la pierda ───────────────────────────────────
-- Mismo criterio que migracion_despachos_archivo.sql: la tabla histórica tiene
-- que tener la misma forma que `despachos`, si no el archivado borra el dato.
ALTER TABLE despachos_archivo
  ADD COLUMN IF NOT EXISTS direccion TEXT;

-- ── SEMBRAR EL CATÁLOGO (opcional) ──────────────────────────────────────────
-- El catálogo arranca VACÍO: se va llenando solo, porque cada dirección nueva
-- que Rafa escriba al despachar queda guardada para la próxima vez.
-- Si querés precargar las que ya conoce, es un INSERT así:
--
--   INSERT INTO direcciones_nacional (codigo, direccion) VALUES
--     ('123', 'Calle 10 #4-56, Bodega 3'),
--     ('123', 'Carrera 50 #12-34')
--   ON CONFLICT (codigo, direccion) DO NOTHING;

-- ── VERIFICACIÓN (opcional, no modifica nada) ───────────────────────────────
--   SELECT codigo, COUNT(*) AS direcciones
--   FROM direcciones_nacional GROUP BY codigo ORDER BY codigo;
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'despachos' AND column_name = 'direccion';
