-- ============================================================================
-- ROLES: perfiles + rol_actual() + policies por comando en las 12 tablas
-- ----------------------------------------------------------------------------
-- Ejecutar MANUALMENTE en el SQL Editor de Supabase. No la corre la app.
--
-- ⚠️ CORRERLA ANTES DE CREAR EL SEGUNDO USUARIO: hasta que esto esté puesto,
--    cualquier cuenta autenticada puede escribir en todas las tablas.
--
-- ── QUÉ HACE ────────────────────────────────────────────────────────────────
-- Hoy las 12 tablas tienen UNA sola policy `FOR ALL` con
-- `auth.role() = 'authenticated'`: todo el que se loguea puede leer y escribir
-- todo. Acá se parte en dos niveles:
--   · LEER:     cualquier autenticado, en todas las tablas (sin cambios).
--   · ESCRIBIR: solo el rol 'admin' (Rafa) — salvo remisiones y
--               remisiones_filas, donde también escribe el rol 'remisiones'.
--
-- ── POR QUÉ 4 POLICIES POR TABLA Y NO 1 ─────────────────────────────────────
-- Postgres no permite que una sola policy `FOR ALL` tenga una regla para
-- SELECT y otra distinta para el resto de los comandos. Para que leer quede
-- abierto y escribir quede cerrado hay que partirla por comando: cada tabla
-- pasa de 1 policy a 4 (SELECT / INSERT / UPDATE / DELETE). Son 12 tablas × 4
-- = 48, más las 4 de `perfiles`.
--
-- ── EL SISTEMA ES REUSABLE, NO ESTÁ CABLEADO A ESTE CASO ────────────────────
-- Agregar un rol nuevo mañana es: sumarlo al CHECK de `perfiles.rol` y tocar
-- el predicado de las tablas que ese rol tenga que escribir. No hay ningún
-- user id ni ningún email hardcodeado en ninguna policy.
--
-- ── TODO EN UNA TRANSACCIÓN ─────────────────────────────────────────────────
-- Entre el DROP de la policy vieja y el CREATE de las nuevas, la tabla queda
-- un instante con RLS activo y CERO policies, que en Postgres es denegar todo.
-- Por eso va entero en BEGIN/COMMIT: nadie de afuera llega a ver ese estado, y
-- si algo falla a mitad de camino no queda media app sin policies.
-- ============================================================================

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) TABLA DE PERFILES
-- ════════════════════════════════════════════════════════════════════════════
-- Una fila por usuario de auth. Es el ÚNICO lugar donde vive el rol.
CREATE TABLE IF NOT EXISTS perfiles (
  -- ON DELETE CASCADE: si se borra la cuenta en auth, no queda el perfil
  -- huérfano apuntando a un usuario que ya no existe.
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- DEFAULT 'admin' a propósito, NO 'remisiones': es el fail-open pedido. Si
  -- alguna vez se crea una cuenta y se olvida asignarle rol, esa cuenta queda
  -- con todos los permisos en vez de quedar bloqueada sin poder trabajar. El
  -- CHECK es lo que mantiene la lista de roles cerrada: un rol mal escrito
  -- ('Admin', 'remision') no entra, revienta acá y no queda silenciosamente
  -- sin permisos.
  rol        TEXT NOT NULL DEFAULT 'admin' CHECK (rol IN ('admin', 'remisiones')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) rol_actual() Y mi_rol()
-- ════════════════════════════════════════════════════════════════════════════
--
-- ── POR QUÉ SECURITY DEFINER (son dos motivos, los dos importantes) ─────────
--
-- 1. SIN DEFINER, EL ROL RESTRINGIDO SE AUTO-PROMOVERÍA A ADMIN.
--    `perfiles` tiene RLS de solo-admin (más abajo). Si esta función corriera
--    con los permisos de quien la llama, un usuario 'remisiones' no podría
--    leer su PROPIA fila: el SELECT le devolvería cero filas, el COALESCE
--    caería en 'admin' y la función le contestaría que es admin. El fail-open
--    del COALESCE está pensado para el usuario que NO TIENE fila, no para
--    tapar una lectura bloqueada. DEFINER es lo que hace que la función lea
--    la verdad.
--
-- 2. RECURSIÓN.
--    Las policies de `perfiles` llaman a rol_actual(), y rol_actual() lee
--    `perfiles`. Como es DEFINER se saltea el RLS de esa tabla, así que la
--    consulta no vuelve a disparar las policies y no se muerde la cola.
--
-- El `SET search_path` es obligatorio en toda función DEFINER: sin él, quien
-- la llame podría anteponer un esquema propio con una tabla `perfiles` falsa
-- y hacerle devolver el rol que quiera. Mismo criterio que ya usa
-- editar_direccion_nacional().
CREATE OR REPLACE FUNCTION rol_actual() RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE((SELECT rol FROM perfiles WHERE id = auth.uid()), 'admin');
$$;

-- El alias que llama el frontend por RPC. Existe para que la pantalla pueda
-- preguntar "¿qué rol tengo?" sin tocar la tabla `perfiles` — que le está
-- vedada si no es admin. Va como INVOKER (el default) porque no necesita
-- privilegios propios: delega en rol_actual(), que sí los tiene.
CREATE OR REPLACE FUNCTION mi_rol() RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT rol_actual();
$$;

-- PostgREST solo expone lo que el rol puede ejecutar. rol_actual() también va
-- concedida porque las policies la evalúan en nombre del usuario que consulta.
GRANT EXECUTE ON FUNCTION rol_actual() TO authenticated;
GRANT EXECUTE ON FUNCTION mi_rol()     TO authenticated;

-- ── RLS DE `perfiles`: solo admin ───────────────────────────────────────────
-- Un usuario 'remisiones' no tiene por qué ver quién más existe ni con qué
-- rol. Su propio rol lo obtiene por mi_rol(), no leyendo la tabla.
ALTER TABLE perfiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS perfiles_select ON perfiles;
DROP POLICY IF EXISTS perfiles_insert ON perfiles;
DROP POLICY IF EXISTS perfiles_update ON perfiles;
DROP POLICY IF EXISTS perfiles_delete ON perfiles;

CREATE POLICY perfiles_select ON perfiles
  FOR SELECT USING (rol_actual() = 'admin');
CREATE POLICY perfiles_insert ON perfiles
  FOR INSERT WITH CHECK (rol_actual() = 'admin');
CREATE POLICY perfiles_update ON perfiles
  FOR UPDATE USING (rol_actual() = 'admin') WITH CHECK (rol_actual() = 'admin');
CREATE POLICY perfiles_delete ON perfiles
  FOR DELETE USING (rol_actual() = 'admin');

-- ════════════════════════════════════════════════════════════════════════════
-- 3) SEMBRAR 'admin' PARA LAS CUENTAS QUE YA EXISTEN
-- ════════════════════════════════════════════════════════════════════════════
-- El DEFAULT de la columna hace el trabajo: no hace falta nombrar el rol acá.
-- Así la cuenta de Rafa queda con FILA EXPLÍCITA y no depende del fail-open
-- del COALESCE para ser admin.
--
-- Este INSERT entra aunque `perfiles` ya tenga RLS de solo-admin porque el SQL
-- Editor de Supabase corre como `postgres`, que se saltea el RLS.
INSERT INTO perfiles (id)
SELECT id FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- OJO con las cuentas que se creen DESPUÉS de esta migración: no tienen fila,
-- así que caen en el fail-open y quedan como admin. Al crear el usuario de
-- remisiones hay que asignarle el rol a mano — esta es la línea, con el mail
-- de la cuenta nueva:
--
--   INSERT INTO perfiles (id, rol)
--   SELECT id, 'remisiones' FROM auth.users WHERE email = 'ACA_EL_MAIL'
--   ON CONFLICT (id) DO UPDATE SET rol = EXCLUDED.rol;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) POLICIES DE LAS 12 TABLAS
-- ════════════════════════════════════════════════════════════════════════════
-- Los DROP van con el nombre EXACTO de la policy actual de cada tabla
-- (verificado contra pg_policies). Ojo que `acceso_autenticado` se repite como
-- nombre en 6 tablas distintas: los nombres de policy son por tabla, no
-- globales, por eso cada DROP nombra su tabla.
--
-- Además se dropean los nombres NUEVOS antes de crearlos, para que el archivo
-- se pueda volver a correr sin reventar si quedó a medias.
--
-- Si alguna vez estas policies se ponen lentas en las tablas grandes, el paso
-- es envolver la llamada en un subselect —`(SELECT rol_actual()) = 'admin'`—
-- para que Postgres la evalúe una vez por sentencia y no una vez por fila.

