// routes/auth.js
// Login y verificación de sesión.
const express = require('express');
const pool = require('../config/db');
const { verificarContrasena, generarToken } = require('../config/auth');
const { requiereAutenticacion } = require('./middleware/autenticacion');

const router = express.Router();

// Devuelve un array con las claves de los módulos activos de una empresa.
// El ADMIN (sin empresa) recibe un array vacío (gestiona todo aparte).
async function modulosActivos(idEmpresa) {
  if (!idEmpresa) return [];
  const [filas] = await pool.query(
    'SELECT modulo FROM MODULOS_EMPRESA WHERE id_empresa = ? AND activo = 1',
    [idEmpresa]
  );
  return filas.map(f => f.modulo);
}

// POST /api/auth/login  { nombre_usuario, contrasena }
router.post('/login', async (req, res) => {
  try {
    const { nombre_usuario, contrasena } = req.body;
    if (!nombre_usuario || !contrasena) {
      return res.status(400).json({ error: 'Usuario y contraseña son obligatorios.' });
    }

    const [[usuario]] = await pool.query(
      `SELECT u.*, e.nombre AS nombre_empresa, e.iniciales AS iniciales_empresa, e.cuit AS cuit_empresa
       FROM USUARIOS u
       LEFT JOIN EMPRESAS e ON e.id_empresa = u.id_empresa
       WHERE u.nombre_usuario = ? AND u.activo = 1`,
      [nombre_usuario]
    );

    if (!usuario || !verificarContrasena(contrasena, usuario.contrasena_hash)) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }

    const token = generarToken({
      id_usuario: usuario.id_usuario,
      nombre_usuario: usuario.nombre_usuario,
      rol: usuario.rol,
      id_empresa: usuario.id_empresa
    });

    const modulos = await modulosActivos(usuario.id_empresa);

    res.json({
      token,
      usuario: {
        id_usuario: usuario.id_usuario,
        nombre_usuario: usuario.nombre_usuario,
        correo: usuario.correo,
        rol: usuario.rol,
        id_empresa: usuario.id_empresa,
        nombre_empresa: usuario.nombre_empresa,
        iniciales_empresa: usuario.iniciales_empresa,
        cuit_empresa: usuario.cuit_empresa,
        tema: usuario.tema || 'verde',
        modulos
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/yo  — datos del usuario autenticado (para revalidar sesión)
router.get('/yo', requiereAutenticacion, async (req, res) => {
  try {
    const [[usuario]] = await pool.query(
      `SELECT u.id_usuario, u.nombre_usuario, u.correo, u.rol, u.id_empresa, u.tema,
              e.nombre AS nombre_empresa, e.iniciales AS iniciales_empresa, e.cuit AS cuit_empresa
       FROM USUARIOS u
       LEFT JOIN EMPRESAS e ON e.id_empresa = u.id_empresa
       WHERE u.id_usuario = ? AND u.activo = 1`,
      [req.usuario.id_usuario]
    );
    if (!usuario) return res.status(401).json({ error: 'Sesión inválida.' });
    usuario.modulos = await modulosActivos(usuario.id_empresa);
    res.json({ usuario });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Temas válidos que el sistema reconoce (debe coincidir con el CSS y el frontend)
const TEMAS_VALIDOS = ['verde', 'azul', 'violeta', 'borgona', 'grafito', 'oceano',
  'indigo', 'esmeralda', 'cobre', 'rosa', 'slate', 'bosque'];

// PUT /api/auth/tema  { tema }  — cada usuario cambia su propia apariencia
router.put('/tema', requiereAutenticacion, async (req, res) => {
  try {
    const { tema } = req.body;
    if (!TEMAS_VALIDOS.includes(tema)) {
      return res.status(400).json({ error: 'Tema no válido.' });
    }
    await pool.query(
      'UPDATE USUARIOS SET tema = ? WHERE id_usuario = ?',
      [tema, req.usuario.id_usuario]
    );
    res.json({ tema });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
