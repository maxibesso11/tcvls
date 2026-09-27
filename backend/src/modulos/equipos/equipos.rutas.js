// backend/src/modulos/equipos/equipos.rutas.js
// Historial de composición de un equipo (se monta antes del CRUD de equipos):
//   GET /api/equipos/:id/historial          períodos, del más reciente al más antiguo
//   PUT /api/equipos/historial/:idHistorial  { desde } corrige la fecha en que
//                                            empezó un período (y recalcula viajes)
const express = require('express');
const pool = require('../../config/db');
const historial = require('./equipos.historial');
const { responderError, ErrorNegocio } = require('../../lib/errores');

const router = express.Router();

router.get('/:id(\\d+)/historial', async (req, res) => {
  try {
    const [[equipo]] = await pool.query(
      'SELECT id_equipo FROM EQUIPO WHERE id_equipo = ? AND id_empresa = ?', [req.params.id, req.usuario.id_empresa]);
    if (!equipo) throw new ErrorNegocio('Equipo no encontrado.', 404);
    res.json(await historial.listarHistorial(pool, req.params.id, req.usuario.id_empresa));
  } catch (err) {
    responderError(res, err, req);
  }
});

router.put('/historial/:idHistorial(\\d+)', async (req, res) => {
  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    const viajes = await historial.moverInicioPeriodo(
      conexion, req.params.idHistorial, req.usuario.id_empresa, req.body && req.body.desde);
    await conexion.commit();
    res.json({ viajes_actualizados: viajes });
  } catch (err) {
    try { await conexion.rollback(); } catch (e) { /* sin transacción */ }
    responderError(res, err, req);
  } finally {
    conexion.release();
  }
});

module.exports = router;
