// backend/src/modulos/auth/auth.rutas.js
// Login, verificación de sesión y cambio de contraseña.
// El login tiene límite de intentos fallidos (lib/seguridad/limiteIntentos.js).
const express = require('express');
const pool = require('../../config/db');
const {
  verificarContrasena, hashearContrasena, problemaContrasenaNueva, generarToken
} = require('../../lib/seguridad/credenciales');
const limite = require('../../lib/seguridad/limiteIntentos');
const { requiereAutenticacion, requiereAutenticacionConCambioPendiente } = require('../../middleware/autenticacion');
const { responderError } = require('../../lib/errores');

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

// Token de sesión del usuario. Lleva version_sesion (v): al cambiar la
// contraseña se incrementa y los tokens anteriores dejan de valer.
function tokenDe(usuario) {
  return generarToken({
    id_usuario: usuario.id_usuario,
    nombre_usuario: usuario.nombre_usuario,
    rol: usuario.rol,
    id_empresa: usuario.id_empresa,
    v: Number(usuario.version_sesion) || 0
  });
}

// POST /api/auth/login  { nombre_usuario, contrasena }
router.post('/login', async (req, res) => {
  try {
    const { nombre_usuario, contrasena } = req.body;
    if (!nombre_usuario || !contrasena) {
      return res.status(400).json({ error: 'Usuario y contraseña son obligatorios.' });
    }

    const espera = limite.segundosDeBloqueo(req.ip, nombre_usuario);
    if (espera > 0) {
      res.setHeader('Retry-After', String(espera));
      return res.status(429).json({
        error: `Demasiados intentos fallidos. Probá de nuevo en ${Math.ceil(espera / 60)} minuto(s).`
      });
    }

    const [[usuario]] = await pool.query(
      `SELECT u.*, e.nombre AS nombre_empresa, e.iniciales AS iniciales_empresa, e.cuit AS cuit_empresa
       FROM USUARIOS u
       LEFT JOIN EMPRESAS e ON e.id_empresa = u.id_empresa
       WHERE u.nombre_usuario = ? AND u.activo = 1`,
      [nombre_usuario]
    );

    if (!usuario || !verificarContrasena(contrasena, usuario.contrasena_hash)) {
      limite.registrarFallo(req.ip, nombre_usuario);
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }
    limite.registrarExito(req.ip, nombre_usuario);

    const token = tokenDe(usuario);

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
        debe_cambiar_contrasena: Boolean(usuario.debe_cambiar_contrasena),
        modulos
      }
    });
  } catch (err) {
    responderError(res, err, req);
  }
});

// GET /api/auth/yo  — datos del usuario autenticado (para revalidar sesión)
router.get('/yo', requiereAutenticacionConCambioPendiente, async (req, res) => {
  try {
    const [[usuario]] = await pool.query(
      `SELECT u.id_usuario, u.nombre_usuario, u.correo, u.rol, u.id_empresa, u.tema, u.debe_cambiar_contrasena,
              e.nombre AS nombre_empresa, e.iniciales AS iniciales_empresa, e.cuit AS cuit_empresa
       FROM USUARIOS u
       LEFT JOIN EMPRESAS e ON e.id_empresa = u.id_empresa
       WHERE u.id_usuario = ? AND u.activo = 1`,
      [req.usuario.id_usuario]
    );
    if (!usuario) return res.status(401).json({ error: 'Sesión inválida.' });
    usuario.debe_cambiar_contrasena = Boolean(usuario.debe_cambiar_contrasena);
    usuario.modulos = await modulosActivos(usuario.id_empresa);
    res.json({ usuario });
  } catch (err) {
    responderError(res, err, req);
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
    responderError(res, err, req);
  }
});

// PUT /api/auth/contrasena  { actual, nueva }
// Cada usuario cambia su propia contraseña (también la inicial obligatoria).
// Invalida las demás sesiones abiertas y devuelve un token nuevo para seguir.
router.put('/contrasena', requiereAutenticacionConCambioPendiente, async (req, res) => {
  try {
    const { actual, nueva } = req.body || {};
    if (!actual || !nueva) {
      return res.status(400).json({ error: 'Ingresá la contraseña actual y la nueva.' });
    }
    const [[usuario]] = await pool.query(
      'SELECT * FROM USUARIOS WHERE id_usuario = ? AND activo = 1', [req.usuario.id_usuario]);
    if (!usuario) return res.status(401).json({ error: 'Sesión inválida.' });

    if (!verificarContrasena(actual, usuario.contrasena_hash)) {
      return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
    }
    if (actual === nueva) {
      return res.status(400).json({ error: 'La contraseña nueva debe ser distinta de la actual.' });
    }
    const problema = problemaContrasenaNueva(nueva, usuario.nombre_usuario);
    if (problema) return res.status(400).json({ error: problema });

    const version = (Number(usuario.version_sesion) || 0) + 1;
    await pool.query(
      `UPDATE USUARIOS SET contrasena_hash = ?, debe_cambiar_contrasena = 0, version_sesion = ?
        WHERE id_usuario = ?`,
      [hashearContrasena(nueva), version, usuario.id_usuario]
    );
    res.json({ token: tokenDe({ ...usuario, version_sesion: version }), mensaje: 'Contraseña actualizada.' });
  } catch (err) {
    responderError(res, err, req);
  }
});

module.exports = router;
