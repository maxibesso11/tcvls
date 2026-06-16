-- =========================================================
-- MIGRACIÓN 014: Iniciales del logo por empresa
-- Permite que cada empresa defina las iniciales que se muestran
-- en el logo del frontend (el recuadro junto al nombre).
-- Si no se definen, el sistema las deriva del nombre.
-- =========================================================
ALTER TABLE EMPRESAS
  ADD COLUMN iniciales VARCHAR(4) AFTER nombre;

-- Asignar iniciales a la empresa de ejemplo existente
UPDATE EMPRESAS SET iniciales = '3A' WHERE id_empresa = 1;
