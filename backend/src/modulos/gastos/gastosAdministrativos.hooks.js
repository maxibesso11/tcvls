// backend/src/modulos/gastos/gastosAdministrativos.hooks.js
// Sincroniza GASTOS_ADMINISTRATIVOS con la cuenta del proveedor, por empresa.
const pool = require('../../config/db');
const { buscarCuentaProveedor, validarProveedor } = require('../cuentas/cuentas.servicio');

async function antesDeCrearGasto(data, req) {
  return validarProveedor(data, null, req.usuario.id_empresa);
}

async function antesDeActualizarGasto(id, data, anterior, req) {
  return validarProveedor(data, anterior, req.usuario.id_empresa);
}

async function eliminarMovimiento(idGasto, idEmpresa) {
  await pool.query(
    'DELETE FROM MOVIMIENTOS WHERE id_empresa = ? AND concepto LIKE ?',
    [idEmpresa, `GASTO ADMINISTRATIVO #${idGasto} —%`]
  );
}

async function crearMovimiento(gasto, idEmpresa) {
  const cuenta = await buscarCuentaProveedor(gasto.proveedor, idEmpresa);
  if (!cuenta) return;
  await pool.query('INSERT INTO MOVIMIENTOS SET ?', [{
    id_empresa: idEmpresa,
    id_cuenta: cuenta.id_cuenta,
    monto: Math.abs(Number(gasto.monto)),
    fecha: gasto.fecha,
    concepto: `GASTO ADMINISTRATIVO #${gasto.id_gasto_administrativo} — ${gasto.concepto}`.slice(0, 255)
  }]);
}

async function alCrearGasto(gasto, req) {
  await crearMovimiento(gasto, req.usuario.id_empresa);
}

async function alActualizarGasto(gasto, anterior, req) {
  await eliminarMovimiento(gasto.id_gasto_administrativo, req.usuario.id_empresa);
  await crearMovimiento(gasto, req.usuario.id_empresa);
}

async function alEliminarGasto(gasto, req) {
  await eliminarMovimiento(gasto.id_gasto_administrativo, req.usuario.id_empresa);
}

module.exports = {
  antesDeCrearGasto,
  antesDeActualizarGasto,
  alCrearGasto,
  alActualizarGasto,
  alEliminarGasto
};
