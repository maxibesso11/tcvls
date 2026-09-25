-- =========================================================
-- MIGRACIÓN 017: Módulo de facturación (Factura A)
-- Agrega datos fiscales a las empresas, las tablas de facturas
-- e ítems, y activa el módulo 'facturacion' para las empresas
-- que ya tienen módulos configurados.
-- =========================================================

-- Datos fiscales del emisor
ALTER TABLE EMPRESAS
  ADD COLUMN condicion_iva VARCHAR(40) DEFAULT 'RESPONSABLE INSCRIPTO' AFTER email,
  ADD COLUMN ingresos_brutos VARCHAR(20) AFTER condicion_iva,
  ADD COLUMN inicio_actividades DATE AFTER ingresos_brutos,
  ADD COLUMN punto_venta INT DEFAULT 1 AFTER inicio_actividades;

-- Tabla de facturas
CREATE TABLE IF NOT EXISTS FACTURAS (
    id_factura INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    clase ENUM('FACTURA', 'NOTA_CREDITO') NOT NULL DEFAULT 'FACTURA',
    tipo_comprobante CHAR(1) NOT NULL DEFAULT 'A',
    punto_venta INT NOT NULL,
    numero INT NOT NULL,
    fecha_emision DATE NOT NULL,
    id_cuenta INT NOT NULL,
    id_viaje INT,
    id_factura_asociada INT,
    receptor_cuit VARCHAR(13) NOT NULL,
    receptor_nombre VARCHAR(150) NOT NULL,
    receptor_domicilio VARCHAR(150),
    receptor_condicion_iva VARCHAR(40) DEFAULT 'RESPONSABLE INSCRIPTO',
    neto_gravado DECIMAL(12, 2) NOT NULL DEFAULT 0,
    iva DECIMAL(12, 2) NOT NULL DEFAULT 0,
    total DECIMAL(12, 2) NOT NULL DEFAULT 0,
    cae VARCHAR(20),
    cae_vencimiento DATE,
    estado ENUM('BORRADOR', 'EMITIDA', 'ANULADA') NOT NULL DEFAULT 'BORRADOR',
    observaciones VARCHAR(255),
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    FOREIGN KEY (id_cuenta) REFERENCES CUENTA(id_cuenta) ON DELETE RESTRICT,
    FOREIGN KEY (id_viaje) REFERENCES VIAJES(id_viaje) ON DELETE SET NULL,
    FOREIGN KEY (id_factura_asociada) REFERENCES FACTURAS(id_factura) ON DELETE SET NULL,
    UNIQUE KEY uq_factura_numero (id_empresa, clase, tipo_comprobante, punto_venta, numero),
    INDEX idx_fac_empresa (id_empresa),
    INDEX idx_fac_cuenta (id_cuenta),
    INDEX idx_fac_viaje (id_viaje),
    INDEX idx_fac_fecha (fecha_emision)
);

-- Ítems de cada factura
CREATE TABLE IF NOT EXISTS FACTURA_ITEMS (
    id_item INT AUTO_INCREMENT PRIMARY KEY,
    id_factura INT NOT NULL,
    descripcion VARCHAR(255) NOT NULL,
    cantidad DECIMAL(10, 2) NOT NULL DEFAULT 1,
    unidad VARCHAR(20),
    precio_unitario DECIMAL(12, 2) NOT NULL DEFAULT 0,
    subtotal DECIMAL(12, 2) NOT NULL DEFAULT 0,
    FOREIGN KEY (id_factura) REFERENCES FACTURAS(id_factura) ON DELETE CASCADE,
    INDEX idx_item_factura (id_factura)
);

-- Activar el módulo de facturación para las empresas que ya tienen módulos
INSERT INTO MODULOS_EMPRESA (id_empresa, modulo, activo)
SELECT DISTINCT id_empresa, 'facturacion', 1 FROM MODULOS_EMPRESA
ON DUPLICATE KEY UPDATE activo = 1;
