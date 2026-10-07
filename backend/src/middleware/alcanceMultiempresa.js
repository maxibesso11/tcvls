// backend/src/middleware/alcanceMultiempresa.js
// Resuelve con qué empresa está operando un ADMIN_MULTIEMPRESA en cada
// pedido. Ese rol no tiene una empresa fija en el token (id_empresa es NULL,
// igual que el ADMIN de plataforma): el cliente indica la empresa elegida
// con la cabecera X-Empresa-Id, y acá se valida contra USUARIOS_EMPRESAS
// antes de confiar en ella.
//
// Para cualquier otro rol no hace nada: su id_empresa sigue viniendo 100%
// del token firmado, nunca de esta cabecera.
const empresasAsignadasServicio = require('../modulos/admin/empresasAsignadas.servicio');
const { responderError } = require('../lib/errores');

const CABECERA = 'x-empresa-id';

function resolverEmpresaMultiempresa({ obligatorio = true } = {}) {
  return async function (req, res, next) {
    if (!req.usuario || req.usuario.rol !== 'ADMIN_MULTIEMPRESA') return next();
    try {
      const idEmpresa = Number(req.headers[CABECERA]);
      if (!idEmpresa) {
        if (!obligatorio) return next();
        return res.status(400).json({
          error: `Indicá con qué empresa estás operando (cabecera ${CABECERA}).`
        });
      }
      const asignada = await empresasAsignadasServicio.estaAsignada(req.usuario.id_usuario, idEmpresa);
      if (!asignada) {
        return res.status(403).json({ error: 'No tenés esa empresa asignada.' });
      }
      req.idEmpresaObjetivo = idEmpresa;
      // Así lo leen, sin cambios, las rutas operativas existentes (crudFactory,
      // dashboard, stock, facturación, etc.), que toman la empresa del token.
      req.usuario.id_empresa = idEmpresa;
      next();
    } catch (err) {
      responderError(res, err, req);
    }
  };
}

module.exports = { resolverEmpresaMultiempresa };
