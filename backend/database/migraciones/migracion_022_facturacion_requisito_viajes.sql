-- Migración 022: facturación y cuentas pasan a ser módulos SIEMPRE activos
--
-- Con la forma de trabajar actual, marcar un viaje como FACTURADO abre el flujo
-- de facturación e imputa en la cuenta corriente del cliente. Por eso los
-- módulos "facturacion" y "cuentas" son núcleo del sistema y deben estar
-- siempre activos en todas las empresas (ya no se pueden desactivar).
--
-- Esta migración los activa en TODAS las empresas: inserta la fila donde falta
-- y la reactiva donde estuviera apagada. Se usa INSERT ... ON DUPLICATE KEY
-- UPDATE, que es una sentencia INSERT y por lo tanto NO se ve afectada por el
-- "modo de actualización segura" de MySQL Workbench (error 1175).

INSERT INTO MODULOS_EMPRESA (id_empresa, modulo, activo)
SELECT id_empresa, 'cuentas', 1 FROM EMPRESAS
ON DUPLICATE KEY UPDATE activo = 1;

INSERT INTO MODULOS_EMPRESA (id_empresa, modulo, activo)
SELECT id_empresa, 'facturacion', 1 FROM EMPRESAS
ON DUPLICATE KEY UPDATE activo = 1;
