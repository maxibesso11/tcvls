// backend/src/modulos/admin/sistema.rutas.js
// Herramientas de operación del administrador de plataforma: registros del
// servidor y respaldos de la base. Se monta dentro de admin.rutas.js, que ya
// exige rol ADMIN en todas sus rutas.
//   GET /logs                      mensajes del servidor (memoria o archivo de PM2)
//   GET /respaldos                 estado y lista de respaldos
//   GET /respaldos/:nombre         descarga de un respaldo
const express = require('express');
const fs = require('fs');
const path = require('path');
const registro = require('../../lib/registro');
const { responderError } = require('../../lib/errores');

const router = express.Router();

const RAIZ = path.join(__dirname, '..', '..', '..', '..');
// Dónde están los archivos de respaldo (ver deploy/servidor/respaldo-bd.sh).
const dirRespaldos = () => process.env.RESPALDOS_DIR || '/var/backups/tcv-bd';
const dirLogs = () => process.env.LOGS_DIR || path.join(RAIZ, 'logs');

const ARCHIVOS_LOG = { salida: 'tcv-erp-out.log', errores: 'tcv-erp-error.log' };
const MAX_BYTES_LOG = 512 * 1024;
const PATRON_RESPALDO = /^[A-Za-z0-9_.-]+\.sql\.gz$/;

// Últimas líneas de un archivo de log, leyendo solo el final.
function ultimasLineas(ruta, limite, nivelFijo) {
  const fd = fs.openSync(ruta, 'r');
  try {
    const { size } = fs.fstatSync(fd);
    const largo = Math.min(size, MAX_BYTES_LOG);
    const buffer = Buffer.alloc(largo);
    fs.readSync(fd, buffer, 0, largo, size - largo);
    const lineas = buffer.toString('utf8').split(/\r?\n/).filter(Boolean);
    if (size > largo) lineas.shift(); // la primera puede venir cortada
    return lineas.slice(-limite).reverse().map((mensaje, i) => ({ id: i, fecha: null, nivel: nivelFijo, mensaje }));
  } finally {
    fs.closeSync(fd);
  }
}

router.get('/logs', (req, res) => {
  try {
    const origen = String(req.query.origen || 'memoria');
    const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 300, 1), registro.LIMITE);
    if (origen === 'memoria') {
      return res.json({ origen, entradas: registro.consultar({ nivel: req.query.nivel, q: req.query.q, limite }) });
    }
    const nombre = ARCHIVOS_LOG[origen];
    if (!nombre) return res.status(400).json({ error: 'Origen de registros desconocido.' });
    const ruta = path.join(dirLogs(), nombre);
    if (!fs.existsSync(ruta)) {
      return res.json({ origen, entradas: [], aviso: `No existe ${nombre} en este servidor (con Docker los registros salen por «docker compose logs app»).` });
    }
    const texto = String(req.query.q || '').trim().toLowerCase();
    let entradas = ultimasLineas(ruta, limite, origen === 'errores' ? 'error' : 'info');
    if (texto) entradas = entradas.filter(e => e.mensaje.toLowerCase().includes(texto));
    res.json({ origen, entradas });
  } catch (err) {
    responderError(res, err, req);
  }
});

function leerTexto(archivo) {
  try { return fs.readFileSync(archivo, 'utf8').trim(); } catch (e) { return null; }
}

router.get('/respaldos', (req, res) => {
  try {
    const dir = dirRespaldos();
    if (!fs.existsSync(dir)) {
      return res.json({ disponible: false, directorio: dir, respaldos: [], ultimoOk: null, ultimoSubido: null });
    }
    const respaldos = fs.readdirSync(dir)
      .filter(n => PATRON_RESPALDO.test(n))
      .map(nombre => {
        const st = fs.statSync(path.join(dir, nombre));
        const conteos = leerTexto(path.join(dir, nombre + '.conteos'));
        return { nombre, tamano: st.size, fecha: st.mtime.toISOString(), tablas: conteos ? conteos.split(/\r?\n/).filter(Boolean).length : null };
      })
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
    res.json({
      disponible: true,
      directorio: dir,
      ultimoOk: leerTexto(path.join(dir, 'ULTIMO_OK')),
      ultimoSubido: leerTexto(path.join(dir, 'ULTIMO_SUBIDO')),
      respaldos
    });
  } catch (err) {
    responderError(res, err, req);
  }
});

router.get('/respaldos/:nombre', (req, res) => {
  try {
    const nombre = req.params.nombre;
    if (!PATRON_RESPALDO.test(nombre)) return res.status(400).json({ error: 'Nombre de respaldo inválido.' });
    const ruta = path.join(dirRespaldos(), nombre);
    if (!fs.existsSync(ruta)) return res.status(404).json({ error: 'Respaldo no encontrado.' });
    res.download(ruta, nombre);
  } catch (err) {
    responderError(res, err, req);
  }
});

module.exports = router;
