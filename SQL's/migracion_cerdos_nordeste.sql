-- ============================================================================
-- Ruta 'CERDOS NORDESTE': habilitarla en el CHECK de `despachos.ruta`
-- ----------------------------------------------------------------------------
-- Ejecutar MANUALMENTE en el SQL Editor de Supabase. No la corre la app.
--
-- ⚠️ CORRERLA **ANTES** DE DESPLEGAR. La ruta ya está en src/lib/rutas.ts, así que
--    apenas se despliegue aparece en el desplegable de despacho de PORCINOS; si el
--    CHECK de `despachos.ruta` no la acepta todavía, el INSERT del despacho FALLA
--    con "violates check constraint" y Rafa no puede despachar por esa ruta.
--
-- ── QUÉ HACE Y QUÉ NO ───────────────────────────────────────────────────────
-- Solo habilita el valor. NO carga maestro de secuencia (`secuencia_entrega`): la
-- ruta no ordena por ahora, igual que Puerto Berrío o Don Matías, así que su hoja
-- del documento sale en el orden de siempre (por código). Si más adelante hay que
-- darle secuencia, es otro .sql más una línea en RUTAS_CON_SECUENCIA.
--
-- ── ES SEGURA DE CORRER SIEMPRE ─────────────────────────────────────────────
-- Recrea el CHECK completo, así que es idempotente: correrla dos veces deja lo
-- mismo. No toca ninguna fila de `despachos`.
-- ============================================================================

-- ── PASO 0: mirá primero qué CHECK existe hoy (informativo, no modifica nada) ─
--   SELECT c.conname, pg_get_constraintdef(c.oid) AS definicion
--   FROM pg_constraint c
--   JOIN pg_class t ON t.oid = c.conrelid
--   WHERE c.contype = 'c' AND t.relname = 'despachos'
--     AND pg_get_constraintdef(c.oid) ILIKE '%ruta%';

-- ── PASO 1: quitar el CHECK viejo de `ruta` (cualquiera sea su nombre) ───────
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

-- ── PASO 2: recrearlo con la lista COMPLETA, ahora de 14 rutas ──────────────
-- Estos valores deben coincidir EXACTO (acentos, mayúsculas, "/") con RUTAS en
-- src/lib/rutas.ts. 'CERDOS NORDESTE' va en MAYÚSCULAS a propósito: es como lo
-- escribió Rafa y es el texto que se guarda y se imprime en el documento.
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
      'CERDOS NORDESTE',
      'Externo'
    )
  );

-- ── NOTA sobre `despachos_archivo` ──────────────────────────────────────────
-- No se toca: es tabla histórica y su columna `ruta` es TEXT SIN CHECK, a
-- propósito, para que acepte cualquier nombre que haya existido alguna vez
-- (ver migracion_despachos_archivo.sql). El archivado de esta ruta funciona sin
-- cambios.

-- ── VERIFICACIÓN (opcional, no modifica nada) ───────────────────────────────
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'despachos'::regclass AND contype = 'c';
--   -- debe listar las 14 rutas, incluida 'CERDOS NORDESTE'.
