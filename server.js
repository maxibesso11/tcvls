// server.js - Servidor principal del ERP (multi-empresa con autenticación)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const crudFactory = require('./routes/crudFactory');
const tablas = require('./routes/tablas');
const dashboardRouter = require('./routes/dashboard');
const stockExtraRouter = require('./routes/stockExtra');
const cuentasCorrientesRouter = require('./routes/cuentasCorrientes');
const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin');
const { requiereAutenticacion, requiereEmpresa } = require('./routes/middleware/autenticacion');
const { requiereModulo } = require('./routes/middleware/modulos');
const pool = require('./config/db');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Detrás de un reverse proxy (Nginx), confiar en la cabecera X-Forwarded-*
// para obtener el IP real del cliente y el protocolo (http/https).
app.set('trust proxy', 1);

// CORS: en producción se puede restringir a un dominio con la variable
// CORS_ORIGIN (ej. "https://erp.midominio.com"). Si no se define, se
// permite cualquier origen (útil en desarrollo).
const corsOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: corsOrigin === '*' ? true : corsOrigin.split(',').map(s => s.trim()) }));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rutas públicas de autenticación (login)
app.use('/api/auth', authRouter);

// Rutas de administración (requieren ADMIN; el propio router lo valida)
app.use('/api/admin', adminRouter);

// A partir de aquí, todas las rutas de datos requieren sesión + empresa.
// El ADMIN no opera datos de empresa, así que requiereEmpresa lo bloquea.
const protegerDatos = [requiereAutenticacion, requiereEmpresa];

// Operaciones especiales de stock (antes del CRUD)
app.use('/api/stock', protegerDatos, requiereModulo('stock'), stockExtraRouter);

// CRUD de las tablas (cada uno protegido por su módulo correspondiente)
tablas.forEach(def => {
  app.use(`/api/${def.ruta}`, protegerDatos, requiereModulo(def.ruta), crudFactory(def));
});

// Métricas (el dashboard se adapta solo a lo activo) y cuentas corrientes
app.use('/api/dashboard', protegerDatos, dashboardRouter);
app.use('/api/cuentas-corrientes', protegerDatos, requiereModulo('cuentas-corrientes'), cuentasCorrientesRouter);

// Salud (pública) — útil para monitoreo y health checks del proxy
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ servidor: 'OK', base_de_datos: 'OK' });
  } catch (err) {
    res.status(500).json({ servidor: 'OK', base_de_datos: 'ERROR', detalle: err.message });
  }
});

// SPA para cualquier otra ruta
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const servidor = app.listen(PORT, HOST, () => {
  console.log(`✓ TCV LogiSuite ERP corriendo en http://${HOST}:${PORT} (entorno: ${process.env.NODE_ENV || 'development'})`);
});

// Cierre ordenado: al recibir señal de parada (PM2/systemd), cerrar el
// servidor HTTP y el pool de conexiones antes de salir.
function cierreOrdenado(senal) {
  console.log(`\n${senal} recibido. Cerrando servidor…`);
  servidor.close(async () => {
    try { await pool.end(); } catch (e) { /* ignorar */ }
    console.log('Servidor y conexiones cerradas. Hasta luego.');
    process.exit(0);
  });
  // Forzar salida si algo queda colgado
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => cierreOrdenado('SIGTERM'));
process.on('SIGINT', () => cierreOrdenado('SIGINT'));
