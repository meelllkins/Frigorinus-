-- ============================================================================
-- ORDEN MANUAL DE LAS CUADRÍCULAS DEL DOCUMENTO DE RUTA
-- Rafa arrastra las filas con el mouse para acomodarlas como va a entregar.
-- ----------------------------------------------------------------------------
-- Ejecutar MANUALMENTE en el SQL Editor de Supabase. No la corre la app.
-- ⚠️ CORRERLA ANTES DE DESPLEGAR: sin la tabla, arrastrar no guarda nada y la
--    pantalla muestra un aviso en cada carga. El documento igual se ve y se
--    exporta (cae a su orden natural de siempre), pero la función no existe.
--
-- ── QUÉ RESUELVE ────────────────────────────────────────────────────────────
-- El orden de cada cuadrícula lo decide hoy el código, en dos escalones:
--   1. la SECUENCIA de entrega del maestro (`secuencia_entrega`), en las rutas
--      regionales; los códigos sin secuencia caen al final;
--   2. compararFila() —código, primer animal, desposte, destino— como desempate
--      determinista, que es TODO el orden en Nacional, Barbosa y Externo.
-- Eso es el "orden natural" y sigue siendo la fuente de verdad. Esta tabla es
-- un OVERRIDE encima: solo pisa el orden de las filas que Rafa efectivamente
-- movió, y solo en el documento donde las movió.
--
-- ── ALCANCE: POR DOCUMENTO ──────────────────────────────────────────────────
-- La clave arranca con `fecha_entrega`, que es LA identidad del documento
-- (ver jornadaCanonica() en src/lib/documentoRuta.ts). Reordenar la tabla del 8
-- no toca la del 9 ni cambia el orden natural de ninguna ruta a futuro: la
-- entrega siguiente vuelve a salir por secuencia del Excel maestro.
--
-- ── ALCANCE: POR CUADRÍCULA ─────────────────────────────────────────────────
-- Una cuadrícula = (ruta, carro_id, tipo_carne). Con eso quedan separadas las
-- tres familias que se ven en pantalla, sin caso especial para ninguna:
--   · regionales / Nacional / Barbosa -> carro_id = '' (no tienen carro)
--   · Externo                         -> carro_id = el id del carro, así BOVINOS
--                                        de un carro no arrastra a PORCINOS del
--                                        mismo carro ni a los otros carros
--   · bovinos vs porcinos             -> tipo_carne
-- Nunca se reordena ENTRE cuadrículas: la app escribe siempre las filas de una
-- sola, y la lectura las agrupa por esta misma clave.
--
-- ── fila_key: DE DÓNDE SALE ─────────────────────────────────────────────────
-- Es `FilaDocumento.key`, o sea claveGrupo() tal cual (src/lib/documentoRuta.ts):
--     ruta|tipoCarne|codigoCliente|esDesposte|codigoDestino|evento|esMediaCanal|direccion
-- No se inventa un identificador nuevo a propósito: esa clave YA es la identidad
-- de la fila —es la clave del Map de grupos, así que es única en todo el
-- documento y no depende del orden en que la BD devuelva los despachos— y ya la
-- usan React, el estado de edición de cabeza/patas y el de secuencia.
-- Los dos campos que importan acá ya están adentro: en Externo `evento` ES el
-- carro, y en Nacional el último campo ES la dirección (el código 355 repartido
-- entre tres direcciones son tres filas, y cada una se mueve por su cuenta).
--
-- TEXT y no una FK a `despachos`: una fila del documento es un GRUPO de
-- despachos (canal + vísceras + adelantos), no una fila de esa tabla, y tiene
-- que sobrevivir a que se le agregue una víscera al grupo sin perder su lugar.
-- ============================================================================

