-- =========================================================
-- Migración 027: IVA discriminado en compras
-- =========================================================
-- Agrega los datos del comprobante del proveedor a los tres registros de
-- compra, sin cambiar el significado de la columna que ya tenían
-- (monto, o litros × precio en combustible): sigue siendo el total que se le
-- debe al proveedor, así que la cuenta corriente y los movimientos
-- automáticos no cambian.
--
-- comprobante_tipo: NO_INFORMADO (registro migrado, sin datos) o
--   SIN_COMPROBANTE (se cargó a mano así) no exigen que el desglose sume el
--   total; el resto sí, con tolerancia de $0,01 (ver
--   modulos/gastos/comprobanteCompra.js). Con letra B, C o TICKET el IVA
--   queda en cero: esos comprobantes no discriminan y no dan crédito fiscal.
--
-- Los registros existentes no tienen forma de saber su IVA real: no se
-- inventa. Quedan como NO_INFORMADO, con neto_gravado = total e iva = 0 (no
-- suman crédito fiscal); un listado "pendientes de completar" filtra por
-- comprobante_tipo = 'NO_INFORMADO' para que el cliente los corrija si tiene
-- el comprobante a mano.
--
-- CUENTA.condicion_iva: la condición del proveedor frente al IVA, para el
-- futuro Libro IVA Compras (comparte esta migración con el Bloque 4). La
-- vista V_COMPRAS_FISCALES ya la deja lista, aunque hoy quede sin cargar.
-- =========================================================

ALTER TABLE CONSUMOS_COMBUSTIBLE
  ADD COLUMN comprobante_tipo ENUM('FACTURA', 'NOTA_DEBITO', 'NOTA_CREDITO', 'TICKET', 'RECIBO', 'SIN_COMPROBANTE', 'NO_INFORMADO')
    NOT NULL DEFAULT 'NO_INFORMADO' AFTER fecha,
  ADD COLUMN comprobante_letra CHAR(1) NULL AFTER comprobante_tipo,
  ADD COLUMN comprobante_punto_venta INT NULL AFTER comprobante_letra,
  ADD COLUMN comprobante_numero INT NULL AFTER comprobante_punto_venta,
  ADD COLUMN neto_gravado DECIMAL(12, 2) NOT NULL DEFAULT 0 AFTER comprobante_numero,
  ADD COLUMN iva_alicuota DECIMAL(5, 2) NULL AFTER neto_gravado,
  ADD COLUMN iva DECIMAL(12, 2) NOT NULL DEFAULT 0 AFTER iva_alicuota,
  ADD COLUMN no_gravado DECIMAL(12, 2) NOT NULL DEFAULT 0 AFTER iva,
  ADD COLUMN exento DECIMAL(12, 2) NOT NULL DEFAULT 0 AFTER no_gravado,
  ADD COLUMN percepciones DECIMAL(12, 2) NOT NULL DEFAULT 0 AFTER exento;

ALTER TABLE CONSUMOS_GENERALES
  ADD COLUMN comprobante_tipo ENUM('FACTURA', 'NOTA_DEBITO', 'NOTA_CREDITO', 'TICKET', 'RECIBO', 'SIN_COMPROBANTE', 'NO_INFORMADO')
    NOT NULL DEFAULT 'NO_INFORMADO' AFTER concepto,
  ADD COLUMN comprobante_letra CHAR(1) NULL AFTER comprobante_tipo,
  ADD COLUMN comprobante_punto_venta INT NULL AFTER comprobante_letra,
  ADD COLUMN comprobante_numero INT NULL AFTER comprobante_punto_venta,
  ADD COLUMN neto_gravado DECIMAL(12, 2) NOT NULL DEFAULT 0 AFTER comprobante_numero,
  ADD COLUMN iva_alicuota DECIMAL(5, 2) NULL AFTER neto_gravado,
  ADD COLUMN iva DECIMAL(12, 2) NOT NULL DEFAULT 0 AFTER iva_alicuota,
  ADD COLUMN no_gravado DECIMAL(12, 2) NOT NULL DEFAULT 0 AFTER iva,
  ADD COLUMN exento DECIMAL(12, 2) NOT NULL DEFAULT 0 AFTER no_gravado,
  ADD COLUMN percepciones DECIMAL(12, 2) NOT NULL DEFAULT 0 AFTER exento;

ALTER TABLE GASTOS_ADMINISTRATIVOS
  ADD COLUMN comprobante_tipo ENUM('FACTURA', 'NOTA_DEBITO', 'NOTA_CREDITO', 'TICKET', 'RECIBO', 'SIN_COMPROBANTE', 'NO_INFORMADO')
    NOT NULL DEFAULT 'NO_INFORMADO' AFTER concepto,
  ADD COLUMN comprobante_letra CHAR(1) NULL AFTER comprobante_tipo,
  ADD COLUMN comprobante_punto_venta INT NULL AFTER comprobante_letra,
  ADD COLUMN comprobante_numero INT NULL AFTER comprobante_punto_venta,
  ADD COLUMN neto_gravado DECIMAL(12, 2) NOT NULL DEFAULT 0 AFTER comprobante_numero,
  ADD COLUMN iva_alicuota DECIMAL(5, 2) NULL AFTER neto_gravado,
  ADD COLUMN iva DECIMAL(12, 2) NOT NULL DEFAULT 0 AFTER iva_alicuota,
  ADD COLUMN no_gravado DECIMAL(12, 2) NOT NULL DEFAULT 0 AFTER iva,
  ADD COLUMN exento DECIMAL(12, 2) NOT NULL DEFAULT 0 AFTER no_gravado,
  ADD COLUMN percepciones DECIMAL(12, 2) NOT NULL DEFAULT 0 AFTER exento;

