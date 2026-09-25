-- Migración 021: certificados de facturación electrónica (ARCA) por empresa
--
-- Crea la tabla donde cada empresa guarda su certificado de facturación. La
-- clave privada se almacena CIFRADA (AES-256-GCM, ver config/cifrado.js); nunca
-- en texto plano. No afecta datos existentes: las empresas sin certificado
-- simplemente no tienen filas en esta tabla hasta que generen el suyo.
--
-- Requiere configurar CERT_SECRET en el .env del servidor (la clave que cifra
-- las claves privadas). Ver .env.example.

CREATE TABLE IF NOT EXISTS CERTIFICADOS_ARCA (
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
