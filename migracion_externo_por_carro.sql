-- ============================================================================
-- Migración PROPUESTA (opcional, NO ejecutada): identificador explícito de CARRO
-- para los despachos a ruta 'Externo'.
-- ----------------------------------------------------------------------------
-- CONTEXTO: 'Externo' no es una ruta — cada acto de despachar a Externo es un
-- carro propio, independiente de los demás aunque coincidan cliente y destino.
--
-- El Documento de ruta YA separa un bloque por carro, pero lo hace infiriendo el
-- carro desde `created_at` (todas las filas insertadas en la misma sentencia
-- comparten esa marca). Funciona, y no requiere tocar el schema, PERO es una
-- inferencia con dos límites:
--
--   1. Si dos despachos distintos a Externo cayeran exactamente en la misma
--      marca de tiempo, se verían como un solo carro.
--   2. Las vísceras se insertan en una sentencia aparte del canal, así que hoy
--      se re-atan a su canal por registro_id. Si Rafa mandara el canal de un
--      animal en un carro y, más tarde ese mismo día, la víscera de ESE MISMO
--      animal en otro carro a Externo, ambas quedarían en el primer carro.
--
-- Esta columna elimina la inferencia: el carro pasa a ser un dato explícito.
-- NO es urgente ni bloquea nada; el comportamiento actual ya es correcto para
-- la operación normal.
--
-- Ejecutar MANUALMENTE en el SQL Editor de Supabase. No la corre la app.
-- ============================================================================

-- ── PASO 1: la columna ───────────────────────────────────────────────────────
-- Nullable a propósito: las rutas con nombre no la usan y los despachos
-- históricos se quedan en NULL (el código sigue cayendo a created_at).
ALTER TABLE despachos
  ADD COLUMN IF NOT EXISTS carro_id UUID;

-- Índice para agrupar rápido por carro dentro de un día.
CREATE INDEX IF NOT EXISTS despachos_carro_id_idx
  ON despachos (fecha_despacho, carro_id)
  WHERE carro_id IS NOT NULL;

-- ── PASO 2 (código, NO incluido acá) ─────────────────────────────────────────
-- Al despachar a 'Externo', el frontend genera UN crypto.randomUUID() por acto
-- de despacho y lo escribe en TODAS las filas de ese despacho (canal + vísceras,
-- aunque vayan en inserts separados). Después, en documentoRuta.ts:
--     evento = d.carro_id ?? <inferencia actual por created_at>
-- Así los despachos nuevos son exactos y los viejos siguen funcionando.
-- ESE CAMBIO DE CÓDIGO NO ESTÁ HECHO: es trabajo aparte, para cuando decidas
-- correr esta migración.

-- ── NOTA: campos manuales por carro (conductor/placa/hora) ───────────────────
-- Aparte de esto, `documentos_ruta` tiene UNIQUE(fecha, ruta), así que TODOS los
-- carros de Externo de un día comparten conductor/auxiliar/placa/hora/observación
-- (la pantalla ya lo avisa). Independizarlos requeriría además llevar carro_id a
-- `documentos_ruta` y cambiar su UNIQUE por (fecha, ruta, carro_id).
