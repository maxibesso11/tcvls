// backend/src/modulos/admin/solicitudes.rutas.js
// Solicitudes del formulario de contacto de la landing ("Solicitar asesoría",
// "Pedir una demostración"). Se montan dentro de admin.rutas.js: solo las ve
// el administrador de plataforma.
//   GET    /            lista (filtro opcional ?estado=NUEVA|CONTACTADA|DESCARTADA)
//   PUT    /:id         cambia el estado
//   DELETE /:id         elimina la solicitud (datos personales que ya no hacen falta)
const express = require('express');
const pool = require('../../config/db');
const { calcularPaginacion } = require('../../lib/paginacion');
const { responderError, ErrorNegocio } = require('../../lib/errores');

const router = express.Router();
const ESTADOS = ['NUEVA', 'CONTACTADA', 'DESCARTADA'];

router.get('/', async (req, res) => {
  try {
    const estado = ESTADOS.includes(req.query.estado) ? req.query.estado : null;
    const donde = estado ? 'WHERE estado = ?' : '';
    const valores = estado ? [estado] : [];
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM SOLICITUDES_CONTACTO ${donde}`, valores);
    const [[{ nuevas }]] = await pool.query("SELECT COUNT(*) AS nuevas FROM SOLICITUDES_CONTACTO WHERE estado = 'NUEVA'");
    const { pagina, porPagina, totalPaginas, offset } = calcularPaginacion(req.query, total);
    const [filas] = await pool.query(
      `SELECT * FROM SOLICITUDES_CONTACTO ${donde} ORDER BY fecha DESC LIMIT ? OFFSET ?`, [...valores, porPagina, offset]);
    res.json({ datos: filas, nuevas: Number(nuevas), paginacion: { pagina, por_pagina: porPagina, total, total_paginas: totalPaginas } });
  } catch (err) {
    responderError(res, err, req);
  }
});

router.put('/:id(\\d+)', async (req, res) => {
  try {
    const estado = req.body && req.body.estado;
    if (!ESTADOS.includes(estado)) throw new ErrorNegocio('Estado inválido.');
    const [r] = await pool.query('UPDATE SOLICITUDES_CONTACTO SET estado = ? WHERE id_solicitud = ?', [estado, req.params.id]);
    if (!r.affectedRows) throw new ErrorNegocio('Solicitud no encontrada.', 404);
    res.json({ ok: true });
  } catch (err) {
    responderError(res, err, req);
  }
});

router.delete('/:id(\\d+)', async (req, res) => {
  try {
    const [r] = await pool.query('DELETE FROM SOLICITUDES_CONTACTO WHERE id_solicitud = ?', [req.params.id]);
    if (!r.affectedRows) throw new ErrorNegocio('Solicitud no encontrada.', 404);
    res.json({ ok: true });
  } catch (err) {
    responderError(res, err, req);
  }
});

module.exports = router;
