-- Migración 019: plazo de pago de clientes en cuentas corrientes
--
-- Agrega a la tabla CUENTA un plazo de pago en días. Aplica a las cuentas de
-- tipo CLIENTE: indica cuántos días puede adeudar el cliente (desde que su
-- saldo entró en deuda) antes de que el sistema genere una alerta de "cobro
-- vencido" en el panel.
--
-- Es opcional (NULL = sin plazo definido = sin alerta). No afecta los datos
-- existentes: las cuentas ya cargadas quedan con NULL hasta que se les asigne
-- un plazo desde el formulario de la cuenta.

ALTER TABLE CUENTA
  ADD COLUMN plazo_pago_dias INT DEFAULT NULL
  COMMENT 'Días de plazo de pago para clientes antes de alertar cobro vencido';
