-- =========================================================
-- MIGRACIÓN 015: Pesos de tara y bruto en los equipos
-- Agrega el peso de tara (vehículo vacío) y el peso bruto
-- (máximo cargado) a cada equipo.
-- =========================================================
ALTER TABLE EQUIPO
  ADD COLUMN peso_tara DECIMAL(10,2) AFTER id_chofer,
  ADD COLUMN peso_bruto DECIMAL(10,2) AFTER peso_tara;
