-- ============================================================================
-- Migración: alinear `despachos_archivo` con `despachos`
-- ----------------------------------------------------------------------------
-- Problema: cada 15 días el archivado mueve las filas de `despachos` a
-- `despachos_archivo`, pero esta tabla NO tiene las columnas de ruta, así que
-- al archivar se pierden ruta, cabeza, patas, codigo_destino, es_desposte y el
-- viscera_id (roja/blanca). Esta migración agrega esas columnas.
--
-- Ejecutar MANUALMENTE en el SQL Editor de Supabase. No la corre la app.
--
-- Notas de diseño:
--   * Todas nullable salvo es_desposte (BOOLEAN NOT NULL DEFAULT FALSE).
--   * viscera_id es UUID SIN llave foránea a inventario_visceras: la víscera
--     original puede borrarse después (reset, eliminación) y no queremos que
--     eso bloquee el archivado ni deje huérfanos que fallen.
--   * ruta es TEXT SIN CHECK de la lista de rutas: es tabla histórica y debe
--     aceptar cualquier nombre que haya existido, incluso si algún día se
--     quita una ruta de la lista actual.
--   * `tipo_despacho` NO se agrega: ya existe en despachos_archivo (el
--     archivado actual ya lo inserta).
-- ============================================================================

ALTER TABLE despachos_archivo
  ADD COLUMN IF NOT EXISTS viscera_id     UUID,
  ADD COLUMN IF NOT EXISTS ruta           TEXT,
  ADD COLUMN IF NOT EXISTS cabeza         INTEGER,
  ADD COLUMN IF NOT EXISTS patas          INTEGER,
  ADD COLUMN IF NOT EXISTS codigo_destino TEXT,
  ADD COLUMN IF NOT EXISTS es_desposte    BOOLEAN NOT NULL DEFAULT FALSE;
