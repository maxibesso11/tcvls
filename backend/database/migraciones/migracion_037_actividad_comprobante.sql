-- =========================================================
-- Migración 037: actividad del emisor en cada comprobante
-- =========================================================
-- ARCA permite indicar en cada comprobante la actividad inscripta del emisor
-- por la que se factura (por ejemplo, transporte o servicios de logística),
-- como en su facturador web. Se guarda el código y la descripción en el
-- comprobante, y la última usada con cada cliente para proponerla.
-- =========================================================

ALTER TABLE FACTURAS
  ADD COLUMN actividad_id BIGINT NULL AFTER concepto,
  ADD COLUMN actividad_descripcion VARCHAR(255) NULL AFTER actividad_id;

ALTER TABLE CUENTA
  ADD COLUMN actividad_arca BIGINT NULL AFTER plantilla_observaciones;
