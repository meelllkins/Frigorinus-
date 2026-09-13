-- ============================================================================
-- REMISIONES: cédula del conductor
-- ----------------------------------------------------------------------------
-- Ejecutar MANUALMENTE en el SQL Editor de Supabase. No la corre la app.
--
-- ⚠️ CORRERLA ANTES DE PROBAR R2.1: la pantalla escribe `remisiones.cedula` al
--    crear y al actualizar. Sin la columna, PostgREST responde PGRST204 ("no
--    existe la columna") y el guardado de la remisión falla entero.
--
-- ── QUÉ RESUELVE ────────────────────────────────────────────────────────────
-- El papel tiene, debajo de la fecha, la fila "Conductor | Cédula | Placa
-- vehículo". La cédula faltaba: R1 creó la tabla con conductor y placa nada más.
--
-- ── POR QUÉ TEXT Y NULLABLE ─────────────────────────────────────────────────
-- TEXT como el resto de los campos del formulario: en el papel es un renglón
-- que se llena a mano y puede traer puntos, espacios o quedar vacío. Nunca se
-- opera con él, así que no hay motivo para un tipo numérico — y uno numérico
-- perdería los ceros a la izquierda, igual que pasó con las rayas del documento
-- de ruta.
--
-- Nullable y sin DEFAULT: las remisiones que ya existen no tienen el dato y
-- quedan en NULL, que es la verdad. La pantalla las abre con el campo vacío.
-- ============================================================================

ALTER TABLE remisiones
  ADD COLUMN IF NOT EXISTS cedula TEXT;

-- ── VERIFICACIÓN (opcional, no modifica nada) ───────────────────────────────
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'remisiones'
--   ORDER BY ordinal_position;
--   -- `cedula` debe aparecer como text / YES.
