// backend/src/modulos/viajes/viajes.hooks.js
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
  // Monto con IVA (comportamiento histórico / líquido producto).
  return calcularNetoConComision(viaje) * (1 + IVA);
}

// Neto del viaje ya descontada la comisión (lo que efectivamente se le cobra
// al cliente antes de IVA). La comisión reduce lo que paga el cliente.
function calcularNetoConComision(viaje) {
  const base = calcularMontoViaje(viaje);
  const comision = Number(viaje.comision) || 0;
  return base * (1 - comision / 100);
}

// Monto a imputar en la cuenta del cliente según el modo de facturación.
//   SIN_FACTURAR      → neto sin IVA
//   LIQUIDO_PRODUCTO  → neto + IVA
//   FACTURA           → neto + IVA (además se emite el comprobante formal)
//   (NULL/otro)       → neto + IVA (compatibilidad con viajes previos)
function calcularMontoCuentaCliente(viaje) {
  const neto = calcularNetoConComision(viaje);
  if (viaje.modo_facturacion === 'SIN_FACTURAR') return neto;
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

// Devuelve el chofer que hizo el viaje, con su cuenta CHOFER.
// Prioridad: la "foto" guardada en viaje.id_chofer (el chofer al momento de
// crear el viaje). Respaldo para viajes viejos sin foto: el chofer actual
// del equipo. Así las rotaciones de choferes no alteran viajes históricos.
async function obtenerChoferDelViaje(viaje, idEmpresa) {
  if (viaje.id_chofer) {
    const [[chofer]] = await pool.query(`
      SELECT ch.*, c.id_cuenta
      FROM CHOFERES ch
      LEFT JOIN CUENTA c ON c.cuil = ch.cuil AND c.id_empresa = ch.id_empresa AND c.tipo = 'CHOFER'
      WHERE ch.id_chofer = ? AND ch.id_empresa = ? LIMIT 1
    `, [viaje.id_chofer, idEmpresa]);
    if (chofer) return chofer;
    // La foto apunta a un chofer eliminado: caer al chofer actual del equipo.
  }
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

// Guarda en el viaje la foto del chofer que tiene el equipo en este momento.
async function fotografiarChofer(idViaje, idEquipo, idEmpresa) {
  if (!idEquipo) return;
  await pool.query(`
    UPDATE VIAJES v
    JOIN EQUIPO e ON e.id_equipo = ? AND e.id_empresa = ?
    SET v.id_chofer = e.id_chofer
    WHERE v.id_viaje = ? AND v.id_empresa = ?
  `, [idEquipo, idEmpresa, idViaje, idEmpresa]);
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
  const monto = calcularMontoCuentaCliente(viaje);
  if (monto === 0) return;

  const comision = Number(viaje.comision) || 0;
  const conIVA = viaje.modo_facturacion !== 'SIN_FACTURAR';
  // Etiqueta fiscal según el modo elegido, para que se entienda en la cuenta.
  let etiqueta;
  if (viaje.modo_facturacion === 'SIN_FACTURAR') {
    etiqueta = comision > 0 ? `[comisión ${comision}% · sin IVA]` : '[sin IVA]';
  } else if (viaje.modo_facturacion === 'FACTURA') {
    etiqueta = comision > 0 ? `[comisión ${comision}% + IVA 21% · facturado]` : '[IVA 21% · facturado]';
  } else {
    // LIQUIDO_PRODUCTO o compatibilidad (NULL)
    etiqueta = comision > 0 ? `[comisión ${comision}% + IVA 21% · líquido producto]` : '[IVA 21% · líquido producto]';
  }
  const concepto = `FACTURACION VIAJE #${viaje.id_viaje} — ${viaje.origen} → ${viaje.destino}` +
                   (viaje.numero_remito ? ` (remito ${viaje.numero_remito})` : '') +
                   ` ${etiqueta}`;

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

// Validaciones de estado compartidas entre creación y actualización.
// data: los campos entrantes; anterior: registro previo (null al crear).
function validarEstado(data, anterior) {
  const estadoFuturo = data.estado ?? anterior?.estado;

  if (estadoFuturo === 'FACTURADO') {
    const pagador = data.pagador !== undefined ? data.pagador : anterior?.pagador;
    if (!pagador) {
      return 'Para marcar el viaje como FACTURADO debe asignarse un pagador con cuenta registrada.';
    }
  }

  if (estadoFuturo === 'FINALIZADO' || estadoFuturo === 'FACTURADO') {
    const tipoTarifa = data.tipo_tarifa ?? anterior?.tipo_tarifa;
    const resultado = data.resultado !== undefined ? data.resultado : anterior?.resultado;
    const necesitaResultado = tipoTarifa === 'POR TONELADA' || tipoTarifa === 'POR KM';
    const sinResultado = resultado === null || resultado === undefined || resultado === '';
    if (necesitaResultado && sinResultado) {
      return `Para marcar el viaje como ${estadoFuturo} con tarifa "${tipoTarifa}" debe cargarse el resultado (toneladas descargadas o kilómetros recorridos).`;
    }
  }

  return null;
}

async function antesDeCrearViaje(data, req) {
  const errorPagador = await validarPagador(data, null, req.usuario.id_empresa);
  if (errorPagador) return errorPagador;
  // Un viaje puede nacer directamente FINALIZADO o FACTURADO (carga histórica),
  // así que las validaciones de estado aplican también en la creación. Sin
  // esto, un viaje POR KM creado como FINALIZADO sin resultado dejaría al
  // chofer sin liquidar silenciosamente.
  return validarEstado(data, null);
}

async function antesDeActualizarViaje(id, data, anterior, req) {
  if (!anterior) return null;

  const errorPagador = await validarPagador(data, anterior, req.usuario.id_empresa);
  if (errorPagador) return errorPagador;

  const errorEstado = validarEstado(data, anterior);
  if (errorEstado) return errorEstado;

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
  const idEmpresa = req.usuario.id_empresa;
  // Fijar la foto del chofer que hace el viaje (el asignado al equipo hoy)
  await fotografiarChofer(viaje.id_viaje, viaje.id_equipo, idEmpresa);
  await reconciliarMovimientos(viaje.id_viaje, idEmpresa);
}

async function alActualizarViaje(viaje, anterior, req) {
  const idEmpresa = req.usuario.id_empresa;
  // Si se cambió el equipo del viaje, el chofer real también cambió:
  // actualizar la foto. Cualquier otra edición conserva el chofer original.
  // Nota: el formulario envía id_equipo como string y la base lo devuelve
  // como número, así que la comparación debe normalizar ambos lados; de lo
  // contrario cualquier edición re-fotografiaría y pisaría al chofer
  // histórico con el actual del equipo.
  const equipoNuevo = viaje.id_equipo !== undefined ? Number(viaje.id_equipo) : null;
  const equipoAnterior = anterior ? Number(anterior.id_equipo) : null;
  if (equipoNuevo !== null && equipoAnterior !== null && equipoNuevo !== equipoAnterior) {
    await fotografiarChofer(viaje.id_viaje, viaje.id_equipo, idEmpresa);
  }
  await reconciliarMovimientos(viaje.id_viaje, idEmpresa);
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
