-- =========================================================
-- MIGRACIÓN 007: Identificador y fecha de colocación en CUBIERTAS
-- Agrega los campos identificador (VARCHAR 50) y fecha_colocacion
-- (DATE) a la tabla CUBIERTAS.
-- Ejecutar solo si la base ya existía sin estos campos.
-- =========================================================
ALTER TABLE CUBIERTAS
    ADD COLUMN identificador VARCHAR(50) AFTER id_cubierta,
    ADD COLUMN fecha_colocacion DATE AFTER ubicacion;
