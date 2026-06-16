-- =========================================================
-- MIGRACIÓN 016: Modularización por empresa
-- Cada empresa puede tener distintos módulos activos según sus
-- necesidades. Desactivar un módulo no borra sus datos.
-- =========================================================

CREATE TABLE MODULOS_EMPRESA (
    id_empresa INT NOT NULL,
    modulo VARCHAR(40) NOT NULL,
    activo TINYINT(1) NOT NULL DEFAULT 1,
    PRIMARY KEY (id_empresa, modulo),
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE
);

-- Activar todos los módulos para las empresas ya existentes, para que el
-- sistema siga funcionando igual que antes tras la migración.
INSERT INTO MODULOS_EMPRESA (id_empresa, modulo, activo)
SELECT e.id_empresa, m.modulo, 1
FROM EMPRESAS e
CROSS JOIN (
    SELECT 'choferes' AS modulo UNION ALL
    SELECT 'unidades' UNION ALL
    SELECT 'equipos' UNION ALL
    SELECT 'cubiertas' UNION ALL
    SELECT 'mantenimientos' UNION ALL
    SELECT 'vencimientos' UNION ALL
    SELECT 'viajes' UNION ALL
    SELECT 'consumos-combustible' UNION ALL
    SELECT 'consumos-generales' UNION ALL
    SELECT 'gastos-administrativos' UNION ALL
    SELECT 'cuentas' UNION ALL
    SELECT 'movimientos' UNION ALL
    SELECT 'cuentas-corrientes' UNION ALL
    SELECT 'stock'
) m;
