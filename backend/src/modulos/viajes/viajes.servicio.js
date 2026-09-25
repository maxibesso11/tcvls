// backend/src/modulos/viajes/viajes.servicio.js
// Movimientos de cuenta corriente que genera un viaje, aislados por empresa:
//   FINALIZADO o FACTURADO → liquidación al chofer (crédito en su cuenta CHOFER)
//   FACTURADO              → débito al pagador (cuenta CLIENTE o PROVEEDOR)
//
// reconciliarMovimientos() es el ÚNICO camino que crea o reemplaza esos
// movimientos: lo usan tanto la edición del viaje (viajes.hooks.js) como la
// facturación desde el módulo de Facturación. Cada movimiento queda vinculado
// al viaje por origen_tipo/origen_id, no por el texto del concepto.
//
// Todas las funciones reciben la conexión (db) de la transacción en curso.
const { calcularMontoCuentaCliente, calcularLiquidacionChofer } = require('./viajes.calculos');
const { ORIGEN, crearMovimientoAutomatico, eliminarMovimientosDeOrigen } = require('../cuentas/movimientos.servicio');

// ---------- Búsqueda de cuentas y chofer ----------

async function buscarCuentaPagador(db, nombre, idEmpresa) {
  if (!nombre) return null;
  const [[c]] = await db.query(
    `SELECT id_cuenta FROM CUENTA
     WHERE nombre = ? AND id_empresa = ? AND tipo IN ('CLIENTE', 'PROVEEDOR')
     ORDER BY FIELD(tipo, 'CLIENTE', 'PROVEEDOR') LIMIT 1`,
    [nombre, idEmpresa]
  );
  return c || null;
}

// Devuelve el chofer que hizo el viaje, con su cuenta CHOFER.
// Prioridad: la "foto" guardada en viaje.id_chofer (el chofer al momento de
// crear el viaje). Respaldo para viajes viejos sin foto: el chofer actual
// del equipo. Así las rotaciones de choferes no alteran viajes históricos.
async function obtenerChoferDelViaje(db, viaje, idEmpresa) {
  if (viaje.id_chofer) {
    const [[chofer]] = await db.query(`
      SELECT ch.*, c.id_cuenta
      FROM CHOFERES ch
      LEFT JOIN CUENTA c ON c.cuil = ch.cuil AND c.id_empresa = ch.id_empresa AND c.tipo = 'CHOFER'
      WHERE ch.id_chofer = ? AND ch.id_empresa = ? LIMIT 1
    `, [viaje.id_chofer, idEmpresa]);
    if (chofer) return chofer;
    // La foto apunta a un chofer eliminado: caer al chofer actual del equipo.
  }
  if (!viaje.id_equipo) return null;
  const [[chofer]] = await db.query(`
    SELECT ch.*, c.id_cuenta
    FROM EQUIPO e
    JOIN CHOFERES ch ON ch.id_chofer = e.id_chofer
    LEFT JOIN CUENTA c ON c.cuil = ch.cuil AND c.id_empresa = e.id_empresa AND c.tipo = 'CHOFER'
    WHERE e.id_equipo = ? AND e.id_empresa = ? LIMIT 1
  `, [viaje.id_equipo, idEmpresa]);
  return chofer || null;
}

// Guarda en el viaje la foto del chofer que tiene el equipo en este momento.
async function fotografiarChofer(db, idViaje, idEquipo, idEmpresa) {
  if (!idEquipo) return;
  await db.query(`
    UPDATE VIAJES v
    JOIN EQUIPO e ON e.id_equipo = ? AND e.id_empresa = ?
    SET v.id_chofer = e.id_chofer
    WHERE v.id_viaje = ? AND v.id_empresa = ?
  `, [idEquipo, idEmpresa, idViaje, idEmpresa]);
}

// ---------- Movimientos ----------

// Factura A emitida para el viaje (la última, aunque esté anulada: si fue
// anulada, su nota de crédito ya compensa el débito, que debe quedar igual).
async function facturaDelViaje(db, idViaje, idEmpresa) {
  const [[factura]] = await db.query(
    `SELECT id_cuenta, total, punto_venta, numero FROM FACTURAS
     WHERE id_viaje = ? AND id_empresa = ? AND clase = 'FACTURA'
     ORDER BY id_factura DESC LIMIT 1`,
    [idViaje, idEmpresa]
  );
  return factura || null;
}

