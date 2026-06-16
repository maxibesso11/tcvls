// routes/hooks/sincronizacionViajes.js
// Ciclo de vida del viaje ↔ cuentas (chofer y pagador), aislado por empresa.
//
// FINALIZADO → liquidación al chofer (crédito en su cuenta CHOFER)
// FACTURADO  → débito al pagador (cuenta CLIENTE/PROVEEDOR), con comisión + IVA
const pool = require('../../config/db');

const IVA = 0.21;

function calcularMontoViaje(viaje) {
  if (viaje.tipo_tarifa === 'UNICA') return Number(viaje.tarifa) || 0;
  const cantidad = Number(viaje.resultado ?? viaje.cantidad_cargada) || 0;
  return (Number(viaje.tarifa) || 0) * cantidad;
}

function calcularMontoFacturado(viaje) {
  const base = calcularMontoViaje(viaje);
  const comision = Number(viaje.comision) || 0;
  const neto = base * (1 - comision / 100);
  return neto * (1 + IVA);
}

function calcularLiquidacionChofer(viaje, chofer) {
  if (!chofer || !chofer.tipo_remuneracion || chofer.remuneracion == null) {
    return { monto: 0, incompleto: false };
  }
  const remu = Number(chofer.remuneracion);
  if (!Number.isFinite(remu) || remu <= 0) return { monto: 0, incompleto: false };

  switch (chofer.tipo_remuneracion) {
    case 'PORCENTAJE':
      return { monto: calcularMontoViaje(viaje) * (remu / 100), incompleto: false };
    case 'POR KM':
      if (viaje.tipo_tarifa === 'POR KM') {
        const km = Number(viaje.resultado) || 0;
        return { monto: km * remu, incompleto: false };
      }
      return { monto: 0, incompleto: true };
    case 'FIJA':
    default:
      return { monto: 0, incompleto: false };
  }
}

// ---------- Búsqueda de cuentas (por empresa) ----------

async function buscarCuentaPagador(nombre, idEmpresa) {
  if (!nombre) return null;
  const [[c]] = await pool.query(
    `SELECT id_cuenta FROM CUENTA
     WHERE nombre = ? AND id_empresa = ? AND tipo IN ('CLIENTE', 'PROVEEDOR')
     ORDER BY FIELD(tipo, 'CLIENTE', 'PROVEEDOR') LIMIT 1`,
    [nombre, idEmpresa]
  );
  return c || null;
}

async function obtenerChoferDelViaje(viaje, idEmpresa) {
  if (!viaje.id_equipo) return null;
  const [[chofer]] = await pool.query(`
    SELECT ch.*, c.id_cuenta
    FROM EQUIPO e
    JOIN CHOFERES ch ON ch.id_chofer = e.id_chofer
    LEFT JOIN CUENTA c ON c.cuil = ch.cuil AND c.id_empresa = e.id_empresa AND c.tipo = 'CHOFER'
    WHERE e.id_equipo = ? AND e.id_empresa = ? LIMIT 1
  `, [viaje.id_equipo, idEmpresa]);
  return chofer || null;
}

// ---------- Movimientos ----------

async function eliminarMovimientoDeViaje(prefijo, idViaje, idEmpresa) {
  await pool.query(
    'DELETE FROM MOVIMIENTOS WHERE id_empresa = ? AND concepto LIKE ?',
    [idEmpresa, `${prefijo} VIAJE #${idViaje} —%`]
  );
}

async function crearFacturacion(viaje, idEmpresa) {
  if (!viaje.pagador) return;
  const cuenta = await buscarCuentaPagador(viaje.pagador, idEmpresa);
  if (!cuenta) return;
  const monto = calcularMontoFacturado(viaje);
  if (monto === 0) return;

  const comision = Number(viaje.comision) || 0;
  const detalleFiscal = comision > 0 ? `[comisión ${comision}% + IVA 21%]` : '[IVA 21%]';
  const concepto = `FACTURACION VIAJE #${viaje.id_viaje} — ${viaje.origen} → ${viaje.destino}` +
                   (viaje.numero_remito ? ` (remito ${viaje.numero_remito})` : '') +
                   ` ${detalleFiscal}`;

  await pool.query('INSERT INTO MOVIMIENTOS SET ?', [{
    id_empresa: idEmpresa,
    id_cuenta: cuenta.id_cuenta,
    monto: -Math.abs(monto),
    fecha: viaje.fecha_llegada || viaje.fecha_origen,
    concepto: concepto.slice(0, 255)
  }]);
}

