-- =========================================================
-- ⚠  ATENCIÓN: ESTE SCRIPT BORRA LA BASE DE DATOS COMPLETA
--    (DROP DATABASE erp_3_abril). Usarlo SOLO en una instalación nueva
--    o en un entorno de prueba. NUNCA en producción con datos reales:
--    para actualizar producción usar las migraciones de
--    backend/database/migraciones/ (ver docs/operacion/ACTUALIZAR_SIN_PERDER_DATOS.md).
-- =========================================================
-- ERP 3 DE ABRIL SAS — INSTALACIÓN COMPLETA DESDE CERO
-- =========================================================
-- Este script único:
--   1. Crea la base de datos (la elimina antes si existía)
--   2. Crea las 12 tablas con el esquema consolidado
--      (incluye todas las modificaciones hasta migración 008)
--   3. Carga un set completo de datos de prueba
--
-- Uso:
--   mysql -u root -p < backend/database/esquema/init_db.sql
--
-- Convenciones contables en MOVIMIENTOS:
--   monto > 0  = crédito a favor del titular (la empresa le adeuda)
--   monto < 0  = débito (el titular adeuda a la empresa)
--   - Consumos    → crédito al proveedor
--   - Facturación → débito al pagador (cliente)
--   - Liquidación → crédito al chofer
--   - Recibos     → compensan el saldo
-- =========================================================

DROP DATABASE IF EXISTS erp_3_abril;
CREATE DATABASE erp_3_abril CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE erp_3_abril;

-- =========================================================
-- TABLAS DE GESTIÓN MULTI-EMPRESA Y USUARIOS
-- =========================================================

-- EMPRESAS: cada firma de transporte. Sus datos están aislados.
CREATE TABLE EMPRESAS (
    id_empresa INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    iniciales VARCHAR(4),
    cuit VARCHAR(13) UNIQUE,
    domicilio VARCHAR(150),
    telefono VARCHAR(30),
    email VARCHAR(100),
    condicion_iva VARCHAR(40) DEFAULT 'RESPONSABLE INSCRIPTO',
    ingresos_brutos VARCHAR(20),
    inicio_actividades DATE,
    punto_venta INT DEFAULT 1,
    activa TINYINT(1) NOT NULL DEFAULT 1,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_nombre (nombre)
);

-- USUARIOS: credenciales de acceso. El ADMIN gestiona empresas y usuarios
-- y no pertenece a ninguna empresa (id_empresa NULL). Los USUARIO operan
-- solo los datos de su empresa.
CREATE TABLE USUARIOS (
    id_usuario INT AUTO_INCREMENT PRIMARY KEY,
    nombre_usuario VARCHAR(50) UNIQUE NOT NULL,
    contrasena_hash VARCHAR(200) NOT NULL,
    correo VARCHAR(100),
    id_empresa INT,
    rol ENUM('ADMIN', 'USUARIO') NOT NULL DEFAULT 'USUARIO',
    tema VARCHAR(30) NOT NULL DEFAULT 'verde',
    activo TINYINT(1) NOT NULL DEFAULT 1,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE SET NULL,
    INDEX idx_nombre_usuario (nombre_usuario),
    INDEX idx_empresa (id_empresa)
);

-- MODULOS_EMPRESA: qué módulos del sistema tiene activos cada empresa.
-- Una fila por módulo activo. Desactivar un módulo NO borra sus datos:
-- solo lo oculta de la interfaz y bloquea su acceso. La clave del módulo
-- coincide con la ruta de la API (ej. 'viajes', 'consumos-combustible').
CREATE TABLE MODULOS_EMPRESA (
    id_empresa INT NOT NULL,
    modulo VARCHAR(40) NOT NULL,
    activo TINYINT(1) NOT NULL DEFAULT 1,
    PRIMARY KEY (id_empresa, modulo),
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE
);

-- CERTIFICADOS_ARCA: material del certificado de facturación electrónica de
-- cada empresa. La clave privada se guarda CIFRADA (AES-256-GCM); nunca en
-- texto plano ni expuesta por la API. Una empresa tiene un certificado activo
-- por vez. El flujo de estados:
--   CSR_GENERADO → se generó la clave y el CSR, falta subir el .crt de ARCA
--   ACTIVO       → certificado cargado y vigente
--   VENCIDO      → pasó su fecha de vencimiento (hay que renovar)
CREATE TABLE CERTIFICADOS_ARCA (
    id_certificado INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    estado ENUM('CSR_GENERADO', 'ACTIVO', 'VENCIDO') NOT NULL DEFAULT 'CSR_GENERADO',
    alias VARCHAR(50),
    clave_privada_cifrada MEDIUMTEXT NOT NULL,
    csr_pem MEDIUMTEXT,
    certificado_pem MEDIUMTEXT,
    fecha_generacion DATETIME DEFAULT CURRENT_TIMESTAMP,
    fecha_vencimiento DATE,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    INDEX idx_cert_empresa (id_empresa)
);

-- =========================================================
-- ESQUEMA DE TABLAS
-- =========================================================

-- 1. CHOFERES
CREATE TABLE CHOFERES (
    id_chofer INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    cuil VARCHAR(13) NOT NULL,
    edad INT NOT NULL,
    ultima_jornada_descanso DATE,
    vencimiento_carnet DATE NOT NULL,
    domicilio VARCHAR(150) NOT NULL,
    telefono VARCHAR(15),
    remuneracion DECIMAL(10, 2),
    tipo_remuneracion ENUM('POR KM', 'PORCENTAJE', 'FIJA'),
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    UNIQUE KEY uq_chofer_cuil (id_empresa, cuil),
    INDEX idx_vencimiento_carnet (vencimiento_carnet)
);

-- 2. UNIDADES
CREATE TABLE UNIDADES (
    id_unidad INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    patente VARCHAR(8) NOT NULL,
    modelo VARCHAR(100) NOT NULL,
    funcionalidad ENUM('PRINCIPAL', 'SECUNDARIA') NOT NULL,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    UNIQUE KEY uq_unidad_patente (id_empresa, patente),
    INDEX idx_funcionalidad (funcionalidad)
);

