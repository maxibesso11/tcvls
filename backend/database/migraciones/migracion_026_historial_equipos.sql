-- =========================================================
-- Migración 026: historial de composición de los equipos
-- =========================================================
-- Cada fila es un período en el que un equipo tuvo un camión (unidad
-- principal), un acoplado (unidad secundaria) y un chofer:
--   desde NULL  → desde el alta del equipo (sin fecha de inicio conocida)
--   hasta NULL  → período vigente
-- Al editar el camión, el acoplado o el chofer de un equipo se cierra el
-- período vigente y se abre uno nuevo; nunca se borra ni se pisa la historia.
-- La foto de cada viaje (chofer y unidades, migraciones 018 y 025) se toma de
-- este historial según la fecha de origen del viaje, y la rentabilidad asigna
-- los consumos de cada unidad al equipo que la tenía en esa fecha.
--
-- Relleno, coherente con la foto que ya tiene cada viaje (018 y 025):
--   1. Los períodos salen de los viajes: cada vez que cambia el chofer o las
--      unidades de un viaje al siguiente (por fecha de origen), empieza un
--      período nuevo en la fecha de ese viaje. El primero va "desde el alta".
--   2. Equipos sin viajes: un período con su composición actual.
--   3. Si la composición actual del equipo no coincide con la del último
--      período, se cierra ese período ahora (hora argentina, como las fechas
--      de los viajes) y se abre uno con la actual.
-- Así, recalcular la foto de cualquier viaje desde el historial da lo mismo
-- que ya tenía (la verificación final debe dar 0).
-- Las correcciones de equipos que cambiaron de unidades antes de esta
-- migración se cargan después con los datos que confirme la empresa.
-- Las unidades y los choferes de un período no se pueden eliminar (RESTRICT):
-- la historia no se pierde. Correr DESPUÉS de la 025.
-- =========================================================

CREATE TABLE EQUIPO_HISTORIAL (
    id_historial INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    id_equipo INT NOT NULL,
    id_unidad_principal INT NOT NULL,
    id_unidad_secundaria INT NOT NULL,
    id_chofer INT NOT NULL,
    desde DATETIME NULL,
    hasta DATETIME NULL,
    id_usuario INT NULL,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    FOREIGN KEY (id_equipo) REFERENCES EQUIPO(id_equipo) ON DELETE CASCADE,
    FOREIGN KEY (id_unidad_principal) REFERENCES UNIDADES(id_unidad) ON DELETE RESTRICT,
    FOREIGN KEY (id_unidad_secundaria) REFERENCES UNIDADES(id_unidad) ON DELETE RESTRICT,
    FOREIGN KEY (id_chofer) REFERENCES CHOFERES(id_chofer) ON DELETE RESTRICT,
    FOREIGN KEY (id_usuario) REFERENCES USUARIOS(id_usuario) ON DELETE SET NULL,
    INDEX idx_historial_equipo (id_empresa, id_equipo, desde),
    INDEX idx_historial_principal (id_unidad_principal),
    INDEX idx_historial_secundaria (id_unidad_secundaria)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 1. Períodos a partir de las fotos de los viajes
INSERT INTO EQUIPO_HISTORIAL (id_empresa, id_equipo, id_unidad_principal, id_unidad_secundaria, id_chofer, desde, hasta)
WITH fotos AS (
  SELECT id_empresa, id_equipo, id_viaje, fecha_origen, id_chofer, id_unidad_principal, id_unidad_secundaria,
         LAG(CONCAT_WS('-', id_chofer, id_unidad_principal, id_unidad_secundaria))
           OVER (PARTITION BY id_equipo ORDER BY fecha_origen, id_viaje) AS anterior
    FROM VIAJES
   WHERE id_chofer IS NOT NULL AND id_unidad_principal IS NOT NULL AND id_unidad_secundaria IS NOT NULL
), cortes AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY id_equipo ORDER BY fecha_origen, id_viaje) AS n
    FROM fotos
   WHERE anterior IS NULL OR anterior <> CONCAT_WS('-', id_chofer, id_unidad_principal, id_unidad_secundaria)
)
SELECT id_empresa, id_equipo, id_unidad_principal, id_unidad_secundaria, id_chofer,
       IF(n = 1, NULL, fecha_origen),
       LEAD(fecha_origen) OVER (PARTITION BY id_equipo ORDER BY fecha_origen, id_viaje)
  FROM cortes;

-- 2. Equipos sin viajes
INSERT INTO EQUIPO_HISTORIAL (id_empresa, id_equipo, id_unidad_principal, id_unidad_secundaria, id_chofer, desde, hasta)
SELECT e.id_empresa, e.id_equipo, e.id_unidad_principal, e.id_unidad_secundaria, e.id_chofer, NULL, NULL
  FROM EQUIPO e
 WHERE NOT EXISTS (SELECT 1 FROM EQUIPO_HISTORIAL h WHERE h.id_equipo = e.id_equipo);

-- 3. Composición actual distinta de la del último período
CREATE TEMPORARY TABLE tmp_equipos_cambiados AS
SELECT h.id_historial, e.id_empresa, e.id_equipo, e.id_unidad_principal, e.id_unidad_secundaria, e.id_chofer
  FROM EQUIPO e
  JOIN EQUIPO_HISTORIAL h ON h.id_equipo = e.id_equipo AND h.hasta IS NULL
 WHERE (h.id_chofer, h.id_unidad_principal, h.id_unidad_secundaria)
    <> (e.id_chofer, e.id_unidad_principal, e.id_unidad_secundaria);

UPDATE EQUIPO_HISTORIAL h JOIN tmp_equipos_cambiados c ON c.id_historial = h.id_historial
   SET h.hasta = CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-03:00');

INSERT INTO EQUIPO_HISTORIAL (id_empresa, id_equipo, id_unidad_principal, id_unidad_secundaria, id_chofer, desde, hasta)
SELECT id_empresa, id_equipo, id_unidad_principal, id_unidad_secundaria, id_chofer, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-03:00'), NULL
  FROM tmp_equipos_cambiados;

DROP TEMPORARY TABLE tmp_equipos_cambiados;

-- Verificación 1: un único período vigente por equipo (debe dar 0 filas).
SELECT e.id_equipo AS equipo_sin_periodo_vigente_unico FROM EQUIPO e
  LEFT JOIN EQUIPO_HISTORIAL h ON h.id_equipo = e.id_equipo AND h.hasta IS NULL
 GROUP BY e.id_equipo HAVING COUNT(h.id_historial) <> 1;

-- Verificación 2: viajes cuya foto no coincide con su período (debe dar 0).
SELECT COUNT(*) AS viajes_con_foto_distinta_al_historial
  FROM VIAJES v
  JOIN EQUIPO_HISTORIAL h ON h.id_equipo = v.id_equipo
   AND (h.desde IS NULL OR h.desde <= v.fecha_origen) AND (h.hasta IS NULL OR h.hasta > v.fecha_origen)
 WHERE (v.id_chofer, v.id_unidad_principal, v.id_unidad_secundaria)
    <> (h.id_chofer, h.id_unidad_principal, h.id_unidad_secundaria);