-- ── clientes ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS clientes_all_authenticated ON clientes;
DROP POLICY IF EXISTS clientes_select ON clientes;
DROP POLICY IF EXISTS clientes_insert ON clientes;
DROP POLICY IF EXISTS clientes_update ON clientes;
DROP POLICY IF EXISTS clientes_delete ON clientes;

CREATE POLICY clientes_select ON clientes
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY clientes_insert ON clientes
  FOR INSERT WITH CHECK (rol_actual() = 'admin');
CREATE POLICY clientes_update ON clientes
  FOR UPDATE USING (rol_actual() = 'admin') WITH CHECK (rol_actual() = 'admin');
CREATE POLICY clientes_delete ON clientes
  FOR DELETE USING (rol_actual() = 'admin');

-- ── despachos ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS acceso_autenticado ON despachos;
DROP POLICY IF EXISTS despachos_select ON despachos;
DROP POLICY IF EXISTS despachos_insert ON despachos;
DROP POLICY IF EXISTS despachos_update ON despachos;
DROP POLICY IF EXISTS despachos_delete ON despachos;

CREATE POLICY despachos_select ON despachos
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY despachos_insert ON despachos
  FOR INSERT WITH CHECK (rol_actual() = 'admin');
CREATE POLICY despachos_update ON despachos
  FOR UPDATE USING (rol_actual() = 'admin') WITH CHECK (rol_actual() = 'admin');
