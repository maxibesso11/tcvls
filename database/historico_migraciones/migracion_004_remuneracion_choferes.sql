-- =========================================================
-- MIGRACIÓN 004: Remuneración de choferes
-- Agrega los campos remuneracion (valor) y tipo_remuneracion
-- (POR KM / PORCENTAJE / FIJA) a la tabla CHOFERES.
-- Ejecutar solo si la base ya existía sin estos campos; las
-- instalaciones nuevas no la necesitan porque schema.sql ya los incluye.
-- =========================================================
ALTER TABLE CHOFERES
    ADD COLUMN remuneracion DECIMAL(10, 2) AFTER telefono,
    ADD COLUMN tipo_remuneracion ENUM('POR KM', 'PORCENTAJE', 'FIJA') AFTER remuneracion;
