-- =========================================================
-- MIGRACIÓN 008: Eliminar estado_pago y fecha_facturado de VIAJES
-- El seguimiento de pagos se realiza exclusivamente mediante
-- movimientos (recibos) en la cuenta corriente del pagador.
-- =========================================================
ALTER TABLE VIAJES
    DROP COLUMN estado_pago,
    DROP COLUMN fecha_facturado;
