-- =========================================================
-- MIGRACIÓN 013: Tema de color por usuario
-- Agrega la columna 'tema' a USUARIOS para que cada usuario
-- pueda personalizar la apariencia del sistema. El valor por
-- defecto es 'verde' (el tema original).
-- Temas válidos: verde, azul, violeta, borgona, grafito, oceano
-- =========================================================
ALTER TABLE USUARIOS
  ADD COLUMN tema VARCHAR(30) NOT NULL DEFAULT 'verde' AFTER rol;
