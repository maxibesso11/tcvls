-- =========================================================
-- Migración 038: solicitudes del formulario de contacto de la landing
-- =========================================================
-- Cada solicitud ("Solicitar asesoría", "Pedir una demostración") se guarda
-- acá y la ve el administrador de plataforma; el aviso por correo es
-- adicional y solo si el servidor tiene el SMTP configurado.
-- =========================================================

CREATE TABLE SOLICITUDES_CONTACTO (
    id_solicitud INT AUTO_INCREMENT PRIMARY KEY,
    fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    nombre VARCHAR(120) NOT NULL,
    empresa VARCHAR(120) NOT NULL,
    email VARCHAR(150) NOT NULL,
    telefono VARCHAR(40) NOT NULL,
    mensaje TEXT NULL,
    ip VARCHAR(45) NULL,
    estado ENUM('NUEVA', 'CONTACTADA', 'DESCARTADA') NOT NULL DEFAULT 'NUEVA',
    avisada_por_correo TINYINT(1) NOT NULL DEFAULT 0,
    INDEX idx_sol_estado_fecha (estado, fecha)
);
