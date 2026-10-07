// backend/src/modulos/gastos/consumos.hooks.js
// Sincronización entre CONSUMOS_COMBUSTIBLE/CONSUMOS_GENERALES y la cuenta
// corriente del proveedor, aislada por empresa.
//
// Convención: al registrar un consumo, la empresa queda debiéndole al
// proveedor → crédito (monto > 0) en su cuenta. `monto` (o litros × precio)
// sigue siendo ese total: el comprobante del proveedor (Bloque 7 · IVA en
// compras) solo lo discrimina en neto, IVA y el resto de los conceptos
// fiscales, sin cambiar el crédito al proveedor ni los movimientos.
//
// Cada movimiento queda vinculado a su consumo por origen_tipo/origen_id
// (ver cuentas/movimientos.servicio.js). El concepto es solo descriptivo:
//   "CONSUMO COMBUSTIBLE #<id> — <detalle>"
//   "CONSUMO GENERAL #<id> — <detalle>"
// Los hooks after* escriben con req.db, dentro de la transacción del CRUD;
// los hooks before* corren antes de esa transacción y validan contra `pool`.
const pool = require('../../config/db');
const { buscarCuentaProveedor, validarProveedor } = require('../cuentas/cuentas.servicio');
const { ORIGEN, crearMovimientoAutomatico, eliminarMovimientosDeOrigen } = require('../cuentas/movimientos.servicio');
const { prepararComprobante } = require('./comprobanteCompra');
const { validarEquipoOperable } = require('../equipos/equipos.historial');
const { validarComprobanteNoDuplicado } = require('./comprobanteDuplicado.servicio');

// Valor efectivo de un campo: lo que llega en `data`, o lo que ya tenía el
// registro (`anterior`, null al crear). Necesario porque una edición parcial
// no reenvía todos los campos (ej. litros y precio, para calcular el total).
function efectivo(campo, data, anterior) {
  if (data[campo] !== undefined) return data[campo];
  return anterior ? anterior[campo] : undefined;
}

// Valida el proveedor, arma el comprobante (o lo completa como NO_INFORMADO),
// valida que no esté duplicado y, si todo está bien, agrega sus campos a
// `data` (mutación in-place: es lo que crudFactory guarda). Devuelve el
// mensaje de error, o null.
async function validarConsumo(data, anterior, idEmpresa, total, tabla, idActual) {
  const errorProveedor = await validarProveedor(data, anterior, idEmpresa);
  if (errorProveedor) return errorProveedor;

  const { datos, error } = prepararComprobante(data, anterior, total);
  if (error) return error;

  const proveedor = efectivo('proveedor', data, anterior);
  const errorDuplicado = await validarComprobanteNoDuplicado(pool, idEmpresa, proveedor, datos, tabla, idActual);
  if (errorDuplicado) return errorDuplicado;

  Object.assign(data, datos);
  return null;
}

// ---------- CONSUMOS_COMBUSTIBLE ----------

async function antesDeCrearConsumoCombustible(data, req) {
  const errorEquipo = await validarEquipoOperable(pool, data.id_equipo, req.usuario.id_empresa, data.fecha);
  if (errorEquipo) return errorEquipo;
  const litros = Number(efectivo('cantidad_litros', data, null)) || 0;
  const precio = Number(efectivo('precio_por_litro', data, null)) || 0;
  return validarConsumo(data, null, req.usuario.id_empresa, litros * precio, 'CONSUMOS_COMBUSTIBLE', null);
}

async function antesDeActualizarConsumoCombustible(id, data, anterior, req) {
  if ((data.id_equipo !== undefined && Number(data.id_equipo) !== Number(anterior.id_equipo))
      || (data.fecha !== undefined && String(data.fecha) !== String(anterior.fecha))) {
    const errorEquipo = await validarEquipoOperable(pool, data.id_equipo ?? anterior.id_equipo,
      req.usuario.id_empresa, data.fecha ?? anterior.fecha);
    if (errorEquipo) return errorEquipo;
  }
  const litros = Number(efectivo('cantidad_litros', data, anterior)) || 0;
  const precio = Number(efectivo('precio_por_litro', data, anterior)) || 0;
  return validarConsumo(data, anterior, req.usuario.id_empresa, litros * precio, 'CONSUMOS_COMBUSTIBLE', id);
}

// ---------- CONSUMOS_GENERALES ----------

async function antesDeCrearConsumoGeneral(data, req) {
  const total = Number(efectivo('monto', data, null)) || 0;
  return validarConsumo(data, null, req.usuario.id_empresa, total, 'CONSUMOS_GENERALES', null);
}

async function antesDeActualizarConsumoGeneral(id, data, anterior, req) {
  const total = Number(efectivo('monto', data, anterior)) || 0;
  return validarConsumo(data, anterior, req.usuario.id_empresa, total, 'CONSUMOS_GENERALES', id);
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
  antesDeCrearConsumoCombustible,
  antesDeActualizarConsumoCombustible,
  antesDeCrearConsumoGeneral,
  antesDeActualizarConsumoGeneral,
  alCrearConsumoCombustible,
  alActualizarConsumoCombustible,
  alEliminarConsumoCombustible,
  alCrearConsumoGeneral,
  alActualizarConsumoGeneral,
  alEliminarConsumoGeneral
};
