-- ============================================================================
-- REVERTIR EN MASA LOS DESPACHOS DEL CÓDIGO 520 (carga errónea)
-- ----------------------------------------------------------------------------
-- Rafa cargó por error ~5000 despachos del código 520 (fecha_despacho entre
-- 2026-08-08 y 2026-08-15). Hay que deshacerlos TODOS, sin tocar despachos
-- legítimos de otros códigos.
--
--   * "Resetear" NO sirve: borra TODO, no solo el 520.
--   * El revert múltiple de Despachos.tsx no alcanza en volumen.
--
-- Este .sql hace EXACTAMENTE lo mismo que revertirUno() (src/pages/Despachos.tsx),
-- pero acotado a codigo_destino = '520'. NO cambia código de la app.
--
-- ── QUÉ HACE revertirUno(), TRADUCIDO A SQL ─────────────────────────────────
-- Por cada despacho:
--   Rama CANAL (tipo_despacho = 'canal'):
--     1. registros_beneficio -> estado = 'activo' y
--        fraccion_despachada = max(0, fraccion_despachada - fraccion_del_despacho).
--        (Solo se resta LA FRACCIÓN de este despacho: si el animal salió en dos
--         mitades y se revierte una, la otra sigue despachada -> 1 baja a 0.5.)
--     2. Si el animal es res:
--          - inventario_visceras despachadas del registro -> 'en_inventario',
--            fecha_despacho = NULL.
--          - borrar las filas de víscera de `despachos` de ese registro.
--     3. borrar la fila de `despachos` del canal.
--   Rama VÍSCERA (tipo_despacho = 'viscera'):
--     1. la víscera de ese despacho -> 'en_inventario', fecha_despacho = NULL.
--        (Por viscera_id; y fallback legacy por registro_id si no hay viscera_id.)
--     2. borrar la fila de `despachos` de la víscera.
--
-- ── ORDEN (respeta las dependencias FK) ─────────────────────────────────────
-- Primero los UPDATE (registros_beneficio, inventario_visceras) que se calculan
-- LEYENDO las filas de `despachos`, y RECIÉN AL FINAL el DELETE de `despachos`.
-- Si se borrara primero, ya no se sabría qué revertir.
--
-- ── ACOTAMIENTO ─────────────────────────────────────────────────────────────
-- Filtro base:  codigo_destino = '520'
-- Cuando se despacha canal + vísceras, las vísceras HEREDAN el codigo_destino
-- del canal (ver Beneficios.tsx), así que TODO lo del 520 (canal y víscera)
-- cae bajo este único filtro.
--
-- Rango de fecha OPCIONAL (2026-08-08 a 2026-08-15): descomentar la línea
-- `AND fecha_despacho BETWEEN ...` SOLO si existieran despachos legítimos del
-- 520 en otras fechas que NO haya que tocar. Si se activa, activarlo en TODOS
-- los lugares marcados con >>> RANGO OPCIONAL <<< (verificación y snapshot).
--
-- ⚠️  DESVIACIÓN DELIBERADA, SEGURA Y ACOTADA respecto de revertirUno():
--     La rama canal-res de la función borra las filas de víscera del `despachos`
--     por registro_id SIN filtrar por código. Acá, para NO tocar despachos de
--     OTROS códigos, se borra solo lo que es del 520. En los datos de esta carga
--     es idéntico (las vísceras heredan el 520 del canal), pero es más seguro.
--
-- ⚠️  Ejecutar MANUALMENTE en el SQL Editor de Supabase. La app NO lo corre.
-- ============================================================================


