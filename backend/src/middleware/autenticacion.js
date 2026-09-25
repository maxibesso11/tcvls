// backend/src/middleware/autenticacion.js
// Middlewares para proteger rutas: verifican el token, adjuntan los datos
// del usuario (id_usuario, rol, id_empresa) a req, y controlan permisos.
//
// El token solo se acepta en la cabecera Authorization (nunca en la URL,
// donde quedaría registrado en logs e historial). Además de su firma y
// vencimiento, en cada pedido se verifica contra la base que el usuario siga
// activo y que la sesión no haya sido invalidada por un cambio de contraseña
// (version_sesion). Mientras el usuario deba cambiar su contraseña, solo
// puede consultar su sesión y cambiarla.
const pool = require('../config/db');
const { verificarToken } = require('../lib/seguridad/credenciales');
const { responderError } = require('../lib/errores');

const CODIGO_CAMBIO_REQUERIDO = 'CAMBIO_CONTRASENA_REQUERIDO';

function crearVerificacion({ permitirCambioPendiente }) {
  return async function (req, res, next) {
    try {
      const cabecera = req.headers.authorization || '';
      const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : null;
      const payload = verificarToken(token);
      if (!payload) {
        return res.status(401).json({ error: 'No autenticado. Inicia sesión nuevamente.' });
      }

      const [[usuario]] = await pool.query(
        'SELECT activo, debe_cambiar_contrasena, version_sesion FROM USUARIOS WHERE id_usuario = ?',
        [payload.id_usuario]
      );
      // Los tokens emitidos antes de existir version_sesion no la traen: valen como 0.
      if (!usuario || !usuario.activo || Number(usuario.version_sesion) !== Number(payload.v || 0)) {
        return res.status(401).json({ error: 'Tu sesión ya no es válida. Inicia sesión nuevamente.' });
      }
      if (usuario.debe_cambiar_contrasena && !permitirCambioPendiente) {
        return res.status(403).json({
          error: 'Tenés que cambiar tu contraseña antes de continuar.',
          codigo: CODIGO_CAMBIO_REQUERIDO
        });
      }

      req.usuario = payload;
      next();
    } catch (err) {
      responderError(res, err, req);
    }
  };
}

// Exige un token válido. Adjunta req.usuario = { id_usuario, rol, id_empresa, nombre_usuario }.
const requiereAutenticacion = crearVerificacion({ permitirCambioPendiente: false });

// Igual, pero deja pasar a quien todavía debe cambiar su contraseña: solo para
// consultar la sesión y hacer ese cambio.
const requiereAutenticacionConCambioPendiente = crearVerificacion({ permitirCambioPendiente: true });

// Exige rol ADMIN.
function requiereAdmin(req, res, next) {
  if (!req.usuario || req.usuario.rol !== 'ADMIN') {
    return res.status(403).json({ error: 'Acción reservada al administrador.' });
  }
  next();
}

// Exige que el usuario tenga una empresa asignada (usuarios operativos).
// El ADMIN no opera datos de empresa, así que se le bloquea el acceso a
// los módulos de datos para no romper el aislamiento.
function requiereEmpresa(req, res, next) {
  if (!req.usuario || !req.usuario.id_empresa) {
    return res.status(403).json({
      error: 'Este usuario no tiene una empresa asignada. El administrador solo gestiona usuarios y empresas.'
    });
  }
  next();
}

module.exports = {
  requiereAutenticacion,
  requiereAutenticacionConCambioPendiente,
  requiereAdmin,
  requiereEmpresa,
  CODIGO_CAMBIO_REQUERIDO
};
