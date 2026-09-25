// backend/src/modulos/viajes/viajes.hooks.js
// Ciclo de vida del viaje ↔ cuentas (chofer y pagador), aislado por empresa.
//
// FINALIZADO → liquidación al chofer (crédito en su cuenta CHOFER)
// FACTURADO  → débito al pagador (cuenta CLIENTE/PROVEEDOR), con comisión + IVA
//
// Los movimientos los arma viajes.servicio.js; los hooks after* escriben con
// req.db, dentro de la transacción del CRUD.
const pool = require('../../config/db');
const {
  buscarCuentaPagador,
  fotografiarChofer,
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
  await fotografiarChofer(req.db, viaje.id_viaje, viaje.id_equipo, idEmpresa);
  await reconciliarMovimientos(req.db, viaje.id_viaje, idEmpresa);
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
    await fotografiarChofer(req.db, viaje.id_viaje, viaje.id_equipo, idEmpresa);
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
