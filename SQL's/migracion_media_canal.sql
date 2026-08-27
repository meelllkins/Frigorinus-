-- ============================================================================
-- Pieza F — MEDIA CANAL (0.5): despachar la mitad de un canal y dejar la otra
-- mitad en cava, para salir después por otra ruta o a otro código.
-- ----------------------------------------------------------------------------
-- Ejecutar MANUALMENTE en el SQL Editor de Supabase. No la corre la app.
--
-- ⚠️ CORRER ESTA MIGRACIÓN **ANTES** DE DESPLEGAR EL CÓDIGO.
--    El Documento de ruta pide `fraccion` en su SELECT; si la columna no existe,
--    PostgREST devuelve error y la pantalla queda vacía.
--
-- ── POR QUÉ HACEN FALTA DOS COLUMNAS ────────────────────────────────────────
-- Hoy no existe ninguna columna de cantidad: el CANT del documento se calcula
-- CONTANDO filas de `despachos` (una fila = un canal = 1). Para que media canal
-- valga 0.5 hay que guardar la fracción en cada despacho.
--
--   1. `despachos.fraccion`  -> cuánto se despachó EN ESE despacho (0.5 o 1).
--      Es lo que suma el CANT del documento. Las dos mitades de un animal son
--      dos filas de 0.5, cada una con su propia ruta y código destino — que es
--      exactamente como sale en el Excel de Rafa (155-2 en dos líneas de 0.5,
--      una PARA COD 154 y la otra no).
--
--   2. `registros_beneficio.fraccion_despachada` -> cuánto lleva despachado el
--      animal en total (0, 0.5 o 1). Es lo que le dice al inventario "a este
--      animal le queda media canal".
--
-- ¿Por qué no alcanza con sumar las filas de `despachos` y evitar la columna 2?
-- Porque el archivado se lleva los despachos a `despachos_archivo` a los 15 días.
-- Si la primera mitad se despachó hace 20 días y la segunda sigue en cava, la
-- suma daría 0 y el animal parecería entero otra vez. El acumulador sobrevive
-- al archivado.
--
-- ¿Por qué no un booleano "media_canal_pendiente"? Porque no distingue "entero
-- sin despachar" de "ya salieron las dos mitades", y porque el número entra
-- directo en la suma del CANT sin lógica extra.
-- ============================================================================

-- ── PASO 1: fracción por despacho ────────────────────────────────────────────
-- DEFAULT 1 para que TODOS los despachos existentes queden como canal entero,
-- que es lo que son. Solo 0.5 y 1: Rafa confirmó que nunca hay cuartos ni
-- tres cuartos, y nunca más de 2 pedazos.
ALTER TABLE despachos
  ADD COLUMN IF NOT EXISTS fraccion NUMERIC(2,1) NOT NULL DEFAULT 1;

ALTER TABLE despachos
  DROP CONSTRAINT IF EXISTS despachos_fraccion_check;
ALTER TABLE despachos
  ADD CONSTRAINT despachos_fraccion_check CHECK (fraccion IN (0.5, 1));

-- ── PASO 2: cuánto lleva despachado cada animal ──────────────────────────────
-- 0 = entero en cava | 0.5 = le queda media | 1 = despachado completo.
ALTER TABLE registros_beneficio
  ADD COLUMN IF NOT EXISTS fraccion_despachada NUMERIC(2,1) NOT NULL DEFAULT 0;

ALTER TABLE registros_beneficio
  DROP CONSTRAINT IF EXISTS registros_beneficio_fraccion_despachada_check;
ALTER TABLE registros_beneficio
  ADD CONSTRAINT registros_beneficio_fraccion_despachada_check
  CHECK (fraccion_despachada IN (0, 0.5, 1));

-- ── PASO 3: poner al día los animales YA despachados ─────────────────────────
-- Los que ya están en estado 'despachado' salieron enteros (media canal no
-- existía), así que su fracción despachada es 1. Los 'activo' se quedan en 0.
UPDATE registros_beneficio
   SET fraccion_despachada = 1
 WHERE estado = 'despachado'
   AND fraccion_despachada = 0;

-- ── PASO 4: que el archivado no pierda la fracción ───────────────────────────
-- Mismo criterio que migracion_despachos_archivo.sql: la tabla histórica debe
-- tener la misma forma que `despachos`, si no el archivado borra el dato.
ALTER TABLE despachos_archivo
  ADD COLUMN IF NOT EXISTS fraccion NUMERIC(2,1) NOT NULL DEFAULT 1;

-- ── VERIFICACIÓN (opcional, no modifica nada) ────────────────────────────────
-- Debería devolver 0 filas: ningún animal activo con fracción inválida.
--   SELECT id, codigo_cliente, numero_animal, estado, fraccion_despachada
--   FROM registros_beneficio
--   WHERE (estado = 'activo'    AND fraccion_despachada = 1)
--      OR (estado = 'despachado' AND fraccion_despachada <> 1);

-- ── NOTA sobre las VÍSCERAS ──────────────────────────────────────────────────
-- Las vísceras NO se parten: van completas con UNA de las dos mitades. No hace
-- falta columna nueva para eso — la fila de víscera en `despachos` ya lleva su
-- propia `ruta` y `codigo_destino`, así que queda atada a la mitad con la que
-- viajó (la que comparte ese destino). Las filas de víscera conservan
-- fraccion = 1: la fracción describe el canal, no la víscera.
