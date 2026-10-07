// backend/src/modulos/gastos/gastosAdministrativos.hooks.js
// Sincroniza GASTOS_ADMINISTRATIVOS con la cuenta del proveedor, por empresa.
// Cada movimiento queda vinculado a su gasto por origen_tipo/origen_id; los
// hooks after* escriben con req.db, dentro de la transacción del CRUD; los
// hooks before* corren antes de esa transacción y validan contra `pool`.
// `monto` sigue siendo el total al proveedor: el comprobante (Bloque 7 · IVA
// en compras) solo lo discrimina en neto, IVA y el resto de los conceptos.
const pool = require('../../config/db');
const { buscarCuentaProveedor, validarProveedor } = require('../cuentas/cuentas.servicio');
const { ORIGEN, crearMovimientoAutomatico, eliminarMovimientosDeOrigen } = require('../cuentas/movimientos.servicio');
const { prepararComprobante } = require('./comprobanteCompra');
const { validarComprobanteNoDuplicado } = require('./comprobanteDuplicado.servicio');

function efectivo(campo, data, anterior) {
  if (data[campo] !== undefined) return data[campo];
  return anterior ? anterior[campo] : undefined;
}

async function validarGasto(data, anterior, idEmpresa, total, idActual) {
  const errorProveedor = await validarProveedor(data, anterior, idEmpresa);
  if (errorProveedor) return errorProveedor;

  const { datos, error } = prepararComprobante(data, anterior, total);
  if (error) return error;

  const proveedor = efectivo('proveedor', data, anterior);
  const errorDuplicado = await validarComprobanteNoDuplicado(pool, idEmpresa, proveedor, datos, 'GASTOS_ADMINISTRATIVOS', idActual);
  if (errorDuplicado) return errorDuplicado;

  Object.assign(data, datos);
  return null;
}

async function antesDeCrearGasto(data, req) {
  const total = Number(efectivo('monto', data, null)) || 0;
  return validarGasto(data, null, req.usuario.id_empresa, total, null);
}

async function antesDeActualizarGasto(id, data, anterior, req) {
  const total = Number(efectivo('monto', data, anterior)) || 0;
  return validarGasto(data, anterior, req.usuario.id_empresa, total, id);
}

async function crearMovimiento(db, gasto, idEmpresa) {
  const cuenta = await buscarCuentaProveedor(gasto.proveedor, idEmpresa, db);
  if (!cuenta) return;
  await crearMovimientoAutomatico(db, {
    idEmpresa,
    idCuenta: cuenta.id_cuenta,
    monto: Math.abs(Number(gasto.monto)),
    fecha: gasto.fecha,
    concepto: `GASTO ADMINISTRATIVO #${gasto.id_gasto_administrativo} — ${gasto.concepto}`,
    origenTipo: ORIGEN.GASTO_ADMINISTRATIVO,
    origenId: gasto.id_gasto_administrativo
  });
}

async function alCrearGasto(gasto, req) {
  await crearMovimiento(req.db, gasto, req.usuario.id_empresa);
}

async function alActualizarGasto(gasto, anterior, req) {
  await alEliminarGasto(gasto, req);
  await crearMovimiento(req.db, gasto, req.usuario.id_empresa);
}

async function alEliminarGasto(gasto, req) {
  await eliminarMovimientosDeOrigen(req.db, req.usuario.id_empresa, ORIGEN.GASTO_ADMINISTRATIVO, gasto.id_gasto_administrativo);
}

module.exports = {
  antesDeCrearGasto,
  antesDeActualizarGasto,
  alCrearGasto,
  alActualizarGasto,
  alEliminarGasto
};
