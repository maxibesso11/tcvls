-- =========================================================
-- MIGRACIÓN 012: Multi-empresa con autenticación
-- Agrega las tablas EMPRESAS y USUARIOS, y la columna id_empresa
-- a las 13 tablas de datos, aislando la información por empresa.
--
-- IMPORTANTE: esta migración asume una base existente con datos de
-- UNA sola empresa. Crea una empresa por defecto (id=1) y le asigna
-- todos los registros actuales. Ajusta el nombre/cuit antes de correr.
-- =========================================================

-- 1. Tablas de gestión
CREATE TABLE EMPRESAS (
    id_empresa INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    cuit VARCHAR(13) UNIQUE,
    domicilio VARCHAR(150),
    telefono VARCHAR(30),
    email VARCHAR(100),
    activa TINYINT(1) NOT NULL DEFAULT 1,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_nombre (nombre)
);

CREATE TABLE USUARIOS (
    id_usuario INT AUTO_INCREMENT PRIMARY KEY,
    nombre_usuario VARCHAR(50) UNIQUE NOT NULL,
    contrasena_hash VARCHAR(200) NOT NULL,
    correo VARCHAR(100),
    id_empresa INT,
    rol ENUM('ADMIN', 'USUARIO') NOT NULL DEFAULT 'USUARIO',
    activo TINYINT(1) NOT NULL DEFAULT 1,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE SET NULL,
    INDEX idx_nombre_usuario (nombre_usuario),
    INDEX idx_empresa (id_empresa)
);

-- 2. Empresa por defecto para los datos existentes (AJUSTAR datos)
INSERT INTO EMPRESAS (id_empresa, nombre, cuit) VALUES (1, '3 de Abril SAS', '30-71122334-5');

-- 3. Usuarios iniciales
--    admin / admin123  · demo / demo123  (cambiar las contraseñas luego)
INSERT INTO USUARIOS (nombre_usuario, contrasena_hash, correo, id_empresa, rol) VALUES
('admin', 'e12acd1b80ef12b19b56c9f4877aed83:7404618ad96aa4d5ad409a42444d9fd9a4ef878c5f170bbb99220790adf9c0c8f4d45e0d01d6e35b864b8e491d9f18a0a8b65a4c60394640fd66d5848c2f3cfa', 'admin@sistema.com', NULL, 'ADMIN'),
('demo',  '3c56c08776b3cff2b08c290940182ad2:739e3d24b6ae96f530d6080ff6c0168055bade988dc58873cb7f9576e90a09fb152539a310412e30ce3a723ade743c9bbc22b7dd3acd524b4d8d8a5d395d86f7', 'demo@3deabril.com.ar', 1, 'USUARIO');

-- 4. Agregar id_empresa a cada tabla, asignar a la empresa 1 y enlazar FK.
--    (Se agrega como NULL, se rellena con 1, luego se vuelve NOT NULL + FK.)
ALTER TABLE CHOFERES               ADD COLUMN id_empresa INT NULL AFTER id_chofer;
ALTER TABLE UNIDADES               ADD COLUMN id_empresa INT NULL AFTER id_unidad;
ALTER TABLE EQUIPO                 ADD COLUMN id_empresa INT NULL AFTER id_equipo;
ALTER TABLE VIAJES                 ADD COLUMN id_empresa INT NULL AFTER id_viaje;
ALTER TABLE CONSUMOS_COMBUSTIBLE   ADD COLUMN id_empresa INT NULL AFTER id_consumo_combustible;
ALTER TABLE CONSUMOS_GENERALES     ADD COLUMN id_empresa INT NULL AFTER id_consumo_general;
ALTER TABLE CUENTA                 ADD COLUMN id_empresa INT NULL AFTER id_cuenta;
ALTER TABLE MOVIMIENTOS            ADD COLUMN id_empresa INT NULL AFTER id_movimiento;
ALTER TABLE STOCK                  ADD COLUMN id_empresa INT NULL AFTER id_stock;
ALTER TABLE MANTENIMIENTOS         ADD COLUMN id_empresa INT NULL AFTER id_mantenimiento;
ALTER TABLE VENCIMIENTOS           ADD COLUMN id_empresa INT NULL AFTER id_vencimiento;
ALTER TABLE CUBIERTAS              ADD COLUMN id_empresa INT NULL AFTER id_cubierta;
ALTER TABLE GASTOS_ADMINISTRATIVOS ADD COLUMN id_empresa INT NULL AFTER id_gasto_administrativo;

UPDATE CHOFERES               SET id_empresa = 1;
UPDATE UNIDADES               SET id_empresa = 1;
UPDATE EQUIPO                 SET id_empresa = 1;
UPDATE VIAJES                 SET id_empresa = 1;
UPDATE CONSUMOS_COMBUSTIBLE   SET id_empresa = 1;
UPDATE CONSUMOS_GENERALES     SET id_empresa = 1;
UPDATE CUENTA                 SET id_empresa = 1;
UPDATE MOVIMIENTOS            SET id_empresa = 1;
UPDATE STOCK                  SET id_empresa = 1;
UPDATE MANTENIMIENTOS         SET id_empresa = 1;
UPDATE VENCIMIENTOS           SET id_empresa = 1;
UPDATE CUBIERTAS              SET id_empresa = 1;
UPDATE GASTOS_ADMINISTRATIVOS SET id_empresa = 1;

-- Volver NOT NULL y enlazar FK
ALTER TABLE CHOFERES               MODIFY id_empresa INT NOT NULL, ADD FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE;
ALTER TABLE UNIDADES               MODIFY id_empresa INT NOT NULL, ADD FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE;
ALTER TABLE EQUIPO                 MODIFY id_empresa INT NOT NULL, ADD FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE;
ALTER TABLE VIAJES                 MODIFY id_empresa INT NOT NULL, ADD FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE;
ALTER TABLE CONSUMOS_COMBUSTIBLE   MODIFY id_empresa INT NOT NULL, ADD FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE;
ALTER TABLE CONSUMOS_GENERALES     MODIFY id_empresa INT NOT NULL, ADD FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE;
ALTER TABLE CUENTA                 MODIFY id_empresa INT NOT NULL, ADD FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE;
ALTER TABLE MOVIMIENTOS            MODIFY id_empresa INT NOT NULL, ADD FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE;
ALTER TABLE STOCK                  MODIFY id_empresa INT NOT NULL, ADD FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE;
ALTER TABLE MANTENIMIENTOS         MODIFY id_empresa INT NOT NULL, ADD FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE;
ALTER TABLE VENCIMIENTOS           MODIFY id_empresa INT NOT NULL, ADD FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE;
ALTER TABLE CUBIERTAS              MODIFY id_empresa INT NOT NULL, ADD FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE;
ALTER TABLE GASTOS_ADMINISTRATIVOS MODIFY id_empresa INT NOT NULL, ADD FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE;

-- 5. Convertir los UNIQUE simples en compuestos (por empresa)
ALTER TABLE CHOFERES DROP INDEX cuil,    ADD UNIQUE KEY uq_chofer_cuil (id_empresa, cuil);
ALTER TABLE UNIDADES DROP INDEX patente, ADD UNIQUE KEY uq_unidad_patente (id_empresa, patente);
ALTER TABLE CUENTA   DROP INDEX cuil,    ADD UNIQUE KEY uq_cuenta_cuil (id_empresa, cuil);