-- Relleno de lo ya cargado: neto_gravado = total, sin IVA (no se inventa).
UPDATE CONSUMOS_COMBUSTIBLE
   SET neto_gravado = ROUND(cantidad_litros * precio_por_litro, 2)
 WHERE comprobante_tipo = 'NO_INFORMADO';

UPDATE CONSUMOS_GENERALES
   SET neto_gravado = monto
 WHERE comprobante_tipo = 'NO_INFORMADO';

UPDATE GASTOS_ADMINISTRATIVOS
   SET neto_gravado = monto
 WHERE comprobante_tipo = 'NO_INFORMADO';

-- Condición frente al IVA del proveedor/cliente (comparte con el Bloque 4).
ALTER TABLE CUENTA
  ADD COLUMN condicion_iva VARCHAR(40) NULL AFTER plazo_pago_dias;

-- V_COMPRAS_FISCALES: une los tres registros de compra con el CUIT y la
-- condición de IVA del proveedor, lista para el Libro IVA Compras (2da entrega).
CREATE OR REPLACE VIEW V_COMPRAS_FISCALES AS
  SELECT 'CONSUMOS_COMBUSTIBLE' AS origen_tabla, cc.id_consumo_combustible AS origen_id,
         cc.id_empresa, cc.proveedor, c.cuil AS proveedor_cuil, c.condicion_iva AS proveedor_condicion_iva,
         cc.fecha, cc.comprobante_tipo, cc.comprobante_letra, cc.comprobante_punto_venta, cc.comprobante_numero,
         cc.neto_gravado, cc.iva_alicuota, cc.iva, cc.no_gravado, cc.exento, cc.percepciones,
         ROUND(cc.cantidad_litros * cc.precio_por_litro, 2) AS total
    FROM CONSUMOS_COMBUSTIBLE cc
    LEFT JOIN CUENTA c ON c.id_empresa = cc.id_empresa AND c.nombre = cc.proveedor AND c.tipo = 'PROVEEDOR'
  UNION ALL
  SELECT 'CONSUMOS_GENERALES', cg.id_consumo_general,
         cg.id_empresa, cg.proveedor, c.cuil, c.condicion_iva,
         cg.fecha, cg.comprobante_tipo, cg.comprobante_letra, cg.comprobante_punto_venta, cg.comprobante_numero,
         cg.neto_gravado, cg.iva_alicuota, cg.iva, cg.no_gravado, cg.exento, cg.percepciones,
         cg.monto
    FROM CONSUMOS_GENERALES cg
    LEFT JOIN CUENTA c ON c.id_empresa = cg.id_empresa AND c.nombre = cg.proveedor AND c.tipo = 'PROVEEDOR'
  UNION ALL
  SELECT 'GASTOS_ADMINISTRATIVOS', ga.id_gasto_administrativo,
         ga.id_empresa, ga.proveedor, c.cuil, c.condicion_iva,
         ga.fecha, ga.comprobante_tipo, ga.comprobante_letra, ga.comprobante_punto_venta, ga.comprobante_numero,
         ga.neto_gravado, ga.iva_alicuota, ga.iva, ga.no_gravado, ga.exento, ga.percepciones,
         ga.monto
    FROM GASTOS_ADMINISTRATIVOS ga
    LEFT JOIN CUENTA c ON c.id_empresa = ga.id_empresa AND c.nombre = ga.proveedor AND c.tipo = 'PROVEEDOR';

-- Verificación: misma cantidad de filas y misma suma de totales antes y
-- después (debe dar 0 en las tres filas de diferencia_total).
SELECT 'CONSUMOS_COMBUSTIBLE' AS tabla, COUNT(*) AS cantidad,
       ROUND(SUM(cantidad_litros * precio_por_litro) - SUM(neto_gravado + iva + no_gravado + exento + percepciones), 2) AS diferencia_total
  FROM CONSUMOS_COMBUSTIBLE
UNION ALL
SELECT 'CONSUMOS_GENERALES', COUNT(*),
       ROUND(SUM(monto) - SUM(neto_gravado + iva + no_gravado + exento + percepciones), 2)
  FROM CONSUMOS_GENERALES
UNION ALL
SELECT 'GASTOS_ADMINISTRATIVOS', COUNT(*),
       ROUND(SUM(monto) - SUM(neto_gravado + iva + no_gravado + exento + percepciones), 2)
  FROM GASTOS_ADMINISTRATIVOS;
