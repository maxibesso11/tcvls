// backend/src/modulos/equipos/equipos.historial.js
// Historial de composición de los equipos (tabla EQUIPO_HISTORIAL, migración 026).
//
// Cada período dice qué camión (unidad principal), acoplado (unidad
// secundaria) y chofer tuvo un equipo, desde y hasta cuándo:
//   desde NULL → desde el alta del equipo   ·   hasta NULL → período vigente
// Editar el camión, el acoplado o el chofer cierra el período vigente y abre
// uno nuevo: la historia nunca se pisa.
//
// El historial es la fuente de verdad de la "foto" de cada viaje (chofer y
// unidades, ver viajes.servicio.js → fotografiarEquipo): si se corrige la
// fecha de un cambio, refotografiarViajes() recalcula los viajes del equipo y
// reconcilia la liquidación de los que cambiaron de chofer.
//
// Todas las funciones reciben la conexión (db) de la transacción en curso.
const { ErrorNegocio } = require('../../lib/errores');
const { ahoraLocal } = require('../../config/constantes');
const { reconciliarMovimientos } = require('../viajes/viajes.servicio');

const CAMPOS_COMPOSICION = ['id_unidad_principal', 'id_unidad_secundaria', 'id_chofer'];

// ¿Cambió el camión, el acoplado o el chofer? (el formulario manda strings)
function cambioComposicion(nuevo, anterior) {
  return CAMPOS_COMPOSICION.some(c =>
    nuevo[c] !== undefined && nuevo[c] !== null && Number(nuevo[c]) !== Number(anterior[c]));
}

// 'AAAA-MM-DD HH:MM[:SS]' o 'AAAA-MM-DDTHH:MM' → 'AAAA-MM-DD HH:MM:SS' (o null si no es válida)
function normalizarFecha(valor) {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?$/.exec(String(valor || '').trim());
  if (!m) return null;
  const texto = `${m[1]} ${m[2]}${m[3] || ':00'}`;
  return Number.isNaN(new Date(texto.replace(' ', 'T') + 'Z').getTime()) ? null : texto;
}

// "Ahora" en hora local, como las fechas de los viajes (ver config/constantes.js).
const ahora = ahoraLocal;

async function periodoVigente(db, idEquipo, idEmpresa) {
  const [[fila]] = await db.query(
    `SELECT * FROM EQUIPO_HISTORIAL WHERE id_equipo = ? AND id_empresa = ? AND hasta IS NULL
      ORDER BY id_historial DESC LIMIT 1`, [idEquipo, idEmpresa]);
  return fila || null;
}

// Valida la fecha de un cambio de composición antes de guardar el equipo.
// Devuelve un mensaje de error o null. fechaCambio vacía = ahora.
async function validarFechaCambio(db, idEquipo, idEmpresa, fechaCambio) {
  if (!fechaCambio) return null;
  const fecha = normalizarFecha(fechaCambio);
  if (!fecha) return 'La fecha del cambio no es válida.';
  if (fecha > ahora()) return 'La fecha del cambio no puede ser futura.';
  const vigente = await periodoVigente(db, idEquipo, idEmpresa);
  if (vigente && vigente.desde && fecha <= String(vigente.desde)) {
    return `La fecha del cambio debe ser posterior al inicio de la composición actual (${String(vigente.desde).slice(0, 16)}).`;
  }
  return null;
}

