-- =========================================================
-- Migración 028: rol ADMIN_EMPRESA
-- =========================================================
-- Agrega un tercer rol a USUARIOS: ADMIN_EMPRESA opera los datos de su
-- empresa igual que un USUARIO y además administra los usuarios, el
-- certificado ARCA y los datos fiscales de su propia empresa (nunca de
-- otra). La empresa siempre sale del token, nunca de la URL ni del cuerpo
-- del pedido (ver modulos/empresa/empresa.rutas.js).
--
-- Sin cambios en los datos existentes: todos los usuarios actuales quedan
-- con su rol tal cual (ADMIN o USUARIO). El administrador de plataforma
-- decide después a quién promover a ADMIN_EMPRESA.
-- =========================================================

ALTER TABLE USUARIOS
  MODIFY COLUMN rol ENUM('ADMIN', 'ADMIN_EMPRESA', 'USUARIO') NOT NULL DEFAULT 'USUARIO';
