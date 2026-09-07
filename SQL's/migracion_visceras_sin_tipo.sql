-- ============================================================================
-- CORRECCIÓN DE DATOS: vísceras sin tipo cargadas a mano
-- ----------------------------------------------------------------------------
-- Ejecutar MANUALMENTE en el SQL Editor de Supabase. No la corre la app.
-- NO es una migración de esquema: no crea ni altera columnas. Solo repara filas.
--
-- ── QUÉ PASÓ ────────────────────────────────────────────────────────────────
-- El formulario "Registrar víscera manualmente" (Inventario) insertaba UNA sola
-- fila por animal y sin el campo `tipo`, así que quedaba en NULL. Tras un reseteo
-- se cargaron 143 filas así. El formulario ya está corregido (ahora crea roja +
-- blanca); esto limpia lo que quedó de antes.
--
-- Una víscera con tipo NULL no es solo cosmética: el documento de ruta cuenta
-- V/B y V/R comparando el tipo contra 'blanca' y 'roja' exactos, así que esas
-- filas NO suman a ninguna de las dos columnas y disparan un aviso ámbar.
--
-- ── QUÉ TOCA Y QUÉ NO ───────────────────────────────────────────────────────
--   · estado = 'despachada'   -> NO SE TOCAN. Son histórico: ya salieron en
--     documentos emitidos. Cambiarles el tipo o crearles el par movería conteos
--     de documentos que Rafa ya entregó. El UPDATE filtra por estado a propósito.
--   · estado = 'en_inventario' -> a cada una se le pone tipo = 'roja' y se le crea
--     la 'blanca' que falta, para que el animal quede con sus dos vísceras.
--
-- Cuál de las dos era originalmente es INDETERMINABLE: la fila nunca guardó el
-- dato. Lo que importa es que el animal quede con una de cada tipo, que es lo que
-- el resto de la app asume.
--
-- ── POR QUÉ EL UPDATE LLEVA RETURNING ───────────────────────────────────────
-- La 'blanca' hay que crearla SOLO para los animales corregidos acá. Una vez que
-- el UPDATE convierte los NULL en 'roja', ese conjunto ya no se puede volver a
-- identificar (quedan iguales a cualquier roja legítima). Por eso el UPDATE va
-- dentro de un CTE con RETURNING y el INSERT se alimenta de ahí, en el MISMO
-- statement. Sin TEMP TABLE, que el editor de Supabase a veces corre en sesiones
-- distintas y falla con "relation does not exist".
-- ============================================================================

BEGIN;

-- ── PASO 1: control ANTES de tocar nada (solo lectura) ──────────────────────
-- Mirá estos números antes de seguir. Lo esperado, según el conteo previo:
--   en_inventario = 77   ·   despachada = 66   ·   total = 143
-- Si no coinciden, hacé ROLLBACK y avisá antes de continuar.
SELECT
  estado,
  COUNT(*)                        AS filas_sin_tipo,
  COUNT(DISTINCT registro_id)     AS animales
FROM inventario_visceras
WHERE tipo IS NULL
GROUP BY estado
ORDER BY estado;

-- ── PASO 2: NULL -> 'roja' y crear la 'blanca' que falta ────────────────────
-- Un solo statement:
--   · El CTE `corregidas` hace el UPDATE y devuelve los registro_id tocados.
--     El filtro `estado = 'en_inventario'` es EXPLÍCITO: las despachadas quedan
--     fuera pase lo que pase.
--   · El INSERT crea la 'blanca' solo para esos registro_id.
--   · DISTINCT por si algún animal tuviera más de una NULL (no debería, pero así
--     nunca se crean dos blancas para el mismo animal).
--   · NOT EXISTS por si algún animal YA tenía una blanca correcta además de la
--     NULL: en ese caso no se le agrega otra. Lee el snapshot previo al
--     statement, lo cual es correcto acá porque el UPDATE solo escribe 'roja'.
--
-- El RETURNING lista los animales a los que se les creó la blanca: esa es la
-- población afectada, guardala si querés auditarla después.
WITH corregidas AS (
  UPDATE inventario_visceras
     SET tipo = 'roja'
   WHERE tipo IS NULL
     AND estado = 'en_inventario'
  RETURNING registro_id
)
INSERT INTO inventario_visceras (registro_id, tipo, estado)
SELECT DISTINCT c.registro_id, 'blanca', 'en_inventario'
  FROM corregidas c
 WHERE NOT EXISTS (
         SELECT 1
           FROM inventario_visceras iv
          WHERE iv.registro_id = c.registro_id
            AND iv.tipo   = 'blanca'
            AND iv.estado = 'en_inventario'
       )
RETURNING registro_id;

-- ── PASO 3: verificación (antes del COMMIT) ─────────────────────────────────
-- 3.a No debe quedar NINGUNA víscera sin tipo en inventario. Las despachadas SÍ
--     siguen en NULL, a propósito: esperado 66.
SELECT
  estado,
  COUNT(*) AS filas_sin_tipo
FROM inventario_visceras
WHERE tipo IS NULL
GROUP BY estado
ORDER BY estado;
-- esperado: una sola fila -> ('despachada', 66). Si aparece 'en_inventario', algo
-- quedó sin corregir: ROLLBACK.

-- 3.b Composición por animal de lo que hay en inventario. Cada animal debería
--     tener exactamente 1 roja + 1 blanca.
--
--     Nota: esto mira TODOS los animales con vísceras en inventario, no solo los
--     77 corregidos. Acotarlo a esos exigiría persistir la lista (TEMP TABLE), que
--     está descartada; el listado del RETURNING del paso 2 es la lista afectada.
--     Como chequeo de integridad general igual sirve, y de paso muestra si había
--     animales torcidos de antes.
SELECT
  COUNT(*) FILTER (WHERE rojas = 1 AND blancas = 1) AS animales_ok,
  COUNT(*) FILTER (WHERE rojas <> 1 OR blancas <> 1) AS animales_raros
FROM (
  SELECT
    registro_id,
    COUNT(*) FILTER (WHERE tipo = 'roja')   AS rojas,
    COUNT(*) FILTER (WHERE tipo = 'blanca') AS blancas
  FROM inventario_visceras
  WHERE estado = 'en_inventario'
  GROUP BY registro_id
) AS por_animal;

-- 3.c Si `animales_raros` no dio 0, esta lista dice cuáles son. Revisala antes de
--     commitear: puede haber casos legítimos (un animal al que ya le despacharon
--     una de las dos), pero conviene mirarlos.
SELECT
  registro_id,
  COUNT(*) FILTER (WHERE tipo = 'roja')   AS rojas,
  COUNT(*) FILTER (WHERE tipo = 'blanca') AS blancas
FROM inventario_visceras
WHERE estado = 'en_inventario'
GROUP BY registro_id
HAVING COUNT(*) FILTER (WHERE tipo = 'roja') <> 1
    OR COUNT(*) FILTER (WHERE tipo = 'blanca') <> 1
ORDER BY registro_id;

COMMIT;

-- ── SI ALGO SALIÓ MAL ───────────────────────────────────────────────────────
-- Mientras no se ejecute el COMMIT nada quedó guardado. Si un número no cuadra o
-- un statement falló, corré:
--
--   ROLLBACK;
--
-- y la base queda exactamente como estaba. Si el editor ya dejó la transacción
-- abortada ("current transaction is aborted"), ROLLBACK también es lo que la
-- cierra.
