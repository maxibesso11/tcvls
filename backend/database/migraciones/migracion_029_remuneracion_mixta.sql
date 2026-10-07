-- =========================================================
-- Migración 029: remuneración mixta de choferes
-- =========================================================
-- Separa la remuneración del chofer en una parte FIJA mensual y una parte
-- VARIABLE por viaje (porcentaje o por km), cada una opcional, para cubrir
-- el caso de un sueldo fijo más un porcentaje del viaje en el mismo chofer.
--
-- CHOFERES.remuneracion y tipo_remuneracion quedan en la tabla una versión
-- más, como respaldo (no los usa más el backend): se eliminan en una
-- migración posterior, cuando el control de antes y después haya dado igual
-- en producción.
--
-- LIQUIDACIONES_SUELDO registra el sueldo fijo liquidado por chofer y
-- período (AAAA-MM), para que la acción "Liquidar sueldos fijos del mes" no
-- duplique el movimiento si se corre más de una vez. La rentabilidad por
-- equipo NO usa esta tabla: siempre prorratea sueldo_fijo_mensual según
-- EQUIPO_HISTORIAL, así un mes sin liquidar no aparece más rentable de lo
-- que es.
-- =========================================================

ALTER TABLE CHOFERES
  ADD COLUMN sueldo_fijo_mensual DECIMAL(12, 2) NULL AFTER tipo_remuneracion,
  ADD COLUMN variable_tipo ENUM('PORCENTAJE', 'POR KM') NULL AFTER sueldo_fijo_mensual,
  ADD COLUMN variable_valor DECIMAL(10, 2) NULL AFTER variable_tipo;

-- Relleno: FIJA → sueldo_fijo_mensual; PORCENTAJE/POR KM → parte variable.
UPDATE CHOFERES
   SET sueldo_fijo_mensual = remuneracion
 WHERE tipo_remuneracion = 'FIJA';

UPDATE CHOFERES
   SET variable_tipo = tipo_remuneracion, variable_valor = remuneracion
 WHERE tipo_remuneracion IN ('PORCENTAJE', 'POR KM');

CREATE TABLE LIQUIDACIONES_SUELDO (
    id_liquidacion_sueldo INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    id_chofer INT NOT NULL,
    periodo CHAR(7) NOT NULL COMMENT 'AAAA-MM',
    monto DECIMAL(12, 2) NOT NULL,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    FOREIGN KEY (id_chofer) REFERENCES CHOFERES(id_chofer) ON DELETE RESTRICT,
    UNIQUE KEY uq_liquidacion_sueldo_periodo (id_empresa, id_chofer, periodo)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Verificación: mismo total de choferes con remuneración antes y después
-- (debe dar 0 en las tres columnas).
SELECT
  SUM(tipo_remuneracion = 'FIJA' AND (sueldo_fijo_mensual IS NULL OR sueldo_fijo_mensual <> remuneracion)) AS fijos_sin_migrar,
  SUM(tipo_remuneracion IN ('PORCENTAJE', 'POR KM') AND (variable_tipo IS NULL OR variable_valor IS NULL)) AS variables_sin_migrar,
  SUM(tipo_remuneracion IS NULL AND (sueldo_fijo_mensual IS NOT NULL OR variable_tipo IS NOT NULL)) AS inventados
FROM CHOFERES;
