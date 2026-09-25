// backend/src/modulos/gastos/gastosAdministrativos.hooks.js
// Sincroniza GASTOS_ADMINISTRATIVOS con la cuenta del proveedor, por empresa.
// Cada movimiento queda vinculado a su gasto por origen_tipo/origen_id; los
// hooks after* escriben con req.db, dentro de la transacción del CRUD.
const { buscarCuentaProveedor, validarProveedor } = require('../cuentas/cuentas.servicio');
const { ORIGEN, crearMovimientoAutomatico, eliminarMovimientosDeOrigen } = require('../cuentas/movimientos.servicio');

async function antesDeCrearGasto(data, req) {
  return validarProveedor(data, null, req.usuario.id_empresa);
}

async function antesDeActualizarGasto(id, data, anterior, req) {
  return validarProveedor(data, anterior, req.usuario.id_empresa);
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
