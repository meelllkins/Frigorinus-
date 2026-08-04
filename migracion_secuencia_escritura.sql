-- ============================================================================
-- OPCIONAL — permisos de ESCRITURA sobre `secuencia_entrega`
-- ----------------------------------------------------------------------------
-- Ejecutar MANUALMENTE en el SQL Editor de Supabase. No la corre la app.
--
-- ⚠️ CORRERLA SOLO SI HACE FALTA. Lo más probable es que NO haga falta: leé abajo.
--
-- ── POR QUÉ probablemente ya funciona ───────────────────────────────────────
-- Hasta ahora la app solo LEÍA el maestro; ahora también lo escribe, porque Rafa
-- puede asignar el orden de entrega de un código desde el Documento de ruta.
--
-- La policy que creó migracion_secuencia_entrega.sql es:
--     CREATE POLICY secuencia_entrega_auth ON secuencia_entrega
--       FOR ALL USING (auth.role() = 'authenticated');
--
-- `FOR ALL` ya cubre INSERT y UPDATE. Y aunque no lleva `WITH CHECK`, Postgres
-- documenta que cuando se omite, la expresión de `USING` se usa TAMBIÉN como
-- `WITH CHECK` — que es lo que gobierna las filas que se pueden insertar.
-- O sea: con la sesión de Rafa (usuario autenticado) la escritura ya debería pasar.
--
-- ── CUÁNDO SÍ CORRERLA ──────────────────────────────────────────────────────
-- Si al asignar una secuencia desde el documento el número no queda guardado y en
-- la consola del navegador aparece:
--     [secuenciaEntrega] Error guardando la secuencia: ... new row violates
--     row-level security policy ...
-- entonces la policy no está o quedó distinta. Esto la deja explícita.
-- ============================================================================

-- Verificación primero (solo lectura, no modifica nada):
--   SELECT policyname, cmd, qual, with_check
--   FROM pg_policies WHERE tablename = 'secuencia_entrega';
--   -- Si aparece una policy con cmd = 'ALL' y qual = (auth.role() = 'authenticated'),
--   -- no hace falta correr nada más.

ALTER TABLE secuencia_entrega ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS secuencia_entrega_auth ON secuencia_entrega;
CREATE POLICY secuencia_entrega_auth ON secuencia_entrega
  FOR ALL
  USING (auth.role() = 'authenticated')        -- qué filas se pueden leer/actualizar/borrar
  WITH CHECK (auth.role() = 'authenticated');  -- qué filas se pueden insertar/dejar

-- ── NOTA ────────────────────────────────────────────────────────────────────
-- No hace falta cargar datos: el maestro de las 10 rutas regionales ya está en la
-- tabla. Los códigos que Rafa vaya asignando desde el documento se agregan solos.