CREATE POLICY despachos_delete ON despachos
  FOR DELETE USING (rol_actual() = 'admin');

-- ── despachos_archivo ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS acceso_autenticado ON despachos_archivo;
DROP POLICY IF EXISTS despachos_archivo_select ON despachos_archivo;
DROP POLICY IF EXISTS despachos_archivo_insert ON despachos_archivo;
DROP POLICY IF EXISTS despachos_archivo_update ON despachos_archivo;
DROP POLICY IF EXISTS despachos_archivo_delete ON despachos_archivo;

CREATE POLICY despachos_archivo_select ON despachos_archivo
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY despachos_archivo_insert ON despachos_archivo
  FOR INSERT WITH CHECK (rol_actual() = 'admin');
CREATE POLICY despachos_archivo_update ON despachos_archivo
  FOR UPDATE USING (rol_actual() = 'admin') WITH CHECK (rol_actual() = 'admin');
CREATE POLICY despachos_archivo_delete ON despachos_archivo
  FOR DELETE USING (rol_actual() = 'admin');

-- ── direcciones_nacional ────────────────────────────────────────────────────
DROP POLICY IF EXISTS direcciones_nacional_auth ON direcciones_nacional;
DROP POLICY IF EXISTS direcciones_nacional_select ON direcciones_nacional;
DROP POLICY IF EXISTS direcciones_nacional_insert ON direcciones_nacional;
DROP POLICY IF EXISTS direcciones_nacional_update ON direcciones_nacional;
DROP POLICY IF EXISTS direcciones_nacional_delete ON direcciones_nacional;

CREATE POLICY direcciones_nacional_select ON direcciones_nacional
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY direcciones_nacional_insert ON direcciones_nacional
  FOR INSERT WITH CHECK (rol_actual() = 'admin');
CREATE POLICY direcciones_nacional_update ON direcciones_nacional
  FOR UPDATE USING (rol_actual() = 'admin') WITH CHECK (rol_actual() = 'admin');
CREATE POLICY direcciones_nacional_delete ON direcciones_nacional
  FOR DELETE USING (rol_actual() = 'admin');

