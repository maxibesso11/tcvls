-- =========================================================
-- MIGRACIÓN 002: Sincronización CHOFERES <-> CUENTA
-- Crea cuentas tipo CHOFER para choferes que aún no la tienen.
-- Idempotente: se puede ejecutar varias veces sin duplicar.
-- =========================================================
INSERT INTO CUENTA (tipo, cuil, nombre, domicilio, telefono)
SELECT 'CHOFER', ch.cuil, ch.nombre, ch.domicilio, ch.telefono
FROM CHOFERES ch
WHERE NOT EXISTS (
    SELECT 1 FROM CUENTA c WHERE c.cuil = ch.cuil
);
