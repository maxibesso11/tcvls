-- =========================================================
-- MIGRACIÓN 018: Foto del chofer en el viaje
-- Agrega VIAJES.id_chofer: el chofer que efectivamente hizo el viaje,
-- tomado del equipo al momento de crearlo. La liquidación al chofer usa
-- esta foto, de modo que rotar choferes entre equipos no altera la
-- liquidación de viajes históricos.
-- =========================================================

ALTER TABLE VIAJES
  ADD COLUMN id_chofer INT NULL AFTER id_equipo,
  ADD CONSTRAINT fk_viaje_chofer FOREIGN KEY (id_chofer)
    REFERENCES CHOFERES(id_chofer) ON DELETE SET NULL;

-- Relleno para los viajes existentes: se asume que el chofer actual de
-- cada equipo es quien hizo sus viajes pasados (la mejor información
-- disponible). Si algún viaje histórico fue de otro chofer, puede
-- corregirse manualmente: UPDATE VIAJES SET id_chofer = X WHERE id_viaje = Y;
UPDATE VIAJES v
JOIN EQUIPO e ON e.id_equipo = v.id_equipo
SET v.id_chofer = e.id_chofer
WHERE v.id_chofer IS NULL;
