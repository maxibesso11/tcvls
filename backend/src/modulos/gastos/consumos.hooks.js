// backend/src/modulos/gastos/consumos.hooks.js
// Sincronización entre CONSUMOS_COMBUSTIBLE/CONSUMOS_GENERALES y la cuenta
// corriente del proveedor, aislada por empresa.
//
// Convención: al registrar un consumo, la empresa queda debiéndole al
// proveedor → crédito (monto > 0) en su cuenta.
//
// Cada movimiento queda vinculado a su consumo por origen_tipo/origen_id
// (ver cuentas/movimientos.servicio.js). El concepto es solo descriptivo:
//   "CONSUMO COMBUSTIBLE #<id> — <detalle>"
//   "CONSUMO GENERAL #<id> — <detalle>"
// Los hooks after* escriben con req.db, dentro de la transacción del CRUD.
const { buscarCuentaProveedor, validarProveedor } = require('../cuentas/cuentas.servicio');
const { ORIGEN, crearMovimientoAutomatico, eliminarMovimientosDeOrigen } = require('../cuentas/movimientos.servicio');

async function antesDeCrearConsumo(data, req) {
  return validarProveedor(data, null, req.usuario.id_empresa);
}

async function antesDeActualizarConsumo(id, data, anterior, req) {
  return validarProveedor(data, anterior, req.usuario.id_empresa);
}

// Crea el movimiento de cuenta corriente para un consumo.
async function crearMovimientoDesdeConsumo(db, { origenTipo, etiqueta, idConsumo, proveedor, monto, fecha, descripcion, idEmpresa }) {
  const cuenta = await buscarCuentaProveedor(proveedor, idEmpresa, db);
  if (!cuenta) return;
  await crearMovimientoAutomatico(db, {
    idEmpresa,
    idCuenta: cuenta.id_cuenta,
    monto: Math.abs(Number(monto)),
    fecha,
    concepto: `CONSUMO ${etiqueta} #${idConsumo} — ${descripcion}`,
    origenTipo,
    origenId: idConsumo
  });
}

// Relee el consumo tal como quedó guardado: los importes del movimiento se
// calculan con los valores de la base (redondeados por sus columnas DECIMAL),
// no con lo que llegó en el pedido. Así la cuenta corriente coincide con el
// consumo registrado.
async function consumoGuardado(db, tabla, campoId, id, idEmpresa) {
  const [[fila]] = await db.query(
    `SELECT * FROM ${tabla} WHERE ${campoId} = ? AND id_empresa = ?`, [id, idEmpresa]);
  return fila;
}

// ---------- CONSUMOS_COMBUSTIBLE ----------

async function alCrearConsumoCombustible(registro, req) {
  const consumo = await consumoGuardado(req.db, 'CONSUMOS_COMBUSTIBLE', 'id_consumo_combustible',
    registro.id_consumo_combustible, req.usuario.id_empresa);
  if (!consumo) return;
  const monto = Number(consumo.cantidad_litros) * Number(consumo.precio_por_litro);
  await crearMovimientoDesdeConsumo(req.db, {
    origenTipo: ORIGEN.CONSUMO_COMBUSTIBLE,
    etiqueta: 'COMBUSTIBLE',
    idConsumo: consumo.id_consumo_combustible,
    proveedor: consumo.proveedor,
    monto,
    fecha: consumo.fecha,
    descripcion: `${Number(consumo.cantidad_litros)} L en ${consumo.estacion_carga}`,
    idEmpresa: req.usuario.id_empresa
  });
}

async function alActualizarConsumoCombustible(consumo, anterior, req) {
  await alEliminarConsumoCombustible(consumo, req);
  await alCrearConsumoCombustible(consumo, req);
}

async function alEliminarConsumoCombustible(consumo, req) {
  await eliminarMovimientosDeOrigen(req.db, req.usuario.id_empresa, ORIGEN.CONSUMO_COMBUSTIBLE, consumo.id_consumo_combustible);
}

// ---------- CONSUMOS_GENERALES ----------

async function alCrearConsumoGeneral(registro, req) {
  const consumo = await consumoGuardado(req.db, 'CONSUMOS_GENERALES', 'id_consumo_general',
    registro.id_consumo_general, req.usuario.id_empresa);
  if (!consumo) return;
  await crearMovimientoDesdeConsumo(req.db, {
    origenTipo: ORIGEN.CONSUMO_GENERAL,
    etiqueta: 'GENERAL',
    idConsumo: consumo.id_consumo_general,
    proveedor: consumo.proveedor,
    monto: Number(consumo.monto),
    fecha: consumo.fecha,
    descripcion: consumo.concepto,
    idEmpresa: req.usuario.id_empresa
  });
}

async function alActualizarConsumoGeneral(consumo, anterior, req) {
  await alEliminarConsumoGeneral(consumo, req);
  await alCrearConsumoGeneral(consumo, req);
}

async function alEliminarConsumoGeneral(consumo, req) {
  await eliminarMovimientosDeOrigen(req.db, req.usuario.id_empresa, ORIGEN.CONSUMO_GENERAL, consumo.id_consumo_general);
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