-- 3. EQUIPO
CREATE TABLE EQUIPO (
    id_equipo INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    id_unidad_principal INT NOT NULL,
    id_unidad_secundaria INT NOT NULL,
    id_chofer INT NOT NULL,
    peso_tara DECIMAL(10,2),
    peso_bruto DECIMAL(10,2),
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    FOREIGN KEY (id_unidad_principal) REFERENCES UNIDADES(id_unidad) ON DELETE RESTRICT,
    FOREIGN KEY (id_unidad_secundaria) REFERENCES UNIDADES(id_unidad) ON DELETE RESTRICT,
    FOREIGN KEY (id_chofer) REFERENCES CHOFERES(id_chofer) ON DELETE RESTRICT,
    INDEX idx_chofer (id_chofer),
    INDEX idx_unidad_principal (id_unidad_principal),
    INDEX idx_unidad_secundaria (id_unidad_secundaria)
);

-- 4. VIAJES
CREATE TABLE VIAJES (
    id_viaje INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    fecha_origen DATETIME NOT NULL,
    tipo_carga VARCHAR(100) NOT NULL,
    origen VARCHAR(100) NOT NULL,
    destino VARCHAR(100) NOT NULL,
    id_equipo INT NOT NULL,
    id_chofer INT,
    tarifa DECIMAL(10, 2) NOT NULL,
    tipo_tarifa ENUM('POR KM', 'POR TONELADA', 'UNICA') NOT NULL,
    cantidad_cargada DECIMAL(10, 2),
    resultado DECIMAL(10, 2),
    comision DECIMAL(5, 2) DEFAULT 0,
    estado ENUM('EN CURSO', 'EN DESTINO', 'FINALIZADO', 'FACTURADO') NOT NULL,
    modo_facturacion ENUM('SIN_FACTURAR', 'LIQUIDO_PRODUCTO', 'FACTURA') DEFAULT NULL,
    fecha_llegada DATETIME,
    pagador VARCHAR(100),
    numero_remito VARCHAR(20),
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    FOREIGN KEY (id_equipo) REFERENCES EQUIPO(id_equipo) ON DELETE RESTRICT,
    FOREIGN KEY (id_chofer) REFERENCES CHOFERES(id_chofer) ON DELETE SET NULL,
    INDEX idx_equipo (id_equipo),
    INDEX idx_estado (estado),
    INDEX idx_fecha_origen (fecha_origen),
    INDEX idx_pagador (pagador),
    INDEX idx_numero_remito (numero_remito)
);
-- Nota: id_chofer es la "foto" del chofer que hizo el viaje, tomada del
-- equipo al momento de crear el viaje (o al cambiarle el equipo). La
-- liquidación al chofer usa esta foto, no el chofer actual del equipo,
-- para que las rotaciones de choferes no alteren viajes históricos.

-- 5. CONSUMOS COMBUSTIBLE
CREATE TABLE CONSUMOS_COMBUSTIBLE (
    id_consumo_combustible INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    estacion_carga VARCHAR(100) NOT NULL,
    proveedor VARCHAR(100) NOT NULL,
    id_equipo INT NOT NULL,
    cantidad_litros DECIMAL(8, 2) NOT NULL,
    km_recorridos DECIMAL(8, 2),
    precio_por_litro DECIMAL(8, 2) NOT NULL,
    fecha DATETIME NOT NULL,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    FOREIGN KEY (id_equipo) REFERENCES EQUIPO(id_equipo) ON DELETE RESTRICT,
    INDEX idx_equipo (id_equipo),
    INDEX idx_fecha (fecha),
    INDEX idx_proveedor (proveedor)
);

-- 6. CONSUMOS GENERALES
CREATE TABLE CONSUMOS_GENERALES (
    id_consumo_general INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    proveedor VARCHAR(100) NOT NULL,
    fecha DATETIME NOT NULL,
    id_unidad INT NOT NULL,
    concepto VARCHAR(150) NOT NULL,
    monto DECIMAL(10, 2) NOT NULL,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    FOREIGN KEY (id_unidad) REFERENCES UNIDADES(id_unidad) ON DELETE RESTRICT,
    INDEX idx_unidad (id_unidad),
    INDEX idx_fecha (fecha),
    INDEX idx_proveedor (proveedor)
);

-- 7. CUENTA
CREATE TABLE CUENTA (
    id_cuenta INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    tipo ENUM('CHOFER', 'PROVEEDOR', 'CLIENTE') NOT NULL,
    cuil VARCHAR(13) NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    domicilio VARCHAR(150),
    telefono VARCHAR(15),
    plazo_pago_dias INT DEFAULT NULL,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    UNIQUE KEY uq_cuenta_cuil (id_empresa, cuil),
    INDEX idx_tipo (tipo),
    INDEX idx_nombre (nombre)
);

