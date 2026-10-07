-- =========================================================
-- Migración 033: baja de equipos
-- =========================================================
-- Un equipo se puede dar de baja (por ejemplo, el chofer dejó la empresa):
-- su historia queda intacta (EQUIPO_HISTORIAL cierra el período vigente en
-- la fecha de baja), deja de ofrecerse para cargar viajes y consumos, y sus
-- unidades y su chofer quedan libres para otro equipo. Antes, como un equipo
-- no podía quedar sin camión ni chofer, se cargaban unidades inventadas para
-- "liberar" el camión, y esas patentes aparecían en las métricas.
--
-- Todos los equipos existentes quedan activos. Los que deban darse de baja
-- se corrigen con scripts/reemplazar-historial-equipo.js. Correr DESPUÉS de
-- la 032.
-- =========================================================

ALTER TABLE EQUIPO
  ADD COLUMN activo TINYINT(1) NOT NULL DEFAULT 1 AFTER peso_bruto,
  ADD COLUMN fecha_baja DATETIME NULL AFTER activo,
  ADD INDEX idx_equipo_activo (id_empresa, activo);
