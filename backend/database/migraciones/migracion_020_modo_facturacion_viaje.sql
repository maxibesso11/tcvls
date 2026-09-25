-- Migración 020: modo de facturación del viaje
--
-- Agrega a VIAJES el modo con que se imputa el viaje en la cuenta del cliente
-- al marcarlo como FACTURADO:
--   SIN_FACTURAR      → se imputa el neto sin IVA
--   LIQUIDO_PRODUCTO  → se imputa el neto + IVA (sin comprobante formal)
--   FACTURA           → se imputa el neto + IVA y se emite la Factura A
--
-- Los viajes ya facturados antes de esta migración quedan con NULL, que el
-- sistema trata como "con IVA" (equivalente a LIQUIDO_PRODUCTO), preservando
-- el monto que ya tenían imputado. Para dejar el dato explícito, la segunda
-- sentencia marca esos viajes históricos como LIQUIDO_PRODUCTO.

ALTER TABLE VIAJES
  ADD COLUMN modo_facturacion ENUM('SIN_FACTURAR', 'LIQUIDO_PRODUCTO', 'FACTURA') DEFAULT NULL
  COMMENT 'Cómo se imputa el viaje en la cuenta del cliente al facturar'
  AFTER estado;

-- Los viajes ya FACTURADOS tenían IVA incluido: se marcan como líquido producto.
UPDATE VIAJES
   SET modo_facturacion = 'LIQUIDO_PRODUCTO'
 WHERE estado = 'FACTURADO' AND modo_facturacion IS NULL;
