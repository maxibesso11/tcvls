-- =========================================================
-- Migración 036: conceptos de los movimientos automáticos sin separadores
-- =========================================================
-- Los movimientos que genera el sistema pasan a escribirse con comas y
-- paréntesis, sin guiones largos, flechas ni puntos medios:
--   antes:   FACTURACION VIAJE #12 — Rosario → Córdoba (remito 45) [IVA 21% · líquido producto]
--   ahora:   FACTURACION VIAJE #12, Rosario a Córdoba, remito 45 (IVA 21%, líquido producto)
-- Solo se reescriben los movimientos automáticos (origen_tipo cargado); los
-- cargados a mano quedan como están.
-- =========================================================

UPDATE MOVIMIENTOS
   SET concepto = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
         concepto,
         ' — ', ', '),
         ' → ', ' a '),
         ' (remito ', ', remito '),
         ') [', ' ['),
         '[', '('),
         ']', ')'),
         ' · ', ', '),
         ' + IVA', ' e IVA')
 WHERE origen_tipo IS NOT NULL
   AND (concepto LIKE '% — %' OR concepto LIKE '% → %' OR concepto LIKE '%[%' OR concepto LIKE '% · %');