-- ── documentos_ruta ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS acceso_autenticado ON documentos_ruta;
DROP POLICY IF EXISTS documentos_ruta_select ON documentos_ruta;
DROP POLICY IF EXISTS documentos_ruta_insert ON documentos_ruta;
DROP POLICY IF EXISTS documentos_ruta_update ON documentos_ruta;
DROP POLICY IF EXISTS documentos_ruta_delete ON documentos_ruta;

CREATE POLICY documentos_ruta_select ON documentos_ruta
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY documentos_ruta_insert ON documentos_ruta
  FOR INSERT WITH CHECK (rol_actual() = 'admin');
CREATE POLICY documentos_ruta_update ON documentos_ruta
  FOR UPDATE USING (rol_actual() = 'admin') WITH CHECK (rol_actual() = 'admin');
CREATE POLICY documentos_ruta_delete ON documentos_ruta
  FOR DELETE USING (rol_actual() = 'admin');

-- ── inventario_visceras ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS acceso_autenticado ON inventario_visceras;
DROP POLICY IF EXISTS inventario_visceras_select ON inventario_visceras;
DROP POLICY IF EXISTS inventario_visceras_insert ON inventario_visceras;
DROP POLICY IF EXISTS inventario_visceras_update ON inventario_visceras;
DROP POLICY IF EXISTS inventario_visceras_delete ON inventario_visceras;

CREATE POLICY inventario_visceras_select ON inventario_visceras
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY inventario_visceras_insert ON inventario_visceras
  FOR INSERT WITH CHECK (rol_actual() = 'admin');
CREATE POLICY inventario_visceras_update ON inventario_visceras
  FOR UPDATE USING (rol_actual() = 'admin') WITH CHECK (rol_actual() = 'admin');
CREATE POLICY inventario_visceras_delete ON inventario_visceras
  FOR DELETE USING (rol_actual() = 'admin');

-- ── notas ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS acceso_autenticado ON notas;
DROP POLICY IF EXISTS notas_select ON notas;
DROP POLICY IF EXISTS notas_insert ON notas;
DROP POLICY IF EXISTS notas_update ON notas;
DROP POLICY IF EXISTS notas_delete ON notas;

CREATE POLICY notas_select ON notas
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY notas_insert ON notas
  FOR INSERT WITH CHECK (rol_actual() = 'admin');
CREATE POLICY notas_update ON notas
  FOR UPDATE USING (rol_actual() = 'admin') WITH CHECK (rol_actual() = 'admin');
CREATE POLICY notas_delete ON notas
  FOR DELETE USING (rol_actual() = 'admin');

-- ── orden_documento_ruta ────────────────────────────────────────────────────
DROP POLICY IF EXISTS orden_documento_ruta_auth ON orden_documento_ruta;
DROP POLICY IF EXISTS orden_documento_ruta_select ON orden_documento_ruta;
DROP POLICY IF EXISTS orden_documento_ruta_insert ON orden_documento_ruta;
DROP POLICY IF EXISTS orden_documento_ruta_update ON orden_documento_ruta;
DROP POLICY IF EXISTS orden_documento_ruta_delete ON orden_documento_ruta;

CREATE POLICY orden_documento_ruta_select ON orden_documento_ruta
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY orden_documento_ruta_insert ON orden_documento_ruta
  FOR INSERT WITH CHECK (rol_actual() = 'admin');
CREATE POLICY orden_documento_ruta_update ON orden_documento_ruta
  FOR UPDATE USING (rol_actual() = 'admin') WITH CHECK (rol_actual() = 'admin');
CREATE POLICY orden_documento_ruta_delete ON orden_documento_ruta
  FOR DELETE USING (rol_actual() = 'admin');

-- ── registros_beneficio ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS acceso_autenticado ON registros_beneficio;
DROP POLICY IF EXISTS registros_beneficio_select ON registros_beneficio;
DROP POLICY IF EXISTS registros_beneficio_insert ON registros_beneficio;
DROP POLICY IF EXISTS registros_beneficio_update ON registros_beneficio;
DROP POLICY IF EXISTS registros_beneficio_delete ON registros_beneficio;

