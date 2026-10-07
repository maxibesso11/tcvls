-- =========================================================
-- Migración 032: bitácora de actividad (AUDITORIA)
-- =========================================================
-- Registra quién hizo qué y cuándo: ingresos al sistema y cada alta,
-- modificación o baja. Sin claves foráneas a propósito: el historial debe
-- sobrevivir a la baja de un usuario o de una empresa (se guarda también el
-- nombre del usuario). Nunca se guardan contraseñas ni el contenido de los
-- formularios. La aplicación elimina lo que supera un año.
-- =========================================================

CREATE TABLE AUDITORIA (
    id_auditoria BIGINT AUTO_INCREMENT PRIMARY KEY,
    fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    id_usuario INT NULL,
    nombre_usuario VARCHAR(100) NULL,
    rol VARCHAR(30) NULL,
    id_empresa INT NULL,
    ip VARCHAR(45) NULL,
    accion VARCHAR(40) NOT NULL,
    entidad VARCHAR(60) NULL,
    id_entidad VARCHAR(40) NULL,
    metodo VARCHAR(8) NOT NULL,
    ruta VARCHAR(255) NOT NULL,
    estado ENUM('OK', 'ERROR') NOT NULL,
    codigo_http SMALLINT NOT NULL,
    detalle VARCHAR(255) NULL,
    navegador VARCHAR(255) NULL,
    INDEX idx_aud_fecha (fecha),
    INDEX idx_aud_empresa_fecha (id_empresa, fecha),
    INDEX idx_aud_usuario (id_usuario),
    INDEX idx_aud_accion (accion)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
