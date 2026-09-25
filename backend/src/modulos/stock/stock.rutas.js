// backend/src/modulos/stock/stock.rutas.js
// Operaciones adicionales sobre STOCK que no son CRUD simple.
// "Mover depósito": reasigna todos los elementos de un depósito a otro
// en una sola operación (UPDATE masivo, sin tocar el esquema).
const express = require('express');
const pool = require('../../config/db');
const { responderError } = require('../../lib/errores');
const router = express.Router();

// Lista de depósitos distintos con cantidad de elementos y valuación total
router.get('/depositos', async (req, res) => {
  try {
    const [filas] = await pool.query(`
      SELECT deposito,
             COUNT(*) AS elementos,
             COALESCE(SUM(valuacion), 0) AS valuacion_total
      FROM STOCK
      WHERE id_empresa = ?
      GROUP BY deposito
      ORDER BY deposito
    `, [req.usuario.id_empresa]);
    res.json(filas);
  } catch (err) {
    responderError(res, err, req);
  }
});

// Mover todos los elementos de un depósito a otro
router.post('/mover-deposito', async (req, res) => {
  try {
    const { origen, destino } = req.body;
    if (!origen || !destino) {
      return res.status(400).json({ error: 'Se requieren depósito de origen y de destino' });
    }
    if (origen === destino) {
      return res.status(400).json({ error: 'El origen y el destino no pueden ser el mismo depósito' });
    }

    const [resultado] = await pool.query(
      'UPDATE STOCK SET deposito = ? WHERE deposito = ? AND id_empresa = ?',
      [destino, origen, req.usuario.id_empresa]
    );

    if (resultado.affectedRows === 0) {
      return res.status(404).json({ error: 'No hay elementos en el depósito de origen' });
    }

    res.json({
      mensaje: `${resultado.affectedRows} elemento(s) movido(s) de "${origen}" a "${destino}"`,
      elementos_movidos: resultado.affectedRows
    });
  } catch (err) {
    responderError(res, err, req);
  }
});

module.exports = router;
