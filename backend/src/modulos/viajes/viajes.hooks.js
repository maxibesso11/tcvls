// backend/src/modulos/viajes/viajes.hooks.js
// Ciclo de vida del viaje ↔ cuentas (chofer y pagador), aislado por empresa.
//
// FINALIZADO → liquidación al chofer (crédito en su cuenta CHOFER)
// FACTURADO  → débito al pagador (cuenta CLIENTE/PROVEEDOR), con comisión + IVA
//
// Los movimientos los arma viajes.servicio.js; los hooks after* escriben con
// req.db, dentro de la transacción del CRUD.
const pool = require('../../config/db');
const { validarEquipoOperable } = require('../equipos/equipos.historial');
const { modulosApagadosPorSistema, MENSAJE_FACTURACION_APAGADA } = require('../../config/modulos');
const {
  buscarCuentaPagador,
  fotografiarEquipo,
  eliminarMovimientosDelViaje,
  reconciliarMovimientos
} = require('./viajes.servicio');

// ---------- Validaciones (before) ----------

async function validarPagador(data, anterior, idEmpresa) {
  const pagador = data.pagador !== undefined ? data.pagador : anterior?.pagador;
  if (!pagador) return null;
  const cuenta = await buscarCuentaPagador(pool, pagador, idEmpresa);
  if (!cuenta) {
    return `El pagador "${pagador}" no está registrado como cuenta CLIENTE o PROVEEDOR. Crea primero la cuenta en el módulo Cuentas.`;
  }
  return null;
}

// Validaciones de estado compartidas entre creación y actualización.
// data: los campos entrantes; anterior: registro previo (null al crear).
function validarEstado(data, anterior) {
  const estadoFuturo = data.estado ?? anterior?.estado;

  // Con la facturación formal apagada no se puede marcar un viaje como
  // facturado "con factura A" (no habría comprobante).
  if (data.modo_facturacion === 'FACTURA' && anterior?.modo_facturacion !== 'FACTURA'
      && modulosApagadosPorSistema().includes('facturacion')) {
    return MENSAJE_FACTURACION_APAGADA;
  }

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
    // Un resultado 0 también cuenta como no cargado: facturaría $0 al cliente
    // (pasó en producción con un viaje POR TONELADA facturado con 0 t).
    const sinResultado = resultado === null || resultado === undefined || resultado === '' || !(Number(resultado) > 0);
    if (necesitaResultado && sinResultado) {
      return `Para marcar el viaje como ${estadoFuturo} con tarifa "${tipoTarifa}" debe cargarse el resultado (toneladas descargadas o kilómetros recorridos), mayor a cero.`;
    }
  }

  return null;
}

async function antesDeCrearViaje(data, req) {
  const errorPagador = await validarPagador(data, null, req.usuario.id_empresa);
  if (errorPagador) return errorPagador;
  const errorEquipo = await validarEquipoOperable(pool, data.id_equipo, req.usuario.id_empresa, data.fecha_origen);
  if (errorEquipo) return errorEquipo;
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

  // Cambiar el equipo o la fecha: el equipo tiene que estar activo en esa fecha.
  const cambiaEquipo = data.id_equipo !== undefined && Number(data.id_equipo) !== Number(anterior.id_equipo);
  const cambiaFecha = data.fecha_origen !== undefined && String(data.fecha_origen) !== String(anterior.fecha_origen);
  if (cambiaEquipo || cambiaFecha) {
    const errorEquipo = await validarEquipoOperable(pool, data.id_equipo ?? anterior.id_equipo,
      req.usuario.id_empresa, data.fecha_origen ?? anterior.fecha_origen);
    if (errorEquipo) return errorEquipo;
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
  const idEmpresa = req.usuario.id_empresa;
  // Fijar la foto del equipo que hace el viaje (su composición en la fecha de origen)
  await fotografiarEquipo(req.db, viaje.id_viaje, viaje.id_equipo, idEmpresa);
  await reconciliarMovimientos(req.db, viaje.id_viaje, idEmpresa);
}

async function alActualizarViaje(viaje, anterior, req) {
  const idEmpresa = req.usuario.id_empresa;
  // La foto sale del historial del equipo según la fecha de origen: si
  // cambió el equipo o la fecha, se vuelve a tomar. Cualquier otra edición
  // conserva la composición con que se hizo el viaje.
  // El formulario envía id_equipo como string y la base lo devuelve como
  // número: se normalizan ambos lados antes de comparar.
  const cambioEquipo = Number(viaje.id_equipo) !== Number(anterior.id_equipo);
  const cambioFecha = String(viaje.fecha_origen) !== String(anterior.fecha_origen);
  if (cambioEquipo || cambioFecha) {
    await fotografiarEquipo(req.db, viaje.id_viaje, viaje.id_equipo, idEmpresa);
  }
  await reconciliarMovimientos(req.db, viaje.id_viaje, idEmpresa);
}

async function alEliminarViaje(viaje, req) {
  await eliminarMovimientosDelViaje(req.db, viaje.id_viaje, req.usuario.id_empresa);
}

module.exports = {
  antesDeCrearViaje,
  antesDeActualizarViaje,
  antesDeEliminarViaje,
  alCrearViaje,
  alActualizarViaje,
  alEliminarViaje
};
