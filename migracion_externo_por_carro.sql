-- ============================================================================
-- Migración PROPUESTA (opcional, NO ejecutada): distinguir carros de Externo
-- en `documentos_ruta` para que CONDUCTOR/AUXILIAR/PLACA/HORA/OBSERVACIÓN
-- puedan guardarse por carro, no compartidos.
-- ----------------------------------------------------------------------------
-- CONTEXTO: el Documento de ruta ahora arma UN BLOQUE "Externo" POR CARRO
-- (agrupando por codigo_cliente + codigo_destino, que ya viven en `despachos`).
-- Pero `documentos_ruta` (donde se guardan los campos manuales) solo tiene
-- UNIQUE(fecha, ruta): con ruta='Externo' compartido por todos los carros del
-- día, no hay forma de guardar un conductor/placa distinto por carro — todos
-- los bloques "Externo" del día leen y escriben la MISMA fila.
--
-- Esta migración es un PROPUESTA, no bloquea el fix ya aplicado (que separa
-- las TABLAS de BOVINOS/PORCINOS por carro, que es lo que Rafa reportó como
-- "códigos mezclados"). Solo hace falta si además querés conductor/placa
-- independientes por carro de Externo. Si la corrés, hay que actualizar
-- también guardarDatosManuales()/construirDocumentoDia() en documentoRuta.ts
-- para que pasen codigo_cliente/codigo_destino en el upsert cuando ruta
-- sea 'Externo' — ESO NO ESTÁ HECHO TODAVÍA, es trabajo aparte.
--
-- Ejecutar MANUALMENTE en el SQL Editor de Supabase. No la corre la app.
-- ============================================================================

-- ── PASO 0: mirá primero el nombre real del UNIQUE actual ────────────────────
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'documentos_ruta'::regclass AND contype = 'u';

-- ── PASO 1: agregar las columnas (nullable; rutas con nombre las dejan NULL) ──
ALTER TABLE documentos_ruta
  ADD COLUMN IF NOT EXISTS codigo_cliente TEXT,
  ADD COLUMN IF NOT EXISTS codigo_destino TEXT;

-- ── PASO 2: reemplazar el UNIQUE(fecha,ruta) por dos índices únicos parciales ─
-- Reemplazá NOMBRE_DEL_CONSTRAINT_VIEJO por lo que devuelva el PASO 0.
-- ALTER TABLE documentos_ruta DROP CONSTRAINT NOMBRE_DEL_CONSTRAINT_VIEJO;

-- Rutas con nombre: se mantiene 1 fila por (fecha,ruta), igual que hoy.
CREATE UNIQUE INDEX IF NOT EXISTS documentos_ruta_rutas_nombradas_uk
  ON documentos_ruta (fecha, ruta)
  WHERE ruta <> 'Externo';

-- Externo: 1 fila por (fecha, codigo_cliente, destino). COALESCE normaliza
-- destino NULL a '' para que Postgres SÍ trate "sin destino" como un valor
-- comparable (por defecto NULL nunca es igual a NULL en un UNIQUE).
CREATE UNIQUE INDEX IF NOT EXISTS documentos_ruta_externo_uk
  ON documentos_ruta (fecha, codigo_cliente, COALESCE(codigo_destino, ''))
  WHERE ruta = 'Externo';

-- ── LÍMITE QUE ESTO NO RESUELVE ────────────────────────────────────────────
-- Si el MISMO código se despacha a Externo DOS VECES el mismo día con el
-- MISMO destino (o ambas veces sin destino), seguirían siendo "un carro" para
-- el sistema — no hay ningún dato hoy que distinga 2 despachos así entre sí.
-- Eso requeriría un identificador de carro/lote explícito (columna nueva en
-- `despachos`, fuera del alcance de esta migración).
