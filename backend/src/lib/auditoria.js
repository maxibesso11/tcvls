// backend/src/lib/auditoria.js
// Bitácora de actividad (tabla AUDITORIA): quién hizo qué, cuándo, desde qué
// IP y con qué resultado. Un middleware global registra los ingresos y cada
// pedido que modifica datos (POST / PUT / DELETE), más la descarga de
// respaldos y de solicitudes de certificado. Nunca guarda el cuerpo del
// pedido (contraseñas, claves, datos de formularios): solo la acción y a qué
// se aplicó. Si registrar falla, el pedido sigue normal.
const pool = require('../config/db');
const { calcularPaginacion } = require('./paginacion');
const { ErrorNegocio } = require('./errores');

const RETENCION_DIAS = 365;

const ACCION_POR_METODO = { POST: 'CREAR', PUT: 'EDITAR', PATCH: 'EDITAR', DELETE: 'ELIMINAR' };
// Segmentos de la ruta que no son una entidad sino el panel desde el que se opera
const PREFIJOS_PANEL = new Set(['admin', 'empresa', 'multiempresa', 'sistema']);

function limpiarIp(ip) {
  return String(ip || '').replace(/^::ffff:/, '').slice(0, 45) || null;
}

// A partir de método + ruta: { accion, entidad, idEntidad, idEmpresaRuta }
function interpretar(metodo, rutaCompleta) {
  const ruta = rutaCompleta.split('?')[0];
  const partes = ruta.replace(/^\/api\//, '').split('/').filter(Boolean);
  if (partes[0] === 'auth') {
    const accion = partes[1] === 'login' ? 'INGRESO'
      : partes[1] === 'contrasena' ? 'CAMBIO_CONTRASENA'
      : (ACCION_POR_METODO[metodo] || metodo);
    return { accion, entidad: 'auth', idEntidad: null, idEmpresaRuta: null };
  }
  while (partes.length > 1 && PREFIJOS_PANEL.has(partes[0])) partes.shift();
  const entidad = partes[0] || null;
  const idEntidad = partes[1] && /^\d+$/.test(partes[1]) ? partes[1] : null;
  const resto = partes.slice(idEntidad ? 2 : 1).filter(p => !/^\d+$/.test(p));
  let accion = ACCION_POR_METODO[metodo] || metodo;
  if (metodo === 'GET') accion = 'DESCARGAR';
  else if (resto.length) accion = resto[resto.length - 1].replace(/-/g, '_').toUpperCase();
  // En /certificados/:idEmpresa y /admin/empresas/:id el id es el de la empresa
  const idEmpresaRuta = (entidad === 'certificados' || entidad === 'empresas') && idEntidad ? Number(idEntidad) : null;
  return { accion, entidad, idEntidad: entidad === 'respaldos' ? partes[1] : idEntidad, idEmpresaRuta };
}

function debeRegistrar(metodo, rutaCompleta) {
  const ruta = rutaCompleta.split('?')[0];
  if (ruta.startsWith('/api/health') || ruta.startsWith('/api/asesoria')) return false;
  if (metodo === 'GET') return /\/respaldos\/[^/]+$/.test(ruta) || /\/csr$/.test(ruta);
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(metodo);
}

async function registrar(req, res, mensajeError) {
  const metodo = req.method;
  const ruta = req.originalUrl.split('?')[0];
  const quien = req.auditoria || req.usuario || null;
  const esIngreso = ruta === '/api/auth/login';
  // Pedidos sin sesión (salvo el ingreso) son ruido: los frena la autenticación
  if (!quien && !esIngreso) return;
  const { accion, entidad, idEntidad, idEmpresaRuta } = interpretar(metodo, ruta);
  const nombre = quien ? quien.nombre_usuario : String((req.body && req.body.nombre_usuario) || '').slice(0, 100);
  await pool.query('INSERT INTO AUDITORIA SET ?', [{
    id_usuario: quien && quien.id_usuario ? quien.id_usuario : null,
    nombre_usuario: nombre || null,
    rol: quien && quien.rol ? quien.rol : null,
    id_empresa: idEmpresaRuta || (quien && quien.id_empresa) || null,
    ip: limpiarIp(req.ip),
    accion,
    entidad,
    id_entidad: idEntidad ? String(idEntidad).slice(0, 40) : null,
    metodo,
    ruta: ruta.slice(0, 255),
    estado: res.statusCode < 400 ? 'OK' : 'ERROR',
    codigo_http: res.statusCode,
    detalle: res.statusCode >= 400 && mensajeError ? String(mensajeError).slice(0, 255) : null,
    navegador: String(req.headers['user-agent'] || '').slice(0, 255) || null
  }]);
}

// Middleware global (se monta antes de las rutas de la API).
function auditar(req, res, next) {
  if (!debeRegistrar(req.method, req.originalUrl)) return next();
  // Para el detalle de un error se toma el mensaje que devuelve la API
  let mensajeError = null;
  const json = res.json.bind(res);
  res.json = cuerpo => {
    if (cuerpo && typeof cuerpo.error === 'string') mensajeError = cuerpo.error;
    return json(cuerpo);
  };
  res.on('finish', () => {
    registrar(req, res, mensajeError).catch(err => console.error('No se pudo registrar en la bitácora:', err.message));
  });
  next();
}

// ---------- Consulta ----------
// idEmpresa: restringe a esa empresa (paneles de empresa); null = todas (ADMIN).
async function listar({ idEmpresa = null, query = {} }) {
  const cond = [];
  const params = [];
  if (idEmpresa) { cond.push('a.id_empresa = ?'); params.push(idEmpresa); }
  else if (query.id_empresa) { cond.push('a.id_empresa = ?'); params.push(Number(query.id_empresa)); }
  if (query.estado === 'OK' || query.estado === 'ERROR') { cond.push('a.estado = ?'); params.push(query.estado); }
  if (query.accion) { cond.push('a.accion = ?'); params.push(String(query.accion)); }
  if (query.entidad) { cond.push('a.entidad = ?'); params.push(String(query.entidad)); }
  if (query.desde) { cond.push('DATE(a.fecha) >= ?'); params.push(query.desde); }
  if (query.hasta) { cond.push('DATE(a.fecha) <= ?'); params.push(query.hasta); }
  if (query.q) {
    cond.push('(a.nombre_usuario LIKE ? OR a.ip LIKE ? OR a.id_entidad LIKE ? OR a.detalle LIKE ?)');
    const like = `%${query.q}%`;
    params.push(like, like, like, like);
  }
  const donde = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  let total;
  try {
    [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM AUDITORIA a ${donde}`, params);
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') {
      throw new ErrorNegocio('Falta crear la tabla de la bitácora. Ejecutá las migraciones: node backend/database/migrar.js', 500);
    }
    throw err;
  }
  const { pagina, porPagina, totalPaginas, offset } = calcularPaginacion(query, total);
  const [filas] = await pool.query(
    `SELECT a.*, e.nombre AS nombre_empresa
     FROM AUDITORIA a LEFT JOIN EMPRESAS e ON e.id_empresa = a.id_empresa
     ${donde} ORDER BY a.fecha DESC, a.id_auditoria DESC LIMIT ? OFFSET ?`,
    [...params, porPagina, offset]
  );
  // Valores para los filtros (solo lo que existe en el alcance consultado)
  const [acciones] = await pool.query(
    `SELECT DISTINCT accion FROM AUDITORIA ${idEmpresa ? 'WHERE id_empresa = ?' : ''} ORDER BY accion`, idEmpresa ? [idEmpresa] : []);
  const [entidades] = await pool.query(
    `SELECT DISTINCT entidad FROM AUDITORIA WHERE entidad IS NOT NULL ${idEmpresa ? 'AND id_empresa = ?' : ''} ORDER BY entidad`, idEmpresa ? [idEmpresa] : []);
  return {
    datos: filas,
    paginacion: { pagina, por_pagina: porPagina, total, total_paginas: totalPaginas },
    filtros: { acciones: acciones.map(a => a.accion), entidades: entidades.map(e => e.entidad) }
  };
}

// Elimina lo que supera la retención. Se corre al arrancar y una vez por día.
async function depurar() {
  try {
    await pool.query('DELETE FROM AUDITORIA WHERE fecha < DATE_SUB(NOW(), INTERVAL ? DAY)', [RETENCION_DIAS]);
  } catch (err) {
    console.error('No se pudo depurar la bitácora:', err.message);
  }
}

function iniciarDepuracion() {
  depurar();
  setInterval(depurar, 24 * 60 * 60 * 1000).unref();
}

module.exports = { auditar, listar, interpretar, iniciarDepuracion, RETENCION_DIAS };
