// backend/src/lib/verificacionEntorno.js
// Verificación del entorno ANTES de arrancar (la corre backend/server.js y,
// a pedido, `npm run verificar-entorno`). Devuelve tres listas:
//   errores  → el sistema no puede funcionar bien: el servidor no arranca.
//   avisos   → conviene corregirlo, pero no impide trabajar.
//   correctos→ lo que se comprobó y está bien (para el informe).
// Cada mensaje dice qué pasa y cómo corregirlo.
const fs = require('fs');
const path = require('path');
const { problemasDeConfiguracion } = require('./seguridad/configuracion');
const { verificarContrasena } = require('./seguridad/credenciales');

const CARPETA_MIGRACIONES = path.join(__dirname, '..', '..', 'database', 'migraciones');
const PATRON_MIGRACION = /^migracion_(\d{3})_.+\.sql$/;
const HORAS_RESPALDO_MAX = 36;
// Contraseñas públicas de los datos de ejemplo
const USUARIOS_DE_EJEMPLO = { admin: 'admin123', demo: 'demo123' };

// ---------- Parte pura: solo mira las variables de entorno ----------
function revisarConfiguracion(env = process.env) {
  const errores = [...problemasDeConfiguracion(env)];
  const avisos = [];
  const produccion = env.NODE_ENV === 'production';

  if (!produccion) {
    avisos.push('NODE_ENV no es "production": es lo esperable solo en desarrollo.');
  }
  if (produccion && (!env.CORS_ORIGIN || env.CORS_ORIGIN.trim() === '*')) {
    avisos.push('CORS_ORIGIN permite cualquier origen. En producción indicá el dominio (ej. https://erp.midominio.com).');
  }
  if (env.FACTURACION_HABILITADA === '1' && env.ARCA_PRODUCCION !== '1' && produccion) {
    avisos.push('Facturación encendida contra ARCA de HOMOLOGACIÓN (pruebas): los comprobantes no tienen validez fiscal. Para facturar en serio: ARCA_PRODUCCION=1.');
  }
  const faltaCorreo = ['ASESORIA_DESTINO', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].filter(v => !env[v] || /ejemplo|tu_casilla|tu_contrase/i.test(env[v]));
  if (faltaCorreo.length) {
    avisos.push(`El formulario de asesoría de la landing no enviará correos: falta configurar ${faltaCorreo.join(', ')}.`);
  }
  return { errores, avisos };
}

function migracionesEnDisco() {
  return fs.readdirSync(CARPETA_MIGRACIONES).filter(n => PATRON_MIGRACION.test(n)).sort();
}

function leerTexto(archivo) {
  try { return fs.readFileSync(archivo, 'utf8').trim(); } catch (e) { return null; }
}

// Respaldos: existe la carpeta y el último respaldo es reciente.
function revisarRespaldos(env, produccion, avisos, correctos) {
  const dir = env.RESPALDOS_DIR || '/var/backups/tcv-bd';
  if (!fs.existsSync(dir)) {
    if (produccion) avisos.push(`No se ve la carpeta de respaldos (${dir}): el panel no podrá mostrar su estado. Definí RESPALDOS_DIR o montala en docker-compose.yml.`);
    return;
  }
  const ultimo = leerTexto(path.join(dir, 'ULTIMO_OK'));
  const fecha = ultimo ? new Date(ultimo.replace(' ', 'T')) : null;
  if (!fecha || isNaN(fecha)) {
    avisos.push(`No hay constancia de ningún respaldo en ${dir}: revisá que el respaldo diario esté instalado (docs/operacion/SERVIDOR.md).`);
    return;
  }
  const horas = (Date.now() - fecha.getTime()) / 36e5;
  if (horas > HORAS_RESPALDO_MAX) {
    avisos.push(`El último respaldo es de hace ${Math.floor(horas / 24)} día(s) (${ultimo}). El respaldo diario no está funcionando.`);
  } else {
    correctos.push(`Último respaldo: ${ultimo}.`);
  }
}

