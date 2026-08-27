-- ============================================================================
-- Origen de carga de los registros de beneficio  (OPCIONAL)
-- ============================================================================
--
-- Marca cada fila de `registros_beneficio` según cómo entró:
--   'manual' -> la cargó alguien a mano (formulario individual o lote)
--   'pdf'    -> vino de la carga masiva del "Informe de Sacrificio por Día" del ERP
--
-- ¿PARA QUÉ?
--   Para poder AISLAR una carga masiva después: revisar qué entró de un PDF, o revertir
--   una carga equivocada de un día sin tocar lo que se metió a mano ese mismo día.
--   Sin esta columna las dos cosas quedan mezcladas y solo se distinguen a ojo.
--
-- ¿ES OBLIGATORIO?  NO.
--   La carga por PDF funciona igual sin correr esto: si la columna no existe, PostgREST
--   responde PGRST204 y src/lib/sacrificioPdf.ts reintenta el INSERT sin ese campo.
--   Correrlo solo agrega la trazabilidad.
--
-- Es idempotente: se puede correr dos veces sin romper nada.
-- ============================================================================

-- 1) La columna. DEFAULT 'manual' para que las filas viejas y las cargas a mano
--    (que no mandan el campo) queden bien marcadas sin tocar el código existente.
ALTER TABLE registros_beneficio
  ADD COLUMN IF NOT EXISTS origen_carga TEXT NOT NULL DEFAULT 'manual';

-- 2) Solo los dos valores válidos. Se dropea primero para poder recorrer el script de nuevo.
ALTER TABLE registros_beneficio
  DROP CONSTRAINT IF EXISTS registros_beneficio_origen_carga_check;
ALTER TABLE registros_beneficio
  ADD CONSTRAINT registros_beneficio_origen_carga_check
  CHECK (origen_carga IN ('manual', 'pdf'));

-- 3) Índice para filtrar/revertir una carga puntual: (origen, fecha) es como se va a buscar
--    siempre ("todo lo que entró por PDF con fecha X").
CREATE INDEX IF NOT EXISTS idx_registros_beneficio_origen_fecha
  ON registros_beneficio (origen_carga, fecha_beneficio);


-- ============================================================================
-- VERIFICACIÓN (correr aparte, después)
-- ============================================================================
-- SELECT origen_carga, COUNT(*)
--   FROM registros_beneficio
--  GROUP BY origen_carga;


-- ============================================================================
-- REVERTIR UNA CARGA MASIVA  (correr a mano, con la fecha puesta)
-- ============================================================================
-- OJO con el ORDEN por las claves foráneas: despachos -> inventario_visceras ->
-- registros_beneficio. Si un animal de esa carga YA SE DESPACHÓ, esto también borra su
-- despacho: revisar el SELECT de control antes de borrar nada.
--
-- -- Control: qué se va a borrar
-- SELECT codigo_cliente, numero_animal, estado
--   FROM registros_beneficio
--  WHERE origen_carga = 'pdf' AND fecha_beneficio = '2026-08-22';
--
-- WITH objetivo AS (
--   SELECT id FROM registros_beneficio
--    WHERE origen_carga = 'pdf' AND fecha_beneficio = '2026-08-22'
-- )
-- DELETE FROM despachos WHERE registro_id IN (SELECT id FROM objetivo);
--
-- WITH objetivo AS (
--   SELECT id FROM registros_beneficio
--    WHERE origen_carga = 'pdf' AND fecha_beneficio = '2026-08-22'
-- )
-- DELETE FROM inventario_visceras WHERE registro_id IN (SELECT id FROM objetivo);
--
-- DELETE FROM registros_beneficio
--  WHERE origen_carga = 'pdf' AND fecha_beneficio = '2026-08-22';