// Primer período de un equipo recién creado. Empieza "desde el alta" (sin
// fecha) salvo que alguna de sus unidades ya haya estado en otro equipo: en
// ese caso empieza ahora, para que los consumos anteriores de esa unidad
// sigan siendo del equipo que la tenía y no se cuenten dos veces.
async function registrarAlta(db, equipo, idEmpresa, idUsuario) {
  const [[previa]] = await db.query(
    `SELECT COUNT(*) AS n FROM EQUIPO_HISTORIAL
      WHERE id_empresa = ? AND id_equipo <> ?
        AND (id_unidad_principal IN (?, ?) OR id_unidad_secundaria IN (?, ?))`,
    [idEmpresa, equipo.id_equipo, equipo.id_unidad_principal, equipo.id_unidad_secundaria,
     equipo.id_unidad_principal, equipo.id_unidad_secundaria]);
  const desde = Number(previa.n) > 0 ? ahora() : null;
  await db.query(
    `INSERT INTO EQUIPO_HISTORIAL
       (id_empresa, id_equipo, id_unidad_principal, id_unidad_secundaria, id_chofer, desde, hasta, id_usuario)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    [idEmpresa, equipo.id_equipo, equipo.id_unidad_principal, equipo.id_unidad_secundaria, equipo.id_chofer,
     desde, idUsuario || null]);
}

// Un camión, un acoplado o un chofer no puede estar en dos equipos activos a
// la vez. Devuelve el mensaje de error (o null). idEquipoPropio: el equipo
// que se está editando (se excluye de la búsqueda).
async function validarDisponibilidad(db, idEmpresa, composicion, idEquipoPropio = null) {
  const up = Number(composicion.id_unidad_principal);
  const us = Number(composicion.id_unidad_secundaria);
  const ch = Number(composicion.id_chofer);
  const [ocupados] = await db.query(`
    SELECT e.id_equipo, e.id_unidad_principal, e.id_unidad_secundaria, e.id_chofer,
           up.patente AS patente_principal, us.patente AS patente_secundaria, c.nombre AS chofer
      FROM EQUIPO e
      JOIN UNIDADES up ON up.id_unidad = e.id_unidad_principal
      JOIN UNIDADES us ON us.id_unidad = e.id_unidad_secundaria
      JOIN CHOFERES c ON c.id_chofer = e.id_chofer
     WHERE e.id_empresa = ? AND e.activo = 1 AND e.id_equipo <> ?
       AND (e.id_unidad_principal IN (?, ?) OR e.id_unidad_secundaria IN (?, ?) OR e.id_chofer = ?)`,
    [idEmpresa, idEquipoPropio || 0, up, us, up, us, ch]);
  if (!ocupados.length) return null;
  const o = ocupados[0];
  const queCosa = [up, us].includes(o.id_unidad_principal) ? `El camión ${o.patente_principal}`
    : [up, us].includes(o.id_unidad_secundaria) ? `El acoplado ${o.patente_secundaria}`
    : `El chofer ${o.chofer}`;
  return `${queCosa} ya está en el equipo #${o.id_equipo} (${o.patente_principal} y ${o.patente_secundaria}, chofer ${o.chofer}). ` +
    'Si cambió el chofer, editá ese equipo y cambiale el chofer; si ese equipo ya no trabaja, dalo de baja primero.';
}

// Da de baja un equipo en una fecha: cierra su período vigente (la historia
// queda intacta) y libera sus unidades y su chofer. No se puede si tiene
// viajes con fecha posterior a la baja.
async function darDeBaja(db, idEquipo, idEmpresa, fechaBaja) {
  const fecha = normalizarFecha(fechaBaja) || ahora();
  if (fecha > ahora()) throw new ErrorNegocio('La fecha de baja no puede ser futura.');
  const [[equipo]] = await db.query(
    'SELECT * FROM EQUIPO WHERE id_equipo = ? AND id_empresa = ? FOR UPDATE', [idEquipo, idEmpresa]);
  if (!equipo) throw new ErrorNegocio('Equipo no encontrado.', 404);
  if (!equipo.activo) throw new ErrorNegocio('El equipo ya está dado de baja.');
  const vigente = await periodoVigente(db, idEquipo, idEmpresa);
  if (vigente && vigente.desde && fecha < String(vigente.desde)) {
    throw new ErrorNegocio(`La fecha de baja no puede ser anterior al inicio de la composición actual (${String(vigente.desde).slice(0, 16)}).`);
  }
  const [posteriores] = await db.query(
    `SELECT id_viaje, DATE_FORMAT(fecha_origen, '%d/%m/%Y') AS fecha FROM VIAJES
      WHERE id_equipo = ? AND id_empresa = ? AND fecha_origen >= ? ORDER BY fecha_origen LIMIT 5`,
    [idEquipo, idEmpresa, fecha]);
  if (posteriores.length) {
    throw new ErrorNegocio('El equipo tiene viajes con fecha posterior a la baja (' +
      posteriores.map(v => `#${v.id_viaje} del ${v.fecha}`).join(', ') + '). Elegí una fecha de baja posterior al último viaje.');
  }
  if (vigente) await db.query('UPDATE EQUIPO_HISTORIAL SET hasta = ? WHERE id_historial = ?', [fecha, vigente.id_historial]);
  await db.query('UPDATE EQUIPO SET activo = 0, fecha_baja = ? WHERE id_equipo = ? AND id_empresa = ?',
    [fecha, idEquipo, idEmpresa]);
}

// Vuelve a poner en servicio un equipo dado de baja, con la composición que
// tenía, desde ahora. Sus unidades y su chofer tienen que estar libres.
async function reactivar(db, idEquipo, idEmpresa, idUsuario) {
  const [[equipo]] = await db.query(
    'SELECT * FROM EQUIPO WHERE id_equipo = ? AND id_empresa = ? FOR UPDATE', [idEquipo, idEmpresa]);
  if (!equipo) throw new ErrorNegocio('Equipo no encontrado.', 404);
  if (equipo.activo) throw new ErrorNegocio('El equipo ya está activo.');
  const ocupado = await validarDisponibilidad(db, idEmpresa, equipo, idEquipo);
  if (ocupado) throw new ErrorNegocio(ocupado);
  await db.query(
    `INSERT INTO EQUIPO_HISTORIAL
       (id_empresa, id_equipo, id_unidad_principal, id_unidad_secundaria, id_chofer, desde, hasta, id_usuario)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    [idEmpresa, idEquipo, equipo.id_unidad_principal, equipo.id_unidad_secundaria, equipo.id_chofer,
     ahora(), idUsuario || null]);
  await db.query('UPDATE EQUIPO SET activo = 1, fecha_baja = NULL WHERE id_equipo = ? AND id_empresa = ?',
    [idEquipo, idEmpresa]);
}

// Para viajes y consumos: el equipo tiene que estar activo en esa fecha.
// Devuelve el mensaje de error o null.
async function validarEquipoOperable(db, idEquipo, idEmpresa, fecha) {
  if (!idEquipo) return null;
  const [[equipo]] = await db.query(
    'SELECT activo, fecha_baja FROM EQUIPO WHERE id_equipo = ? AND id_empresa = ?', [idEquipo, idEmpresa]);
  if (!equipo || equipo.activo) return null;
  const f = normalizarFecha(fecha) || (fecha ? String(fecha).slice(0, 10) + ' 00:00:00' : null);
  if (!f || f >= String(equipo.fecha_baja)) {
    return `El equipo #${idEquipo} está dado de baja desde el ${String(equipo.fecha_baja).slice(0, 10).split('-').reverse().join('/')}: ` +
      'elegí un equipo activo.';
  }
  return null;
}

// Cierra el período vigente en fechaCambio (o ahora) y abre uno con la
// composición nueva. Después recalcula la foto de los viajes posteriores.
async function registrarCambio(db, equipo, idEmpresa, idUsuario, fechaCambio) {
  const fecha = normalizarFecha(fechaCambio) || ahora();
  const vigente = await periodoVigente(db, equipo.id_equipo, idEmpresa);
  if (vigente && vigente.desde && fecha <= String(vigente.desde)) {
    throw new ErrorNegocio('La fecha del cambio debe ser posterior al inicio de la composición actual.');
  }
  if (vigente) {
    await db.query('UPDATE EQUIPO_HISTORIAL SET hasta = ? WHERE id_historial = ?', [fecha, vigente.id_historial]);
  }
  await db.query(
    `INSERT INTO EQUIPO_HISTORIAL
       (id_empresa, id_equipo, id_unidad_principal, id_unidad_secundaria, id_chofer, desde, hasta, id_usuario)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    [idEmpresa, equipo.id_equipo, equipo.id_unidad_principal, equipo.id_unidad_secundaria, equipo.id_chofer,
     vigente ? fecha : null, idUsuario || null]);
  return refotografiarViajes(db, equipo.id_equipo, idEmpresa);
}

// Recalcula la foto (chofer y unidades) de todos los viajes del equipo según
// el período que contiene su fecha de origen, y reconcilia los movimientos de
// los viajes cuyo chofer cambió (la liquidación va al chofer correcto).
// Devuelve la cantidad de viajes que cambiaron.
async function refotografiarViajes(db, idEquipo, idEmpresa) {
  const consulta = `SELECT id_viaje, id_chofer, id_unidad_principal, id_unidad_secundaria
                      FROM VIAJES WHERE id_equipo = ? AND id_empresa = ? ORDER BY id_viaje`;
  const [antes] = await db.query(consulta, [idEquipo, idEmpresa]);
  await db.query(`
    UPDATE VIAJES v
    JOIN EQUIPO_HISTORIAL h ON h.id_equipo = v.id_equipo AND h.id_empresa = v.id_empresa
     AND (h.desde IS NULL OR h.desde <= v.fecha_origen) AND (h.hasta IS NULL OR h.hasta > v.fecha_origen)
     SET v.id_chofer = h.id_chofer,
         v.id_unidad_principal = h.id_unidad_principal,
         v.id_unidad_secundaria = h.id_unidad_secundaria
   WHERE v.id_equipo = ? AND v.id_empresa = ?`, [idEquipo, idEmpresa]);
  const [despues] = await db.query(consulta, [idEquipo, idEmpresa]);

  let cambiados = 0;
  for (let i = 0; i < despues.length; i++) {
    const a = antes[i], d = despues[i];
    const cambioChofer = a.id_chofer !== d.id_chofer;
    if (cambioChofer || a.id_unidad_principal !== d.id_unidad_principal || a.id_unidad_secundaria !== d.id_unidad_secundaria) {
      cambiados++;
    }
    if (cambioChofer) await reconciliarMovimientos(db, d.id_viaje, idEmpresa);
  }
  return cambiados;
}

// Corrige la fecha en que empezó un período (y termina el anterior). Sirve
// para registrar la fecha real de un cambio cargado días después.
async function moverInicioPeriodo(db, idHistorial, idEmpresa, nuevaFecha) {
  const fecha = normalizarFecha(nuevaFecha);
  if (!fecha) throw new ErrorNegocio('La fecha no es válida.');
  if (fecha > ahora()) throw new ErrorNegocio('La fecha no puede ser futura.');

  const [[periodo]] = await db.query(
    'SELECT * FROM EQUIPO_HISTORIAL WHERE id_historial = ? AND id_empresa = ? FOR UPDATE', [idHistorial, idEmpresa]);
  if (!periodo) throw new ErrorNegocio('Período no encontrado.', 404);
  if (periodo.desde === null) throw new ErrorNegocio('El primer período empieza con el alta del equipo: no tiene fecha para mover.');
  if (periodo.hasta && fecha >= String(periodo.hasta)) {
    throw new ErrorNegocio(`La fecha debe ser anterior al fin de este período (${String(periodo.hasta).slice(0, 16)}).`);
  }
  const [[previo]] = await db.query(
    `SELECT * FROM EQUIPO_HISTORIAL WHERE id_equipo = ? AND id_empresa = ? AND hasta = ? FOR UPDATE`,
    [periodo.id_equipo, idEmpresa, periodo.desde]);
  if (previo && previo.desde && fecha <= String(previo.desde)) {
    throw new ErrorNegocio(`La fecha debe ser posterior al inicio del período anterior (${String(previo.desde).slice(0, 16)}).`);
  }

  await db.query('UPDATE EQUIPO_HISTORIAL SET desde = ? WHERE id_historial = ?', [fecha, periodo.id_historial]);
  if (previo) await db.query('UPDATE EQUIPO_HISTORIAL SET hasta = ? WHERE id_historial = ?', [fecha, previo.id_historial]);
  return refotografiarViajes(db, periodo.id_equipo, idEmpresa);
}

// Períodos de un equipo, del más reciente al más antiguo, con las patentes,
// el chofer y cuántos viajes se hicieron en cada uno.
async function listarHistorial(db, idEquipo, idEmpresa) {
  const [filas] = await db.query(`
    SELECT h.id_historial, h.desde, h.hasta, h.fecha_registro,
           h.id_unidad_principal, up.patente AS patente_principal, up.modelo AS modelo_principal,
           h.id_unidad_secundaria, us.patente AS patente_secundaria,
           h.id_chofer, ch.nombre AS chofer, u.nombre_usuario AS registrado_por,
           (SELECT COUNT(*) FROM VIAJES v
             WHERE v.id_equipo = h.id_equipo AND v.id_empresa = h.id_empresa
               AND (h.desde IS NULL OR v.fecha_origen >= h.desde)
               AND (h.hasta IS NULL OR v.fecha_origen < h.hasta)) AS viajes
      FROM EQUIPO_HISTORIAL h
      JOIN UNIDADES up ON up.id_unidad = h.id_unidad_principal
      JOIN UNIDADES us ON us.id_unidad = h.id_unidad_secundaria
      JOIN CHOFERES ch ON ch.id_chofer = h.id_chofer
      LEFT JOIN USUARIOS u ON u.id_usuario = h.id_usuario
     WHERE h.id_equipo = ? AND h.id_empresa = ?
     ORDER BY (h.desde IS NULL), h.desde DESC`, [idEquipo, idEmpresa]);
  return filas;
}

module.exports = {
  cambioComposicion,
  validarFechaCambio,
  validarDisponibilidad,
  validarEquipoOperable,
  darDeBaja,
  reactivar,
  registrarAlta,
  registrarCambio,
  refotografiarViajes,
  moverInicioPeriodo,
  listarHistorial
};
