-- =========================================================
-- Migración 034: facturación electrónica (comprobantes A, B y C con ARCA)
-- =========================================================
-- - ARCA_TICKETS: tickets de acceso de ARCA (WSAA), cifrados. ARCA rechaza
--   pedir uno nuevo mientras hay otro vigente, así que se guardan apenas llegan
--   y se reutilizan hasta que vencen (ver integraciones/arca/tickets.js).
-- - FACTURAS:
--     · estados BORRADOR (editable, sin número) → PENDIENTE (número reservado,
--       esperando el CAE) → EMITIDA → ANULADA (por nota de crédito). Un
--       comprobante que ARCA rechaza vuelve a BORRADOR, sin número.
--     · numero pasa a admitir NULL (los borradores no tienen número).
--     · codigo_arca (1/6/11 facturas, 3/8/13 notas de crédito), concepto,
--       período del servicio, vencimiento del pago, documento y condición del
--       receptor, condición del emisor y entorno (HOMOLOGACION/PRODUCCION).
--     · la numeración es única por empresa, entorno, letra, clase y punto de venta.
-- - FACTURA_VIAJES: los viajes que incluye cada comprobante (puede ser más de uno).
-- - FACTURA_ITEMS: el viaje de cada renglón y cantidades con 3 decimales.
-- - CUENTA: plantilla de renglón y de observaciones del facturador por cliente.
-- - MOVIMIENTOS.monto pasa a DECIMAL(14, 2): un comprobante que agrupa muchos
--   viajes puede superar los $ 99.999.999,99 que admitía.
-- Las facturas existentes (borradores internos de la versión anterior) quedan
-- como estaban. Correr DESPUÉS de la 033.
-- =========================================================

CREATE TABLE ARCA_TICKETS (
    id_ticket INT AUTO_INCREMENT PRIMARY KEY,
    cuit VARCHAR(11) NOT NULL,
    entorno ENUM('HOMOLOGACION', 'PRODUCCION') NOT NULL,
    servicio VARCHAR(20) NOT NULL,
    huella_certificado CHAR(64) NOT NULL,
    token_cifrado MEDIUMTEXT NOT NULL,
    sign_cifrado MEDIUMTEXT NOT NULL,
    generado DATETIME NOT NULL,
    expira DATETIME NOT NULL,
    UNIQUE KEY uq_ticket (cuit, entorno, servicio, huella_certificado)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE FACTURAS
  DROP INDEX uq_factura_numero,
  MODIFY COLUMN numero INT NULL,
  MODIFY COLUMN estado ENUM('BORRADOR', 'PENDIENTE', 'EMITIDA', 'ANULADA') NOT NULL DEFAULT 'BORRADOR',
  MODIFY COLUMN observaciones TEXT NULL,
  ADD COLUMN entorno ENUM('HOMOLOGACION', 'PRODUCCION') NULL AFTER id_empresa,
  ADD COLUMN codigo_arca SMALLINT NULL AFTER tipo_comprobante,
  ADD COLUMN concepto TINYINT NOT NULL DEFAULT 2 AFTER fecha_emision,
  ADD COLUMN fecha_servicio_desde DATE NULL AFTER concepto,
  ADD COLUMN fecha_servicio_hasta DATE NULL AFTER fecha_servicio_desde,
  ADD COLUMN fecha_vto_pago DATE NULL AFTER fecha_servicio_hasta,
  ADD COLUMN receptor_doc_tipo SMALLINT NULL AFTER receptor_cuit,
  ADD COLUMN condicion_iva_receptor_id SMALLINT NULL AFTER receptor_condicion_iva,
  ADD COLUMN emisor_condicion_iva VARCHAR(40) NULL AFTER condicion_iva_receptor_id,
  ADD COLUMN respuesta_arca TEXT NULL AFTER estado,
  ADD UNIQUE KEY uq_factura_numero (id_empresa, entorno, tipo_comprobante, clase, punto_venta, numero),
  ADD INDEX idx_fac_estado (id_empresa, estado);

CREATE TABLE FACTURA_VIAJES (
    id_factura INT NOT NULL,
    id_viaje INT NOT NULL,
    PRIMARY KEY (id_factura, id_viaje),
    FOREIGN KEY (id_factura) REFERENCES FACTURAS(id_factura) ON DELETE CASCADE,
    FOREIGN KEY (id_viaje) REFERENCES VIAJES(id_viaje) ON DELETE RESTRICT,
    INDEX idx_fv_viaje (id_viaje)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Los viajes que ya tenían factura (una por viaje) pasan a la tabla nueva.
INSERT IGNORE INTO FACTURA_VIAJES (id_factura, id_viaje)
SELECT id_factura, id_viaje FROM FACTURAS WHERE id_viaje IS NOT NULL;

ALTER TABLE FACTURA_ITEMS
  MODIFY COLUMN cantidad DECIMAL(12, 3) NOT NULL DEFAULT 1,
  ADD COLUMN id_viaje INT NULL AFTER id_factura,
  ADD CONSTRAINT fk_item_viaje FOREIGN KEY (id_viaje) REFERENCES VIAJES(id_viaje) ON DELETE SET NULL;

ALTER TABLE CUENTA
  ADD COLUMN plantilla_item VARCHAR(255) NULL AFTER condicion_iva,
  ADD COLUMN plantilla_observaciones TEXT NULL AFTER plantilla_item;

ALTER TABLE MOVIMIENTOS MODIFY monto DECIMAL(14, 2) NOT NULL;