CREATE TABLE IF NOT EXISTS orden_documento_ruta (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Identidad del DOCUMENTO. Es la fecha de ENTREGA, no la de despacho.
  fecha_entrega DATE    NOT NULL,
  -- Identidad de la CUADRÍCULA dentro del documento.
  ruta          TEXT    NOT NULL,             -- coincide EXACTO con src/lib/rutas.ts
  carro_id      TEXT    NOT NULL DEFAULT '',  -- '' en rutas con nombre; el carro en Externo
  tipo_carne    TEXT    NOT NULL CHECK (tipo_carne IN ('res', 'cerdo')),
  -- Identidad de la FILA dentro de la cuadrícula (ver comentario de arriba).
  fila_key      TEXT    NOT NULL,
  -- Posición 0-based dentro de la cuadrícula. La app reescribe la cuadrícula
  -- ENTERA en cada soltada (0..n-1), así que nunca hay huecos ni empates.
  posicion      INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Una fila no puede tener dos posiciones en la misma cuadrícula del mismo
-- documento. Es un UNIQUE de columnas PLANAS —no un índice por expresión— a
-- propósito: el UPSERT de PostgREST nombra estas cinco columnas en su
-- onConflict y ahí no se pueden usar COALESCE ni expresiones. Por el mismo
-- motivo `carro_id` es NOT NULL DEFAULT '' y no nullable: dos NULL no empatan en
-- un UNIQUE, así que una fila con NULL nunca haría match y se duplicaría en cada
-- arrastre. Mismo criterio que documentos_ruta (ver migracion_fecha_entrega.sql).
ALTER TABLE orden_documento_ruta
  DROP CONSTRAINT IF EXISTS orden_documento_ruta_cuadricula_fila_uk;
ALTER TABLE orden_documento_ruta
  ADD CONSTRAINT orden_documento_ruta_cuadricula_fila_uk
  UNIQUE (fecha_entrega, ruta, carro_id, tipo_carne, fila_key);

-- La app lee TODO el orden de un documento de una sola consulta (una por
-- refresco, filtrando solo por fecha_entrega) y lo agrupa por cuadrícula en
-- memoria. Este índice es el que sirve ese filtro.
CREATE INDEX IF NOT EXISTS orden_documento_ruta_fecha_idx
  ON orden_documento_ruta (fecha_entrega);

-- RLS desde la creación, mismo patrón que documentos_ruta y secuencia_entrega.
-- WITH CHECK explícito y no solo USING: sin él el INSERT del upsert puede
-- rebotar con "new row violates row-level security policy". Es exactamente el
-- problema que tuvo que arreglar migracion_secuencia_escritura.sql, y esta tabla
-- se escribe desde el primer arrastre, así que va explícito de entrada.
ALTER TABLE orden_documento_ruta ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orden_documento_ruta_auth ON orden_documento_ruta;
CREATE POLICY orden_documento_ruta_auth ON orden_documento_ruta
  FOR ALL
  USING (auth.role() = 'authenticated')        -- leer / actualizar / borrar
  WITH CHECK (auth.role() = 'authenticated');  -- insertar

-- ── NOTA SOBRE FILAS HUÉRFANAS ──────────────────────────────────────────────
-- Si un despacho se revierte, su `fila_key` deja de existir en el documento y su
-- fila acá queda huérfana. No molesta: la lectura solo busca las claves de las
-- filas que el documento realmente tiene, así que una clave que ya no sale no la
-- consulta nadie. No hace falta limpiarlas. Si algún día sobran, esto las borra
-- (no se corre solo):
--   DELETE FROM orden_documento_ruta WHERE fecha_entrega < CURRENT_DATE - 60;

-- ── VERIFICACIÓN (opcional, no modifica nada) ───────────────────────────────
--   -- La tabla y sus columnas:
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'orden_documento_ruta' ORDER BY ordinal_position;
--
--   -- El UNIQUE (tiene que ser el de las 5 columnas, o el upsert falla):
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'orden_documento_ruta'::regclass AND contype = 'u';
--   -- UNIQUE (fecha_entrega, ruta, carro_id, tipo_carne, fila_key)
--
--   -- La policy (cmd = 'ALL', qual Y with_check con auth.role()):
--   SELECT policyname, cmd, qual, with_check
--   FROM pg_policies WHERE tablename = 'orden_documento_ruta';
--
--   -- Qué cuadrículas tienen reorden manual, después de probar:
--   SELECT fecha_entrega, ruta, carro_id, tipo_carne, COUNT(*) AS filas
--   FROM orden_documento_ruta
--   GROUP BY 1, 2, 3, 4 ORDER BY 1 DESC, 2;
