-- =========================================================
-- MIGRACIÓN 003: Movimientos automáticos por consumos existentes
-- Genera el movimiento de cuenta corriente correspondiente a cada
-- consumo (de combustible y general) cuyo proveedor coincide con
-- una cuenta tipo PROVEEDOR o CLIENTE.
-- Idempotente: usa NOT EXISTS y un patrón de concepto único por
-- id de consumo, por lo que puede correrse varias veces sin duplicar.
-- =========================================================

-- Movimientos por CONSUMOS_COMBUSTIBLE
INSERT INTO MOVIMIENTOS (id_cuenta, monto, fecha, concepto)
SELECT
  c.id_cuenta,
  cc.cantidad_litros * cc.precio_por_litro,
  cc.fecha,
  CONCAT('CONSUMO COMBUSTIBLE #', cc.id_consumo_combustible,
         ' — ', cc.cantidad_litros, ' L en ', cc.estacion_carga)
FROM CONSUMOS_COMBUSTIBLE cc
JOIN CUENTA c ON c.nombre = cc.proveedor AND c.tipo IN ('PROVEEDOR', 'CLIENTE')
WHERE NOT EXISTS (
  SELECT 1 FROM MOVIMIENTOS m
  WHERE m.concepto LIKE CONCAT('CONSUMO COMBUSTIBLE #', cc.id_consumo_combustible, ' —%')
);

-- Movimientos por CONSUMOS_GENERALES
INSERT INTO MOVIMIENTOS (id_cuenta, monto, fecha, concepto)
SELECT
  c.id_cuenta,
  cg.monto,
  cg.fecha,
  CONCAT('CONSUMO GENERAL #', cg.id_consumo_general, ' — ', cg.concepto)
FROM CONSUMOS_GENERALES cg
JOIN CUENTA c ON c.nombre = cg.proveedor AND c.tipo IN ('PROVEEDOR', 'CLIENTE')
WHERE NOT EXISTS (
  SELECT 1 FROM MOVIMIENTOS m
  WHERE m.concepto LIKE CONCAT('CONSUMO GENERAL #', cg.id_consumo_general, ' —%')
);
