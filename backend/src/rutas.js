// backend/src/rutas.js
// Único lugar donde se montan todas las rutas de la API (/api/*).
// El orden importa: primero las públicas y las de administración, luego las
// de datos, que exigen sesión + empresa + módulo activo.
const crudFactory = require('./lib/crudFactory');
const tablas = require('./modulos/tablas');
const { requiereAutenticacion, requiereEmpresa } = require('./middleware/autenticacion');
const { requiereModulo } = require('./middleware/modulos');
const pool = require('./config/db');

const authRouter = require('./modulos/auth/auth.rutas');
const asesoriaRouter = require('./modulos/asesoria/asesoria.rutas');
const adminRouter = require('./modulos/admin/admin.rutas');
const certificadosRouter = require('./modulos/admin/certificados.rutas');
const stockRouter = require('./modulos/stock/stock.rutas');
const dashboardRouter = require('./modulos/dashboard/dashboard.rutas');
const cuentasCorrientesRouter = require('./modulos/cuentas/cuentasCorrientes.rutas');
const facturacionRouter = require('./modulos/facturacion/facturacion.rutas');

function montarRutasApi(app) {
  // Rutas públicas de autenticación (login)
  app.use('/api/auth', authRouter);

  // Solicitud de asesoría desde la landing (pública, sin login)
  app.use('/api/asesoria', asesoriaRouter);

  // Rutas de administración (requieren ADMIN; el propio router lo valida)
  app.use('/api/admin', adminRouter);
  app.use('/api/certificados', certificadosRouter);

  // A partir de aquí, todas las rutas de datos requieren sesión + empresa.
  // El ADMIN no opera datos de empresa, así que requiereEmpresa lo bloquea.
  const protegerDatos = [requiereAutenticacion, requiereEmpresa];

  // Operaciones especiales de stock (antes del CRUD)
  app.use('/api/stock', protegerDatos, requiereModulo('stock'), stockRouter);

  // CRUD de las tablas (cada uno protegido por su módulo correspondiente)
  tablas.forEach(def => {
    app.use(`/api/${def.ruta}`, protegerDatos, requiereModulo(def.ruta), crudFactory(def));
  });

  // Métricas (el dashboard se adapta solo a lo activo) y cuentas corrientes
  app.use('/api/dashboard', protegerDatos, dashboardRouter);
  app.use('/api/cuentas-corrientes', protegerDatos, requiereModulo('cuentas-corrientes'), cuentasCorrientesRouter);
  app.use('/api/facturacion', protegerDatos, requiereModulo('facturacion'), facturacionRouter);

  // Salud (pública) — útil para monitoreo y health checks del proxy
  app.get('/api/health', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ servidor: 'OK', base_de_datos: 'OK' });
    } catch (err) {
      // Es pública: el detalle técnico va solo al log del servidor.
      console.error('Health check: sin conexión a la base de datos:', err.message);
      res.status(500).json({ servidor: 'OK', base_de_datos: 'ERROR' });
    }
  });
}

module.exports = { montarRutasApi };
