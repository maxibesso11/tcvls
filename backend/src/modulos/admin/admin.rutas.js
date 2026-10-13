// backend/src/modulos/admin/admin.rutas.js
// Gestión de empresas, usuarios y herramientas de sistema. Todas las rutas requieren rol ADMIN.
const express = require('express');
const pool = require('../../config/db');
const { requiereAutenticacion, requiereAdmin } = require('../../middleware/autenticacion');
const { MODULOS, CLAVES, validarDependencias, conObligatorios } = require('../../config/modulos');
const { responderError } = require('../../lib/errores');
const usuariosServicio = require('./usuarios.servicio');
const empresasServicio = require('./empresas.servicio');
const empresasAsignadasServicio = require('./empresasAsignadas.servicio');

const router = express.Router();
router.use(requiereAutenticacion, requiereAdmin);

// Bitácora de actividad de todas las empresas
router.get('/auditoria', async (req, res) => {
  try {
    res.json(await require('../../lib/auditoria').listar({ query: req.query }));
  } catch (err) {
    responderError(res, err, req);
  }
});

// Registros del servidor y respaldos
router.use('/sistema', require('./sistema.rutas'));

// Solicitudes del formulario de contacto de la landing
router.use('/solicitudes', require('./solicitudes.rutas'));

// ==================== EMPRESAS ====================

router.get('/empresas', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT e.*,
             (SELECT COUNT(*) FROM USUARIOS u WHERE u.id_empresa = e.id_empresa) AS cantidad_usuarios
      FROM EMPRESAS e
      ORDER BY e.nombre
    `);
    res.json(rows);
  } catch (err) {
    responderError(res, err, req);
  }
});

router.post('/empresas', async (req, res) => {
  try {
    // Toda empresa nueva arranca con todos los módulos activos
    const { id_empresa, nombre } = await empresasServicio.crear(req.body);
    res.status(201).json({ id_empresa, nombre });
  } catch (err) {
    responderError(res, err, req);
  }
});

router.put('/empresas/:id', async (req, res) => {
  try {
    const { nombre, iniciales, cuit, domicilio, telefono, email, activa,
            condicion_iva, ingresos_brutos, inicio_actividades, punto_venta } = req.body;
    const data = {};
    if (nombre !== undefined) data.nombre = nombre;
    if (iniciales !== undefined) data.iniciales = (iniciales || '').trim().slice(0, 4).toUpperCase() || null;
    if (cuit !== undefined) data.cuit = cuit || null;
    if (domicilio !== undefined) data.domicilio = domicilio || null;
    if (telefono !== undefined) data.telefono = telefono || null;
    if (email !== undefined) data.email = email || null;
    if (activa !== undefined) data.activa = activa ? 1 : 0;
    if (condicion_iva !== undefined) data.condicion_iva = condicion_iva || null;
    if (ingresos_brutos !== undefined) data.ingresos_brutos = ingresos_brutos || null;
    if (inicio_actividades !== undefined) data.inicio_actividades = inicio_actividades || null;
    if (punto_venta !== undefined) data.punto_venta = parseInt(punto_venta, 10) || 1;
    const [result] = await pool.query('UPDATE EMPRESAS SET ? WHERE id_empresa = ?', [data, req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Empresa no encontrada.' });
    res.json({ id_empresa: Number(req.params.id), ...data });
  } catch (err) {
    responderError(res, err, req);
  }
});

// ==================== USUARIOS ====================

router.get('/usuarios', async (req, res) => {
  try {
    res.json(await usuariosServicio.listar(null));
  } catch (err) {
    responderError(res, err, req);
  }
});

router.post('/usuarios', async (req, res) => {
  try {
    const usuario = await usuariosServicio.crear(req.body, null);
    res.status(201).json(usuario);
  } catch (err) {
    responderError(res, err, req);
  }
});

router.put('/usuarios/:id', async (req, res) => {
  try {
    res.json(await usuariosServicio.actualizar(req.params.id, req.body, null, req.usuario));
  } catch (err) {
    responderError(res, err, req);
  }
});

// Eliminar un usuario. El administrador principal (seed) nunca puede eliminarse.
router.delete('/usuarios/:id', async (req, res) => {
  try {
    res.json(await usuariosServicio.eliminar(req.params.id, null, req.usuario));
  } catch (err) {
    responderError(res, err, req);
  }
});

// Empresas asignadas a un usuario ADMIN_MULTIEMPRESA.
router.get('/usuarios/:id/empresas', async (req, res) => {
  try {
    res.json(await empresasAsignadasServicio.listar(req.params.id));
  } catch (err) {
    responderError(res, err, req);
  }
});

// Reemplaza el conjunto completo. Body: { empresas: [1, 2, ...] }
router.put('/usuarios/:id/empresas', async (req, res) => {
  try {
    res.json(await empresasAsignadasServicio.asignar(req.params.id, req.body.empresas));
  } catch (err) {
    responderError(res, err, req);
  }
});

// ==================== MÓDULOS POR EMPRESA ====================

// Catálogo de módulos disponibles (con dependencias), para que el panel
// sepa qué ofrecer.
router.get('/modulos/catalogo', (req, res) => {
  res.json(MODULOS);
});

// Módulos activos de una empresa concreta.
router.get('/empresas/:id/modulos', async (req, res) => {
  try {
    const [filas] = await pool.query(
      'SELECT modulo FROM MODULOS_EMPRESA WHERE id_empresa = ? AND activo = 1',
      [req.params.id]
    );
    res.json(filas.map(f => f.modulo));
  } catch (err) {
    responderError(res, err, req);
  }
});

// Guardar el conjunto de módulos activos de una empresa.
// Body: { modulos: ['viajes', 'cuentas', ...] }
router.put('/empresas/:id/modulos', async (req, res) => {
  const conexion = await pool.getConnection();
  try {
    const idEmpresa = Number(req.params.id);
    let { modulos } = req.body;
    if (!Array.isArray(modulos)) {
      return res.status(400).json({ error: 'Se esperaba una lista de módulos.' });
    }
    // Filtrar a claves válidas, quitar duplicados y forzar los obligatorios
    // (facturación y cuentas siempre activos, no se pueden desactivar).
    modulos = conObligatorios(modulos.filter(m => CLAVES.includes(m)));

    // Validar dependencias antes de guardar
    const errores = validarDependencias(modulos);
    if (errores.length > 0) {
      return res.status(400).json({ error: 'Configuración incoherente:\n' + errores.join('\n') });
    }

    // Reemplazar el conjunto: marcar todos inactivos y activar los elegidos.
    await conexion.beginTransaction();
    await conexion.query('DELETE FROM MODULOS_EMPRESA WHERE id_empresa = ?', [idEmpresa]);
    if (modulos.length > 0) {
      const valores = modulos.map(m => [idEmpresa, m, 1]);
      await conexion.query(
        'INSERT INTO MODULOS_EMPRESA (id_empresa, modulo, activo) VALUES ?',
        [valores]
      );
    }
    await conexion.commit();
    res.json({ id_empresa: idEmpresa, modulos });
  } catch (err) {
    await conexion.rollback();
    responderError(res, err, req);
  } finally {
    conexion.release();
  }
});

module.exports = router;
