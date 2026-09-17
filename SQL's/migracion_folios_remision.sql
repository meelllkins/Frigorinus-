-- ============================================================================
-- REMISIONES: reserva de RANGO de folios por remisión
-- ----------------------------------------------------------------------------
-- Ejecutar MANUALMENTE en el SQL Editor de Supabase. No la corre la app.
--
-- ⚠️ CORRERLA ANTES DE DESPLEGAR: renombra `remisiones.numero` y la app nueva
--    ya lee `folio_inicio`. Con la versión vieja del código esto rompe, y con
--    la nueva sin correr esto también. Van juntas.
--
-- ── QUÉ RESUELVE ────────────────────────────────────────────────────────────
-- Una remisión larga se imprime en VARIAS hojas, y cada hoja que Rafa arranca
-- del talonario es un folio físico distinto. La plantilla ya imprime
-- `folioBase + N` en la hoja N, pero la base guardaba UN solo número por
-- remisión y el correlativo salía de MAX(numero)+1. O sea: una remisión de 3
-- hojas se imprimía como 100, 101 y 102, y la SIGUIENTE remisión recibía 101
-- — un folio que Rafa ya había arrancado. El comentario en Remisiones.tsx ya
-- documentaba esa colisión como deuda conocida.
--
-- Acá el folio deja de derivarse de las remisiones existentes y pasa a salir
-- de un contador explícito que avanza tantas posiciones como HOJAS consuma
-- cada remisión.
--
-- ── EL RANGO SE RESERVA AL CREAR, Y NO SE RECALCULA NUNCA ───────────────────
-- `hojas_reservadas` se fija con la cantidad de filas que la remisión tiene en
-- el momento de crearse. Después:
--   · Quitar filas está permitido: quedan hojas reservadas sin usar. Se
--     acepta a propósito — el folio ya podría estar impreso en papel.
--   · Agregar filas más allá de lo reservado se RECHAZA desde la app
--     (actualizarRemision en src/lib/remisiones.ts). No se reasigna ni se
--     amplía el rango: los folios que siguen ya se los llevó otra remisión.
--
-- ── LAS 6 FILAS POR HOJA ────────────────────────────────────────────────────
-- El 6 de acá abajo tiene que ser el MISMO que FILAS_POR_HOJA en
-- src/lib/remisiones.ts (que a su vez es el que usa la plantilla al armar los
-- bloques `.hoja-impresion`). Si alguna vez cambia el alto del encabezado o
-- del pie impreso y entra otra cantidad de filas por hoja, hay que cambiarlo
-- en los DOS lados o la reserva deja de coincidir con lo que sale en papel.
-- ============================================================================

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) CONTADOR DE FOLIOS
-- ════════════════════════════════════════════════════════════════════════════
-- Fila única: `id` es BOOLEAN con PK y CHECK (id), así que solo puede existir
-- la fila TRUE. Es el truco estándar para una tabla de un solo registro — sin
-- esto, nada impediría que aparezca un segundo contador y el correlativo se
-- bifurque en silencio.
--
-- NO se siembra acá: el folio inicial lo teclea Rafa la primera vez desde la
-- pantalla, igual que hoy, y lo siembra el RPC de más abajo dentro de la misma
-- transacción en que crea la primera remisión. Hardcodear un número de arranque
-- en esta migración es justo lo que no se quiere.
CREATE TABLE IF NOT EXISTS contador_folios (
  id              BOOLEAN     PRIMARY KEY DEFAULT TRUE CHECK (id),
  siguiente_folio INTEGER     NOT NULL CHECK (siguiente_folio > 0),
  actualizado_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS igual que remisiones: leer cualquiera autenticado, escribir admin y el
-- rol 'remisiones' (que es justamente quien crea remisiones y por lo tanto
-- tiene que poder mover el contador). Ver SQL's/migracion_roles.sql.
ALTER TABLE contador_folios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contador_folios_select ON contador_folios;
DROP POLICY IF EXISTS contador_folios_insert ON contador_folios;
DROP POLICY IF EXISTS contador_folios_update ON contador_folios;
DROP POLICY IF EXISTS contador_folios_delete ON contador_folios;

CREATE POLICY contador_folios_select ON contador_folios
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY contador_folios_insert ON contador_folios
  FOR INSERT WITH CHECK (rol_actual() IN ('admin', 'remisiones'));
CREATE POLICY contador_folios_update ON contador_folios
  FOR UPDATE USING (rol_actual() IN ('admin', 'remisiones'))
           WITH CHECK (rol_actual() IN ('admin', 'remisiones'));
CREATE POLICY contador_folios_delete ON contador_folios
  FOR DELETE USING (rol_actual() = 'admin');

-- ════════════════════════════════════════════════════════════════════════════
-- 2) COLUMNAS EN `remisiones`
-- ════════════════════════════════════════════════════════════════════════════
-- `numero` pasa a llamarse `folio_inicio`: ya no es "el número de la remisión"
-- sino el PRIMER folio de un rango. Se renombra en vez de agregar una columna
-- nueva porque dejar las dos sería tener dos fuentes de verdad para lo mismo,
-- y porque la tabla está en cero (el DROP de la eliminación se llevó el
-- histórico), así que no hay ni una fila que migrar. En el código solo lo leen
-- src/lib/remisiones.ts y src/pages/Remisiones.tsx.
--
-- El bloque DO lo hace re-corrible: si la migración ya se corrió, no revienta.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'remisiones' AND column_name = 'numero'
  ) THEN
    ALTER TABLE remisiones RENAME COLUMN numero TO folio_inicio;
  END IF;

  -- El UNIQUE viaja solo con el rename, pero se queda con el nombre viejo.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'remisiones'::regclass AND conname = 'remisiones_numero_key'
  ) THEN
    ALTER TABLE remisiones RENAME CONSTRAINT remisiones_numero_key TO remisiones_folio_inicio_key;
  END IF;
