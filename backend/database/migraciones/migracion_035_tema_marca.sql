-- =========================================================
-- Migración 035: tema de la marca por defecto
-- =========================================================
-- El tema "TCV" pasa a usar los colores oficiales de la marca (carbón
-- #282828 y celeste #4cc3ff) y es el de todo usuario nuevo. Quienes tenían
-- "verde" (el que se asignaba por defecto) pasan a "TCV"; los que eligieron
-- otro tema lo conservan.
-- =========================================================

ALTER TABLE USUARIOS MODIFY tema VARCHAR(30) NOT NULL DEFAULT 'tcv';
UPDATE USUARIOS SET tema = 'tcv' WHERE tema = 'verde';
