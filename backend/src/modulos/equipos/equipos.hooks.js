// backend/src/modulos/equipos/equipos.hooks.js
// Cada alta o cambio de composición de un equipo queda en su historial
// (equipos.historial.js). El formulario puede mandar fecha_cambio, la fecha
// real en que cambió el camión, el acoplado o el chofer (no es una columna
// de EQUIPO: se lee de req.body); sin ella, el cambio se registra ahora.
const pool = require('../../config/db');
const historial = require('./equipos.historial');

async function antesDeCrearEquipo(data, req) {
  return historial.validarDisponibilidad(pool, req.usuario.id_empresa, data);
}

async function antesDeActualizarEquipo(id, data, anterior, req) {
  if (!historial.cambioComposicion(data, anterior)) return null;
  if (!anterior.activo) {
    return 'El equipo está dado de baja: reactivalo antes de cambiarle el camión, el acoplado o el chofer.';
  }
  const ocupado = await historial.validarDisponibilidad(pool, req.usuario.id_empresa, { ...anterior, ...data }, anterior.id_equipo);
  if (ocupado) return ocupado;
  return historial.validarFechaCambio(pool, anterior.id_equipo, req.usuario.id_empresa, req.body.fecha_cambio);
}

async function alCrearEquipo(equipo, req) {
  await historial.registrarAlta(req.db, equipo, req.usuario.id_empresa, req.usuario.id_usuario);
}

async function alActualizarEquipo(equipo, anterior, req) {
  if (!historial.cambioComposicion(equipo, anterior)) return;
  await historial.registrarCambio(req.db, equipo, req.usuario.id_empresa, req.usuario.id_usuario, req.body.fecha_cambio);
}

module.exports = { antesDeCrearEquipo, antesDeActualizarEquipo, alCrearEquipo, alActualizarEquipo };
