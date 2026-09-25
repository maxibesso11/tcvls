-- =========================================================
-- MIGRACIÓN 011: Gastos administrativos
-- Nueva tabla para gastos de estructura no asociados a una unidad
-- ni a un viaje (contabilidad, impuestos, asesorías, honorarios).
-- Cada gasto se imputa automáticamente a la cuenta corriente de su
-- proveedor (igual que los consumos) y se considera como costo de
-- estructura en la rentabilidad del período.
-- =========================================================
CREATE TABLE GASTOS_ADMINISTRATIVOS (
    id_gasto_administrativo INT AUTO_INCREMENT PRIMARY KEY,
    proveedor VARCHAR(100) NOT NULL,
    concepto VARCHAR(150) NOT NULL,
    fecha DATETIME NOT NULL,
    monto DECIMAL(10, 2) NOT NULL,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_fecha (fecha),
    INDEX idx_proveedor (proveedor)
);
