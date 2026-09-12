-- ============================================================================
-- REMISIÓN DE SALIDA DE DESPACHOS
-- El formato de papel que Rafa llena a mano hoy, ahora guardado en Supabase
-- para archivo permanente.
-- ----------------------------------------------------------------------------
-- Ejecutar MANUALMENTE en el SQL Editor de Supabase. No la corre la app.
-- ⚠️ CORRERLA ANTES DE R2 (la UI de Remisiones): sin estas dos tablas la
--    pantalla no puede ni listar ni guardar nada.
--
-- ── QUÉ ES Y QUÉ NO ES ──────────────────────────────────────────────────────
-- Es una sección APARTE, sin relación con `despachos` ni con `documentos_ruta`:
-- Rafa escribe las celdas de cero, la app no auto-llena ninguna desde el
-- documento de ruta. Por eso no hay ni una FK hacia esas tablas, y por eso las
-- celdas no se validan contra el maestro de clientes ni contra rutas.ts.
--
-- ── POR QUÉ TODA CELDA DE FILA ES TEXT ──────────────────────────────────────
-- A propósito, no por pereza de tipado. En el papel, `canastillas` trae cosas
-- como "V. Blancas 3 V. Rojas 3 Cabezas 3", y `und_kg` mezcla unidades con
-- kilos. Tiparlas como número (o como JSON) obligaría a inventar una estructura
-- que el formato de papel no tiene, y a rechazar lo que Rafa efectivamente
-- escribe. La remisión es un documento que se archiva y se vuelve a leer, no
-- una fuente de datos para sumar: nada en la app calcula sobre estas celdas.
-- El TOTAL del pie es por eso una FILA MÁS (`es_total`), no una columna
-- calculada: en el papel también se escribe a mano.
-- ============================================================================

