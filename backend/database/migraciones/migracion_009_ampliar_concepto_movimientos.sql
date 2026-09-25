-- =========================================================
-- MIGRACIÓN 009: Ampliar concepto de MOVIMIENTOS a 255
-- El límite anterior de 150 caracteres era insuficiente para
-- los conceptos automáticos largos, como la liquidación pendiente
-- de un chofer por km cuando el viaje no registra kilómetros.
-- =========================================================
ALTER TABLE MOVIMIENTOS
    MODIFY COLUMN concepto VARCHAR(255) NOT NULL;
