-- ============================================================================
-- FECHA DE ENTREGA POR DESPACHO — dos documentos de ruta en una sola jornada
-- ----------------------------------------------------------------------------
-- Ejecutar MANUALMENTE en el SQL Editor de Supabase. No la corre la app.
-- ⚠️ CORRERLA ANTES DE DESPLEGAR: el despacho escribe `despachos.fecha_entrega`
--    y la pantalla hace UPSERT sobre `documentos_ruta` nombrando fecha_entrega en
--    el onConflict; sin las columnas, las dos cosas fallan.
--
-- ── QUÉ RESUELVE ────────────────────────────────────────────────────────────
-- El documento de ruta se armaba por la fecha del DESPACHO, y el día de entrega
-- no se guardaba en ningún lado: se INFERÍA como "despacho + 1" en cuatro lugares
-- distintos (encabezado de la pantalla, línea de fecha del Excel, nombre de hoja y
-- el día de semana del maestro de Cimitarra). Con eso, todo lo despachado en una
-- jornada salía forzosamente en UN solo documento.
--
-- La víspera de festivo rompe esa suposición: en una misma jornada hay que dejar
-- listo lo que se entrega mañana Y lo del día hábil siguiente, y son DOS documentos
-- distintos, cada uno con su carro, su conductor y su placa.
--
-- Con `fecha_entrega` el día de entrega pasa a ser un dato explícito y el documento
-- se agrupa por él. El SELECTOR, en cambio, no está siempre: solo aparece en el tramo
-- previo a un festivo, que es el único momento en que hace falta despachar para dos
-- días distintos. El criterio vive en src/lib/festivos.ts.
--
-- ⚠️ Que el selector esté oculto NO vuelve opcional esta migración: la app escribe
--    `fecha_entrega` en TODOS los despachos, con la entrega normal (despacho + 1)
--    cuando no hay nada que elegir. Las columnas hacen falta el año entero.
--
-- ── COMPATIBILIDAD: NADA CAMBIA SI NO SE ELIGE FECHA ────────────────────────
-- La entrega por defecto sigue siendo despacho + 1. Vive en tres capas, y las tres
-- dan lo mismo:
--   1. El selector de despacho arranca con esa fecha puesta.
--   2. El DEFAULT de la columna, para inserts hechos por fuera de la app.
--   3. Un fallback en la app (src/lib/fechaEntrega.ts): fecha_entrega NULL se lee
--      como fecha_despacho + 1. Es lo que hace que TODO el histórico se siga
--      agrupando y ordenando exactamente igual que antes de esta migración.
-- Por eso el backfill de abajo es opcional en `despachos` (el fallback ya lo cubre)
-- pero NO en `documentos_ruta` (ahí la columna entra en un índice único).
-- ============================================================================

-- ── PASO 1: para qué día se entrega cada despacho ───────────────────────────
-- Nullable a propósito: las filas anteriores a esta migración quedan en NULL y la
-- app las resuelve al default de siempre. El DEFAULT solo aplica a inserts que
-- OMITAN la columna; la app siempre la manda explícita.
--
-- ⚠️ El DEFAULT usa CURRENT_DATE, no `fecha_despacho`: Postgres no permite que el
--    DEFAULT de una columna referencie otra columna de la misma fila. Como todo
--    despacho se registra el día en que ocurre (fecha_despacho = hoy), en la
--    práctica es lo mismo. Un insert manual con una fecha_despacho vieja y sin
--    fecha_entrega sería el único caso donde el DEFAULT no aplica bien; ahí conviene
--    escribir la columna a mano.
ALTER TABLE despachos
  ADD COLUMN IF NOT EXISTS fecha_entrega DATE DEFAULT (CURRENT_DATE + 1);

-- Backfill OPCIONAL del histórico. No hace falta —el fallback de la app ya lo
-- resuelve—, pero deja el dato explícito en la tabla. Es idempotente y no cambia
-- ningún agrupamiento: escribe exactamente lo que la app ya asume.
--   UPDATE despachos
--      SET fecha_entrega = fecha_despacho + 1
--    WHERE fecha_entrega IS NULL;

-- Para traer el documento de un día y partirlo por fecha de entrega.
CREATE INDEX IF NOT EXISTS despachos_fecha_entrega_idx
  ON despachos (fecha_despacho, fecha_entrega);

-- ── PASO 2: que el archivado no la pierda ───────────────────────────────────
-- Mismo criterio que migracion_despachos_archivo.sql y migracion_externo_por_carro.sql:
-- la tabla histórica tiene que tener la misma forma que `despachos`, si no el
-- archivado (cada 15 días, desde la pantalla de Despachos) borra el dato.
-- Sin DEFAULT acá: es una tabla histórica, copia lo que venga, incluido NULL.
ALTER TABLE despachos_archivo
  ADD COLUMN IF NOT EXISTS fecha_entrega DATE;

