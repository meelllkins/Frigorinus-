-- ============================================================================
-- Pieza G — SECUENCIA DE ENTREGA: orden en que se entregan los códigos de cada
-- ruta regional. Alimenta el Excel de secuencia (una hoja por ruta).
-- ----------------------------------------------------------------------------
-- Ejecutar MANUALMENTE en el SQL Editor de Supabase. No la corre la app.
-- ⚠️ CORRERLA ANTES DE DESPLEGAR: sin la tabla, el Excel de secuencia falla.
--
-- ── DE DÓNDE SALEN ESTOS DATOS ──────────────────────────────────────────────
-- Extraídos del archivo real de Rafa "SECUENCIA CODIGOS.xlsx", del bloque
-- maestro (columnas CIUDAD | CODIGO | SECUENCIA) de cada hoja de ruta.
-- Son 199 códigos de 9 rutas. NO están escritos a mano: se generaron leyendo
-- el archivo, así que respetan los códigos y el orden tal cual están ahí.
--
-- ── CÓMO SE USA ─────────────────────────────────────────────────────────────
-- En el Excel de Rafa la secuencia se resuelve con
--     =IFERROR(VLOOKUP(COD; maestro; 2; 0); "")
-- y después se ordena el bloque por esa columna. Acá el VLOOKUP se hace en
-- código (src/lib/secuenciaEntrega.ts): se busca el código en esta tabla y se
-- ordena de menor a mayor. No se escriben fórmulas en el Excel generado.
--
-- El código que se busca NO siempre es el del animal: si el despacho va a otro
-- código ("... PARA COD 154"), la secuencia se busca por el código DESTINO.
-- Así lo hace Rafa a mano en su archivo (sobrescribe la celda COD).
--
-- ── DÍA (solo Cimitarra) ────────────────────────────────────────────────────
-- Cimitarra entrega LUNES y JUEVES con órdenes DISTINTOS, por eso su maestro
-- tiene columna DIA y esta tabla también. Las demás rutas van con dia = NULL
-- (sirve para cualquier día).
-- ============================================================================