END $$;

-- Cuántas hojas se le reservaron a esta remisión al crearla. El rango de folios
-- que ocupa es [folio_inicio, folio_inicio + hojas_reservadas - 1].
--
-- DEFAULT 1 y CHECK >= 1: toda remisión ocupa al menos una hoja, incluso sin
-- filas (el papel igual lleva encabezado y firmas).
ALTER TABLE remisiones
  ADD COLUMN IF NOT EXISTS hojas_reservadas INTEGER NOT NULL DEFAULT 1
    CHECK (hojas_reservadas >= 1);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) RPC: CREAR LA REMISIÓN RESERVANDO EL RANGO, EN UNA SOLA TRANSACCIÓN
-- ════════════════════════════════════════════════════════════════════════════
-- Reemplaza al MAX(numero)+1 con reintento que hacía crearRemision(). Aquel
-- leía y después insertaba, así que dos creaciones simultáneas podían calcular
-- el mismo número y el UNIQUE hacía de árbitro; con rangos eso ya no alcanza,
-- porque el choque no es de un número sino de un tramo entero.
--
-- Acá el `FOR UPDATE` sobre la fila del contador serializa a los que creen al
-- mismo tiempo: el segundo espera, lee el contador YA avanzado y reserva el
-- tramo siguiente. No hay reintento porque no hay carrera que perder.
--
-- De paso, encabezado y filas entran en la MISMA transacción, así que
-- desaparece el rollback manual que tenía crearRemision() (insertaba el
-- encabezado, y si fallaban las filas lo borraba a mano).
--
-- SECURITY INVOKER (el default): corre con los permisos de quien llama, así
-- que las policies de remisiones, remisiones_filas y contador_folios se
-- aplican igual que en un INSERT directo. Mismo criterio que
-- remision_reemplazar_filas().
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
  -- una posición y reservaría una hoja de más cada 6 filas.
  SELECT COUNT(*) INTO v_filas
    FROM jsonb_array_elements(COALESCE(p_filas, '[]'::jsonb)) e
   WHERE COALESCE((e->>'es_total')::BOOLEAN, FALSE) = FALSE;

  -- El 6: ver la nota de la cabecera. Tiene que coincidir con FILAS_POR_HOJA
  -- en src/lib/remisiones.ts. El GREATEST es el caso de la remisión sin filas,
  -- que igual se imprime en una hoja.
  v_hojas := GREATEST(CEIL(v_filas::NUMERIC / 6)::INTEGER, 1);

  -- Acá se serializa todo el que esté creando una remisión al mismo tiempo.
  SELECT siguiente_folio INTO v_folio FROM contador_folios WHERE id FOR UPDATE;

  IF NOT FOUND THEN
    -- Primera remisión de la historia: el folio lo pone Rafa desde su
    -- talonario de papel y acá se siembra el contador con ese número. Es el
    -- mismo comportamiento de antes, cuando proximoNumero() devolvía null.
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

GRANT EXECUTE ON FUNCTION remision_crear_con_folio(DATE, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER)
  TO authenticated;

COMMIT;

-- ============================================================================
-- VERIFICACIÓN (opcional, no modifica nada)
-- ============================================================================
--   -- 1) La columna quedó renombrada y hojas_reservadas existe:
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'remisiones' ORDER BY ordinal_position;
--   -- Esperado: folio_inicio (integer, NO), hojas_reservadas (integer, NO, 1).
--   --           `numero` ya NO debe aparecer.
--
--   -- 2) El UNIQUE viajó con el rename:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'remisiones'::regclass AND contype = 'u';
--   -- Esperado: remisiones_folio_inicio_key  UNIQUE (folio_inicio)
--
--   -- 3) El contador (vacío hasta la primera remisión):
--   SELECT * FROM contador_folios;
--
--   -- 4) Rangos ocupados, una vez que haya remisiones:
--   SELECT folio_inicio,
--          folio_inicio + hojas_reservadas - 1 AS folio_fin,
--          hojas_reservadas
--   FROM remisiones ORDER BY folio_inicio;
--   -- Ningún rango debe solaparse con el siguiente.

-- ============================================================================
-- PRUEBAS MANUALES (desde la app; las filas de prueba llevan "TESTQA" en
-- cliente para poder borrarlas después a mano)
-- ============================================================================
-- 1. Crear una remisión con 8 filas -> reserva 2 hojas; imprime 2 hojas con
--    folios consecutivos (N y N+1).
-- 2. Crear otra enseguida -> su folio_inicio debe ser N+2, sin pisar el rango
--    de la primera.
-- 3. Editar la primera agregando filas hasta pasar de 12 -> el guardado se
--    rechaza con el aviso y NADA cambia en la base (verificar con la consulta
--    4 de arriba que folio_inicio y hojas_reservadas siguen igual).
-- 4. Editar la primera quitando filas hasta dejar 6 o menos -> guarda bien e
--    imprime UNA hoja. El folio N+1 queda reservado sin usar, que es lo
--    aceptado por diseño.
-- 5. Reimprimir la primera sin editarla -> exactamente los mismos folios.
--
-- Limpieza de las de prueba (borra el encabezado; las filas se van por
-- CASCADE). El contador NO se retrocede a propósito: esos folios se
-- consideran consumidos, igual que si se hubiera arrancado la hoja del
-- talonario.
--   DELETE FROM remisiones r
--    WHERE EXISTS (SELECT 1 FROM remisiones_filas f
--                   WHERE f.remision_id = r.id AND f.cliente ILIKE '%TESTQA%');
