-- ============================================================================
-- ADELANTO DE VÍSCERAS: append atómico a `documentos_ruta.observacion`
-- ----------------------------------------------------------------------------
-- Ejecutar MANUALMENTE en el SQL Editor de Supabase. No la corre la app.
--
-- ⚠️ CORRERLA ANTES DE DESPLEGAR: al despachar un adelanto la app llama a esta
--    función por RPC. Si no existe, PostgREST responde 404 y la línea no se
--    escribe (el despacho igual se guarda — ver la nota del final).
--
-- ── NO AGREGA NINGUNA COLUMNA ───────────────────────────────────────────────
-- `observacion` ya existe en `documentos_ruta` y es texto libre multilínea (el
-- export la parte por saltos de línea). El destino propio de las vísceras
-- adelantadas tampoco necesita columna: cada víscera YA es su propia fila en
-- `despachos`, con su propio `codigo_destino` (TEXT, sin CHECK). Lo único que
-- faltaba era que la app dejara de escribirle el mismo valor que a la canal.
--
-- ── POR QUÉ UNA FUNCIÓN Y NO UN UPDATE DESDE EL CLIENTE ─────────────────────
-- La observación se edita también a mano, desde el textarea del documento, que
-- guarda con debounce. Un "leer, concatenar, escribir" hecho en el navegador
-- pierde lo que haya entrado en el medio. Acá el read-modify-write pasa entero
-- dentro de una sola sentencia del servidor, sobre la fila bloqueada por el
-- INSERT ... ON CONFLICT, así que dos adelantos simultáneos no se pisan.
--
-- ── POR QUÉ = ANY(string_to_array(...)) Y NO position() ─────────────────────
-- Para no duplicar la línea si se re-despacha hay que preguntar si YA está. Con
-- position()/LIKE la comparación es por substring y
--     'ENVIAR 2 PAQ ... COD 120-2-3'
-- es substring de
--     'ENVIAR 3 PAQ ... COD 120-2-3-4'
-- así que una línea legítima quedaría sin agregarse. Comparando contra el
-- arreglo de líneas la igualdad es exacta.
-- ============================================================================

CREATE OR REPLACE FUNCTION documento_ruta_agregar_observacion(
  p_fecha         DATE,
  p_fecha_entrega DATE,
  p_ruta          TEXT,
  p_carro_id      TEXT,
  p_linea         TEXT
) RETURNS TEXT
LANGUAGE plpgsql
-- SECURITY INVOKER (el default): la función corre con los permisos de quien la
-- llama, así que las policies de RLS de `documentos_ruta` se siguen aplicando
-- igual que en el UPSERT normal. No se usa DEFINER a propósito.
SECURITY INVOKER
AS $$
DECLARE
  v_observacion TEXT;
BEGIN
  -- Una línea vacía no toca nada: evita crear el encabezado de un documento por
  -- un despacho que al final no tenía adelanto.
  IF p_linea IS NULL OR btrim(p_linea) = '' THEN
    RETURN NULL;
  END IF;

  INSERT INTO documentos_ruta (fecha, fecha_entrega, ruta, carro_id, observacion)
  VALUES (p_fecha, p_fecha_entrega, p_ruta, COALESCE(p_carro_id, ''), p_linea)
  ON CONFLICT (fecha, ruta, carro_id, fecha_entrega) DO UPDATE
    SET observacion = CASE
      -- Ya está esa línea EXACTA: se deja como está (re-despachar no duplica).
      WHEN p_linea = ANY(string_to_array(COALESCE(documentos_ruta.observacion, ''), E'\n'))
        THEN documentos_ruta.observacion
      -- Primera línea del documento: sin salto de línea adelante.
      WHEN COALESCE(btrim(documentos_ruta.observacion), '') = ''
        THEN p_linea
      -- Caso normal: se agrega abajo, sin tocar lo que Rafa haya escrito.
      ELSE documentos_ruta.observacion || E'\n' || p_linea
    END
  RETURNING observacion INTO v_observacion;

  RETURN v_observacion;
END;
$$;

-- PostgREST solo expone lo que el rol puede ejecutar.
GRANT EXECUTE ON FUNCTION documento_ruta_agregar_observacion(DATE, DATE, TEXT, TEXT, TEXT)
  TO authenticated;

-- ── VERIFICACIÓN (opcional; crea y borra una fila de prueba) ────────────────
--   SELECT documento_ruta_agregar_observacion(
--     '2026-09-02', '2026-09-03', 'Yolombó', '',
--     'ENVIAR 4 PAQ DE VISCERAS DE ADELANTO COD 120-2-3-4-5');
--   -- repetir la MISMA llamada: la observación no debe cambiar (no duplica).
--   SELECT documento_ruta_agregar_observacion(
--     '2026-09-02', '2026-09-03', 'Yolombó', '',
--     'ENVIAR 3 PAQ DE VISCERAS DE ADELANTO COD 120-2-3-4');
--   -- esta SÍ debe agregarse, aunque la anterior sea "parecida".
--   SELECT observacion FROM documentos_ruta
--    WHERE fecha = '2026-09-02' AND ruta = 'Yolombó' AND carro_id = ''
--      AND fecha_entrega = '2026-09-03';
--   DELETE FROM documentos_ruta
--    WHERE fecha = '2026-09-02' AND ruta = 'Yolombó' AND carro_id = ''
--      AND fecha_entrega = '2026-09-03';

-- ── NOTA sobre el fallo ─────────────────────────────────────────────────────
-- La app llama a esta función DESPUÉS de insertar los despachos y no revierte
-- nada si falla: el despacho es el dato importante y la línea es un texto de
-- apoyo. Si la función no existe, el despacho se guarda igual y la pantalla
-- avisa que la observación no se pudo escribir.