-- ── ENCABEZADO ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS remisiones (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Correlativo del talonario. INTEGER y no TEXT: la app asigna el siguiente
  -- como MAX(numero) + 1, y eso necesita que ordene como número.
  --
  -- UNIQUE no es decorativo: es el ÁRBITRO de la carrera del correlativo. MAX+1
  -- se calcula leyendo y después insertando, así que dos guardados casi
  -- simultáneos pueden llegar al mismo número; con este UNIQUE el segundo falla
  -- con 23505 en vez de duplicar el número en silencio, y la app reintenta
  -- recalculando (ver crearRemision() en src/lib/remisiones.ts).
  --
  -- NO hay default ni secuencia a propósito: el primer número lo teclea Rafa
  -- (el folio donde va el talonario de papel), no lo decide la base. Una
  -- SEQUENCE tendría que arrancar en un número hardcodeado acá, que es justo lo
  -- que no se quiere.
  numero            INTEGER     NOT NULL UNIQUE,
  fecha             DATE        NOT NULL,
  conductor         TEXT,
  placa             TEXT,
  firma_responsable TEXT,
  firma_conductor   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- La vista lista/archivo de R2/R3 filtra por rango de fechas y ordena por
-- numero DESC. `numero` ya tiene índice por el UNIQUE; este es el del filtro.
CREATE INDEX IF NOT EXISTS remisiones_fecha_idx ON remisiones (fecha);

-- ── FILAS DE LA TABLA DE LA REMISIÓN ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS remisiones_filas (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ON DELETE CASCADE: borrar la remisión se lleva sus filas. Acá SÍ va la FK
  -- (al contrario de despachos_archivo.viscera_id): una fila sin su encabezado
  -- no es un dato histórico que valga la pena conservar, es basura.
  -- De esto depende eliminarRemision(), que borra SOLO el encabezado.
  remision_id    UUID    NOT NULL REFERENCES remisiones(id) ON DELETE CASCADE,
  -- Posición 0-based dentro de la remisión. La app reescribe las filas ENTERAS
  -- en cada guardado (borra e inserta 0..n-1), así que nunca hay huecos.
  orden          INTEGER NOT NULL,
  -- Las celdas. TEXT libre, todas nullable: una fila a medio llenar es normal
  -- en el papel. Ver el comentario de arriba sobre por qué ninguna es numérica.
  cliente        TEXT,
  producto       TEXT,
  und_kg         TEXT,
  canastillas    TEXT,
  destino        TEXT,
  firma_recibido TEXT,
  -- La fila TOTAL del pie del formato. Es una fila como las otras —con sus
  -- mismas celdas de texto— marcada con esta bandera para que la UI de R2 la
  -- dibuje en el pie y no entre las filas normales.
  es_total       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- obtenerRemision() trae las filas de UNA remisión ordenadas por `orden`; este
-- índice sirve el filtro y el orden de una sola pasada.
--
-- Es un índice y NO un UNIQUE (remision_id, orden) a propósito: actualizar una
-- remisión borra sus filas y vuelve a insertarlas. Si el DELETE llegara a
-- fallar y el INSERT siguiera, un UNIQUE convertiría eso en un error a mitad de
-- camino que dejaría la remisión con filas viejas y nuevas mezcladas; sin él,
-- el peor caso es orden duplicado —visible y corregible volviendo a guardar—.
-- Nada de la app depende de que `orden` sea único.
CREATE INDEX IF NOT EXISTS remisiones_filas_remision_orden_idx
  ON remisiones_filas (remision_id, orden);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Mismo patrón que documentos_ruta, secuencia_entrega y orden_documento_ruta.
-- WITH CHECK explícito y no solo USING: sin él el INSERT rebota con "new row
-- violates row-level security policy" (es el bug que arregló
-- migracion_secuencia_escritura.sql). Las dos tablas se escriben desde la
-- primera remisión, así que va explícito de entrada en las dos.
ALTER TABLE remisiones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS remisiones_auth ON remisiones;
CREATE POLICY remisiones_auth ON remisiones
  FOR ALL
  USING (auth.role() = 'authenticated')        -- leer / actualizar / borrar
  WITH CHECK (auth.role() = 'authenticated');  -- insertar

ALTER TABLE remisiones_filas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS remisiones_filas_auth ON remisiones_filas;
CREATE POLICY remisiones_filas_auth ON remisiones_filas
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ── VERIFICACIÓN (opcional, no modifica nada) ───────────────────────────────
--   -- Las dos tablas y sus columnas:
--   SELECT table_name, column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_name IN ('remisiones', 'remisiones_filas')
--   ORDER BY table_name, ordinal_position;
--
--   -- El UNIQUE de numero (sin él, el correlativo puede duplicarse):
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'remisiones'::regclass AND contype = 'u';
--   -- UNIQUE (numero)
--
--   -- La FK con CASCADE (sin ella, borrar una remisión deja filas huérfanas):
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'remisiones_filas'::regclass AND contype = 'f';
--   -- FOREIGN KEY (remision_id) REFERENCES remisiones(id) ON DELETE CASCADE
--
--   -- Las policies (cmd = 'ALL', qual Y with_check con auth.role()):
--   SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies
--   WHERE tablename IN ('remisiones', 'remisiones_filas');

-- ── TESTQA (toca datos; se limpia solo al final) ────────────────────────────
-- Pegar en el SQL Editor DESPUÉS de correr la migración. Usa numero = 99001
-- (arranque simulado, bien lejos del talonario real) y borra todo al terminar.
-- Descomentar el bloque entero y correrlo de una sola vez.
--
--   -- 0) proximoNumero() con la tabla vacía -> NULL
--   SELECT MAX(numero) AS debe_ser_null FROM remisiones;
--
--   -- 1) Una remisión con 5 filas de texto + 1 fila TOTAL
--   WITH r AS (
--     INSERT INTO remisiones (numero, fecha, conductor, placa,
--                             firma_responsable, firma_conductor)
--     VALUES (99001, CURRENT_DATE, 'QA CONDUCTOR', 'QAA111', 'QA RESP', 'QA COND')
--     RETURNING id
--   )
--   INSERT INTO remisiones_filas
--     (remision_id, orden, cliente, producto, und_kg, canastillas, destino,
--      firma_recibido, es_total)
--   SELECT r.id, v.orden, v.cliente, v.producto, v.und_kg, v.canastillas,
--          v.destino, v.firma_recibido, v.es_total
--   FROM r, (VALUES
--     (0, 'QA 301', 'Canal res',  '2 und', 'V. Blancas 3 V. Rojas 3 Cabezas 3', 'Cimitarra', '',        FALSE),
--     (1, 'QA 302', 'Media canal','1 und', 'V. Rojas 1',                        'Cisneros',  '',        FALSE),
--     (2, 'QA 303', 'Desposte',   '45,5 kg','2 canastillas',                    'Barbosa',   '',        FALSE),
--     (3, 'QA 304', 'Cerdo',      '3 und', 'Patas 12',                          'Nacional',  '',        FALSE),
--     (4, 'QA 305', 'Vísceras',   '',      'V. Blancas 2',                      'Gómez Plata','',       FALSE),
--     (5, 'TOTAL',  '',           '6 und', '8 canastillas',                     '',          '',        TRUE)
--   ) AS v(orden, cliente, producto, und_kg, canastillas, destino, firma_recibido, es_total);
--
--   -- 2) obtenerRemision(): se lee de vuelta en el MISMO orden, TOTAL al final
--   SELECT f.orden, f.cliente, f.canastillas, f.es_total
--   FROM remisiones_filas f JOIN remisiones r ON r.id = f.remision_id
--   WHERE r.numero = 99001 ORDER BY f.orden;
--   -- Esperado: 6 filas, orden 0..5, "V. Blancas 3 V. Rojas 3 Cabezas 3" intacto
--   --           en la 0, es_total = TRUE solo en la 5.
--
--   -- 3) proximoNumero() con 99001 presente -> 99002
--   SELECT MAX(numero) + 1 AS debe_ser_99002 FROM remisiones;
--
--   -- 4) El UNIQUE del correlativo bloquea el número repetido (debe FALLAR
--   --    con 23505; es lo que hace que el reintento de crearRemision() sirva):
--   -- INSERT INTO remisiones (numero, fecha) VALUES (99001, CURRENT_DATE);
--
--   -- 5) El candado de fecha vive en la app, no en la base. Para probarlo:
--   --    esta remisión queda fechada AYER, así que actualizarRemision() y
--   --    eliminarRemision() tienen que rechazarla sin escribir.
--   UPDATE remisiones SET fecha = CURRENT_DATE - 1 WHERE numero = 99001;
--   -- ...probar en la app (R2) o desde la consola del navegador, y después
--   --    devolverla a hoy para probar el caso que SÍ escribe:
--   UPDATE remisiones SET fecha = CURRENT_DATE WHERE numero = 99001;
--
--   -- 6) LIMPIEZA: borrar SOLO el encabezado. Las 6 filas se van por CASCADE.
--   DELETE FROM remisiones WHERE numero = 99001;
--   SELECT COUNT(*) AS filas_huerfanas FROM remisiones_filas f
--   WHERE NOT EXISTS (SELECT 1 FROM remisiones r WHERE r.id = f.remision_id);
--   -- Esperado: 0. Si da > 0, la FK no quedó con ON DELETE CASCADE.
