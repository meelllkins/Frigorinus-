-- ============================================================================
-- Migración: agregar la ruta 'Cisneros/San Roque' al CHECK de `despachos.ruta`
-- ----------------------------------------------------------------------------
-- La lista de rutas vive en el frontend (src/lib/rutas.ts), NO en una tabla.
-- Pero `despachos.ruta` tiene un CHECK con los valores permitidos: si se agrega
-- la ruta solo en el frontend, el dropdown la muestra y el INSERT del despacho
-- FALLA con "violates check constraint".
--
-- Ejecutar MANUALMENTE en el SQL Editor de Supabase. No la corre la app.
-- Los valores deben coincidir EXACTO (acentos, mayúsculas, "/") con RUTAS.
-- ============================================================================

-- ── PASO 0: mirá primero qué CHECK existe hoy (informativo, no modifica nada) ──
-- Corré esto solo y revisá el nombre y la definición antes de seguir:
--
--   SELECT c.conname, pg_get_constraintdef(c.oid) AS definicion
--   FROM pg_constraint c
--   JOIN pg_class t ON t.oid = c.conrelid
--   WHERE c.contype = 'c' AND t.relname = 'despachos'
--     AND pg_get_constraintdef(c.oid) ILIKE '%ruta%';

-- ── PASO 1: quitar el CHECK viejo de `ruta` (cualquiera sea su nombre) ────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.contype = 'c'
      AND t.relname = 'despachos'
      AND pg_get_constraintdef(c.oid) ILIKE '%ruta%'
  LOOP
    EXECUTE format('ALTER TABLE despachos DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE 'CHECK eliminado: %', r.conname;
  END LOOP;
END $$;

-- ── PASO 2: volver a crearlo con la lista completa (11 rutas + la nueva) ──────
-- `ruta IS NULL` se permite: hay despachos viejos sin ruta asignada y no
-- queremos que la migración falle por ellos.
ALTER TABLE despachos
  ADD CONSTRAINT despachos_ruta_check CHECK (
    ruta IS NULL OR ruta IN (
      'Remedios/Segovia',
      'San José/Maceo',
      'Yolombó',
      'Cimitarra',
      'Don Matías',
      'Yalí/Vegachí',
      'Nacional',
      'Barbosa',
      'Puerto Berrío',
      'Caracolí/Cristales',
      'Cisneros/San Roque',
      'Externo'
    )
  );

-- ── NOTA sobre `documentos_ruta` ─────────────────────────────────────────────
-- Si esa tabla también tiene un CHECK sobre su columna `ruta`, hay que repetir
-- lo mismo ahí, o al guardar conductor/placa de Cisneros/San Roque va a fallar.
-- Verificalo con:
--
--   SELECT c.conname, pg_get_constraintdef(c.oid)
--   FROM pg_constraint c
--   JOIN pg_class t ON t.oid = c.conrelid
--   WHERE c.contype = 'c' AND t.relname = 'documentos_ruta';
--
-- (Si no devuelve ninguna fila con 'ruta', no hay nada que hacer.)
