-- ============================================================================
-- CARROS EXTERNOS: identificador propio + datos manuales por carro
-- ----------------------------------------------------------------------------
-- Ejecutar MANUALMENTE en el SQL Editor de Supabase. No la corre la app.
-- ⚠️ CORRERLA ANTES DE DESPLEGAR: el despacho a Externo escribe `despachos.carro_id`
--    y la pantalla guarda `documentos_ruta.carro_id`; sin las columnas, falla.
--
-- ── QUÉ RESUELVE ────────────────────────────────────────────────────────────
-- 'Externo' no es una ruta: cada acto de despachar a Externo es un carro propio.
-- Hasta ahora el carro se INFERÍA por `created_at` (todas las filas insertadas en
-- la misma sentencia comparten esa marca), y los datos manuales
-- (conductor/auxiliar/placa/hora/observación) se guardaban por (fecha, ruta), así
-- que TODOS los carros externos de un día compartían conductor y placa.
--
-- Con esto cada carro tiene su identificador y sus propios datos manuales.
--
-- ── POR QUÉ carro_id ES UUID EN UNA TABLA Y TEXT EN LA OTRA ─────────────────
--   · `despachos.carro_id`        -> UUID. Lo genera el frontend (crypto.randomUUID)
--     una vez por acto de despacho y lo escribe en TODAS las filas de ese despacho
--     (el canal y las vísceras que viajan con él). NULL en rutas con nombre y en
--     los despachos viejos.
--
--   · `documentos_ruta.carro_id`  -> TEXT. Acá NO alcanza con UUID: los carros
--     VIEJOS (los que no tienen carro_id) se siguen identificando por el valor
--     inferido —una marca de tiempo, no un UUID—, y Rafa tiene que poder cargarles
--     conductor y placa igual. TEXT acepta las dos formas.
--
-- ── POR QUÉ NOT NULL DEFAULT '' Y NO NULL ───────────────────────────────────
-- La app guarda los datos manuales con un UPSERT que necesita nombrar las columnas
-- del índice único (onConflict). Un índice con COALESCE(carro_id,'') no se puede
-- nombrar así. Con NOT NULL DEFAULT '' el UNIQUE es (fecha, ruta, carro_id) plano:
-- las rutas con nombre usan '' y se comportan igual que antes (una fila por
-- fecha+ruta), y cada carro externo usa su identificador.
-- ============================================================================

-- ── PASO 1: identificador de carro en los despachos ─────────────────────────
-- Nullable a propósito: las rutas con nombre no lo usan y los despachos históricos
-- quedan en NULL (el documento sigue infiriendo el carro por created_at).
ALTER TABLE despachos
  ADD COLUMN IF NOT EXISTS carro_id UUID;

-- Para agrupar rápido por carro dentro de un día.
CREATE INDEX IF NOT EXISTS despachos_carro_id_idx
  ON despachos (fecha_despacho, carro_id)
  WHERE carro_id IS NOT NULL;

-- ── PASO 2: que el archivado no lo pierda ───────────────────────────────────
-- Mismo criterio que migracion_despachos_archivo.sql: la tabla histórica tiene que
-- tener la misma forma que `despachos`, si no el archivado borra el dato.
ALTER TABLE despachos_archivo
  ADD COLUMN IF NOT EXISTS carro_id UUID;

-- ── PASO 3: datos manuales POR CARRO ────────────────────────────────────────
-- '' = "no es un carro externo" (rutas con nombre). Ver la explicación de arriba.
ALTER TABLE documentos_ruta
  ADD COLUMN IF NOT EXISTS carro_id TEXT NOT NULL DEFAULT '';

-- Se reemplaza el UNIQUE(fecha, ruta) por UNIQUE(fecha, ruta, carro_id).
-- El DO encuentra el constraint viejo sea cual sea su nombre.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.contype = 'u'
      AND t.relname = 'documentos_ruta'
  LOOP
    EXECUTE format('ALTER TABLE documentos_ruta DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE 'UNIQUE eliminado: %', r.conname;
  END LOOP;
END $$;

ALTER TABLE documentos_ruta
  DROP CONSTRAINT IF EXISTS documentos_ruta_fecha_ruta_carro_uk;
ALTER TABLE documentos_ruta
  ADD CONSTRAINT documentos_ruta_fecha_ruta_carro_uk UNIQUE (fecha, ruta, carro_id);

-- ── VERIFICACIÓN (opcional, no modifica nada) ───────────────────────────────
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'documentos_ruta'::regclass AND contype = 'u';
--   -- debe quedar UNIQUE (fecha, ruta, carro_id)
--
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_name IN ('despachos','documentos_ruta') AND column_name = 'carro_id';

-- ── NOTA sobre los datos que ya existen ─────────────────────────────────────
-- Las filas actuales de documentos_ruta quedan con carro_id = '' por el DEFAULT,
-- que es exactamente lo que corresponde para las rutas con nombre. Si había datos
-- manuales cargados para 'Externo', quedan en la fila con carro_id = '' y ya no se
-- van a mostrar en ningún carro (cada carro busca por su propio identificador).
-- Es un solo día de datos manuales de Externo; si hiciera falta rescatarlos:
--   SELECT * FROM documentos_ruta WHERE ruta = 'Externo' AND carro_id = '';
