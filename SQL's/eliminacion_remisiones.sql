-- ============================================================================
-- REMISIONES: eliminación definitiva
-- ----------------------------------------------------------------------------
-- Ejecutar MANUALMENTE en el SQL Editor de Supabase. No la corre la app.
--
-- ── QUÉ RESUELVE ────────────────────────────────────────────────────────────
-- Decisión externa a Rafa: se retira toda la funcionalidad de Remisiones
-- (pantalla, impresión, lib y estas dos tablas). No es una corrección de un
-- requisito mal planteado — la sección completa deja de existir.
--
-- migracion_remisiones.sql y migracion_remision_cedula.sql NO se tocan: quedan
-- como registro histórico de cómo se creó lo que este script borra.
--
-- Orden por FK: `remisiones_filas` referencia a `remisiones` (ON DELETE
-- CASCADE), así que borrar el encabezado primero también se llevaría las
-- filas solo — igual se listan las dos DROP explícitas y en el orden correcto
-- (filas antes que encabezado) para que el script sea autoexplicativo y no
-- dependa de que el CASCADE siga ahí.
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS remisiones_filas;
DROP TABLE IF EXISTS remisiones;

COMMIT;

-- ── VERIFICACIÓN (opcional, no modifica nada) ───────────────────────────────
--   SELECT table_name FROM information_schema.tables
--   WHERE table_name IN ('remisiones', 'remisiones_filas');
--   -- Esperado: 0 filas.