-- FACTURAS: comprobantes emitidos (siempre Factura A en esta etapa).
-- Se crea después de VIAJES y CUENTA porque tiene claves foráneas a ambas.
-- Se asocia obligatoriamente a una CUENTA (el receptor) y opcionalmente a un
-- VIAJE. La numeración es correlativa por (empresa, punto de venta, tipo).
-- Los campos del receptor se guardan como "foto" al momento de emitir.
-- El CAE se completa cuando ARCA autoriza; hasta entonces queda en BORRADOR.
CREATE TABLE FACTURAS (
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

-- Renglones (ítems) de cada factura.
CREATE TABLE FACTURA_ITEMS (
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

-- 8. MOVIMIENTOS
CREATE TABLE MOVIMIENTOS (
    id_movimiento INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    id_cuenta INT NOT NULL,
    monto DECIMAL(10, 2) NOT NULL,
    fecha DATETIME NOT NULL,
    concepto VARCHAR(255) NOT NULL,
    -- Documento que generó el movimiento (NULL = cargado a mano). Ver migración 023.
    origen_tipo VARCHAR(30) NULL,
    origen_id INT NULL,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    FOREIGN KEY (id_cuenta) REFERENCES CUENTA(id_cuenta) ON DELETE RESTRICT,
    INDEX idx_mov_origen (id_empresa, origen_tipo, origen_id),
    INDEX idx_cuenta (id_cuenta),
    INDEX idx_fecha (fecha),
    INDEX idx_monto (monto)
);

-- 9. STOCK
CREATE TABLE STOCK (
    id_stock INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    elemento VARCHAR(150) NOT NULL,
    valuacion DECIMAL(10, 2) NOT NULL,
    deposito VARCHAR(100) NOT NULL,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    INDEX idx_elemento (elemento),
    INDEX idx_deposito (deposito)
);

-- 10. MANTENIMIENTOS
CREATE TABLE MANTENIMIENTOS (
    id_mantenimiento INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    id_unidad INT NOT NULL,
    periodicidad VARCHAR(50) NOT NULL,
    fecha DATE,
    fecha_vencimiento DATE NOT NULL,
    concepto VARCHAR(150) NOT NULL,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    FOREIGN KEY (id_unidad) REFERENCES UNIDADES(id_unidad) ON DELETE RESTRICT,
    INDEX idx_unidad (id_unidad),
    INDEX idx_fecha_vencimiento (fecha_vencimiento),
    INDEX idx_concepto (concepto)
);

-- 11. VENCIMIENTOS
CREATE TABLE VENCIMIENTOS (
    id_vencimiento INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    concepto VARCHAR(150) NOT NULL,
    fecha_vencimiento DATE NOT NULL,
    id_unidad INT NOT NULL,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    FOREIGN KEY (id_unidad) REFERENCES UNIDADES(id_unidad) ON DELETE RESTRICT,
    INDEX idx_unidad (id_unidad),
    INDEX idx_fecha_vencimiento (fecha_vencimiento),
    INDEX idx_concepto (concepto)
);

-- 12. CUBIERTAS
CREATE TABLE CUBIERTAS (
    id_cubierta INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    identificador VARCHAR(50),
    estado VARCHAR(50) NOT NULL,
    id_unidad INT NOT NULL,
    ubicacion ENUM('COLOCADA', 'AUXILIO') NOT NULL,
    fecha_colocacion DATE,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    FOREIGN KEY (id_unidad) REFERENCES UNIDADES(id_unidad) ON DELETE RESTRICT,
    INDEX idx_unidad (id_unidad),
    INDEX idx_ubicacion (ubicacion),
    INDEX idx_estado (estado)
);

-- 13. GASTOS_ADMINISTRATIVOS
-- Gastos de estructura no asociados a una unidad ni a un viaje:
-- contabilidad, impuestos, asesorías, honorarios, seguros generales, etc.
CREATE TABLE GASTOS_ADMINISTRATIVOS (
    id_gasto_administrativo INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    proveedor VARCHAR(100) NOT NULL,
    concepto VARCHAR(150) NOT NULL,
    fecha DATETIME NOT NULL,
    monto DECIMAL(10, 2) NOT NULL,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    INDEX idx_fecha (fecha),
    INDEX idx_proveedor (proveedor)
);

-- =========================================================
-- DATOS DE PRUEBA
-- =========================================================

-- ---------- EMPRESAS ----------
INSERT INTO EMPRESAS (id_empresa, nombre, iniciales, cuit, domicilio, telefono, email, condicion_iva, ingresos_brutos, inicio_actividades, punto_venta) VALUES
(1, '3 de Abril SAS', '3A', '30-71122334-5', 'Ruta 9 km 698, Córdoba', '351-5559000', 'contacto@3deabril.com.ar', 'RESPONSABLE INSCRIPTO', '901-123456-7', '2015-03-04', 1);

-- ---------- USUARIOS ----------
-- admin / admin123  (administrador global, gestiona empresas y usuarios)
-- demo  / demo123   (usuario operativo de la empresa 3 de Abril SAS)
INSERT INTO USUARIOS (nombre_usuario, contrasena_hash, correo, id_empresa, rol) VALUES
('admin', 'e12acd1b80ef12b19b56c9f4877aed83:7404618ad96aa4d5ad409a42444d9fd9a4ef878c5f170bbb99220790adf9c0c8f4d45e0d01d6e35b864b8e491d9f18a0a8b65a4c60394640fd66d5848c2f3cfa', 'admin@sistema.com', NULL, 'ADMIN'),
('demo',  '3c56c08776b3cff2b08c290940182ad2:739e3d24b6ae96f530d6080ff6c0168055bade988dc58873cb7f9576e90a09fb152539a310412e30ce3a723ade743c9bbc22b7dd3acd524b4d8d8a5d395d86f7',  'demo@3deabril.com.ar', 1, 'USUARIO');

-- ---------- MODULOS_EMPRESA ----------
-- La empresa de ejemplo arranca con todos los módulos activos.
INSERT INTO MODULOS_EMPRESA (id_empresa, modulo, activo) VALUES
(1, 'choferes', 1), (1, 'unidades', 1), (1, 'equipos', 1), (1, 'cubiertas', 1),
(1, 'mantenimientos', 1), (1, 'vencimientos', 1), (1, 'viajes', 1),
(1, 'consumos-combustible', 1), (1, 'consumos-generales', 1), (1, 'gastos-administrativos', 1),
(1, 'cuentas', 1), (1, 'movimientos', 1), (1, 'cuentas-corrientes', 1), (1, 'stock', 1),
(1, 'facturacion', 1);

-- ---------- CHOFERES (uno por cada tipo de remuneración) ----------
INSERT INTO CHOFERES (id_empresa, nombre, cuil, edad, ultima_jornada_descanso, vencimiento_carnet, domicilio, telefono, remuneracion, tipo_remuneracion) VALUES
(1, 'Juan Pérez',      '20-28456789-3', 42, DATE_SUB(CURDATE(), INTERVAL 2 DAY),  DATE_ADD(CURDATE(), INTERVAL 180 DAY), 'Av. Colón 1234, Córdoba',      '351-5550101',    195.00, 'POR KM'),
(1, 'Carlos Gómez',    '20-31222333-1', 38, DATE_SUB(CURDATE(), INTERVAL 28 DAY), DATE_ADD(CURDATE(), INTERVAL 12 DAY),  'Bv. San Juan 567, Córdoba',    '351-5550102',     15.00, 'PORCENTAJE'),
(1, 'Roberto Díaz',    '20-25987654-7', 47, DATE_SUB(CURDATE(), INTERVAL 7 DAY),  DATE_ADD(CURDATE(), INTERVAL 320 DAY), 'Ruta 9 km 12, Villa María',    '353-5550103',     18.00, 'PORCENTAJE'),
(1, 'Miguel Torres',   '20-33444555-9', 35, DATE_SUB(CURDATE(), INTERVAL 1 DAY),  DATE_ADD(CURDATE(), INTERVAL 95 DAY),  'Mitre 890, Río Cuarto',        '358-5550104', 920000.00, 'FIJA'),
(1, 'Daniel Sosa',     '20-29871234-5', 44, DATE_SUB(CURDATE(), INTERVAL 4 DAY),  DATE_ADD(CURDATE(), INTERVAL 240 DAY), 'San Martín 456, Córdoba',      '351-5550105',    205.00, 'POR KM');

-- ---------- UNIDADES (5 principales + 5 secundarias) ----------
INSERT INTO UNIDADES (id_empresa, patente, modelo, funcionalidad) VALUES
(1, 'AB123CD', 'Scania R450',           'PRINCIPAL'),
(1, 'AD789GH', 'Iveco Stralis',         'PRINCIPAL'),
(1, 'AF345KL', 'Mercedes Actros',       'PRINCIPAL'),
(1, 'AH901OP', 'Scania G410',           'PRINCIPAL'),
(1, 'AJ567ST', 'Volvo FH 460',          'PRINCIPAL'),
(1, 'AC456EF', 'Batea Cormetal',        'SECUNDARIA'),
(1, 'AE012IJ', 'Semirremolque Randon',  'SECUNDARIA'),
(1, 'AG678MN', 'Batea Helvética',       'SECUNDARIA'),
(1, 'AI234QR', 'Acoplado Montenegro',   'SECUNDARIA'),
(1, 'AK890UV', 'Semirremolque Hermann', 'SECUNDARIA');

-- ---------- EQUIPOS ----------
INSERT INTO EQUIPO (id_empresa, id_unidad_principal, id_unidad_secundaria, id_chofer, peso_tara, peso_bruto) VALUES
(1, 1, 6, 1, 14500.00, 45000.00),   -- Equipo 1: Scania R450 + Batea Cormetal + Juan Pérez
(1, 2, 7, 2, 15200.00, 45000.00),   -- Equipo 2: Iveco Stralis + Semirremolque Randon + Carlos Gómez
(1, 3, 8, 3, 14800.00, 44000.00),   -- Equipo 3: Mercedes Actros + Batea Helvética + Roberto Díaz
(1, 4, 9, 4, 13900.00, 43500.00),   -- Equipo 4: Scania G410 + Acoplado Montenegro + Miguel Torres
(1, 5, 10, 5, 15500.00, 46000.00);  -- Equipo 5: Volvo FH 460 + Semirremolque Hermann + Daniel Sosa

-- ---------- CUENTAS ----------
-- Choferes (también sincronizados automáticamente al crear un chofer
-- desde la app; aquí se cargan directamente para los datos de prueba)
INSERT INTO CUENTA (id_empresa, tipo, cuil, nombre, domicilio, telefono) VALUES
(1, 'CHOFER',    '20-28456789-3', 'Juan Pérez',          'Av. Colón 1234, Córdoba',          '351-5550101'),
(1, 'CHOFER',    '20-31222333-1', 'Carlos Gómez',        'Bv. San Juan 567, Córdoba',        '351-5550102'),
(1, 'CHOFER',    '20-25987654-7', 'Roberto Díaz',        'Ruta 9 km 12, Villa María',        '353-5550103'),
(1, 'CHOFER',    '20-33444555-9', 'Miguel Torres',       'Mitre 890, Río Cuarto',            '358-5550104'),
(1, 'CHOFER',    '20-29871234-5', 'Daniel Sosa',         'San Martín 456, Córdoba',          '351-5550105'),
-- Proveedores
(1, 'PROVEEDOR', '30-65432198-2', 'YPF',                 'Macacha Güemes 515, CABA',         '011-5550201'),
(1, 'PROVEEDOR', '30-71234567-8', 'Shell',               'Av. del Libertador 498, CABA',     '011-5550202'),
(1, 'PROVEEDOR', '30-70123456-9', 'Axion',               'Av. Cnel. Díaz 1900, CABA',        '011-5550203'),
(1, 'PROVEEDOR', '30-72111222-3', 'Lubricentro Central', 'Av. Vélez Sarsfield 2300, Córdoba','351-5550204'),
(1, 'PROVEEDOR', '30-73444555-6', 'Neumáticos del Sur',  'Bv. Las Heras 800, Córdoba',       '351-5550205'),
(1, 'PROVEEDOR', '30-74666777-8', 'Taller Hnos. López',  'Av. Sabattini 4500, Córdoba',      '351-5550206'),
(1, 'PROVEEDOR', '30-75888999-1', 'Repuestos Camino',    'Ruta 9 km 705, Córdoba',           '3572-555207'),
(1, 'PROVEEDOR', '30-77222333-4', 'Estudio Contable Ruiz','Av. Olmos 234, Córdoba',          '351-5550210'),
(1, 'PROVEEDOR', '30-78333444-5', 'AFIP',                 'Hipólito Yrigoyen 370, CABA',      '011-5550211'),
(1, 'PROVEEDOR', '30-79444555-6', 'Rentas Córdoba',       'Av. Concepción Arenal 54, Córdoba','351-5550212'),
(1, 'PROVEEDOR', '30-80555666-7', 'Consultora Vial SRL',  'Bv. Chacabuco 1100, Córdoba',      '351-5550213'),
-- Clientes
(1, 'CLIENTE',   '30-69876543-4', 'Agro del Centro SA',  'Ruta 9 km 695, Córdoba',           '351-5550301'),
(1, 'CLIENTE',   '30-66554433-6', 'Molinos Unidos',      'Puerto Norte, Rosario',            '341-5550302'),
(1, 'CLIENTE',   '30-62112233-0', 'Nutrientes SRL',      'Parque Industrial, Marcos Juárez', '3472-555303'),
(1, 'CLIENTE',   '30-67889900-2', 'Cereales del Sur',    'Av. Costanera 1500, Bahía Blanca', '291-5550304'),
(1, 'CLIENTE',   '30-68112233-5', 'AgroMaq SA',          'Av. Vélez Sarsfield 800, Córdoba', '351-5550305'),
(1, 'CLIENTE',   '30-69334455-8', 'Oleaginosa Pampa',    'Ruta 5 km 540, Quequén',           '2262-555306');

-- ---------- VIAJES ----------
-- Mezcla de estados y tipos de tarifa. Los movimientos automáticos
-- (facturación y liquidación) se cargan más abajo, calculados a mano
-- para reflejar lo que generarían los hooks del sistema.
INSERT INTO VIAJES (id_empresa, fecha_origen, tipo_carga, origen, destino, id_equipo, tarifa, tipo_tarifa, cantidad_cargada, resultado, comision, estado, fecha_llegada, pagador, numero_remito) VALUES
-- #1 EN CURSO (sin resultado todavía)
(1, DATE_SUB(NOW(), INTERVAL 1 DAY),  'Soja',         'Córdoba',       'Rosario',      1, 38500,   'POR TONELADA', 30.0,  NULL, 0,  'EN CURSO',   NULL,                            'Agro del Centro SA', 'R-0001-00012845'),
-- #2 EN CURSO
(1, DATE_SUB(NOW(), INTERVAL 2 DAY),  'Maíz',         'Villa María',   'Bahía Blanca', 3, 41200,   'POR TONELADA', 31.0,  NULL, 0,  'EN CURSO',   NULL,                            'Cereales del Sur',   'R-0001-00012799'),
-- #3 EN DESTINO (con resultado cargado)
(1, DATE_SUB(NOW(), INTERVAL 3 DAY),  'Trigo',        'Río Cuarto',    'Buenos Aires', 2, 39800,   'POR TONELADA', 29.5,  29.3, 0,  'EN DESTINO', DATE_SUB(NOW(), INTERVAL 1 DAY), 'Molinos Unidos',     'R-0001-00012760'),
-- #4 FINALIZADO POR TONELADA (chofer 4 FIJA → sin liquidación)
(1, DATE_SUB(NOW(), INTERVAL 6 DAY),  'Soja',         'Córdoba',       'San Lorenzo',  4, 37900,   'POR TONELADA', 30.2,  30.0, 0,  'FINALIZADO', DATE_SUB(NOW(), INTERVAL 5 DAY), 'Agro del Centro SA', 'R-0001-00012701'),
-- #5 FACTURADO UNICA (chofer 1 POR KM, viaje no POR KM → liquidación $0 pendiente)
(1, DATE_SUB(NOW(), INTERVAL 9 DAY),  'Fertilizante', 'Marcos Juárez', 'Rosario',      1, 1180000, 'UNICA',        NULL,  NULL, 0,  'FACTURADO',  DATE_SUB(NOW(), INTERVAL 8 DAY), 'Nutrientes SRL',     'R-0001-00012688'),
-- #6 FACTURADO POR KM (chofer 2 PORCENTAJE 15%), con 5% de comisión al cliente
(1, DATE_SUB(NOW(), INTERVAL 12 DAY), 'Maquinaria',   'Córdoba',       'Mendoza',      2, 2150,    'POR KM',       NULL,  612,  5,  'FACTURADO',  DATE_SUB(NOW(), INTERVAL 11 DAY),'AgroMaq SA',         'R-0001-00012650'),
-- #7 FACTURADO POR TONELADA (chofer 3 PORCENTAJE 18%)
(1, DATE_SUB(NOW(), INTERVAL 20 DAY), 'Soja',         'Córdoba',       'Rosario',      3, 36800,   'POR TONELADA', 30.5,  30.4, 0,  'FACTURADO',  DATE_SUB(NOW(), INTERVAL 19 DAY),'Agro del Centro SA', 'R-0001-00012590'),
-- #8 FACTURADO POR TONELADA (chofer 4 FIJA → sin liquidación)
(1, DATE_SUB(NOW(), INTERVAL 28 DAY), 'Girasol',      'Laboulaye',     'Quequén',      4, 43500,   'POR TONELADA', 29.8,  29.7, 0,  'FACTURADO',  DATE_SUB(NOW(), INTERVAL 27 DAY),'Oleaginosa Pampa',   'R-0001-00012511'),
-- #9 FINALIZADO POR KM (chofer 5 POR KM 205/km)
(1, DATE_SUB(NOW(), INTERVAL 15 DAY), 'Cemento',      'Córdoba',       'San Juan',     5, 1980,    'POR KM',       NULL,  540,  0,  'FINALIZADO', DATE_SUB(NOW(), INTERVAL 14 DAY),'Molinos Unidos',     'R-0001-00012620');

-- Foto del chofer en los viajes de ejemplo (el chofer del equipo al crearse)
UPDATE VIAJES v JOIN EQUIPO e ON e.id_equipo = v.id_equipo
SET v.id_chofer = e.id_chofer WHERE v.id_chofer IS NULL;

-- ---------- CONSUMOS COMBUSTIBLE ----------
INSERT INTO CONSUMOS_COMBUSTIBLE (id_empresa, estacion_carga, proveedor, id_equipo, cantidad_litros, km_recorridos, precio_por_litro, fecha) VALUES
(1, 'YPF Ruta 9 Pilar',        'YPF',   1, 480, 1240, 612.50, DATE_SUB(NOW(), INTERVAL 2 DAY)),
(1, 'Shell Av. Circunvalación','Shell', 2, 510, 1255, 628.00, DATE_SUB(NOW(), INTERVAL 3 DAY)),
(1, 'YPF Villa María',         'YPF',   3, 495, 1183, 612.50, DATE_SUB(NOW(), INTERVAL 4 DAY)),
(1, 'Axion Río Cuarto',        'Axion', 4, 530, 1171, 605.00, DATE_SUB(NOW(), INTERVAL 5 DAY)),
(1, 'YPF Córdoba Sur',         'YPF',   5, 500, 1085, 612.50, DATE_SUB(NOW(), INTERVAL 6 DAY)),
(1, 'Shell Rosario Oeste',     'Shell', 2, 505, 1242, 628.00, DATE_SUB(NOW(), INTERVAL 13 DAY));

-- ---------- CONSUMOS GENERALES ----------
INSERT INTO CONSUMOS_GENERALES (id_empresa, proveedor, fecha, id_unidad, concepto, monto) VALUES
(1, 'Lubricentro Central', DATE_SUB(NOW(), INTERVAL 4 DAY),  1, 'Cambio de aceite y filtros',      185000),
(1, 'Neumáticos del Sur',  DATE_SUB(NOW(), INTERVAL 8 DAY),  6, 'Recapado de 2 cubiertas',         320000),
(1, 'Taller Hnos. López',  DATE_SUB(NOW(), INTERVAL 11 DAY), 2, 'Reparación sistema de frenos',    410000),
(1, 'Repuestos Camino',    DATE_SUB(NOW(), INTERVAL 15 DAY), 3, 'Amortiguadores traseros',         275000),
(1, 'Taller Hnos. López',  DATE_SUB(NOW(), INTERVAL 18 DAY), 5, 'Service completo de motor',       520000);

-- ---------- MOVIMIENTOS ----------
-- Se cargan en tres bloques que reflejan lo que el sistema genera
-- automáticamente, más algunos recibos manuales de ejemplo.

-- (A) Movimientos por CONSUMOS (crédito al proveedor)
INSERT INTO MOVIMIENTOS (id_empresa, id_cuenta, monto, fecha, concepto) VALUES
-- combustible: litros × precio
(1, (SELECT id_cuenta FROM CUENTA WHERE nombre='YPF' AND id_empresa=1),   294000.00, DATE_SUB(NOW(), INTERVAL 2 DAY),  'CONSUMO COMBUSTIBLE #1 — 480 L en YPF Ruta 9 Pilar'),
(1, (SELECT id_cuenta FROM CUENTA WHERE nombre='Shell' AND id_empresa=1), 320280.00, DATE_SUB(NOW(), INTERVAL 3 DAY),  'CONSUMO COMBUSTIBLE #2 — 510 L en Shell Av. Circunvalación'),
(1, (SELECT id_cuenta FROM CUENTA WHERE nombre='YPF' AND id_empresa=1),   303187.50, DATE_SUB(NOW(), INTERVAL 4 DAY),  'CONSUMO COMBUSTIBLE #3 — 495 L en YPF Villa María'),
(1, (SELECT id_cuenta FROM CUENTA WHERE nombre='Axion' AND id_empresa=1), 320650.00, DATE_SUB(NOW(), INTERVAL 5 DAY),  'CONSUMO COMBUSTIBLE #4 — 530 L en Axion Río Cuarto'),
(1, (SELECT id_cuenta FROM CUENTA WHERE nombre='YPF' AND id_empresa=1),   306250.00, DATE_SUB(NOW(), INTERVAL 6 DAY),  'CONSUMO COMBUSTIBLE #5 — 500 L en YPF Córdoba Sur'),
(1, (SELECT id_cuenta FROM CUENTA WHERE nombre='Shell' AND id_empresa=1), 317140.00, DATE_SUB(NOW(), INTERVAL 13 DAY), 'CONSUMO COMBUSTIBLE #6 — 505 L en Shell Rosario Oeste'),
-- generales
(1, (SELECT id_cuenta FROM CUENTA WHERE nombre='Lubricentro Central' AND id_empresa=1), 185000.00, DATE_SUB(NOW(), INTERVAL 4 DAY),  'CONSUMO GENERAL #1 — Cambio de aceite y filtros'),
(1, (SELECT id_cuenta FROM CUENTA WHERE nombre='Neumáticos del Sur' AND id_empresa=1),  320000.00, DATE_SUB(NOW(), INTERVAL 8 DAY),  'CONSUMO GENERAL #2 — Recapado de 2 cubiertas'),
(1, (SELECT id_cuenta FROM CUENTA WHERE nombre='Taller Hnos. López' AND id_empresa=1),  410000.00, DATE_SUB(NOW(), INTERVAL 11 DAY), 'CONSUMO GENERAL #3 — Reparación sistema de frenos'),
(1, (SELECT id_cuenta FROM CUENTA WHERE nombre='Repuestos Camino' AND id_empresa=1),    275000.00, DATE_SUB(NOW(), INTERVAL 15 DAY), 'CONSUMO GENERAL #4 — Amortiguadores traseros'),
(1, (SELECT id_cuenta FROM CUENTA WHERE nombre='Taller Hnos. López' AND id_empresa=1),  520000.00, DATE_SUB(NOW(), INTERVAL 18 DAY), 'CONSUMO GENERAL #5 — Service completo de motor');

-- (B) Movimientos por FACTURACION (débito al pagador) — solo viajes FACTURADOS
-- Valor con IVA 21% y, si corresponde, descontada la comisión al cliente.
INSERT INTO MOVIMIENTOS (id_empresa, id_cuenta, monto, fecha, concepto) VALUES
-- #5 UNICA: 1.180.000 × 1.21 = 1.427.800
(1, (SELECT id_cuenta FROM CUENTA WHERE nombre='Nutrientes SRL' AND id_empresa=1),    -1427800.00, DATE_SUB(NOW(), INTERVAL 8 DAY),  'FACTURACION VIAJE #5 — Marcos Juárez → Rosario (remito R-0001-00012688) [IVA 21%]'),
-- #6 POR KM: 1.315.800 − 5% = 1.250.010 × 1.21 = 1.512.512,10
(1, (SELECT id_cuenta FROM CUENTA WHERE nombre='AgroMaq SA' AND id_empresa=1),        -1512512.10, DATE_SUB(NOW(), INTERVAL 11 DAY), 'FACTURACION VIAJE #6 — Córdoba → Mendoza (remito R-0001-00012650) [comisión 5% + IVA 21%]'),
-- #7 POR TONELADA: 1.118.720 × 1.21 = 1.353.651,20
(1, (SELECT id_cuenta FROM CUENTA WHERE nombre='Agro del Centro SA' AND id_empresa=1),-1353651.20, DATE_SUB(NOW(), INTERVAL 19 DAY), 'FACTURACION VIAJE #7 — Córdoba → Rosario (remito R-0001-00012590) [IVA 21%]'),
-- #8 POR TONELADA: 1.291.950 × 1.21 = 1.563.259,50
(1, (SELECT id_cuenta FROM CUENTA WHERE nombre='Oleaginosa Pampa' AND id_empresa=1),  -1563259.50, DATE_SUB(NOW(), INTERVAL 27 DAY), 'FACTURACION VIAJE #8 — Laboulaye → Quequén (remito R-0001-00012511) [IVA 21%]');

-- (C) Movimientos por LIQUIDACION (crédito al chofer) — viajes FINALIZADOS/FACTURADOS
INSERT INTO MOVIMIENTOS (id_empresa, id_cuenta, monto, fecha, concepto) VALUES
-- #5 chofer 1 POR KM en viaje UNICA → $0 pendiente
(1, (SELECT id_cuenta FROM CUENTA WHERE nombre='Juan Pérez' AND id_empresa=1),   0.00,       DATE_SUB(NOW(), INTERVAL 8 DAY),  'LIQUIDACION VIAJE #5 — Marcos Juárez → Rosario [PENDIENTE: faltan los km recorridos para liquidar al chofer]'),
-- #6 chofer 2 PORCENTAJE 15% de 1.315.800 = 197.370
(1, (SELECT id_cuenta FROM CUENTA WHERE nombre='Carlos Gómez' AND id_empresa=1), 197370.00,  DATE_SUB(NOW(), INTERVAL 11 DAY), 'LIQUIDACION VIAJE #6 — Córdoba → Mendoza'),
-- #7 chofer 3 PORCENTAJE 18% de 1.118.720 = 201.369,60
(1, (SELECT id_cuenta FROM CUENTA WHERE nombre='Roberto Díaz' AND id_empresa=1), 201369.60,  DATE_SUB(NOW(), INTERVAL 19 DAY), 'LIQUIDACION VIAJE #7 — Córdoba → Rosario'),
-- #9 chofer 5 POR KM 205 × 540 = 110.700
(1, (SELECT id_cuenta FROM CUENTA WHERE nombre='Daniel Sosa' AND id_empresa=1),  110700.00,  DATE_SUB(NOW(), INTERVAL 14 DAY), 'LIQUIDACION VIAJE #9 — Córdoba → San Juan');

-- (D) Recibos y adelantos manuales de ejemplo
INSERT INTO MOVIMIENTOS (id_empresa, id_cuenta, monto, fecha, concepto) VALUES
-- Adelantos a choferes (débito en su cuenta)
(1, (SELECT id_cuenta FROM CUENTA WHERE nombre='Juan Pérez' AND id_empresa=1),   -150000.00, DATE_SUB(NOW(), INTERVAL 3 DAY),  'RECIBO N° 0001-00000045 — Adelanto de viáticos'),
(1, (SELECT id_cuenta FROM CUENTA WHERE nombre='Carlos Gómez' AND id_empresa=1), -120000.00, DATE_SUB(NOW(), INTERVAL 5 DAY),  'RECIBO N° 0001-00000046 — Adelanto de viáticos'),
-- Cobros de clientes que compensan facturaciones (crédito)
(1, (SELECT id_cuenta FROM CUENTA WHERE nombre='Nutrientes SRL' AND id_empresa=1),     1427800.00, DATE_SUB(NOW(), INTERVAL 6 DAY),  'RECIBO N° 0001-00000047 — Pago factura viaje #5'),
(1, (SELECT id_cuenta FROM CUENTA WHERE nombre='Agro del Centro SA' AND id_empresa=1), 1353651.20, DATE_SUB(NOW(), INTERVAL 17 DAY), 'RECIBO N° 0001-00000048 — Pago factura viaje #7'),
-- Pago parcial a un proveedor (débito que reduce el saldo acreedor)
(1, (SELECT id_cuenta FROM CUENTA WHERE nombre='YPF' AND id_empresa=1),               -600000.00, DATE_SUB(NOW(), INTERVAL 1 DAY),  'RECIBO N° 0001-00000049 — Pago parcial cuenta YPF');

-- ---------- STOCK ----------
INSERT INTO STOCK (id_empresa, elemento, valuacion, deposito) VALUES
(1, 'Cubierta 295/80 R22.5 nueva',     480000, 'Depósito Central Córdoba'),
(1, 'Filtro de aceite Scania',           42000, 'Depósito Central Córdoba'),
(1, 'Aceite 15W40 (tambor 200L)',       890000, 'Depósito Central Córdoba'),
(1, 'Lona para batea 14m',              310000, 'Depósito Villa María'),
(1, 'Kit de luces LED reglamentarias',   75000, 'Depósito Central Córdoba'),
(1, 'Cubierta de auxilio 295/80 R22.5', 460000, 'Equipo #1 · AB123CD'),
(1, 'Crique hidráulico 20 tn',          145000, 'Equipo #1 · AB123CD'),
(1, 'Kit de herramientas de ruta',       68000, 'Equipo #2 · AD789GH'),
(1, 'Matafuego 5 kg reglamentario',      52000, 'Equipo #3 · AF345KL'),
(1, 'Cadenas para nieve (juego)',       128000, 'Equipo #5 · AJ567ST');

-- ---------- MANTENIMIENTOS ----------
INSERT INTO MANTENIMIENTOS (id_empresa, id_unidad, periodicidad, fecha, fecha_vencimiento, concepto) VALUES
(1, 1, 'Cada 30.000 km', DATE_SUB(CURDATE(), INTERVAL 85 DAY),  DATE_ADD(CURDATE(), INTERVAL 5 DAY),  'Cambio de aceite y filtros'),
(1, 2, 'Cada 6 meses',   DATE_SUB(CURDATE(), INTERVAL 150 DAY), DATE_ADD(CURDATE(), INTERVAL 32 DAY), 'Revisión general de frenos'),
(1, 3, 'Cada 12 meses',  DATE_SUB(CURDATE(), INTERVAL 300 DAY), DATE_ADD(CURDATE(), INTERVAL 65 DAY), 'Service integral de motor'),
(1, 4, 'Cada 40.000 km', DATE_SUB(CURDATE(), INTERVAL 95 DAY),  DATE_ADD(CURDATE(), INTERVAL 48 DAY), 'Cambio de correa y tensores'),
(1, 5, 'Cada 30.000 km', DATE_SUB(CURDATE(), INTERVAL 40 DAY),  DATE_ADD(CURDATE(), INTERVAL 80 DAY), 'Cambio de aceite y filtros');

-- ---------- VENCIMIENTOS ----------
INSERT INTO VENCIMIENTOS (id_empresa, concepto, fecha_vencimiento, id_unidad) VALUES
(1, 'VTV',                    DATE_ADD(CURDATE(), INTERVAL 8 DAY),   2),
(1, 'Seguro',                 DATE_SUB(CURDATE(), INTERVAL 3 DAY),   3),
(1, 'Habilitación municipal', DATE_ADD(CURDATE(), INTERVAL 75 DAY),  1),
(1, 'RUTA',                   DATE_ADD(CURDATE(), INTERVAL 120 DAY), 4),
(1, 'VTV',                    DATE_ADD(CURDATE(), INTERVAL 200 DAY), 6),
(1, 'Seguro',                 DATE_ADD(CURDATE(), INTERVAL 25 DAY),  5);

-- ---------- CUBIERTAS ----------
INSERT INTO CUBIERTAS (id_empresa, identificador, estado, id_unidad, ubicacion, fecha_colocacion) VALUES
(1, '295-80-A001', 'Nueva',          1, 'COLOCADA', DATE_SUB(CURDATE(), INTERVAL 15 DAY)),
(1, '295-80-A002', 'Buen estado',    1, 'AUXILIO',  DATE_SUB(CURDATE(), INTERVAL 90 DAY)),
(1, '295-80-B001', 'Media vida',     2, 'COLOCADA', DATE_SUB(CURDATE(), INTERVAL 120 DAY)),
(1, '295-80-C001', 'Recapada',       3, 'COLOCADA', DATE_SUB(CURDATE(), INTERVAL 45 DAY)),
(1, '295-80-D001', 'Desgaste alto',  4, 'COLOCADA', DATE_SUB(CURDATE(), INTERVAL 200 DAY)),
(1, '295-80-E001', 'Nueva',          5, 'COLOCADA', DATE_SUB(CURDATE(), INTERVAL 10 DAY)),
(1, '295-80-E002', 'Buen estado',    5, 'AUXILIO',  DATE_SUB(CURDATE(), INTERVAL 30 DAY));

-- ---------- GASTOS ADMINISTRATIVOS ----------
INSERT INTO GASTOS_ADMINISTRATIVOS (id_empresa, proveedor, concepto, fecha, monto) VALUES
(1, 'Estudio Contable Ruiz', 'Honorarios contables mensuales',        DATE_SUB(NOW(), INTERVAL 5 DAY),  280000),
(1, 'AFIP',                  'Pago de IVA mensual',                   DATE_SUB(NOW(), INTERVAL 7 DAY),  650000),
(1, 'Rentas Córdoba',        'Impuesto a los Ingresos Brutos',        DATE_SUB(NOW(), INTERVAL 9 DAY),  320000),
(1, 'Consultora Vial SRL',   'Asesoría en habilitaciones de flota',   DATE_SUB(NOW(), INTERVAL 14 DAY), 180000),
(1, 'AFIP',                  'Aportes y contribuciones (cargas soc.)',DATE_SUB(NOW(), INTERVAL 18 DAY), 540000);

-- Movimientos de los gastos administrativos (crédito al proveedor)
INSERT INTO MOVIMIENTOS (id_empresa, id_cuenta, monto, fecha, concepto) VALUES
(1, (SELECT id_cuenta FROM CUENTA WHERE nombre='Estudio Contable Ruiz' AND id_empresa=1), 280000.00, DATE_SUB(NOW(), INTERVAL 5 DAY),  'GASTO ADMINISTRATIVO #1 — Honorarios contables mensuales'),
(1, (SELECT id_cuenta FROM CUENTA WHERE nombre='AFIP' AND id_empresa=1),                  650000.00, DATE_SUB(NOW(), INTERVAL 7 DAY),  'GASTO ADMINISTRATIVO #2 — Pago de IVA mensual'),
(1, (SELECT id_cuenta FROM CUENTA WHERE nombre='Rentas Córdoba' AND id_empresa=1),        320000.00, DATE_SUB(NOW(), INTERVAL 9 DAY),  'GASTO ADMINISTRATIVO #3 — Impuesto a los Ingresos Brutos'),
(1, (SELECT id_cuenta FROM CUENTA WHERE nombre='Consultora Vial SRL' AND id_empresa=1),   180000.00, DATE_SUB(NOW(), INTERVAL 14 DAY), 'GASTO ADMINISTRATIVO #4 — Asesoría en habilitaciones de flota'),
(1, (SELECT id_cuenta FROM CUENTA WHERE nombre='AFIP' AND id_empresa=1),                  540000.00, DATE_SUB(NOW(), INTERVAL 18 DAY), 'GASTO ADMINISTRATIVO #5 — Aportes y contribuciones (cargas soc.)');

-- Vincular los movimientos automáticos con su documento de origen
-- (origen_tipo/origen_id), igual que la migración 023.
-- Movimientos de viajes, consumos y gastos: "<PREFIJO> #<id> — ..."
UPDATE MOVIMIENTOS
   SET origen_tipo = 'VIAJE_FACTURACION', origen_id = CAST(REGEXP_SUBSTR(concepto, '[0-9]+') AS UNSIGNED)
 WHERE origen_tipo IS NULL AND concepto REGEXP '^FACTURACION VIAJE #[0-9]+ —';

UPDATE MOVIMIENTOS
   SET origen_tipo = 'VIAJE_LIQUIDACION', origen_id = CAST(REGEXP_SUBSTR(concepto, '[0-9]+') AS UNSIGNED)
 WHERE origen_tipo IS NULL AND concepto REGEXP '^LIQUIDACION VIAJE #[0-9]+ —';

UPDATE MOVIMIENTOS
   SET origen_tipo = 'CONSUMO_COMBUSTIBLE', origen_id = CAST(REGEXP_SUBSTR(concepto, '[0-9]+') AS UNSIGNED)
 WHERE origen_tipo IS NULL AND concepto REGEXP '^CONSUMO COMBUSTIBLE #[0-9]+ —';

UPDATE MOVIMIENTOS
   SET origen_tipo = 'CONSUMO_GENERAL', origen_id = CAST(REGEXP_SUBSTR(concepto, '[0-9]+') AS UNSIGNED)
 WHERE origen_tipo IS NULL AND concepto REGEXP '^CONSUMO GENERAL #[0-9]+ —';

UPDATE MOVIMIENTOS
   SET origen_tipo = 'GASTO_ADMINISTRATIVO', origen_id = CAST(REGEXP_SUBSTR(concepto, '[0-9]+') AS UNSIGNED)
 WHERE origen_tipo IS NULL AND concepto REGEXP '^GASTO ADMINISTRATIVO #[0-9]+ —';

-- Facturas manuales y notas de crédito: "FACTURA A 0001-00000012 ..." y
-- "NOTA DE CREDITO A 0001-00000003 ...", vinculadas por punto de venta y número.
UPDATE MOVIMIENTOS m
  JOIN FACTURAS f ON f.id_empresa = m.id_empresa AND f.clase = 'FACTURA' AND f.id_viaje IS NULL
   AND m.concepto LIKE CONCAT('FACTURA A ', LPAD(f.punto_venta, 4, '0'), '-', LPAD(f.numero, 8, '0'), '%')
   SET m.origen_tipo = 'FACTURA', m.origen_id = f.id_factura
 WHERE m.origen_tipo IS NULL;

UPDATE MOVIMIENTOS m
  JOIN FACTURAS f ON f.id_empresa = m.id_empresa AND f.clase = 'NOTA_CREDITO'
   AND m.concepto LIKE CONCAT('NOTA DE CREDITO A ', LPAD(f.punto_venta, 4, '0'), '-', LPAD(f.numero, 8, '0'), '%')
   SET m.origen_tipo = 'NOTA_CREDITO', m.origen_id = f.id_factura
 WHERE m.origen_tipo IS NULL;

-- =========================================================
-- FIN DE LA INSTALACIÓN
-- =========================================================