// ---------- Verificación completa ----------
// pool: conexión a la base (mysql2/promise). Sin pool, solo la parte de configuración.
async function verificar({ pool = null, env = process.env } = {}) {
  const { errores, avisos } = revisarConfiguracion(env);
  const correctos = [];
  const produccion = env.NODE_ENV === 'production';
  if (!errores.length) correctos.push('Secretos AUTH_SECRET y CERT_SECRET válidos.');

  if (pool) {
    try {
      await pool.query('SELECT 1');
      correctos.push('Conexión con la base de datos.');
    } catch (err) {
      errores.push(`No se puede conectar con la base de datos (${err.code || err.message}). Revisá DB_HOST, DB_PORT, DB_USER, DB_PASSWORD y DB_NAME.`);
      return { errores, avisos, correctos };
    }

    const [tablas] = await pool.query(
      `SELECT table_name AS nombre FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name IN ('EMPRESAS', 'USUARIOS', 'MIGRACIONES')`);
    const hay = new Set(tablas.map(t => t.nombre.toUpperCase()));
    if (!hay.has('EMPRESAS') || !hay.has('USUARIOS')) {
      errores.push('La base está vacía o incompleta. Para una instalación nueva ejecutá: node backend/database/instalar.js (en Docker: docker compose run --rm app node backend/database/instalar.js).');
      return { errores, avisos, correctos };
    }
    if (!hay.has('MIGRACIONES')) {
      errores.push('La base no tiene el registro de migraciones. Ver docs/operacion/ACTUALIZAR_SIN_PERDER_DATOS.md (migrar.js --registrar-hasta).');
    } else {
      const [filas] = await pool.query('SELECT nombre FROM MIGRACIONES');
      const aplicadas = new Set(filas.map(f => f.nombre));
      const pendientes = migracionesEnDisco().filter(n => !aplicadas.has(n));
      if (pendientes.length) {
        const msg = `Hay ${pendientes.length} migración(es) sin aplicar (${pendientes[0]}${pendientes.length > 1 ? ', …' : ''}). Ejecutá: node backend/database/migrar.js (en Docker: docker compose run --rm app node backend/database/migrar.js).`;
        // En producción el esquema desactualizado rompe pantallas: no se arranca así.
        (produccion ? errores : avisos).push(msg);
      } else {
        correctos.push('Migraciones al día.');
      }
    }

    const [[{ admins }]] = await pool.query("SELECT COUNT(*) AS admins FROM USUARIOS WHERE rol = 'ADMIN' AND activo = 1");
    if (!Number(admins)) {
      avisos.push('No hay ningún administrador de plataforma activo. Crealo con: node backend/database/instalar.js --solo-admin');
    }
    const [[{ empresas }]] = await pool.query('SELECT COUNT(*) AS empresas FROM EMPRESAS');
    if (!Number(empresas)) {
      avisos.push('Todavía no hay empresas cargadas. Dalas de alta con: node backend/database/alta-cliente.js');
    }

    // Contraseñas públicas de los datos de ejemplo todavía vigentes
    const [ejemplos] = await pool.query(
      'SELECT nombre_usuario, contrasena_hash FROM USUARIOS WHERE activo = 1 AND nombre_usuario IN (?)', [Object.keys(USUARIOS_DE_EJEMPLO)]);
    const conClaveConocida = ejemplos.filter(u => verificarContrasena(USUARIOS_DE_EJEMPLO[u.nombre_usuario], u.contrasena_hash));
    if (conClaveConocida.length) {
      avisos.push(`Siguen activos usuarios con contraseña pública de ejemplo (${conClaveConocida.map(u => u.nombre_usuario).join(', ')}). Cambiales la contraseña o desactivalos.`);
    }
  }

  revisarRespaldos(env, produccion, avisos, correctos);
  return { errores, avisos, correctos };
}

// Texto para consola.
function informe({ errores, avisos, correctos }) {
  const lineas = [];
  correctos.forEach(m => lineas.push(`  ✓ ${m}`));
  avisos.forEach(m => lineas.push(`  ⚠ ${m}`));
  errores.forEach(m => lineas.push(`  ✗ ${m}`));
  return lineas.join('\n');
}

module.exports = { verificar, revisarConfiguracion, informe, HORAS_RESPALDO_MAX };
