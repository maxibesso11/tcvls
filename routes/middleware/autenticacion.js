// routes/middleware/autenticacion.js
// Middlewares para proteger rutas: verifican el token, adjuntan los datos
// del usuario (id_usuario, rol, id_empresa) a req, y controlan permisos.
const { verificarToken } = require('../../config/auth');

// Exige un token válido. Adjunta req.usuario = { id_usuario, rol, id_empresa, nombre_usuario }.
function requiereAutenticacion(req, res, next) {
  const cabecera = req.headers.authorization || '';
  let token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : null;
  // Las descargas (PDF) se abren en una pestaña nueva sin cabeceras, así que
  // también se admite el token por query string en ese caso.
  if (!token && req.query && req.query.token) token = req.query.token;
  const payload = verificarToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'No autenticado. Inicia sesión nuevamente.' });
  }
  req.usuario = payload;
  next();
}

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

module.exports = { requiereAutenticacion, requiereAdmin, requiereEmpresa };
