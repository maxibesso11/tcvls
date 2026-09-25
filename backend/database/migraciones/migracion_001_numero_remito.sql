-- =========================================================
-- MIGRACIÓN 001: Agregar numero_remito a VIAJES
-- Ejecutar solo si la base de datos ya fue creada con el
-- schema anterior. Las instalaciones nuevas no la necesitan
-- porque schema.sql ya incluye el campo.
-- =========================================================
ALTER TABLE VIAJES
    ADD COLUMN numero_remito VARCHAR(20) AFTER estado_pago,
    ADD INDEX idx_numero_remito (numero_remito);
