// backend/src/middleware/modulos.js
// Bloquea el acceso a las rutas de un módulo que la empresa tiene desactivado.
// Se apoya en el catálogo central (config/modulos.js) y en la tabla
// MODULOS_EMPRESA. El ADMIN no opera datos, así que no se ve afectado.
const pool = require('../config/db');
const { RUTA_A_MODULO, modulosApagadosPorSistema, MENSAJE_FACTURACION_APAGADA } = require('../config/modulos');
const { responderError } = require('../lib/errores');

// Devuelve un Set con las claves de los módulos activos de una empresa,
// sin los que están apagados para todo el sistema (config/modulos.js).
async function modulosActivosDe(idEmpresa) {
  if (!idEmpresa) return new Set();
  const [filas] = await pool.query(
    'SELECT modulo FROM MODULOS_EMPRESA WHERE id_empresa = ? AND activo = 1',
    [idEmpresa]
  );
  const apagados = modulosApagadosPorSistema();
  return new Set(filas.map(f => f.modulo).filter(m => !apagados.includes(m)));
}

// Middleware fábrica: protege una ruta concreta (por su prefijo) verificando
// que el módulo correspondiente esté activo para la empresa del usuario.
function requiereModulo(rutaApi) {
  const moduloClave = RUTA_A_MODULO[rutaApi] || rutaApi;
  return async (req, res, next) => {
    try {
      // El usuario ya pasó por requiereAutenticacion + requiereEmpresa
      const activos = await modulosActivosDe(req.usuario.id_empresa);
      if (moduloClave === 'facturacion' && modulosApagadosPorSistema().includes('facturacion')) {
        return res.status(403).json({ error: MENSAJE_FACTURACION_APAGADA });
      }
      if (!activos.has(moduloClave)) {
        return res.status(403).json({
          error: 'Este módulo no está habilitado para tu empresa. Consultá con el administrador.'
        });
      }
      next();
    } catch (err) {
      responderError(res, err, req);
    }
  };
}

module.exports = { requiereModulo, modulosActivosDe };
