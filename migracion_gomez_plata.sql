-- ============================================================================
-- Ruta 'Gómez Plata': habilitarla para despachos + cargar su maestro de secuencia.
-- ----------------------------------------------------------------------------
-- Ejecutar MANUALMENTE en el SQL Editor de Supabase. No la corre la app.
--
-- ⚠️ CORRERLA **ANTES** DE DESPLEGAR. La ruta ya está en src/lib/rutas.ts, así que
--    apenas se despliegue va a aparecer en el desplegable de despacho; si el CHECK
--    de `despachos.ruta` no la acepta todavía, el INSERT del despacho FALLA con
--    "violates check constraint".
--
-- ── ES SEGURA DE CORRER SIEMPRE ─────────────────────────────────────────────
-- No importa si ya corriste migracion_secuencia_entrega.sql o no: este archivo
-- solo toca la ruta 'Gómez Plata' (borra sus filas y las vuelve a insertar), así
-- que se puede correr las veces que haga falta sin duplicar ni pisar las demás
-- rutas. Por eso va aparte y no como edición del .sql original.
-- ============================================================================

-- ── PASO 1: que el CHECK de despachos.ruta acepte la ruta nueva ──────────────
-- Mismo procedimiento que migracion_ruta_cisneros.sql: se elimina el CHECK actual
-- (sea cual sea su nombre) y se recrea con la lista COMPLETA de rutas.
-- Estos 13 valores deben coincidir EXACTO con RUTAS en src/lib/rutas.ts.
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
      'Gómez Plata',
      'Externo'
    )
  );

-- ── PASO 2: maestro de secuencia de Gómez Plata ─────────────────────────────
-- 5 códigos, extraídos de la hoja "GOMEZ PLATA" del Excel de Rafa (no escritos a
-- mano). dia = NULL porque esa hoja no tiene columna DIA: el orden vale para
-- cualquier día. (En Hoja1 figura como despacho de MARTES, pero eso es el día en
-- que sale la ruta, no un orden distinto por día como sí tiene Cimitarra.)
DELETE FROM secuencia_entrega WHERE ruta = 'Gómez Plata';

INSERT INTO secuencia_entrega (ruta, ciudad, dia, codigo, secuencia) VALUES
  ('Gómez Plata', 'GOMEZ PLATA', NULL, '610', 1),
  ('Gómez Plata', 'GOMEZ PLATA', NULL, '192', 2),
  ('Gómez Plata', 'GOMEZ PLATA', NULL, '191', 3),
  ('Gómez Plata', 'GOMEZ PLATA', NULL, '193', 4),
  ('Gómez Plata', 'GOMEZ PLATA', NULL, '190', 5);

-- ── A VALIDAR CON RAFA: ¿Gómez Plata reordena? ──────────────────────────────
-- El maestro queda CARGADO, pero la ruta NO está en RUTAS_CON_SECUENCIA
-- (src/lib/secuenciaEntrega.ts), así que hoy su hoja sale SIN reordenar.
-- Se dejó así por consistencia: Puerto Berrío, Cisneros/San Roque y Don Matías
-- también tienen maestro cargado y tampoco reordenan, porque en esas rutas el
-- orden lo define el cliente. Gómez Plata venía en ese mismo grupo.
-- Si Rafa confirma que sí debe ordenarse, es UNA línea: agregar 'Gómez Plata'
-- a RUTAS_CON_SECUENCIA. No hace falta tocar la base.

-- ── VERIFICACIÓN (opcional, no modifica nada) ───────────────────────────────
--   SELECT ruta, dia, COUNT(*) AS codigos, MIN(secuencia), MAX(secuencia)
--   FROM secuencia_entrega GROUP BY ruta, dia ORDER BY ruta, dia;
--   -- 'Gómez Plata' debe dar 5 códigos, secuencias 1..5.
--
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'despachos'::regclass AND contype = 'c';
--   -- debe listar las 13 rutas, incluida 'Gómez Plata'.
