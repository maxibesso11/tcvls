// backend/src/modulos/cuentas/movimientos.servicio.js
// Movimientos de cuenta corriente que genera el sistema automáticamente.
// Cada uno guarda una referencia formal a su documento de origen
// (origen_tipo + origen_id, migración 023). Se buscan y reemplazan por esa
// referencia, nunca por el texto del concepto: así editar el concepto a mano
// no rompe el vínculo ni duplica la deuda.
//
// Los movimientos cargados a mano (recibos, ajustes) no tienen origen.
// Todas las funciones reciben la conexión (db) para escribir dentro de la
// transacción de quien las llama.

const ORIGEN = {
  VIAJE_FACTURACION: 'VIAJE_FACTURACION',   // débito al pagador del viaje
  VIAJE_LIQUIDACION: 'VIAJE_LIQUIDACION',   // crédito al chofer del viaje
  CONSUMO_COMBUSTIBLE: 'CONSUMO_COMBUSTIBLE',
  CONSUMO_GENERAL: 'CONSUMO_GENERAL',
  GASTO_ADMINISTRATIVO: 'GASTO_ADMINISTRATIVO',
  FACTURA: 'FACTURA',                       // factura manual (sin viaje)
  NOTA_CREDITO: 'NOTA_CREDITO'
};

async function crearMovimientoAutomatico(db, { idEmpresa, idCuenta, monto, fecha, concepto, origenTipo, origenId }) {
  await db.query('INSERT INTO MOVIMIENTOS SET ?', [{
    id_empresa: idEmpresa,
    id_cuenta: idCuenta,
    monto,
    fecha,
    concepto: String(concepto).slice(0, 255),
    origen_tipo: origenTipo,
    origen_id: origenId
  }]);
}

async function eliminarMovimientosDeOrigen(db, idEmpresa, origenTipo, origenId) {
  await db.query(
    'DELETE FROM MOVIMIENTOS WHERE id_empresa = ? AND origen_tipo = ? AND origen_id = ?',
    [idEmpresa, origenTipo, origenId]
  );
}

module.exports = { ORIGEN, crearMovimientoAutomatico, eliminarMovimientosDeOrigen };
