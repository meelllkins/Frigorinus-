-- ============================================================================
-- REMISIONES: 8 filas por hoja (era 6) — hoja VERTICAL
-- ----------------------------------------------------------------------------
-- Ejecutar MANUALMENTE en el SQL Editor de Supabase. No la corre la app.
--
-- ⚠️ OBLIGATORIA. Sin correrla, el frontend arma bloques de 8 filas por hoja
--    pero el RPC sigue reservando folios de a 6: una remisión de 8 filas
--    imprimiría UNA hoja y se llevaría DOS folios, y a partir de ahí el número
--    impreso en el papel deja de coincidir con el rango reservado. Va junto con
--    el deploy del frontend.
--
-- ── QUÉ CAMBIA ──────────────────────────────────────────────────────────────
-- Solo el divisor del cálculo de hojas dentro de remision_crear_con_folio():
-- CEIL(filas / 6) pasa a CEIL(filas / 8). Nada más. No toca tablas, columnas,
-- policies ni el contador de folios — todo eso lo dejó
-- SQL's/migracion_folios_remision.sql, que ya corrió y no se vuelve a tocar.
--
-- Se reemplaza la función ENTERA con CREATE OR REPLACE (Postgres no permite
-- parchear el cuerpo) y se re-otorga el GRANT, que el REPLACE no conserva.
--
-- ── POR QUÉ 8 ───────────────────────────────────────────────────────────────
-- La remisión pasó de imprimirse apaisada a VERTICAL, y el alto útil de la
-- hoja subió de ~20.4cm a 26.74cm (carta, márgenes de 0.6cm). Midiendo la
-- plantilla real impresa a PDF con Edge headless:
--   · celdas de una línea: entran hasta 12 filas
--   · las 6 columnas envueltas a dos líneas en TODAS las filas: entran 8
--     (25.19cm contra 26.74cm; la novena se pasa por 0.20cm)
-- Se toma el peor caso. Si un bloque no entra en su hoja, el navegador lo parte
-- al medio y esa hoja física de más NO tiene folio reservado.
--
-- El 8 tiene que ser el MISMO que FILAS_POR_HOJA en src/lib/remisiones.ts, que
-- es con el que la plantilla arma los bloques `.hoja-impresion`.
--
-- ── LAS REMISIONES YA CREADAS NO SE TOCAN ───────────────────────────────────
-- `hojas_reservadas` se fijó al crear cada remisión y no se recalcula nunca —
-- ni acá ni en la app. Como el número SUBE, una remisión vieja necesita ahora
-- MENOS hojas que las que tiene reservadas, nunca más: no puede quedar corta ni
-- pisar el rango de la siguiente. Una de 8 filas creada con el valor viejo
-- reservó 2 hojas y ahora reimprime en 1; el segundo folio queda reservado sin
-- usar, que es el caso que el diseño ya acepta (ver la nota sobre el rango en
-- migracion_folios_remision.sql).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION remision_crear_con_folio(
  p_fecha             DATE,
  p_filas             JSONB,
  p_conductor         TEXT    DEFAULT NULL,
  p_cedula            TEXT    DEFAULT NULL,
  p_placa             TEXT    DEFAULT NULL,
  p_firma_responsable TEXT    DEFAULT NULL,
  p_firma_conductor   TEXT    DEFAULT NULL,
  p_folio_inicial     INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_filas INTEGER;
  v_hojas INTEGER;
  v_folio INTEGER;
  v_id    UUID;
BEGIN
  -- Solo las filas de CLIENTE cuentan para las hojas. La fila TOTAL viaja en
  -- el mismo arreglo (marcada con es_total) pero no ocupa lugar en el cuadro:
  -- va en el pie, que se repite entero en cada hoja. Contarla correría todo
  -- una posición y reservaría una hoja de más cada 8 filas.
  SELECT COUNT(*) INTO v_filas
    FROM jsonb_array_elements(COALESCE(p_filas, '[]'::jsonb)) e
   WHERE COALESCE((e->>'es_total')::BOOLEAN, FALSE) = FALSE;

  -- ⚠️ EL 8: ver la nota de la cabecera. Tiene que coincidir con FILAS_POR_HOJA
  -- en src/lib/remisiones.ts. El GREATEST es el caso de la remisión sin filas,
  -- que igual se imprime en una hoja.
  v_hojas := GREATEST(CEIL(v_filas::NUMERIC / 8)::INTEGER, 1);

  -- Acá se serializa todo el que esté creando una remisión al mismo tiempo.
  SELECT siguiente_folio INTO v_folio FROM contador_folios WHERE id FOR UPDATE;

  IF NOT FOUND THEN
    -- Primera remisión de la historia: el folio lo pone Rafa desde su
    -- talonario de papel y acá se siembra el contador con ese número.
    IF p_folio_inicial IS NULL THEN
      RAISE EXCEPTION 'Todavía no hay folio inicial: escribí el número de la primera remisión del talonario.'
        USING ERRCODE = '22023';
    END IF;
    INSERT INTO contador_folios (siguiente_folio) VALUES (p_folio_inicial);
    v_folio := p_folio_inicial;
  END IF;

  -- El contador queda apuntando al primer folio LIBRE después de este rango.
  UPDATE contador_folios
     SET siguiente_folio = v_folio + v_hojas,
         actualizado_at  = now()
   WHERE id;

  INSERT INTO remisiones
    (folio_inicio, hojas_reservadas, fecha, conductor, cedula, placa,
     firma_responsable, firma_conductor)
  VALUES
    (v_folio, v_hojas, p_fecha, p_conductor, p_cedula, p_placa,
     p_firma_responsable, p_firma_conductor)
  RETURNING id INTO v_id;

  INSERT INTO remisiones_filas
    (remision_id, orden, cliente, producto, und_kg, canastillas, destino,
     firma_recibido, es_total)
  SELECT v_id,
         (e->>'orden')::INTEGER,
         e->>'cliente',
         e->>'producto',
         e->>'und_kg',
         e->>'canastillas',
         e->>'destino',
         e->>'firma_recibido',
         COALESCE((e->>'es_total')::BOOLEAN, FALSE)
    FROM jsonb_array_elements(COALESCE(p_filas, '[]'::jsonb)) e;

  RETURN jsonb_build_object(
    'id',               v_id,
    'folio_inicio',     v_folio,
    'hojas_reservadas', v_hojas
  );
END;
$$;

-- El GRANT no sobrevive al CREATE OR REPLACE: hay que volver a darlo o la app
-- pierde el permiso de crear remisiones.
GRANT EXECUTE ON FUNCTION remision_crear_con_folio(DATE, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER)
  TO authenticated;

COMMIT;

-- ============================================================================
-- VERIFICACIÓN (opcional, no modifica nada)
-- ============================================================================
--   -- 1) El divisor quedó en 8 dentro de la función:
--   SELECT prosrc LIKE '%NUMERIC / 8%' AS quedo_en_8
--   FROM pg_proc WHERE proname = 'remision_crear_con_folio';
--   -- Esperado: true
--
--   -- 2) El GRANT sigue puesto:
--   SELECT has_function_privilege(
--     'authenticated',
--     'remision_crear_con_folio(DATE, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER)',
--     'EXECUTE') AS puede_ejecutar;
--   -- Esperado: true
--
--   -- 3) Los rangos viejos siguen intactos y sin solaparse:
--   SELECT folio_inicio,
--          folio_inicio + hojas_reservadas - 1 AS folio_fin,
--          hojas_reservadas
--   FROM remisiones ORDER BY folio_inicio;