-- ============================================================================
-- PASO 0 — CORRER ESTO PRIMERO (está TODO comentado a propósito).
--   Descomentá y ejecutá SOLO este bloque para ver cuántas filas hay HOY en
--   cada tabla afectada y confirmar el número ANTES de tocar nada.
--   Si activás el rango de fecha, descomentá también las líneas de BETWEEN.
-- ----------------------------------------------------------------------------
-- SELECT 'despachos 520 (todos)'            AS tabla, COUNT(*) AS filas
--   FROM despachos
--   WHERE codigo_destino = '520'
--     -- >>> RANGO OPCIONAL <<<  AND fecha_despacho BETWEEN '2026-08-08' AND '2026-08-15'
-- UNION ALL
-- SELECT 'despachos 520 canal',              COUNT(*)
--   FROM despachos
--   WHERE codigo_destino = '520' AND tipo_despacho = 'canal'
--     -- >>> RANGO OPCIONAL <<<  AND fecha_despacho BETWEEN '2026-08-08' AND '2026-08-15'
-- UNION ALL
-- SELECT 'despachos 520 viscera',            COUNT(*)
--   FROM despachos
--   WHERE codigo_destino = '520' AND tipo_despacho = 'viscera'
--     -- >>> RANGO OPCIONAL <<<  AND fecha_despacho BETWEEN '2026-08-08' AND '2026-08-15'
-- UNION ALL
-- SELECT 'registros_beneficio a reactivar',  COUNT(DISTINCT registro_id)
--   FROM despachos
--   WHERE codigo_destino = '520' AND tipo_despacho = 'canal'
--     -- >>> RANGO OPCIONAL <<<  AND fecha_despacho BETWEEN '2026-08-08' AND '2026-08-15'
-- ;


-- ============================================================================
-- PASO 1 — SELECT DE VERIFICACIÓN (esto SÍ se ejecuta; no muta nada).
--   Muestra, por tabla, cuántas filas va a TOCAR el bloque transaccional de
--   abajo. Revisá que los números cuadren con lo esperado antes de seguir.
--   El filtro es EL MISMO que usa el snapshot del PASO 2. Si cambiás el rango
--   acá, cambialo también allá.
-- ----------------------------------------------------------------------------
WITH objetivo AS (
  SELECT id, registro_id, viscera_id, tipo_despacho, fraccion
  FROM despachos
  WHERE codigo_destino = '520'
    -- >>> RANGO OPCIONAL <<<  AND fecha_despacho BETWEEN '2026-08-08' AND '2026-08-15'
)
SELECT 'despachos a BORRAR' AS accion, COUNT(*) AS filas
  FROM objetivo
UNION ALL
SELECT 'registros_beneficio a REACTIVAR (estado=activo, resta fraccion)',
       COUNT(DISTINCT registro_id)
  FROM objetivo
  WHERE tipo_despacho = 'canal'
UNION ALL
SELECT 'inventario_visceras a DEVOLVER — heredadas de canal res',
       COUNT(*)
  FROM inventario_visceras v
  WHERE v.estado = 'despachada'
    AND v.registro_id IN (
      SELECT o.registro_id FROM objetivo o
      JOIN registros_beneficio r ON r.id = o.registro_id
      WHERE o.tipo_despacho = 'canal' AND r.tipo_carne = 'res'
    )
UNION ALL
SELECT 'inventario_visceras a DEVOLVER — despacho de víscera (por viscera_id)',
       COUNT(*)
  FROM inventario_visceras v
  WHERE v.id IN (
      SELECT o.viscera_id FROM objetivo o
      WHERE o.tipo_despacho = 'viscera' AND o.viscera_id IS NOT NULL
    )
UNION ALL
SELECT 'inventario_visceras a DEVOLVER — despacho de víscera legacy (sin viscera_id)',
       COUNT(*)
  FROM inventario_visceras v
  WHERE v.estado = 'despachada'
    AND v.registro_id IN (
      SELECT o.registro_id FROM objetivo o
      WHERE o.tipo_despacho = 'viscera' AND o.viscera_id IS NULL
    )
;


-- ============================================================================
-- PASO 2 — BLOQUE TRANSACCIONAL. Todo o nada: si algo falla, ROLLBACK y no
--   queda nada a medias. Ejecutar el bloque completo (BEGIN … COMMIT).
-- ----------------------------------------------------------------------------
BEGIN;

