-- =========================================================
-- MIGRACIÓN 006: Liquidación de choferes por viajes finalizados
-- Genera el crédito en la cuenta del chofer (CHOFER) por cada
-- viaje en estado FINALIZADO o FACTURADO, según el tipo de
-- remuneración:
--   - PORCENTAJE : valor_viaje × (remuneracion / 100)
--   - POR KM     : km × remuneracion (solo si tarifa del viaje POR KM)
--   - POR KM sin km medibles: $0 con aclaración [PENDIENTE]
--   - FIJA       : no genera movimiento
-- Idempotente: usa NOT EXISTS y un patrón único por id de viaje.
-- =========================================================

-- Liquidaciones con monto calculable (PORCENTAJE o POR KM con km)
INSERT INTO MOVIMIENTOS (id_cuenta, monto, fecha, concepto)
SELECT
  c.id_cuenta,
  CASE
    WHEN ch.tipo_remuneracion = 'PORCENTAJE' THEN
      (CASE WHEN v.tipo_tarifa = 'UNICA' THEN v.tarifa
            ELSE v.tarifa * COALESCE(v.resultado, v.cantidad_cargada, 0)
       END) * (ch.remuneracion / 100)
    WHEN ch.tipo_remuneracion = 'POR KM' AND v.tipo_tarifa = 'POR KM' THEN
      COALESCE(v.resultado, 0) * ch.remuneracion
    ELSE 0
  END,
  COALESCE(v.fecha_llegada, v.fecha_origen),
  CONCAT('LIQUIDACION VIAJE #', v.id_viaje, ' — ', v.origen, ' → ', v.destino)
FROM VIAJES v
JOIN EQUIPO e    ON e.id_equipo = v.id_equipo
JOIN CHOFERES ch ON ch.id_chofer = e.id_chofer
JOIN CUENTA c    ON c.cuil = ch.cuil AND c.tipo = 'CHOFER'
WHERE v.estado IN ('FINALIZADO', 'FACTURADO')
  AND ch.tipo_remuneracion IN ('PORCENTAJE', 'POR KM')
  AND ch.remuneracion IS NOT NULL
  AND (ch.tipo_remuneracion = 'PORCENTAJE'
       OR (ch.tipo_remuneracion = 'POR KM' AND v.tipo_tarifa = 'POR KM'))
  AND NOT EXISTS (
    SELECT 1 FROM MOVIMIENTOS m
    WHERE m.concepto LIKE CONCAT('LIQUIDACION VIAJE #', v.id_viaje, ' —%')
  )
HAVING monto > 0;

-- Liquidaciones pendientes: chofer POR KM en viaje sin km medibles → $0 con aviso
INSERT INTO MOVIMIENTOS (id_cuenta, monto, fecha, concepto)
SELECT
  c.id_cuenta,
  0,
  COALESCE(v.fecha_llegada, v.fecha_origen),
  CONCAT('LIQUIDACION VIAJE #', v.id_viaje, ' — ', v.origen, ' → ', v.destino,
         ' [PENDIENTE: faltan los km recorridos para liquidar al chofer]')
FROM VIAJES v
JOIN EQUIPO e    ON e.id_equipo = v.id_equipo
JOIN CHOFERES ch ON ch.id_chofer = e.id_chofer
JOIN CUENTA c    ON c.cuil = ch.cuil AND c.tipo = 'CHOFER'
WHERE v.estado IN ('FINALIZADO', 'FACTURADO')
  AND ch.tipo_remuneracion = 'POR KM'
  AND v.tipo_tarifa <> 'POR KM'
  AND NOT EXISTS (
    SELECT 1 FROM MOVIMIENTOS m
    WHERE m.concepto LIKE CONCAT('LIQUIDACION VIAJE #', v.id_viaje, ' —%')
  );