function etiquetaFiscal(viaje, factura) {
  const comision = Number(viaje.comision) || 0;
  const conComision = texto => (comision > 0 ? `comisión ${comision}% + ${texto}` : texto);
  if (factura) {
    const nro = `${String(factura.punto_venta).padStart(4, '0')}-${String(factura.numero).padStart(8, '0')}`;
    return `[${conComision('IVA 21%')} · factura A ${nro}]`;
  }
  if (viaje.modo_facturacion === 'SIN_FACTURAR') {
    return comision > 0 ? `[comisión ${comision}% · sin IVA]` : '[sin IVA]';
  }
  if (viaje.modo_facturacion === 'FACTURA') return `[${conComision('IVA 21%')} · facturado]`;
  // LIQUIDO_PRODUCTO o compatibilidad (NULL)
  return `[${conComision('IVA 21%')} · líquido producto]`;
}

// Débito al pagador. Si el viaje tiene factura formal, el débito es el total
// de esa factura (así la nota de crédito lo compensa exacto); si no, el monto
// calculado según el modo de facturación.
async function crearFacturacion(db, viaje, idEmpresa) {
  const factura = await facturaDelViaje(db, viaje.id_viaje, idEmpresa);
  let idCuenta, monto;
  if (factura) {
    idCuenta = factura.id_cuenta;
    monto = Number(factura.total);
  } else {
    if (!viaje.pagador) return;
    const cuenta = await buscarCuentaPagador(db, viaje.pagador, idEmpresa);
    if (!cuenta) return;
    idCuenta = cuenta.id_cuenta;
    monto = calcularMontoCuentaCliente(viaje);
  }
  if (monto === 0) return;

  const concepto = `FACTURACION VIAJE #${viaje.id_viaje} — ${viaje.origen} → ${viaje.destino}` +
                   (viaje.numero_remito ? ` (remito ${viaje.numero_remito})` : '') +
                   ` ${etiquetaFiscal(viaje, factura)}`;

  await crearMovimientoAutomatico(db, {
    idEmpresa,
    idCuenta,
    monto: -Math.abs(monto),
    fecha: viaje.fecha_llegada || viaje.fecha_origen,
    concepto,
    origenTipo: ORIGEN.VIAJE_FACTURACION,
    origenId: viaje.id_viaje
  });
}

async function crearLiquidacion(db, viaje, idEmpresa) {
  const chofer = await obtenerChoferDelViaje(db, viaje, idEmpresa);
  if (!chofer || !chofer.id_cuenta) return;

  const { monto, incompleto } = calcularLiquidacionChofer(viaje, chofer);
  if (monto === 0 && !incompleto) return;

  const concepto = incompleto
    ? `LIQUIDACION VIAJE #${viaje.id_viaje} — ${viaje.origen} → ${viaje.destino} ` +
      `[PENDIENTE: faltan los km recorridos para liquidar al chofer]`
    : `LIQUIDACION VIAJE #${viaje.id_viaje} — ${viaje.origen} → ${viaje.destino}`;

  await crearMovimientoAutomatico(db, {
    idEmpresa,
    idCuenta: chofer.id_cuenta,
    monto,
    fecha: viaje.fecha_llegada || viaje.fecha_origen,
    concepto,
    origenTipo: ORIGEN.VIAJE_LIQUIDACION,
    origenId: viaje.id_viaje
  });
}

async function eliminarMovimientosDelViaje(db, idViaje, idEmpresa) {
  await eliminarMovimientosDeOrigen(db, idEmpresa, ORIGEN.VIAJE_LIQUIDACION, idViaje);
  await eliminarMovimientosDeOrigen(db, idEmpresa, ORIGEN.VIAJE_FACTURACION, idViaje);
}

// Reemplaza los movimientos del viaje según su estado actual en la base.
async function reconciliarMovimientos(db, idViaje, idEmpresa) {
  const [[v]] = await db.query(
    'SELECT * FROM VIAJES WHERE id_viaje = ? AND id_empresa = ?', [idViaje, idEmpresa]
  );
  if (!v) return;

  await eliminarMovimientosDelViaje(db, idViaje, idEmpresa);

  if (v.estado === 'FINALIZADO' || v.estado === 'FACTURADO') {
    await crearLiquidacion(db, v, idEmpresa);
  }
  if (v.estado === 'FACTURADO') {
    await crearFacturacion(db, v, idEmpresa);
  }
}

module.exports = {
  buscarCuentaPagador,
  fotografiarChofer,
  eliminarMovimientosDelViaje,
  reconciliarMovimientos
};
