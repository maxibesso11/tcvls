// backend/src/modulos/gastos/consumos.hooks.js
// Sincronización entre CONSUMOS_COMBUSTIBLE/CONSUMOS_GENERALES y la cuenta
// corriente del proveedor, aislada por empresa.
//
// Convención: al registrar un consumo, la empresa queda debiéndole al
// proveedor → crédito (monto > 0) en su cuenta.
//
// Movimientos rastreados por concepto:
//   "CONSUMO COMBUSTIBLE #<id> — <detalle>"
//   "CONSUMO GENERAL #<id> — <detalle>"
const pool = require('../../config/db');

// Busca la cuenta del proveedor por nombre exacto DENTRO de la empresa.
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

// Validación estricta: el proveedor debe existir como cuenta de la empresa.
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

async function antesDeCrearConsumo(data, req) {
  return validarProveedor(data, null, req.usuario.id_empresa);
}

async function antesDeActualizarConsumo(id, data, anterior, req) {
  return validarProveedor(data, anterior, req.usuario.id_empresa);
}

// Crea el movimiento de cuenta corriente para un consumo.
async function crearMovimientoDesdeConsumo({ tipoConsumo, idConsumo, proveedor, monto, fecha, descripcion, idEmpresa }) {
  const cuenta = await buscarCuentaPorNombre(proveedor, idEmpresa);
  if (!cuenta) return false;
  await pool.query('INSERT INTO MOVIMIENTOS SET ?', [{
    id_empresa: idEmpresa,
    id_cuenta: cuenta.id_cuenta,
    monto: Math.abs(Number(monto)),
    fecha,
    concepto: `CONSUMO ${tipoConsumo} #${idConsumo} — ${descripcion}`.slice(0, 255)
  }]);
  return true;
}

// Elimina el movimiento asociado a un consumo (dentro de la empresa).
async function eliminarMovimientoDeConsumo(tipoConsumo, idConsumo, idEmpresa) {
  await pool.query(
    'DELETE FROM MOVIMIENTOS WHERE id_empresa = ? AND concepto LIKE ?',
    [idEmpresa, `CONSUMO ${tipoConsumo} #${idConsumo} —%`]
  );
}

// ---------- CONSUMOS_COMBUSTIBLE ----------

async function alCrearConsumoCombustible(consumo, req) {
  const monto = Number(consumo.cantidad_litros) * Number(consumo.precio_por_litro);
  await crearMovimientoDesdeConsumo({
    tipoConsumo: 'COMBUSTIBLE',
    idConsumo: consumo.id_consumo_combustible,
    proveedor: consumo.proveedor,
    monto,
    fecha: consumo.fecha,
    descripcion: `${consumo.cantidad_litros} L en ${consumo.estacion_carga}`,
    idEmpresa: req.usuario.id_empresa
  });
}

async function alActualizarConsumoCombustible(consumo, anterior, req) {
  await eliminarMovimientoDeConsumo('COMBUSTIBLE', consumo.id_consumo_combustible, req.usuario.id_empresa);
  await alCrearConsumoCombustible(consumo, req);
}

async function alEliminarConsumoCombustible(consumo, req) {
  await eliminarMovimientoDeConsumo('COMBUSTIBLE', consumo.id_consumo_combustible, req.usuario.id_empresa);
}

// ---------- CONSUMOS_GENERALES ----------

async function alCrearConsumoGeneral(consumo, req) {
  await crearMovimientoDesdeConsumo({
    tipoConsumo: 'GENERAL',
    idConsumo: consumo.id_consumo_general,
    proveedor: consumo.proveedor,
    monto: Number(consumo.monto),
    fecha: consumo.fecha,
    descripcion: consumo.concepto,
    idEmpresa: req.usuario.id_empresa
  });
}

async function alActualizarConsumoGeneral(consumo, anterior, req) {
  await eliminarMovimientoDeConsumo('GENERAL', consumo.id_consumo_general, req.usuario.id_empresa);
  await alCrearConsumoGeneral(consumo, req);
}

async function alEliminarConsumoGeneral(consumo, req) {
  await eliminarMovimientoDeConsumo('GENERAL', consumo.id_consumo_general, req.usuario.id_empresa);
}

module.exports = {
  antesDeCrearConsumo,
  antesDeActualizarConsumo,
  alCrearConsumoCombustible,
  alActualizarConsumoCombustible,
  alEliminarConsumoCombustible,
  alCrearConsumoGeneral,
  alActualizarConsumoGeneral,
  alEliminarConsumoGeneral
};