-- ============================================================================
-- PRUEBAS MANUALES (desde la app; las filas de prueba llevan "TESTQA" en
-- cliente para poder borrarlas después a mano)
-- ============================================================================
-- 1. Crear una remisión con 8 filas -> reserva 1 hoja (antes eran 2); imprime
--    UNA sola hoja, sin cortar el cuadro ni dejar una página en blanco atrás.
-- 2. Crear otra con 9 filas -> reserva 2 hojas; imprime 2, con folios
--    consecutivos (N y N+1) y el encabezado completo en las dos.
-- 3. Crear una tercera enseguida -> su folio_inicio debe ser el que sigue al
--    rango de la segunda, sin pisarlo.
-- 4. Editar la de 9 filas agregando hasta pasar de 16 -> el guardado se rechaza
--    con el aviso y NADA cambia en la base (verificar con la consulta 3).
-- 5. Reimprimir una remisión creada ANTES de esta migración -> no se rompe: sale
--    con los mismos folios, en igual o menos hojas que las que reservó.
--
-- Limpieza de las de prueba (borra el encabezado; las filas se van por
-- CASCADE). El contador NO se retrocede a propósito: esos folios se
-- consideran consumidos, igual que si se hubiera arrancado la hoja del
-- talonario.
--   DELETE FROM remisiones r
--    WHERE EXISTS (SELECT 1 FROM remisiones_filas f
--                   WHERE f.remision_id = r.id AND f.cliente ILIKE '%TESTQA%');
