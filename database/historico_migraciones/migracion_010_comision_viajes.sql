-- =========================================================
-- MIGRACIÓN 010: Eliminar celdas y agregar comisión en VIAJES
-- - Se elimina la columna 'celdas' (innecesaria).
-- - Se agrega 'comision' (% que se descuenta al cliente al facturar).
-- Nota: a partir de esta versión, el valor que se imputa a la cuenta
-- del pagador al facturar un viaje se calcula como:
--     neto = (tarifa × resultado)  −  comisión%
--     total = neto × 1.21   (IVA 21%)
-- =========================================================
ALTER TABLE VIAJES
    DROP COLUMN celdas,
    ADD COLUMN comision DECIMAL(5, 2) DEFAULT 0 AFTER resultado;
