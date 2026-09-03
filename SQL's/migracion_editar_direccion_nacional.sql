-- ============================================================================
-- EDITAR UNA DIRECCIÓN DEL CATÁLOGO NACIONAL (y propagarla al histórico)
-- ----------------------------------------------------------------------------
-- Ejecutar MANUALMENTE en el SQL Editor de Supabase. No la corre la app.
-- ⚠️ CORRERLA ANTES DE DESPLEGAR: sin esta función, el botón "Gestionar
--    direcciones" falla al guardar una corrección (la RPC no existe).
--
-- ── QUÉ RESUELVE ────────────────────────────────────────────────────────────
-- Rafa a veces guarda una dirección mal escrita al despachar Nacional y no
-- tiene cómo corregirla. Corregirla solo en el catálogo no alcanza: los
-- despachos que ya salieron siguen mostrando el texto malo, porque
-- `despachos.direccion` guarda TEXTO y no una llave al catálogo.
--
-- ⚠️ ESTO CAMBIA UNA DECISIÓN DE DISEÑO de migracion_direcciones_nacional.sql,
--    que denormalizó el texto justamente para que "el documento de un despacho
--    viejo siga diciendo lo que decía ese día". Rafa lo pidió explícito: al
--    corregir un error de tipeo, quiere que el histórico también se corrija.
--    Sigue siendo TEXTO (no FK): borrar del catálogo NO toca los despachos.
--
-- ── POR QUÉ LA CORRECCIÓN VA POR CÓDIGO ─────────────────────────────────────
-- El catálogo es POR CÓDIGO: la llave única es (codigo, direccion), así que el
-- mismo texto puede existir para varios clientes. Si se corrigiera solo por
-- texto, arreglar el typo del código 355 le reescribiría la dirección (y los
-- despachos) al 420. Por eso la función recibe el código y ese es su alcance.
--
-- ── POR QUÉ SECURITY DEFINER ────────────────────────────────────────────────
-- El UPDATE toca `despachos`, cuya RLS no está versionada en este repo (se
-- configuró desde el panel de Supabase). Para no depender de eso, la función
-- corre como su dueño y valida el rol adentro: sigue siendo llamable SOLO por
-- usuarios autenticados, igual que el patrón de las demás tablas.
-- `search_path` fijo para que un search_path del llamador no la desvíe.
--
-- ── ALCANCE: `despachos`, NO `despachos_archivo` ────────────────────────────
-- A los 15 días el archivado mueve las filas a `despachos_archivo`, que también
-- tiene columna `direccion`. Esta función NO la toca: corrige lo vivo, no lo
-- archivado. Si Rafa quiere que la corrección llegue también al archivo, hay
-- que decidirlo aparte (es reescribir documentos ya emitidos).
-- ============================================================================

CREATE OR REPLACE FUNCTION editar_direccion_nacional(
  p_codigo text,
  p_vieja  text,
  p_nueva  text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_codigo    text := btrim(p_codigo);
  v_vieja     text := btrim(p_vieja);
  v_nueva     text := btrim(p_nueva);
  v_afectados integer;
BEGIN
  -- Mismo criterio que la policy direcciones_nacional_auth: solo autenticados.
  IF auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION 'No autorizado.'
      USING ERRCODE = '42501';
  END IF;

  IF v_codigo = '' OR v_vieja = '' OR v_nueva = '' THEN
    RAISE EXCEPTION 'El código y las direcciones no pueden ir vacíos.'
      USING ERRCODE = '22023';
  END IF;

  -- No-op: sin esto, el chequeo de duplicado de abajo la rechazaría igual, pero
  -- con un mensaje que no explica nada ("ya existe" contra sí misma).
  IF v_vieja = v_nueva THEN
    RAISE EXCEPTION 'La dirección nueva es igual a la actual.'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM direcciones_nacional
     WHERE codigo = v_codigo AND direccion = v_vieja
  ) THEN
    RAISE EXCEPTION 'El código % no tiene la dirección "%" en su catálogo.', v_codigo, v_vieja
      USING ERRCODE = 'P0002';
  END IF;

  -- Se valida antes de escribir en vez de dejar reventar el UNIQUE, para poder
  -- dar el mensaje concreto que el modal le muestra a Rafa.
  IF EXISTS (
    SELECT 1 FROM direcciones_nacional
     WHERE codigo = v_codigo AND direccion = v_nueva
  ) THEN
    RAISE EXCEPTION 'El código % ya tiene la dirección "%".', v_codigo, v_nueva
      USING ERRCODE = '23505';
  END IF;

  -- Las dos escrituras van en la MISMA transacción (el bloque de la función):
  -- o se corrigen catálogo e histórico juntos, o no se corrige nada.
  UPDATE direcciones_nacional
     SET direccion = v_nueva
   WHERE codigo = v_codigo AND direccion = v_vieja;

  -- `despachos` no tiene codigo_cliente: se llega por registro_id. El join
  -- acota la corrección a los despachos DE ESE código, por lo mismo que arriba.
  UPDATE despachos d
     SET direccion = v_nueva
    FROM registros_beneficio r
   WHERE d.registro_id = r.id
     AND d.direccion   = v_vieja
     AND r.codigo_cliente = v_codigo;

  GET DIAGNOSTICS v_afectados = ROW_COUNT;
  RETURN v_afectados;
END;
$$;

-- SECURITY DEFINER + EXECUTE a PUBLIC sería dejarla abierta a `anon`. Aunque el
-- guard de rol de adentro ya la frena, se cierra también acá.
REVOKE ALL   ON FUNCTION editar_direccion_nacional(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION editar_direccion_nacional(text, text, text) TO authenticated;

-- ── BORRAR ──────────────────────────────────────────────────────────────────
-- No lleva función: es un DELETE simple sobre direcciones_nacional, que la
-- policy direcciones_nacional_auth (FOR ALL, authenticated) ya permite desde el
-- cliente. Y a propósito NO toca `despachos`: los que ya usaron esa dirección
-- siguen mostrándola, que es lo que Rafa pidió.