-- ── PASO 3: un encabezado por DOCUMENTO, no por jornada ─────────────────────
-- `documentos_ruta` guarda conductor/auxiliar/placa/hora/observación con
-- UNIQUE (fecha, ruta, carro_id), donde `fecha` es la de DESPACHO y carro_id es ''
-- en las rutas con nombre.
--
-- Externo ya estaba cubierto: cada acto de despacho genera su propio carro_id, así
-- que dos carros externos de días de entrega distintos ya tenían encabezados
-- separados. Las rutas con NOMBRE no: dos Cimitarra de la misma jornada (una para
-- mañana, otra para pasado) caían en la MISMA fila y compartían conductor y placa.
-- Son dos camiones distintos, así que la fecha de entrega entra en la clave.
ALTER TABLE documentos_ruta
  ADD COLUMN IF NOT EXISTS fecha_entrega DATE;

-- Backfill OBLIGATORIO (a diferencia de `despachos`): la columna entra en el índice
-- único de más abajo y el UPSERT de la app compara por igualdad, así que un NULL
-- dejaría esas filas inalcanzables. `fecha + 1` es exactamente el día que esas filas
-- ya representaban, así que los encabezados históricos siguen apareciendo donde
-- siempre estuvieron.
UPDATE documentos_ruta
   SET fecha_entrega = fecha + 1
 WHERE fecha_entrega IS NULL;

-- NOT NULL después del backfill, por el mismo motivo que carro_id es NOT NULL
-- DEFAULT '': el onConflict del UPSERT nombra columnas planas y no puede usar
-- COALESCE. Sin NOT NULL, una fila con NULL nunca haría match y se duplicaría.
ALTER TABLE documentos_ruta
  ALTER COLUMN fecha_entrega SET NOT NULL;

-- Se reemplaza el UNIQUE (fecha, ruta, carro_id) por
--              UNIQUE (fecha, ruta, carro_id, fecha_entrega).
-- El DO encuentra el constraint viejo sea cual sea su nombre (mismo patrón que
-- migracion_externo_por_carro.sql).
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
  DROP CONSTRAINT IF EXISTS documentos_ruta_fecha_ruta_carro_entrega_uk;
ALTER TABLE documentos_ruta
  ADD CONSTRAINT documentos_ruta_fecha_ruta_carro_entrega_uk
  UNIQUE (fecha, ruta, carro_id, fecha_entrega);

-- ── VERIFICACIÓN (opcional, no modifica nada) ───────────────────────────────
--   -- Las tres columnas nuevas:
--   SELECT table_name, column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE column_name = 'fecha_entrega'
--     AND table_name IN ('despachos','despachos_archivo','documentos_ruta')
--   ORDER BY table_name;
--   -- despachos          -> date, YES, (CURRENT_DATE + 1)
--   -- despachos_archivo  -> date, YES, (sin default)
--   -- documentos_ruta    -> date, NO,  (sin default)
--
--   -- El UNIQUE nuevo:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'documentos_ruta'::regclass AND contype = 'u';
--   -- debe quedar UNIQUE (fecha, ruta, carro_id, fecha_entrega)
--
--   -- Ninguna fila de encabezado quedó sin día:
--   SELECT COUNT(*) FROM documentos_ruta WHERE fecha_entrega IS NULL;  -- 0
--
--   -- Jornadas que produjeron MÁS DE UN documento (antes de esta migración: ninguna):
--   SELECT fecha_despacho, COUNT(DISTINCT COALESCE(fecha_entrega, fecha_despacho + 1)) AS entregas
--   FROM despachos GROUP BY fecha_despacho HAVING COUNT(DISTINCT COALESCE(fecha_entrega, fecha_despacho + 1)) > 1
--   ORDER BY fecha_despacho DESC;

-- ── NOTA sobre Cimitarra ────────────────────────────────────────────────────
-- El maestro `secuencia_entrega` NO se toca. Sus filas de Cimitarra siguen con
-- dia = 'LUNES'/'JUEVES', que siempre fueron días de ENTREGA. Lo único que cambia
-- es de dónde sale ese día en la app: antes lo deducía de fecha_despacho + 1, ahora
-- lo lee de fecha_entrega. Para un despacho que no elige fecha el resultado es
-- idéntico (entrega = despacho + 1), y para uno que sí elige deja de mentir: antes,
-- despachar un martes para el jueves daba MIÉRCOLES y no encontraba el maestro.