-- Snapshot único de los despachos objetivo. TODO lo que sigue (updates y delete)
-- deriva de esta tabla, así operan exactamente sobre el mismo conjunto de filas.
-- El filtro tiene que ser IDÉNTICO al del PASO 1.
CREATE TEMP TABLE _revert_520 ON COMMIT DROP AS
SELECT id, registro_id, viscera_id, tipo_despacho, fraccion
FROM despachos
WHERE codigo_destino = '520'
  -- >>> RANGO OPCIONAL <<<  AND fecha_despacho BETWEEN '2026-08-08' AND '2026-08-15'
;

-- ── revertirUno(), rama CANAL · paso 1 ──────────────────────────────────────
-- registros_beneficio -> estado='activo' y se resta la fracción despachada.
-- En serie, la función lee fraccion_despachada FRESCA y resta la fracción de
-- cada despacho una por una; en conjunto es lo mismo que restar la SUMA de las
-- fracciones de los canales 520 de ese registro (con tope inferior 0). Ej.: dos
-- mitades 0.5 del mismo animal -> 1 − (0.5+0.5) = 0.
UPDATE registros_beneficio r
SET estado = 'activo',
    fraccion_despachada = GREATEST(0, r.fraccion_despachada - agg.total_revertir)
FROM (
  SELECT registro_id, SUM(COALESCE(fraccion, 1)) AS total_revertir
  FROM _revert_520
  WHERE tipo_despacho = 'canal'
  GROUP BY registro_id
) agg
WHERE r.id = agg.registro_id;

-- ── revertirUno(), rama CANAL · paso 2 (solo res) ───────────────────────────
-- Devolver las vísceras despachadas del animal a inventario. Igual que la
-- función: por registro_id de los canales 520 cuyo animal es res.
UPDATE inventario_visceras v
SET estado = 'en_inventario',
    fecha_despacho = NULL
WHERE v.estado = 'despachada'
  AND v.registro_id IN (
    SELECT d.registro_id
    FROM _revert_520 d
    JOIN registros_beneficio r ON r.id = d.registro_id
    WHERE d.tipo_despacho = 'canal' AND r.tipo_carne = 'res'
  );

-- ── revertirUno(), rama VÍSCERA · paso 1 (caso normal, con viscera_id) ───────
-- Despachos de víscera del 520 que NO se heredan de un canal (víscera suelta):
-- devolver EXACTAMENTE esa víscera por su id.
UPDATE inventario_visceras v
SET estado = 'en_inventario',
    fecha_despacho = NULL
WHERE v.id IN (
    SELECT d.viscera_id
    FROM _revert_520 d
    WHERE d.tipo_despacho = 'viscera' AND d.viscera_id IS NOT NULL
  );

-- ── revertirUno(), rama VÍSCERA · paso 1 (fallback legacy, sin viscera_id) ───
-- Despachos de víscera viejos (previos a la migración de viscera_id): devolver
-- las despachadas del registro, igual que el fallback de la función.
UPDATE inventario_visceras v
SET estado = 'en_inventario',
    fecha_despacho = NULL
WHERE v.estado = 'despachada'
  AND v.registro_id IN (
    SELECT d.registro_id
    FROM _revert_520 d
    WHERE d.tipo_despacho = 'viscera' AND d.viscera_id IS NULL
  );

-- ── revertirUno() · paso final: borrar los despachos ────────────────────────
-- Borra los canales Y las vísceras del 520 en un solo golpe (todos están en el
-- snapshot). Acotado al 520: NO borra despachos de otros códigos aunque
-- compartan registro_id (única desviación segura respecto de la función; ver
-- cabecera). Se hace AL FINAL para no perder los datos que usan los UPDATE.
DELETE FROM despachos
WHERE id IN (SELECT id FROM _revert_520);

COMMIT;

-- ============================================================================
-- (Opcional) VERIFICACIÓN POSTERIOR — correr después del COMMIT.
--   Debería devolver 0 en todo.
-- ----------------------------------------------------------------------------
-- SELECT 'despachos 520 restantes' AS chequeo, COUNT(*) AS filas
--   FROM despachos WHERE codigo_destino = '520'
--     -- >>> RANGO OPCIONAL <<<  AND fecha_despacho BETWEEN '2026-08-08' AND '2026-08-15'
-- ;
-- ============================================================================
