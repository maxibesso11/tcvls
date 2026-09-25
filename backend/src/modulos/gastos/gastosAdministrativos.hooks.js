// backend/src/modulos/gastos/gastosAdministrativos.hooks.js
// Sincroniza GASTOS_ADMINISTRATIVOS con la cuenta del proveedor, por empresa.
const pool = require('../../config/db');

async function buscarCuentaPorNombre(nombre, idEmpresa) {
  if (!nombre) return null;
  const [[cuenta]] = await pool.query(
    `SELECT id_cuenta FROM CUENTA
     WHERE nombre = ? AND id_empresa = ? AND tipo IN ('PROVEEDOR', 'CLIENTE')
     ORDER BY FIELD(tipo, 'PROVEEDOR', 'CLIENTE') LIMIT 1`,
    [nombre, idEmpresa]
  );
  return cuenta || null;
}

async function validarProveedor(data, anterior, idEmpresa) {
  const proveedor = data.proveedor !== undefined ? data.proveedor : anterior?.proveedor;
  if (!proveedor) {
    return 'El proveedor es obligatorio y debe corresponder a una cuenta registrada en el sistema.';
  }
  const cuenta = await buscarCuentaPorNombre(proveedor, idEmpresa);
  if (!cuenta) {
    return `El proveedor "${proveedor}" no está registrado como cuenta PROVEEDOR o CLIENTE. Crea primero la cuenta en el módulo Cuentas.`;
  }
  return null;
}

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
  const cuenta = await buscarCuentaPorNombre(gasto.proveedor, idEmpresa);
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