CREATE TABLE IF NOT EXISTS secuencia_entrega (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ruta       TEXT    NOT NULL,   -- coincide EXACTO con src/lib/rutas.ts
  ciudad     TEXT,               -- informativo (SEGOVIA, REMEDIOS, ...)
  dia        TEXT,               -- NULL = cualquier día; 'LUNES'/'JUEVES' en Cimitarra
  codigo     TEXT    NOT NULL,   -- TEXT y no INT: hay códigos con cero adelante ('04')
  secuencia  INTEGER NOT NULL,   -- 1, 2, 3... orden de entrega
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un código no puede tener dos secuencias en la misma ruta+día.
-- COALESCE porque en un UNIQUE dos NULL no se consideran iguales.
CREATE UNIQUE INDEX IF NOT EXISTS secuencia_entrega_uk
  ON secuencia_entrega (ruta, COALESCE(dia, ''), codigo);

-- Búsqueda por ruta+día (la que hace el "VLOOKUP" al armar el Excel).
CREATE INDEX IF NOT EXISTS secuencia_entrega_ruta_dia_idx
  ON secuencia_entrega (ruta, dia);

ALTER TABLE secuencia_entrega ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS secuencia_entrega_auth ON secuencia_entrega;
CREATE POLICY secuencia_entrega_auth ON secuencia_entrega
  FOR ALL USING (auth.role() = 'authenticated');

-- Se puede volver a correr sin duplicar: limpia antes de insertar.
DELETE FROM secuencia_entrega;

-- ============================================================================
-- MAESTRO (datos reales del Excel de Rafa)
-- ============================================================================

-- REM-SEG -> Remedios/Segovia  (55 códigos)
INSERT INTO secuencia_entrega (ruta, ciudad, dia, codigo, secuencia) VALUES
  ('Remedios/Segovia', 'SEGOVIA', NULL, '601', 1),
  ('Remedios/Segovia', 'SEGOVIA', NULL, '172', 2),
  ('Remedios/Segovia', 'SEGOVIA', NULL, '149', 3),
  ('Remedios/Segovia', 'SEGOVIA', NULL, '602', 4),
  ('Remedios/Segovia', 'SEGOVIA', NULL, '150', 5),
  ('Remedios/Segovia', 'SEGOVIA', NULL, '123', 6),
  ('Remedios/Segovia', 'SEGOVIA', NULL, '141', 7),
  ('Remedios/Segovia', 'SEGOVIA', NULL, '147', 8),
  ('Remedios/Segovia', 'SEGOVIA', NULL, '129', 9),
  ('Remedios/Segovia', 'SEGOVIA', NULL, '442', 10),
  ('Remedios/Segovia', 'SEGOVIA', NULL, '136', 11),
  ('Remedios/Segovia', 'SEGOVIA', NULL, '276', 12),
  ('Remedios/Segovia', 'SEGOVIA', NULL, '143', 13),
  ('Remedios/Segovia', 'SEGOVIA', NULL, '137', 14),
  ('Remedios/Segovia', 'SEGOVIA', NULL, '127', 15),
  ('Remedios/Segovia', 'SEGOVIA', NULL, '445', 16),
  ('Remedios/Segovia', 'SEGOVIA', NULL, '424', 17),
  ('Remedios/Segovia', 'SEGOVIA', NULL, '146', 18),
  ('Remedios/Segovia', 'SEGOVIA', NULL, '414', 19),
  ('Remedios/Segovia', 'SEGOVIA', NULL, '131', 20),
  ('Remedios/Segovia', 'SEGOVIA', NULL, '135', 21),
  ('Remedios/Segovia', 'SEGOVIA', NULL, '128', 22),
  ('Remedios/Segovia', 'SEGOVIA', NULL, '188', 23),
  ('Remedios/Segovia', 'SEGOVIA', NULL, '438', 24),
  ('Remedios/Segovia', 'SEGOVIA', NULL, '120', 25),
  ('Remedios/Segovia', 'SEGOVIA', NULL, '431', 26),
  ('Remedios/Segovia', 'SEGOVIA', NULL, '177', 27),
  ('Remedios/Segovia', 'SEGOVIA', NULL, '440', 28),
  ('Remedios/Segovia', 'SEGOVIA', NULL, '138', 29),
  ('Remedios/Segovia', 'SEGOVIA', NULL, '140', 30),
  ('Remedios/Segovia', 'SEGOVIA', NULL, '121', 31),
  ('Remedios/Segovia', 'SEGOVIA', NULL, '613', 32),
  ('Remedios/Segovia', 'REMEDIOS', NULL, '134', 33),
  ('Remedios/Segovia', 'REMEDIOS', NULL, '118', 34),
  ('Remedios/Segovia', 'REMEDIOS', NULL, '152', 35),
  ('Remedios/Segovia', 'REMEDIOS', NULL, '433', 36),
  ('Remedios/Segovia', 'REMEDIOS', NULL, '154', 37),
  ('Remedios/Segovia', 'REMEDIOS', NULL, '155', 38),
  ('Remedios/Segovia', 'REMEDIOS', NULL, '883', 39),
  ('Remedios/Segovia', 'REMEDIOS', NULL, '184', 40),
  ('Remedios/Segovia', 'REMEDIOS', NULL, '186', 41),
  ('Remedios/Segovia', 'REMEDIOS', NULL, '178', 42),
  ('Remedios/Segovia', 'REMEDIOS', NULL, '156', 43),
  ('Remedios/Segovia', 'REMEDIOS', NULL, '159', 44),
  ('Remedios/Segovia', 'REMEDIOS', NULL, '161', 45),
  ('Remedios/Segovia', 'REMEDIOS', NULL, '157', 46),
  ('Remedios/Segovia', 'REMEDIOS', NULL, '173', 47),
  ('Remedios/Segovia', 'REMEDIOS', NULL, '151', 48),
  ('Remedios/Segovia', 'REMEDIOS', NULL, '162', 49),
  ('Remedios/Segovia', 'REMEDIOS', NULL, '160', 50),
  ('Remedios/Segovia', 'REMEDIOS', NULL, '153', 51),
  ('Remedios/Segovia', 'REMEDIOS', NULL, '158', 52),
  ('Remedios/Segovia', 'REMEDIOS', NULL, '168', 53),
  ('Remedios/Segovia', 'REMEDIOS', NULL, '165', 54),
  ('Remedios/Segovia', 'REMEDIOS', NULL, '166', 54);

-- CIMITARRA -> Cimitarra  (61 códigos)
INSERT INTO secuencia_entrega (ruta, ciudad, dia, codigo, secuencia) VALUES
  ('Cimitarra', 'CIMITARRA', 'LUNES', '241', 1),
  ('Cimitarra', 'CIMITARRA', 'LUNES', '202', 2),
  ('Cimitarra', 'CIMITARRA', 'LUNES', '609', 3),
  ('Cimitarra', 'CIMITARRA', 'LUNES', '427', 4),
  ('Cimitarra', 'CIMITARRA', 'LUNES', '204', 5),
  ('Cimitarra', 'CIMITARRA', 'LUNES', '605', 6),
  ('Cimitarra', 'CIMITARRA', 'LUNES', '233', 7),
  ('Cimitarra', 'CIMITARRA', 'LUNES', '203', 8),
  ('Cimitarra', 'CIMITARRA', 'LUNES', '200', 9),
  ('Cimitarra', 'CIMITARRA', 'LUNES', '207', 10),
  ('Cimitarra', 'CIMITARRA', 'LUNES', '209', 11),
  ('Cimitarra', 'CIMITARRA', 'LUNES', '219', 12),
  ('Cimitarra', 'CIMITARRA', 'LUNES', '201', 13),
  ('Cimitarra', 'CIMITARRA', 'LUNES', '206', 14),
  ('Cimitarra', 'CIMITARRA', 'LUNES', '423', 15),
  ('Cimitarra', 'CIMITARRA', 'LUNES', '210', 16),
  ('Cimitarra', 'CIMITARRA', 'LUNES', '205', 17),
  ('Cimitarra', 'CIMITARRA', 'LUNES', '604', 18),
  ('Cimitarra', 'CIMITARRA', 'LUNES', '208', 19),
  ('Cimitarra', 'CIMITARRA', 'LUNES', '211', 20),
  ('Cimitarra', 'CIMITARRA', 'LUNES', '216', 21),
  ('Cimitarra', 'CIMITARRA', 'LUNES', '608', 22),
  ('Cimitarra', 'CIMITARRA', 'LUNES', '217', 23),
  ('Cimitarra', 'CIMITARRA', 'LUNES', '279', 24),
  ('Cimitarra', 'CIMITARRA', 'LUNES', '218', 25),
  ('Cimitarra', 'CIMITARRA', 'LUNES', '213', 26),
  ('Cimitarra', 'CIMITARRA', 'LUNES', '879', 27),
  ('Cimitarra', 'CIMITARRA', 'LUNES', '240', 28),
  ('Cimitarra', 'CIMITARRA', 'LUNES', '215', 29),
  ('Cimitarra', 'CIMITARRA', 'LUNES', '220', 30),
  ('Cimitarra', 'FLORESTA', 'JUEVES', '04', 1),
  ('Cimitarra', 'CIMITARRA', 'JUEVES', '241', 2),
  ('Cimitarra', 'CIMITARRA', 'JUEVES', '202', 3),
  ('Cimitarra', 'CIMITARRA', 'JUEVES', '609', 3),
  ('Cimitarra', 'CIMITARRA', 'JUEVES', '209', 5),
  ('Cimitarra', 'CIMITARRA', 'JUEVES', '219', 6),
  ('Cimitarra', 'CIMITARRA', 'JUEVES', '201', 7),
  ('Cimitarra', 'CIMITARRA', 'JUEVES', '206', 8),
  ('Cimitarra', 'CIMITARRA', 'JUEVES', '423', 9),
  ('Cimitarra', 'CIMITARRA', 'JUEVES', '210', 10),
  ('Cimitarra', 'CIMITARRA', 'JUEVES', '205', 11),
  ('Cimitarra', 'CIMITARRA', 'JUEVES', '604', 12),
  ('Cimitarra', 'CIMITARRA', 'JUEVES', '208', 13),
  ('Cimitarra', 'CIMITARRA', 'JUEVES', '211', 14),
  ('Cimitarra', 'CIMITARRA', 'JUEVES', '216', 15),
  ('Cimitarra', 'CIMITARRA', 'JUEVES', '608', 16),
  ('Cimitarra', 'CIMITARRA', 'JUEVES', '217', 17),
  ('Cimitarra', 'CIMITARRA', 'JUEVES', '279', 18),
  ('Cimitarra', 'CIMITARRA', 'JUEVES', '427', 19),
  ('Cimitarra', 'CIMITARRA', 'JUEVES', '218', 20),
  ('Cimitarra', 'CIMITARRA', 'JUEVES', '213', 21),
  ('Cimitarra', 'CIMITARRA', 'JUEVES', '879', 22),
  ('Cimitarra', 'CIMITARRA', 'JUEVES', '240', 23),
  ('Cimitarra', 'CIMITARRA', 'JUEVES', '215', 24),
  ('Cimitarra', 'CIMITARRA', 'JUEVES', '220', 25),
  ('Cimitarra', 'CIMITARRA', 'JUEVES', '204', 26),
  ('Cimitarra', 'CIMITARRA', 'JUEVES', '605', 27),
  ('Cimitarra', 'CIMITARRA', 'JUEVES', '233', 28),
  ('Cimitarra', 'CIMITARRA', 'JUEVES', '203', 29),
  ('Cimitarra', 'CIMITARRA', 'JUEVES', '200', 30),
  ('Cimitarra', 'CIMITARRA', 'JUEVES', '207', 31);

-- FLORES-YALI-VEGA -> Yalí/Vegachí  (18 códigos)
INSERT INTO secuencia_entrega (ruta, ciudad, dia, codigo, secuencia) VALUES
  ('Yalí/Vegachí', 'FLORESTA YOLOMBO', NULL, '273', 1),
  ('Yalí/Vegachí', 'FLORESTA YOLOMBO', NULL, '272', 2),
  ('Yalí/Vegachí', 'YALI', NULL, '447', 3),
  ('Yalí/Vegachí', 'YALI', NULL, '102', 4),
  ('Yalí/Vegachí', 'YALI', NULL, '101', 5),
  ('Yalí/Vegachí', 'YALI', NULL, '105', 6),
  ('Yalí/Vegachí', 'YALI', NULL, '907', 7),
  ('Yalí/Vegachí', 'VEGACHI', NULL, '114', 8),
  ('Yalí/Vegachí', 'VEGACHI', NULL, '615', 9),
  ('Yalí/Vegachí', 'VEGACHI', NULL, '116', 10),
  ('Yalí/Vegachí', 'VEGACHI', NULL, '111', 11),
  ('Yalí/Vegachí', 'VEGACHI', NULL, '112', 12),
  ('Yalí/Vegachí', 'VEGACHI', NULL, '413', 13),
  ('Yalí/Vegachí', 'VEGACHI', NULL, '109', 14),
  ('Yalí/Vegachí', 'VEGACHI', NULL, '110', 15),
  ('Yalí/Vegachí', 'VEGACHI', NULL, '113', 16),
  ('Yalí/Vegachí', 'VEGACHI', NULL, '108', 17),
  ('Yalí/Vegachí', 'VEGACHI', NULL, '106', 18);

-- SAN JOSE - MACEO -> San José/Maceo  (9 códigos)
INSERT INTO secuencia_entrega (ruta, ciudad, dia, codigo, secuencia) VALUES
  ('San José/Maceo', 'MACEO', NULL, '7', 1),
  ('San José/Maceo', 'MACEO', NULL, '17', 2),
  ('San José/Maceo', 'MACEO', NULL, '416', 3),
  ('San José/Maceo', 'SAN JOSE', NULL, '13', 4),
  ('San José/Maceo', 'SAN JOSE', NULL, '34', 5),
  ('San José/Maceo', 'SAN JOSE', NULL, '385', 6),
  ('San José/Maceo', 'SAN JOSE', NULL, '15', 7),
  ('San José/Maceo', 'SAN JOSE', NULL, '12', 8),
  ('San José/Maceo', 'SAN JOSE', NULL, '47', 9);

-- CARACOLI - CRISTAL -> Caracolí/Cristales  (6 códigos)
INSERT INTO secuencia_entrega (ruta, ciudad, dia, codigo, secuencia) VALUES
  ('Caracolí/Cristales', 'CRISTALES', NULL, '99', 1),
  ('Caracolí/Cristales', 'CARACOLI', NULL, '82', 2),
  ('Caracolí/Cristales', 'CARACOLI', NULL, '75', 3),
  ('Caracolí/Cristales', 'CARACOLI', NULL, '80', 4),
  ('Caracolí/Cristales', 'CARACOLI', NULL, '71', 5),
  ('Caracolí/Cristales', 'CARACOLI', NULL, '617', 6);

-- YOLOMBO -> Yolombó  (11 códigos)
INSERT INTO secuencia_entrega (ruta, ciudad, dia, codigo, secuencia) VALUES
  ('Yolombó', 'YOLOMBO', NULL, '611', 1),
  ('Yolombó', 'YOLOMBO', NULL, '268', 2),
  ('Yolombó', 'YOLOMBO', NULL, '265', 3),
  ('Yolombó', 'YOLOMBO', NULL, '266', 4),
  ('Yolombó', 'YOLOMBO', NULL, '264', 5),
  ('Yolombó', 'YOLOMBO', NULL, '269', 6),
  ('Yolombó', 'YOLOMBO', NULL, '262', 7),
  ('Yolombó', 'YOLOMBO', NULL, '261', 8),
  ('Yolombó', 'YOLOMBO', NULL, '263', 9),
  ('Yolombó', 'YOLOMBO', NULL, '260', 10),
  ('Yolombó', 'YOLOMBO', NULL, '430', 11);

-- BERRIO -> Puerto Berrío  (16 códigos)
INSERT INTO secuencia_entrega (ruta, ciudad, dia, codigo, secuencia) VALUES
  ('Puerto Berrío', 'BERRIO', NULL, '428', 1),
  ('Puerto Berrío', 'BERRIO', NULL, '176', 2),
  ('Puerto Berrío', 'BERRIO', NULL, '89', 3),
  ('Puerto Berrío', 'BERRIO', NULL, '90', 4),
  ('Puerto Berrío', 'BERRIO', NULL, '83', 5),
  ('Puerto Berrío', 'BERRIO', NULL, '94', 6),
  ('Puerto Berrío', 'BERRIO', NULL, '85', 7),
  ('Puerto Berrío', 'BERRIO', NULL, '92', 8),
  ('Puerto Berrío', 'BERRIO', NULL, '62', 9),
  ('Puerto Berrío', 'BERRIO', NULL, '98', 10),
  ('Puerto Berrío', 'BERRIO', NULL, '87', 11),
  ('Puerto Berrío', 'BERRIO', NULL, '91', 12),
  ('Puerto Berrío', 'BERRIO', NULL, '93', 13),
  ('Puerto Berrío', 'BERRIO', NULL, '72', 14),
  ('Puerto Berrío', 'BERRIO', NULL, '86', 15),
  ('Puerto Berrío', 'FLORESTA', NULL, '33', 16);

-- CISNEROS SAN ROQUE -> Cisneros/San Roque  (17 códigos)
INSERT INTO secuencia_entrega (ruta, ciudad, dia, codigo, secuencia) VALUES
  ('Cisneros/San Roque', 'CISNEROS', NULL, '69', 1),
  ('Cisneros/San Roque', 'CISNEROS', NULL, '16', 2),
  ('Cisneros/San Roque', 'CISNEROS', NULL, '54', 3),
  ('Cisneros/San Roque', 'CISNEROS', NULL, '8', 4),
  ('Cisneros/San Roque', 'CISNEROS', NULL, '70', 5),
  ('Cisneros/San Roque', 'CISNEROS', NULL, '58', 6),
  ('Cisneros/San Roque', 'CISNEROS', NULL, '32', 7),
  ('Cisneros/San Roque', 'SAN ROQUE', NULL, '40', 8),
  ('Cisneros/San Roque', 'SAN ROQUE', NULL, '36', 9),
  ('Cisneros/San Roque', 'SAN ROQUE', NULL, '45', 10),
  ('Cisneros/San Roque', 'SAN ROQUE', NULL, '31', 11),
  ('Cisneros/San Roque', 'SAN ROQUE', NULL, '50', 12),
  ('Cisneros/San Roque', 'SAN ROQUE', NULL, '38', 13),
  ('Cisneros/San Roque', 'SAN ROQUE', NULL, '612', 14),
  ('Cisneros/San Roque', 'SAN ROQUE', NULL, '29', 15),
  ('Cisneros/San Roque', 'PROVIDENCIA', NULL, '21', 16),
  ('Cisneros/San Roque', 'PROVIDENCIA', NULL, '30', 17);

-- DON MATIAS -> Don Matías  (6 códigos)
INSERT INTO secuencia_entrega (ruta, ciudad, dia, codigo, secuencia) VALUES
  ('Don Matías', 'DON MATIAS', NULL, '415', 1),
  ('Don Matías', 'DON MATIAS', NULL, '419', 2),
  ('Don Matías', 'DON MATIAS', NULL, '28', 3),
  ('Don Matías', 'DON MATIAS', NULL, '606', 4),
  ('Don Matías', 'DON MATIAS', NULL, '331', 5),
  ('Don Matías', 'DON MATIAS', NULL, '417', 6);

-- OMITIDA hoja "GOMEZ PLATA" (5 filas): no existe esa ruta en src/lib/rutas.ts
-- ── PENDIENTES A CONFIRMAR CON RAFA (esta pieza queda ABIERTA) ───────────────
-- 1. RESUELTO: GOMEZ PLATA sí es una ruta real (confirmado por Rafa). Ya está en
--    src/lib/rutas.ts, y sus 5 códigos + el CHECK actualizado de despachos.ruta
--    van en migracion_gomez_plata.sql — ese archivo es aparte y se puede correr
--    en cualquier momento, haya corrido este o no. Por eso los INSERT de GOMEZ
--    PLATA NO están acá abajo.
-- 2. El Excel tiene maestro poblado en BERRIO, CISNEROS SAN ROQUE, DON MATIAS
--    y GOMEZ PLATA, aunque se dijo que esas rutas NO usan secuencia. Se
--    cargaron igual (el dato existe); qué rutas REORDENAN se decide en
--    RUTAS_CON_SECUENCIA (src/lib/secuenciaEntrega.ts), no acá.
-- 3. Verificar que estos códigos sigan vigentes: el maestro es del archivo de
--    Rafa, no de la tabla `clientes`.

-- ── VERIFICACIÓN (opcional) ─────────────────────────────────────────────────
--   SELECT ruta, dia, COUNT(*) AS codigos, MIN(secuencia), MAX(secuencia)
--   FROM secuencia_entrega GROUP BY ruta, dia ORDER BY ruta, dia;
