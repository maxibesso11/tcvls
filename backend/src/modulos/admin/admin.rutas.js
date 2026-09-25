// backend/src/modulos/admin/admin.rutas.js
// Gestión de empresas y usuarios. Todas las rutas requieren rol ADMIN.
const express = require('express');
const pool = require('../../config/db');
const { hashearContrasena } = require('../../lib/seguridad/credenciales');
const { requiereAutenticacion, requiereAdmin } = require('../../middleware/autenticacion');
const { MODULOS, CLAVES, validarDependencias, conObligatorios } = require('../../config/modulos');

const router = express.Router();
router.use(requiereAutenticacion, requiereAdmin);

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
    res.status(500).json({ error: err.message });
  }
});

router.post('/empresas', async (req, res) => {
  try {
    const { nombre, iniciales, cuit, domicilio, telefono, email } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre de la empresa es obligatorio.' });
    const [result] = await pool.query(
      'INSERT INTO EMPRESAS SET ?',
      [{
        nombre,
        iniciales: (iniciales || '').trim().slice(0, 4).toUpperCase() || null,
        cuit: cuit || null,
        domicilio: domicilio || null,
        telefono: telefono || null,
        email: email || null,
        activa: 1
      }]
    );
    // Toda empresa nueva arranca con todos los módulos activos
    const nuevaId = result.insertId;
    const valores = CLAVES.map(m => [nuevaId, m, 1]);
    await pool.query('INSERT INTO MODULOS_EMPRESA (id_empresa, modulo, activo) VALUES ?', [valores]);
    res.status(201).json({ id_empresa: nuevaId, nombre });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe una empresa con ese CUIT.' });
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

// ==================== USUARIOS ====================

router.get('/usuarios', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT u.id_usuario, u.nombre_usuario, u.correo, u.rol, u.id_empresa, u.activo,
             e.nombre AS nombre_empresa
      FROM USUARIOS u
      LEFT JOIN EMPRESAS e ON e.id_empresa = u.id_empresa
      ORDER BY u.nombre_usuario
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/usuarios', async (req, res) => {
  try {
    const { nombre_usuario, contrasena, correo, id_empresa, rol } = req.body;
    if (!nombre_usuario || !contrasena) {
      return res.status(400).json({ error: 'Usuario y contraseña son obligatorios.' });
    }
    const rolFinal = rol === 'ADMIN' ? 'ADMIN' : 'USUARIO';
    // Un usuario operativo (no ADMIN) debe tener empresa
    if (rolFinal === 'USUARIO' && !id_empresa) {
      return res.status(400).json({ error: 'Un usuario operativo debe pertenecer a una empresa.' });
    }
    const [result] = await pool.query('INSERT INTO USUARIOS SET ?', [{
      nombre_usuario,
      contrasena_hash: hashearContrasena(contrasena),
      correo: correo || null,
      id_empresa: rolFinal === 'ADMIN' ? null : id_empresa,
      rol: rolFinal,
      activo: 1
    }]);
    res.status(201).json({ id_usuario: result.insertId, nombre_usuario, rol: rolFinal });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un usuario con ese nombre.' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/usuarios/:id', async (req, res) => {
  try {
    // Identificar al usuario a editar para proteger al ADMIN original.
    // El admin original es el del seed (nombre_usuario = 'admin'); no se
    // puede desactivar, renombrar, cambiarle el rol ni la empresa. Solo se
    // permite cambiarle la contraseña, para no dejar nunca al sistema sin
    // su administrador principal.
    const [[objetivo]] = await pool.query(
      'SELECT id_usuario, nombre_usuario, rol FROM USUARIOS WHERE id_usuario = ?',
      [req.params.id]
    );
    if (!objetivo) return res.status(404).json({ error: 'Usuario no encontrado.' });
    const esAdminOriginal = objetivo.nombre_usuario === 'admin' && objetivo.rol === 'ADMIN';

    const { nombre_usuario, contrasena, correo, id_empresa, rol, activo } = req.body;
    const data = {};

    if (esAdminOriginal) {
      // Para el admin original, ignorar todo menos la contraseña.
      if (contrasena) data.contrasena_hash = hashearContrasena(contrasena);
      // Permitir actualizar el correo (dato de contacto, inofensivo)
      if (correo !== undefined) data.correo = correo || null;
      if (Object.keys(data).length === 0) {
        return res.status(400).json({ error: 'Del usuario administrador principal solo se puede cambiar la contraseña.' });
      }
      // Bloquear explícitamente intentos de desactivarlo o degradarlo
      if (activo !== undefined && !activo) {
        return res.status(403).json({ error: 'No se puede desactivar al administrador principal.' });
      }
      if (rol !== undefined && rol !== 'ADMIN') {
        return res.status(403).json({ error: 'No se puede cambiar el rol del administrador principal.' });
      }
      if (nombre_usuario !== undefined && nombre_usuario !== 'admin') {
        return res.status(403).json({ error: 'No se puede renombrar al administrador principal.' });
      }
    } else {
      if (nombre_usuario !== undefined) data.nombre_usuario = nombre_usuario;
      if (correo !== undefined) data.correo = correo || null;
      if (rol !== undefined) data.rol = rol === 'ADMIN' ? 'ADMIN' : 'USUARIO';
      if (id_empresa !== undefined) data.id_empresa = id_empresa || null;
      if (activo !== undefined) data.activo = activo ? 1 : 0;
      // Solo cambiar la contraseña si se envió una nueva no vacía
      if (contrasena) data.contrasena_hash = hashearContrasena(contrasena);

      // Coherencia: un ADMIN no tiene empresa; un USUARIO debe tenerla
      if (data.rol === 'ADMIN') data.id_empresa = null;
      if (data.rol === 'USUARIO' && data.id_empresa === null) {
        return res.status(400).json({ error: 'Un usuario operativo debe pertenecer a una empresa.' });
      }
    }

    const [result] = await pool.query('UPDATE USUARIOS SET ? WHERE id_usuario = ?', [data, req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Usuario no encontrado.' });
    delete data.contrasena_hash;
    res.json({ id_usuario: Number(req.params.id), ...data });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un usuario con ese nombre.' });
    res.status(500).json({ error: err.message });
  }
});

// Eliminar un usuario. El administrador principal (seed) nunca puede eliminarse.
router.delete('/usuarios/:id', async (req, res) => {
  try {
    const [[objetivo]] = await pool.query(
      'SELECT id_usuario, nombre_usuario, rol FROM USUARIOS WHERE id_usuario = ?',
      [req.params.id]
    );
    if (!objetivo) return res.status(404).json({ error: 'Usuario no encontrado.' });

    if (objetivo.nombre_usuario === 'admin' && objetivo.rol === 'ADMIN') {
      return res.status(403).json({ error: 'No se puede eliminar al administrador principal del sistema.' });
    }
    // Evitar que un admin se elimine a sí mismo en plena sesión
    if (objetivo.id_usuario === req.usuario.id_usuario) {
      return res.status(403).json({ error: 'No podés eliminar tu propio usuario mientras estás conectado.' });
    }

    await pool.query('DELETE FROM USUARIOS WHERE id_usuario = ?', [req.params.id]);
    res.json({ mensaje: 'Usuario eliminado correctamente.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  } finally {
    conexion.release();
  }
});

module.exports = router;
