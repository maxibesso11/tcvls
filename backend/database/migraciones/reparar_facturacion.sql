-- =========================================================
-- REPARACIÓN: crea las tablas de facturación si faltan.
-- Seguro de correr varias veces: usa IF NOT EXISTS y no borra datos.
-- Útil si la creación quedó a medias (ej. error 1824 previo) y quedó
-- FACTURAS sin FACTURA_ITEMS, o faltan ambas.
-- Requiere que ya existan las tablas EMPRESAS, CUENTA y VIAJES.
-- =========================================================

-- Datos fiscales del emisor (por si la columna no se agregó)
-- (si ya existen, estos ALTER fallarían; por eso van condicionados abajo)

CREATE TABLE IF NOT EXISTS FACTURAS (
    id_factura INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    tipo_comprobante CHAR(1) NOT NULL DEFAULT 'A',
    punto_venta INT NOT NULL,
    numero INT NOT NULL,
    fecha_emision DATE NOT NULL,
    id_cuenta INT NOT NULL,
    id_viaje INT,
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
    UNIQUE KEY uq_factura_numero (id_empresa, tipo_comprobante, punto_venta, numero),
    INDEX idx_fac_empresa (id_empresa),
    INDEX idx_fac_cuenta (id_cuenta),
    INDEX idx_fac_viaje (id_viaje),
    INDEX idx_fac_fecha (fecha_emision)
);

CREATE TABLE IF NOT EXISTS FACTURA_ITEMS (
    id_item INT AUTO_INCREMENT PRIMARY KEY,
    id_factura INT NOT NULL,
    descripcion VARCHAR(255) NOT NULL,
    cantidad DECIMAL(10, 2) NOT NULL DEFAULT 1,
    precio_unitario DECIMAL(12, 2) NOT NULL DEFAULT 0,
    subtotal DECIMAL(12, 2) NOT NULL DEFAULT 0,
    FOREIGN KEY (id_factura) REFERENCES FACTURAS(id_factura) ON DELETE CASCADE,
    INDEX idx_item_factura (id_factura)
);

-- Agregar la columna 'unidad' a FACTURA_ITEMS si la tabla ya existía sin ella.
-- (Si la columna ya existe, este ALTER da error que se puede ignorar.)
ALTER TABLE FACTURA_ITEMS ADD COLUMN unidad VARCHAR(20) AFTER cantidad;

-- Soporte de nota de crédito: clase de comprobante y vínculo a la factura
-- original. Si las columnas ya existen, estos ALTER dan error que se ignora.
ALTER TABLE FACTURAS ADD COLUMN clase ENUM('FACTURA','NOTA_CREDITO') NOT NULL DEFAULT 'FACTURA' AFTER id_empresa;
ALTER TABLE FACTURAS ADD COLUMN id_factura_asociada INT NULL AFTER id_viaje;
ALTER TABLE FACTURAS ADD FOREIGN KEY (id_factura_asociada) REFERENCES FACTURAS(id_factura) ON DELETE SET NULL;
-- Recrear la clave única para que facturas y notas de crédito numeren aparte
ALTER TABLE FACTURAS DROP INDEX uq_factura_numero;
ALTER TABLE FACTURAS ADD UNIQUE KEY uq_factura_numero (id_empresa, clase, tipo_comprobante, punto_venta, numero);
