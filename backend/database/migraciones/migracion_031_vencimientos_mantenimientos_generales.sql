-- =========================================================
-- Migración 031: vencimientos y mantenimientos generales de la flota
-- =========================================================
-- Hasta ahora todo vencimiento y todo mantenimiento colgaba de una unidad.
-- Ahora también pueden ser generales de la flota (un impuesto, un seguro
-- colectivo, una habilitación de la empresa…): id_unidad queda en NULL.
-- Los registros existentes no cambian. La clave foránea a UNIDADES se
-- conserva: una unidad con vencimientos o mantenimientos sigue sin poder
-- eliminarse.
-- =========================================================

ALTER TABLE VENCIMIENTOS    MODIFY COLUMN id_unidad INT NULL;
ALTER TABLE MANTENIMIENTOS  MODIFY COLUMN id_unidad INT NULL;
