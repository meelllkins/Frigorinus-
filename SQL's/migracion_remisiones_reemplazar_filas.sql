-- ============================================================================
-- REMISIONES: reemplazo atómico de filas al editar
-- ----------------------------------------------------------------------------
-- Ejecutar MANUALMENTE en el SQL Editor de Supabase. No la corre la app.
--
-- ⚠️ CORRERLA ANTES DE USAR "editar" EN REMISIONES: actualizarRemision() en
--    src/lib/remisiones.ts llama a esta función por RPC. Si no existe,
--    PostgREST responde 404 y la edición falla entera (no hay fallback al
--    borrar+insertar viejo, a propósito — ver más abajo por qué).
--
-- ── QUÉ RESUELVE ────────────────────────────────────────────────────────────
-- Antes, actualizarRemision() borraba TODAS las filas de la remisión y recién
-- después insertaba las nuevas, en dos llamadas separadas al cliente de
-- Supabase (dos transacciones distintas de Postgres). Si el DELETE entraba y
-- el INSERT fallaba a mitad de camino (red, RLS, lo que sea), la remisión
-- quedaba con el encabezado pero SIN FILAS: el documento archivado se vaciaba
-- y no había forma de recuperarlo salvo volver a escribirlo a mano.
--
-- ── POR QUÉ UNA FUNCIÓN Y NO UNA TRANSACCIÓN DESDE EL CLIENTE ───────────────
-- supabase-js (vía PostgREST) no expone BEGIN/COMMIT al cliente: cada
-- .from(...).insert()/.delete() es su propia sentencia HTTP y su propia
-- transacción de Postgres. La única forma de que "borrar todo e insertar lo
-- nuevo" ocurra en una sola transacción es empaquetarlo en una función que
-- corra del lado del servidor: el cuerpo entero de la función es una sola
-- sentencia para quien la llama, así que si el INSERT lanza excepción,
-- Postgres deshace también el DELETE. Mismo patrón que
-- documento_ruta_agregar_observacion() en migracion_observacion_adelanto.sql.
--
-- ── POR QUÉ JSONB Y NO UN ARREGLO DE FILAS TIPADO ───────────────────────────
-- PostgREST/RPC no tiene un tipo de "arreglo de composite" cómodo de armar
-- desde JS; JSONB es lo que supabase-js manda sin fricción, y
-- jsonb_array_elements() lo despliega fila por fila del lado del servidor.
-- ============================================================================

CREATE OR REPLACE FUNCTION remision_reemplazar_filas(
  p_remision_id UUID,
  p_filas       JSONB
) RETURNS VOID
LANGUAGE plpgsql
-- SECURITY INVOKER (el default): corre con los permisos de quien llama, así
-- que las policies de RLS de remisiones_filas se siguen aplicando igual que
-- en el DELETE/INSERT directo que reemplaza.
SECURITY INVOKER
AS $$
BEGIN
  DELETE FROM remisiones_filas WHERE remision_id = p_remision_id;

  INSERT INTO remisiones_filas
    (remision_id, orden, cliente, producto, und_kg, canastillas, destino, firma_recibido, es_total)
  SELECT
    p_remision_id,
    (elem->>'orden')::INTEGER,
    elem->>'cliente',
    elem->>'producto',
    elem->>'und_kg',
    elem->>'canastillas',
    elem->>'destino',
    elem->>'firma_recibido',
    COALESCE((elem->>'es_total')::BOOLEAN, FALSE)
  FROM jsonb_array_elements(p_filas) AS elem;
END;
$$;

-- PostgREST solo expone lo que el rol puede ejecutar.
GRANT EXECUTE ON FUNCTION remision_reemplazar_filas(UUID, JSONB) TO authenticated;

-- ── VERIFICACIÓN (opcional; crea y borra una remisión de prueba) ────────────
--   -- 1) Encabezado + una fila inicial
--   WITH r AS (
--     INSERT INTO remisiones (numero, fecha) VALUES (99002, CURRENT_DATE)
--     RETURNING id
--   )
--   INSERT INTO remisiones_filas (remision_id, orden, cliente, es_total)
--   SELECT id, 0, 'QA ANTES', FALSE FROM r;
--
--   -- 2) Reemplazo atómico por dos filas nuevas
--   SELECT remision_reemplazar_filas(
--     (SELECT id FROM remisiones WHERE numero = 99002),
--     '[{"orden":0,"cliente":"QA DESPUES 1"},{"orden":1,"cliente":"QA DESPUES 2","es_total":true}]'::jsonb
--   );
--   SELECT f.orden, f.cliente, f.es_total FROM remisiones_filas f
--   JOIN remisiones r ON r.id = f.remision_id
--   WHERE r.numero = 99002 ORDER BY f.orden;
--   -- Esperado: 2 filas, "QA ANTES" ya no está.
--
--   -- 3) Simular un fallo a mitad de camino (falta "orden", que es NOT NULL)
--   --    y confirmar que NO borra las filas existentes:
--   -- SELECT remision_reemplazar_filas(
--   --   (SELECT id FROM remisiones WHERE numero = 99002),
--   --   '[{"cliente":"SIN ORDEN"}]'::jsonb
--   -- );
--   -- Debe fallar con "null value in column orden violates not-null
--   -- constraint", y las 2 filas del paso 2 deben seguir intactas (SELECT del
--   -- paso 2 repetido debe devolver lo mismo).
--
--   -- 4) LIMPIEZA
--   DELETE FROM remisiones WHERE numero = 99002;
