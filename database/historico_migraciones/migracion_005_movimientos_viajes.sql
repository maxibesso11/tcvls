-- =========================================================
-- MIGRACIÓN 005: Movimientos automáticos por viajes facturados
-- Genera el débito en la cuenta del pagador para cada viaje en
-- estado FACTURADO cuyo pagador coincida con una cuenta CLIENTE
-- o PROVEEDOR.
-- Idempotente: usa NOT EXISTS y un patrón único por id de viaje.
-- =========================================================
INSERT INTO MOVIMIENTOS (id_cuenta, monto, fecha, concepto)
SELECT
  c.id_cuenta,
  -- Débito al pagador: monto negativo (el pagador adeuda)
  -1 * (CASE
    WHEN v.tipo_tarifa = 'UNICA' THEN v.tarifa
    ELSE v.tarifa * COALESCE(v.resultado, v.cantidad_cargada, 0)
  END),
  COALESCE(v.fecha_facturado, v.fecha_llegada, v.fecha_origen),
  CONCAT('FACTURACION VIAJE #', v.id_viaje, ' — ', v.origen, ' → ', v.destino,
         IF(v.numero_remito IS NOT NULL, CONCAT(' (remito ', v.numero_remito, ')'), ''))
FROM VIAJES v
JOIN CUENTA c ON c.nombre = v.pagador AND c.tipo IN ('CLIENTE', 'PROVEEDOR')
WHERE v.estado = 'FACTURADO'
  AND v.pagador IS NOT NULL
  AND v.pagador <> ''
  AND NOT EXISTS (
    SELECT 1 FROM MOVIMIENTOS m
    WHERE m.concepto LIKE CONCAT('FACTURACION VIAJE #', v.id_viaje, ' —%')
  );