async function crearLiquidacion(viaje, idEmpresa) {
  const chofer = await obtenerChoferDelViaje(viaje, idEmpresa);
  if (!chofer || !chofer.id_cuenta) return;

  const { monto, incompleto } = calcularLiquidacionChofer(viaje, chofer);
  if (monto === 0 && !incompleto) return;

  const concepto = incompleto
    ? `LIQUIDACION VIAJE #${viaje.id_viaje} — ${viaje.origen} → ${viaje.destino} ` +
      `[PENDIENTE: faltan los km recorridos para liquidar al chofer]`
    : `LIQUIDACION VIAJE #${viaje.id_viaje} — ${viaje.origen} → ${viaje.destino}`;

  await pool.query('INSERT INTO MOVIMIENTOS SET ?', [{
    id_empresa: idEmpresa,
    id_cuenta: chofer.id_cuenta,
    monto: monto,
    fecha: viaje.fecha_llegada || viaje.fecha_origen,
    concepto: concepto.slice(0, 255)
  }]);
}

async function reconciliarMovimientos(idViaje, idEmpresa) {
  const [[v]] = await pool.query(
    'SELECT * FROM VIAJES WHERE id_viaje = ? AND id_empresa = ?', [idViaje, idEmpresa]
  );
  if (!v) return;

  await eliminarMovimientoDeViaje('LIQUIDACION', idViaje, idEmpresa);
  await eliminarMovimientoDeViaje('FACTURACION', idViaje, idEmpresa);

  if (v.estado === 'FINALIZADO' || v.estado === 'FACTURADO') {
    await crearLiquidacion(v, idEmpresa);
  }
  if (v.estado === 'FACTURADO') {
    await crearFacturacion(v, idEmpresa);
  }
}

// ---------- Validaciones (before) ----------

async function validarPagador(data, anterior, idEmpresa) {
  const pagador = data.pagador !== undefined ? data.pagador : anterior?.pagador;
  if (!pagador) return null;
  const cuenta = await buscarCuentaPagador(pagador, idEmpresa);
  if (!cuenta) {
    return `El pagador "${pagador}" no está registrado como cuenta CLIENTE o PROVEEDOR. Crea primero la cuenta en el módulo Cuentas.`;
  }
  return null;
}

async function antesDeCrearViaje(data, req) {
  return validarPagador(data, null, req.usuario.id_empresa);
}

async function antesDeActualizarViaje(id, data, anterior, req) {
  if (!anterior) return null;

  const errorPagador = await validarPagador(data, anterior, req.usuario.id_empresa);
  if (errorPagador) return errorPagador;

  const estadoFuturo = data.estado ?? anterior.estado;

  if (estadoFuturo === 'FACTURADO') {
    const pagador = data.pagador !== undefined ? data.pagador : anterior.pagador;
    if (!pagador) {
      return 'Para marcar el viaje como FACTURADO debe asignarse un pagador con cuenta registrada.';
    }
  }

  if (estadoFuturo === 'FINALIZADO' || estadoFuturo === 'FACTURADO') {
    const tipoTarifa = data.tipo_tarifa ?? anterior.tipo_tarifa;
    const resultado = data.resultado !== undefined ? data.resultado : anterior.resultado;
    const necesitaResultado = tipoTarifa === 'POR TONELADA' || tipoTarifa === 'POR KM';
    const sinResultado = resultado === null || resultado === undefined || resultado === '';
    if (necesitaResultado && sinResultado) {
      return `Para marcar el viaje como ${estadoFuturo} con tarifa "${tipoTarifa}" debe cargarse el resultado (toneladas descargadas o kilómetros recorridos).`;
    }
  }

  if (anterior.estado === 'FACTURADO' && data.estado && data.estado !== 'FACTURADO') {
    return 'Un viaje en estado FACTURADO no puede volver a un estado anterior.';
  }

  return null;
}

function antesDeEliminarViaje(viaje) {
  if (viaje.estado === 'FACTURADO') {
    return 'Los viajes facturados no se pueden eliminar.';
  }
  return null;
}

// ---------- Efectos (after) ----------

async function alCrearViaje(viaje, req) {
  await reconciliarMovimientos(viaje.id_viaje, req.usuario.id_empresa);
}

async function alActualizarViaje(viaje, anterior, req) {
  await reconciliarMovimientos(viaje.id_viaje, req.usuario.id_empresa);
}

async function alEliminarViaje(viaje, req) {
  await eliminarMovimientoDeViaje('LIQUIDACION', viaje.id_viaje, req.usuario.id_empresa);
  await eliminarMovimientoDeViaje('FACTURACION', viaje.id_viaje, req.usuario.id_empresa);
}

module.exports = {
  antesDeCrearViaje,
  antesDeActualizarViaje,
  antesDeEliminarViaje,
  alCrearViaje,
  alActualizarViaje,
  alEliminarViaje
};
