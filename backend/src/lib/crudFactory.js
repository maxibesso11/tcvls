// backend/src/lib/crudFactory.js
// Genera rutas CRUD (GET, POST, PUT, DELETE) para cualquier tabla del esquema.
// Aísla los datos por empresa: cada operación se restringe a la empresa del
// usuario autenticado (req.usuario.id_empresa), que adjunta el middleware.
//
// Las escrituras (alta, edición, baja) y sus hooks after* corren en UNA
// transacción: si un automatismo falla (por ejemplo, el movimiento de cuenta
// corriente de un consumo), se deshace todo y se responde con error, en lugar
// de dejar el registro guardado y la cuenta corriente desincronizada.
// Los hooks deben usar req.db (la conexión de esa transacción) para escribir.
const express = require('express');
const pool = require('../config/db');
const { calcularPaginacion } = require('./paginacion');

const MENSAJE_FALLA_AUTOMATISMO =
  'No se pudo completar la operación: falló la actualización automática de las cuentas corrientes. No se guardó ningún cambio.';

// Ejecuta fn(conexion) dentro de una transacción y deja la conexión en req.db
// para que los hooks escriban en la misma transacción.
async function enTransaccion(req, fn) {
  const conexion = await pool.getConnection();
  req.db = conexion;
  try {
    await conexion.beginTransaction();
    const resultado = await fn(conexion);
    await conexion.commit();
    return resultado;
  } catch (err) {
    try { await conexion.rollback(); } catch (e) { /* conexión ya sin transacción */ }
    throw err;
  } finally {
    req.db = null;
    conexion.release();
  }
}

// Corre un hook after*: si falla, lo marca para responder un error claro.
async function correrHookPosterior(nombre, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`Error en ${nombre}:`, err.message);
    err.fallaAutomatismo = true;
    throw err;
  }
}

function responderError(res, err) {
  if (err.fallaAutomatismo) return res.status(500).json({ error: MENSAJE_FALLA_AUTOMATISMO });
  if (err.code === 'ER_ROW_IS_REFERENCED_2') {
    return res.status(409).json({ error: 'No se puede eliminar: el registro está siendo utilizado por otra tabla' });
  }
  return res.status(500).json({ error: err.message });
}

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

      const creado = await enTransaccion(req, async conexion => {
        const [result] = await conexion.query(`INSERT INTO ${table} SET ?`, [data]);
        const registro = { [idField]: result.insertId, ...data };
        if (hooks.afterCreate) {
          await correrHookPosterior('afterCreate', () => hooks.afterCreate(registro, req));
        }
        return registro;
      });

      res.status(201).json(creado);
    } catch (err) {
      responderError(res, err);
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

      const actualizado = { [idField]: Number(req.params.id), ...data };
      const encontrado = await enTransaccion(req, async conexion => {
        if (Object.keys(data).length > 0) {
          const [result] = await conexion.query(
            `UPDATE ${table} SET ? WHERE ${idField} = ? AND id_empresa = ?`,
            [data, req.params.id, req.usuario.id_empresa]
          );
          if (result.affectedRows === 0) return false;
        }
        // El hook recibe el registro completo (anterior + cambios): una
        // edición parcial no debe perder los datos que no se reenviaron.
        if (hooks.afterUpdate) {
          const completo = { ...anterior, ...actualizado };
          await correrHookPosterior('afterUpdate', () => hooks.afterUpdate(completo, anterior, req));
        }
        return true;
      });
      if (!encontrado) return res.status(404).json({ error: 'Registro no encontrado' });

      res.json(actualizado);
    } catch (err) {
      responderError(res, err);
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

      const eliminado = await enTransaccion(req, async conexion => {
        const [result] = await conexion.query(
          `DELETE FROM ${table} WHERE ${idField} = ? AND id_empresa = ?`,
          [req.params.id, req.usuario.id_empresa]
        );
        if (result.affectedRows === 0) return false;
        if (hooks.afterDelete) {
          await correrHookPosterior('afterDelete', () => hooks.afterDelete(registro, req));
        }
        return true;
      });
      if (!eliminado) return res.status(404).json({ error: 'Registro no encontrado' });

      res.json({ mensaje: 'Registro eliminado correctamente' });
    } catch (err) {
      responderError(res, err);
    }
  });

  return router;
}

module.exports = crudFactory;
