-- =========================================================
-- Migración 025: foto de las unidades en el viaje
-- =========================================================
-- Un viaje solo guardaba su EQUIPO. Como la composición de un equipo se
-- puede editar (cambiar el camión o el acoplado), al editarla toda la
-- historia de viajes del equipo pasaba a mostrarse con las unidades nuevas:
-- la rentabilidad y los datos del camión anterior "desaparecían".
--
-- Igual que id_chofer (migración 018), el viaje guarda ahora qué camión
-- (unidad principal) y qué acoplado (unidad secundaria) lo hicieron, tomados
-- del equipo al crear el viaje o al cambiarle el equipo.
--
-- Relleno: se usa la composición ACTUAL de cada equipo, la única información
-- disponible. Si un equipo cambió de unidades antes de esta migración, sus
-- viajes anteriores quedan con las unidades nuevas y deben corregirse a mano:
--   UPDATE VIAJES SET id_unidad_principal = X, id_unidad_secundaria = Y
--    WHERE id_equipo = Z AND fecha_origen < 'AAAA-MM-DD';
-- Correr DESPUÉS de la 024.
-- =========================================================

ALTER TABLE VIAJES
  ADD COLUMN id_unidad_principal INT NULL AFTER id_chofer,
  ADD COLUMN id_unidad_secundaria INT NULL AFTER id_unidad_principal,
  ADD CONSTRAINT fk_viaje_unidad_principal FOREIGN KEY (id_unidad_principal)
    REFERENCES UNIDADES(id_unidad) ON DELETE SET NULL,
  ADD CONSTRAINT fk_viaje_unidad_secundaria FOREIGN KEY (id_unidad_secundaria)
    REFERENCES UNIDADES(id_unidad) ON DELETE SET NULL;

UPDATE VIAJES v
JOIN EQUIPO e ON e.id_equipo = v.id_equipo AND e.id_empresa = v.id_empresa
SET v.id_unidad_principal = e.id_unidad_principal,
    v.id_unidad_secundaria = e.id_unidad_secundaria
WHERE v.id_unidad_principal IS NULL;

-- Verificación: viajes que quedaron sin foto (debería dar 0).
SELECT COUNT(*) AS viajes_sin_unidades FROM VIAJES WHERE id_unidad_principal IS NULL;