CREATE POLICY registros_beneficio_select ON registros_beneficio
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY registros_beneficio_insert ON registros_beneficio
  FOR INSERT WITH CHECK (rol_actual() = 'admin');
CREATE POLICY registros_beneficio_update ON registros_beneficio
  FOR UPDATE USING (rol_actual() = 'admin') WITH CHECK (rol_actual() = 'admin');
CREATE POLICY registros_beneficio_delete ON registros_beneficio
  FOR DELETE USING (rol_actual() = 'admin');

-- ── secuencia_entrega ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS secuencia_entrega_auth ON secuencia_entrega;
DROP POLICY IF EXISTS secuencia_entrega_select ON secuencia_entrega;
DROP POLICY IF EXISTS secuencia_entrega_insert ON secuencia_entrega;
DROP POLICY IF EXISTS secuencia_entrega_update ON secuencia_entrega;
DROP POLICY IF EXISTS secuencia_entrega_delete ON secuencia_entrega;

CREATE POLICY secuencia_entrega_select ON secuencia_entrega
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY secuencia_entrega_insert ON secuencia_entrega
  FOR INSERT WITH CHECK (rol_actual() = 'admin');
CREATE POLICY secuencia_entrega_update ON secuencia_entrega
  FOR UPDATE USING (rol_actual() = 'admin') WITH CHECK (rol_actual() = 'admin');
CREATE POLICY secuencia_entrega_delete ON secuencia_entrega
  FOR DELETE USING (rol_actual() = 'admin');

-- ── remisiones ──── las dos que SÍ escribe el rol 'remisiones' ──────────────
DROP POLICY IF EXISTS remisiones_auth ON remisiones;
DROP POLICY IF EXISTS remisiones_select ON remisiones;
DROP POLICY IF EXISTS remisiones_insert ON remisiones;
DROP POLICY IF EXISTS remisiones_update ON remisiones;
DROP POLICY IF EXISTS remisiones_delete ON remisiones;

CREATE POLICY remisiones_select ON remisiones
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY remisiones_insert ON remisiones
  FOR INSERT WITH CHECK (rol_actual() IN ('admin', 'remisiones'));
CREATE POLICY remisiones_update ON remisiones
  FOR UPDATE USING (rol_actual() IN ('admin', 'remisiones'))
           WITH CHECK (rol_actual() IN ('admin', 'remisiones'));
CREATE POLICY remisiones_delete ON remisiones
  FOR DELETE USING (rol_actual() IN ('admin', 'remisiones'));

-- ── remisiones_filas ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS remisiones_filas_auth ON remisiones_filas;
DROP POLICY IF EXISTS remisiones_filas_select ON remisiones_filas;
DROP POLICY IF EXISTS remisiones_filas_insert ON remisiones_filas;
DROP POLICY IF EXISTS remisiones_filas_update ON remisiones_filas;
DROP POLICY IF EXISTS remisiones_filas_delete ON remisiones_filas;

CREATE POLICY remisiones_filas_select ON remisiones_filas
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY remisiones_filas_insert ON remisiones_filas
  FOR INSERT WITH CHECK (rol_actual() IN ('admin', 'remisiones'));
CREATE POLICY remisiones_filas_update ON remisiones_filas
  FOR UPDATE USING (rol_actual() IN ('admin', 'remisiones'))
           WITH CHECK (rol_actual() IN ('admin', 'remisiones'));
CREATE POLICY remisiones_filas_delete ON remisiones_filas
  FOR DELETE USING (rol_actual() IN ('admin', 'remisiones'));

