-- =========================================================
-- Migración 024: seguridad de las cuentas de usuario
-- =========================================================
-- debe_cambiar_contrasena: el usuario tiene una contraseña asignada por otro
--   (instalación inicial o alta/reseteo hecho por el administrador) y debe
--   cambiarla al ingresar. Mientras tanto no puede operar el sistema.
-- version_sesion: se incrementa al cambiar la contraseña. Las sesiones
--   abiertas con la versión anterior dejan de valer en ese momento, en lugar
--   de seguir activas hasta que venzan (12 h).
--
-- Segura sobre datos reales: los usuarios existentes quedan con 0 en ambas
-- columnas, así que nadie queda obligado a cambiar la contraseña ni pierde la
-- sesión al desplegar. Correr DESPUÉS de la 023.
-- =========================================================

ALTER TABLE USUARIOS
  ADD COLUMN debe_cambiar_contrasena TINYINT(1) NOT NULL DEFAULT 0 AFTER activo,
  ADD COLUMN version_sesion INT NOT NULL DEFAULT 0 AFTER debe_cambiar_contrasena;
