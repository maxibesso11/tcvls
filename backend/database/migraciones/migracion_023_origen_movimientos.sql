-- =========================================================
-- Migración 023: referencia formal entre cada movimiento automático y su origen
-- =========================================================
-- Hasta ahora los movimientos que genera el sistema (facturación y
-- liquidación de viajes, consumos, gastos administrativos, facturas manuales
-- y notas de crédito) se vinculaban con su documento de origen solo por el
-- TEXTO del concepto. Si alguien editaba el concepto, el vínculo se perdía y
-- la próxima edición del viaje duplicaba la deuda.
--
-- Esta migración agrega una referencia explícita (origen_tipo + origen_id) y
-- la completa para los movimientos existentes a partir de su concepto.
-- Es segura sobre datos reales: solo agrega columnas e índice y completa las
-- que están vacías. Los movimientos cargados a mano (recibos, ajustes) quedan
-- sin origen, como corresponde.
--
-- Requiere MySQL 8 (REGEXP_SUBSTR). Correr DESPUÉS de la 022.
-- Al final muestra un resumen para verificar el resultado.
-- =========================================================

ALTER TABLE MOVIMIENTOS
  ADD COLUMN origen_tipo VARCHAR(30) NULL AFTER concepto,
  ADD COLUMN origen_id INT NULL AFTER origen_tipo,
  ADD INDEX idx_mov_origen (id_empresa, origen_tipo, origen_id);

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

-- Resumen: cuántos movimientos quedaron vinculados a cada tipo de origen.
-- "SIN ORIGEN" son los cargados a mano (recibos, ajustes).
SELECT COALESCE(origen_tipo, 'SIN ORIGEN') AS origen, COUNT(*) AS movimientos
  FROM MOVIMIENTOS GROUP BY origen_tipo ORDER BY origen;

-- Movimientos que PARECEN automáticos pero no se pudieron vincular (concepto
-- editado a mano o mal codificado). Deben quedar en cero o revisarse a mano.
SELECT id_movimiento, id_empresa, id_cuenta, monto, fecha, concepto
  FROM MOVIMIENTOS
 WHERE origen_tipo IS NULL
   AND concepto REGEXP '^(FACTURACION VIAJE|LIQUIDACION VIAJE|CONSUMO COMBUSTIBLE|CONSUMO GENERAL|GASTO ADMINISTRATIVO|FACTURA A|NOTA DE CREDITO A)';
