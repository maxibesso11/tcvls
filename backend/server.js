// backend/server.js - Punto de entrada del servidor del ERP (multi-empresa con autenticación)
// Carga la configuración (.env de la carpeta desde donde se ejecuta, la raíz
// del proyecto), abre el puerto y maneja el cierre ordenado.
require('dotenv').config();

// Sin los secretos críticos bien configurados el servidor no arranca (ver
// src/lib/seguridad/configuracion.js). Se verifica antes de cargar la app.
const { problemasDeConfiguracion } = require('./src/lib/seguridad/configuracion');
const problemas = problemasDeConfiguracion();
if (problemas.length) {
  console.error('✗ El ERP no puede arrancar: configuración insegura o incompleta.');
  problemas.forEach(p => console.error(`  - ${p}`));
  console.error('  Corregí el archivo .env (valores nuevos con: openssl rand -hex 48) y volvé a iniciar.');
  process.exit(1);
}

const app = require('./src/app');
const pool = require('./src/config/db');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

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
