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

-- Relleno para los viajes existentes, en dos pasos:
--
-- 1. El chofer al que ya se le LIQUIDÓ el viaje (movimiento
--    "LIQUIDACION VIAJE #<id> — ..." en su cuenta CHOFER). Es el dato real
--    de quién hizo el viaje, aunque después haya rotado de equipo.
UPDATE VIAJES v
JOIN MOVIMIENTOS m ON m.id_empresa = v.id_empresa
                  AND m.concepto LIKE CONCAT('LIQUIDACION VIAJE #', v.id_viaje, ' %')
JOIN CUENTA c ON c.id_cuenta = m.id_cuenta AND c.tipo = 'CHOFER'
JOIN CHOFERES ch ON ch.cuil = c.cuil AND ch.id_empresa = c.id_empresa
SET v.id_chofer = ch.id_chofer
WHERE v.id_chofer IS NULL;

-- 2. Viajes sin liquidación (en curso, o de choferes eliminados): se asume
--    el chofer actual del equipo, la mejor información disponible. Si alguno
--    fue de otro chofer: UPDATE VIAJES SET id_chofer = X WHERE id_viaje = Y;
UPDATE VIAJES v
JOIN EQUIPO e ON e.id_equipo = v.id_equipo
SET v.id_chofer = e.id_chofer
WHERE v.id_chofer IS NULL;