-- ════════════════════════════════════════════════════════════════════════════
-- 5) TAPAR EL HUECO DE editar_direccion_nacional()
-- ════════════════════════════════════════════════════════════════════════════
-- Esa función es SECURITY DEFINER, o sea que SE SALTEA EL RLS por definición:
-- las 48 policies de arriba no la tocan. Su único chequeo era
-- `auth.role() <> 'authenticated'`, así que sin esto un usuario 'remisiones'
-- podría llamarla por RPC y reescribir direcciones en `direcciones_nacional`
-- Y en `despachos` (la función hace UPDATE en las dos) — justo dos tablas que
-- el sistema de roles le deja en solo lectura.
--
-- Cambia SOLO el guard de autorización; el resto del cuerpo queda igual. En
-- una función DEFINER el permiso se chequea adentro, porque afuera no hay
-- policy que la alcance.
--
-- La otra función que toca estas tablas, crear_viscera_automatica() (el
-- trigger que crea las dos vísceras al registrar una res), es INVOKER: respeta
-- las policies del que la dispara y no necesita ningún ajuste.
CREATE OR REPLACE FUNCTION editar_direccion_nacional(p_codigo TEXT, p_vieja TEXT, p_nueva TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_codigo    text := btrim(p_codigo);
  v_vieja     text := btrim(p_vieja);
  v_nueva     text := btrim(p_nueva);
  v_afectados integer;
BEGIN
  -- Mismo criterio que las policies de escritura de direcciones_nacional y
  -- despachos: además de estar logueado, hay que ser admin. El chequeo va acá
  -- adentro porque esta función es DEFINER y el RLS no la alcanza.
  IF auth.role() <> 'authenticated' OR rol_actual() <> 'admin' THEN
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
$function$;

COMMIT;

-- ============================================================================
-- VERIFICACIÓN (opcional, no modifica nada)
-- ============================================================================
--   -- 1) Las 13 tablas con 4 policies cada una (12 + perfiles = 52):
--   SELECT tablename, COUNT(*) AS policies, string_agg(cmd, ', ' ORDER BY cmd) AS comandos
--   FROM pg_policies WHERE schemaname = 'public'
--   GROUP BY tablename ORDER BY tablename;
--   -- Esperado: 13 filas, cada una con policies = 4 y
--   --           comandos = 'DELETE, INSERT, SELECT, UPDATE'.
--   --           Si alguna dice 'ALL', esa tabla quedó con la policy vieja.
--
--   -- 2) Quién quedó con qué rol:
--   SELECT u.email, p.rol FROM perfiles p JOIN auth.users u ON u.id = p.id
--   ORDER BY p.rol, u.email;
--
--   -- 3) Las funciones, con su modo de seguridad:
--   SELECT proname, CASE WHEN prosecdef THEN 'DEFINER' ELSE 'INVOKER' END AS seguridad
--   FROM pg_proc WHERE pronamespace = 'public'::regnamespace ORDER BY proname;
--   -- Esperado: rol_actual y editar_direccion_nacional en DEFINER;
--   --           mi_rol, remision_reemplazar_filas, documento_ruta_agregar_
--   --           observacion y crear_viscera_automatica en INVOKER.
--
--   -- 4) El rol que ve la sesión actual (en el SQL Editor da 'admin' por el
--   --    fail-open, porque `postgres` no tiene fila en perfiles — para probar
--   --    de verdad hay que llamarla logueado desde la app):
--   SELECT rol_actual(), mi_rol();

-- ============================================================================
-- CÓMO PROBARLO DESDE LA APP (después de crear el usuario de remisiones)
-- ============================================================================
-- Logueado como el usuario 'remisiones':
--   · Todas las pantallas tienen que SEGUIR VIÉNDOSE con sus datos (el SELECT
--     quedó abierto para todos).
--   · Crear/editar una remisión: tiene que funcionar.
--   · Guardar en Beneficios / Despachos / Vísceras / Notas / Documento de ruta:
--     NO tiene que escribir nada.
--
-- ⚠️ OJO CON CÓMO FALLA: un INSERT bloqueado por RLS tira error visible, pero
--    un UPDATE o un DELETE bloqueados NO tiran error — afectan 0 filas y
--    vuelven "ok". O sea que hoy, sin el candado del frontend, el usuario
--    'remisiones' va a ver pantallas que parecen guardar y no guardan. Eso es
--    exactamente lo que resuelve el paso siguiente (el blur + modal), y por
--    eso el frontend es parte necesaria del sistema de roles, no un adorno.
