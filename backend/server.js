// backend/server.js - Punto de entrada del servidor del ERP (multi-empresa con autenticación)
// Carga la configuración (.env de la carpeta desde donde se ejecuta, la raíz
// del proyecto), abre el puerto y maneja el cierre ordenado.
require('dotenv').config();
require('./src/lib/registro').instalar();

const app = require('./src/app');
const pool = require('./src/config/db');
const { verificar, informe } = require('./src/lib/verificacionEntorno');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

let servidor;

// Antes de abrir el puerto se verifica el entorno (src/lib/verificacionEntorno.js):
// secretos, base de datos, esquema y migraciones. Si algo impide funcionar bien,
// el servidor NO arranca y explica cómo corregirlo; los avisos solo se imprimen.
async function iniciar() {
  const resultado = await verificar({ pool });
  if (resultado.errores.length) {
    console.error('✗ El ERP no puede arrancar: el entorno no está bien configurado.');
    console.error(informe(resultado));
    process.exit(1);
  }
  if (resultado.avisos.length) {
    console.warn('⚠ El ERP arranca, pero conviene revisar:');
    console.warn(informe({ errores: [], avisos: resultado.avisos, correctos: [] }));
  }

  require('./src/lib/auditoria').iniciarDepuracion();

  servidor = app.listen(PORT, HOST, () => {
    console.log(`✓ TCV LogiSuite ERP corriendo en http://${HOST}:${PORT} (entorno: ${process.env.NODE_ENV || 'development'})`);
  });
}

iniciar().catch(err => {
  console.error('✗ No se pudo iniciar el ERP:', err.message);
  process.exit(1);
});

// Cierre ordenado: al recibir señal de parada (PM2/systemd), cerrar el
// servidor HTTP y el pool de conexiones antes de salir.
function cierreOrdenado(senal) {
  console.log(`\n${senal} recibido. Cerrando servidor…`);
  if (!servidor) process.exit(0);
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
