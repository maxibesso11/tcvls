// backend/src/lib/crudFactory.js
// Genera rutas CRUD (GET, POST, PUT, DELETE) para cualquier tabla del esquema.
// Aísla los datos por empresa: cada operación se restringe a la empresa del
// usuario autenticado (req.usuario.id_empresa), que adjunta el middleware.
const express = require('express');
const pool = require('../config/db');
const { calcularPaginacion } = require('./paginacion');

function crudFactory({ table, idField, fields, filtroEquipo, filtrosExactos, filtrosLike, filtroFecha, ordenable, hooks = {} }) {
  const router = express.Router();

  // Listar (filtrado por empresa + filtros opcionales)
  router.get('/', async (req, res) => {
    try {
      let sql = `SELECT * FROM ${table}`;
      const condiciones = ['id_empresa = ?'];
      const params = [req.usuario.id_empresa];

      if (req.query.q) {
        const busqueda = fields.map(f => `${f} LIKE ?`).join(' OR ');
        condiciones.push(`(${busqueda})`);
        fields.forEach(() => params.push(`%${req.query.q}%`));
      }

      if (filtrosExactos) {
        filtrosExactos.forEach(col => {
          if (req.query[col]) {
            condiciones.push(`${col} = ?`);
            params.push(req.query[col]);
          }
        });
      }

      if (filtrosLike) {
        filtrosLike.forEach(col => {
          if (req.query[col]) {
            condiciones.push(`${col} LIKE ?`);
            params.push(`%${req.query[col]}%`);
          }
        });
      }

      if (filtroFecha) {
        const col = filtroFecha.columna;
        if (req.query.fecha_desde) { condiciones.push(`DATE(${col}) >= ?`); params.push(req.query.fecha_desde); }
        if (req.query.fecha_hasta) { condiciones.push(`DATE(${col}) <= ?`); params.push(req.query.fecha_hasta); }
      }

      if (req.query.id_equipo && filtroEquipo) {
        if (filtroEquipo === 'directo') {
          condiciones.push('id_equipo = ?');
          params.push(req.query.id_equipo);
        } else if (filtroEquipo === 'por_unidad') {
          condiciones.push(`id_unidad IN (
            SELECT id_unidad_principal FROM EQUIPO WHERE id_equipo = ?
            UNION
            SELECT id_unidad_secundaria FROM EQUIPO WHERE id_equipo = ?
          )`);
          params.push(req.query.id_equipo, req.query.id_equipo);
        }
      }

      sql += ` WHERE ${condiciones.join(' AND ')}`;

      // --- Total de registros que cumplen el filtro (para la paginación) ---
      const sqlConteo = `SELECT COUNT(*) AS total FROM ${table} WHERE ${condiciones.join(' AND ')}`;
      const [[{ total }]] = await pool.query(sqlConteo, params);

      const dirRaw = String(req.query.dir || 'desc').toUpperCase();
      const dir = dirRaw === 'ASC' ? 'ASC' : 'DESC';
      const ordenCol = ordenable && req.query.orden && ordenable.includes(req.query.orden)
        ? req.query.orden
        : idField;
      sql += ` ORDER BY ${ordenCol} ${dir}`;

      // --- Paginación: 50 por página por defecto (ver config/constantes.js) ---
      const { pagina, porPagina, totalPaginas, offset } = calcularPaginacion(req.query, total);
      sql += ` LIMIT ? OFFSET ?`;

      const [rows] = await pool.query(sql, [...params, porPagina, offset]);
      res.json({
        datos: rows,
        paginacion: { pagina, por_pagina: porPagina, total, total_paginas: totalPaginas }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Obtener uno por ID (restringido a la empresa)
  router.get('/:id', async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT * FROM ${table} WHERE ${idField} = ? AND id_empresa = ?`,
        [req.params.id, req.usuario.id_empresa]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Registro no encontrado' });
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Crear (inyecta id_empresa)
  router.post('/', async (req, res) => {
    try {
      const data = {};
      fields.forEach(f => {
        if (req.body[f] !== undefined && req.body[f] !== '') data[f] = req.body[f];
      });
      if (Object.keys(data).length === 0) {
        return res.status(400).json({ error: 'No se enviaron datos válidos' });
      }
      // El id_empresa lo fija el servidor según el usuario, nunca el cliente
      data.id_empresa = req.usuario.id_empresa;

      if (hooks.beforeCreate) {
        const error = await hooks.beforeCreate(data, req);
        if (error) return res.status(400).json({ error });
      }

      const [result] = await pool.query(`INSERT INTO ${table} SET ?`, [data]);
      const creado = { [idField]: result.insertId, ...data };

      if (hooks.afterCreate) {
        try { await hooks.afterCreate(creado, req); }
        catch (errHook) { console.error('Error en afterCreate:', errHook.message); }
      }

      res.status(201).json(creado);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Actualizar (verifica pertenencia a la empresa)
  router.put('/:id', async (req, res) => {
    try {
      const data = {};
      fields.forEach(f => {
        if (req.body[f] !== undefined) data[f] = req.body[f] === '' ? null : req.body[f];
      });

      // El registro anterior debe pertenecer a la empresa del usuario
      const [[anterior]] = await pool.query(
        `SELECT * FROM ${table} WHERE ${idField} = ? AND id_empresa = ?`,
        [req.params.id, req.usuario.id_empresa]
      );
      if (!anterior) return res.status(404).json({ error: 'Registro no encontrado' });

      if (hooks.beforeUpdate) {
        const error = await hooks.beforeUpdate(req.params.id, data, anterior, req);
        if (error) return res.status(400).json({ error });
      }

      const [result] = await pool.query(
        `UPDATE ${table} SET ? WHERE ${idField} = ? AND id_empresa = ?`,
        [data, req.params.id, req.usuario.id_empresa]
      );
      if (result.affectedRows === 0) return res.status(404).json({ error: 'Registro no encontrado' });

      const actualizado = { [idField]: Number(req.params.id), ...data };
      if (hooks.afterUpdate) {
        try { await hooks.afterUpdate(actualizado, anterior, req); }
        catch (errHook) { console.error('Error en afterUpdate:', errHook.message); }
      }

      res.json(actualizado);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Eliminar (verifica pertenencia a la empresa)
  router.delete('/:id', async (req, res) => {
    try {
      const [[registro]] = await pool.query(
        `SELECT * FROM ${table} WHERE ${idField} = ? AND id_empresa = ?`,
        [req.params.id, req.usuario.id_empresa]
      );
      if (!registro) return res.status(404).json({ error: 'Registro no encontrado' });

      if (hooks.beforeDelete) {
        const error = await hooks.beforeDelete(registro, req);
        if (error) return res.status(400).json({ error });
      }

      const [result] = await pool.query(
        `DELETE FROM ${table} WHERE ${idField} = ? AND id_empresa = ?`,
        [req.params.id, req.usuario.id_empresa]
      );
      if (result.affectedRows === 0) return res.status(404).json({ error: 'Registro no encontrado' });

      if (hooks.afterDelete) {
        try { await hooks.afterDelete(registro, req); }
        catch (errHook) { console.error('Error en afterDelete:', errHook.message); }
      }

      res.json({ mensaje: 'Registro eliminado correctamente' });
    } catch (err) {
      if (err.code === 'ER_ROW_IS_REFERENCED_2') {
        return res.status(409).json({ error: 'No se puede eliminar: el registro está siendo utilizado por otra tabla' });
      }
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = crudFactory;
