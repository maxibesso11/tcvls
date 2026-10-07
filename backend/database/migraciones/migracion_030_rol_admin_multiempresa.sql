-- =========================================================
-- Migración 030: rol ADMIN_MULTIEMPRESA
-- =========================================================
-- Agrega un cuarto rol a USUARIOS: ADMIN_MULTIEMPRESA administra y opera un
-- subconjunto de empresas (no todas, como el ADMIN de plataforma; no una
-- sola, como ADMIN_EMPRESA). Dentro de cada empresa asignada puede
-- gestionar usuarios (hasta ADMIN_EMPRESA), el certificado ARCA y los datos
-- fiscales, y operar el día a día — igual que hace ADMIN_EMPRESA, pero para
-- varias. Nunca crea ni da de baja empresas.
--
-- Igual que el ADMIN de plataforma, no pertenece a ninguna empresa
-- (id_empresa NULL): el conjunto de empresas que puede operar vive en
-- USUARIOS_EMPRESAS, y con cuál está operando en cada momento es un dato de
-- sesión (cabecera X-Empresa-Id), no de columna. Solo el ADMIN global
-- escribe USUARIOS_EMPRESAS (ver backend/src/modulos/admin/empresasAsignadas.servicio.js).
--
-- Sin cambios en los datos existentes: todos los usuarios actuales quedan
-- con su rol tal cual. El administrador de plataforma decide después a
-- quién promover a ADMIN_MULTIEMPRESA y qué empresas asignarle.
-- =========================================================

ALTER TABLE USUARIOS
  MODIFY COLUMN rol ENUM('ADMIN', 'ADMIN_EMPRESA', 'ADMIN_MULTIEMPRESA', 'USUARIO') NOT NULL DEFAULT 'USUARIO';

CREATE TABLE USUARIOS_EMPRESAS (
    id_usuario INT NOT NULL,
    id_empresa INT NOT NULL,
    fecha_asignacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_usuario, id_empresa),
    FOREIGN KEY (id_usuario) REFERENCES USUARIOS(id_usuario) ON DELETE CASCADE,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    INDEX idx_ue_empresa (id_empresa)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
