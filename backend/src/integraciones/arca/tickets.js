// backend/src/integraciones/arca/tickets.js
// Tickets de acceso (TA) de ARCA: se piden UNA vez y se reutilizan hasta que
// vencen (≈12 h). Pedir uno nuevo mientras hay otro vigente hace que ARCA
// rechace el acceso hasta que el anterior venza, así que:
//   1. Se busca un TA vigente en la base (ARCA_TICKETS) y se usa ese.
//   2. Si no hay, se toma un candado de MySQL por certificado+servicio para
//      que dos pedidos simultáneos no pidan dos TA, se vuelve a mirar la base
//      y recién entonces se pide al WSAA.
//   3. El TA se guarda (cifrado) apenas llega, antes de usarlo.
// Un TA se identifica por el CUIT, el entorno, el servicio y la huella del
// certificado: si la empresa cambia de certificado, se pide uno nuevo.
const pool = require('../../config/db');
const cifrado = require('../../lib/seguridad/cifrado');
const { pedirTicket, huellaCertificado } = require('./wsaa');
const { ErrorArca } = require('./soap');

// Margen antes del vencimiento a partir del cual el TA ya no se usa.
const MARGEN_MS = 5 * 60 * 1000;

function fechaMysql(d) {
  return new Date(d).toISOString().slice(0, 19).replace('T', ' ');
}

async function buscarVigente(conexion, clave) {
  const [[fila]] = await conexion.query(
    `SELECT token_cifrado, sign_cifrado, expira FROM ARCA_TICKETS
      WHERE cuit = ? AND entorno = ? AND servicio = ? AND huella_certificado = ?
        AND expira > ?`,
    [clave.cuit, clave.entorno, clave.servicio, clave.huella, fechaMysql(Date.now() + MARGEN_MS)]);
  if (!fila) return null;
  return {
    token: cifrado.descifrar(fila.token_cifrado),
    sign: cifrado.descifrar(fila.sign_cifrado),
    expira: fila.expira
  };
}

// Devuelve { token, sign } para el servicio pedido, reutilizando el vigente.
// Las fechas de ARCA_TICKETS se guardan en UTC.
async function obtenerTicket({ cuit, entorno, servicio = 'wsfe', certificadoPem, clavePrivadaPem }) {
  const clave = { cuit: String(cuit), entorno, servicio, huella: huellaCertificado(certificadoPem) };
  const conexion = await pool.getConnection();
  const candado = `tcv_arca_${clave.cuit}_${entorno}_${servicio}`.slice(0, 64);
  let tomado = false;
  try {
    // dateStrings del pool: las fechas vuelven como texto; se comparan en SQL.
    const vigente = await buscarVigente(conexion, clave);
    if (vigente) return vigente;

    const [[r]] = await conexion.query('SELECT GET_LOCK(?, 60) AS ok', [candado]);
    tomado = Number(r.ok) === 1;
    if (!tomado) throw new ErrorArca('Otro proceso está pidiendo el acceso a ARCA. Probá de nuevo en un minuto.');

    // Otro pedido pudo haberlo obtenido mientras esperábamos el candado.
    const recien = await buscarVigente(conexion, clave);
    if (recien) return recien;

    let ta;
    try {
      ta = await pedirTicket({ servicio, certificadoPem, clavePrivadaPem, entorno });
    } catch (err) {
      if (err.yaTieneTicket) {
        throw new ErrorArca('ARCA indica que este certificado ya tiene un acceso vigente que el sistema no tiene guardado ' +
          '(por ejemplo, porque se usó el mismo certificado en otro sistema). Hay que esperar a que venza: hasta 12 horas. ' +
          'Mientras tanto no se pueden emitir comprobantes con este certificado.', { codigo: 'TA_VIGENTE_EXTERNO' });
      }
      throw err;
    }

    // Guardarlo YA: si se pierde, ARCA no entrega otro hasta que venza.
    await conexion.query(
      `INSERT INTO ARCA_TICKETS (cuit, entorno, servicio, huella_certificado, token_cifrado, sign_cifrado, generado, expira)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE token_cifrado = VALUES(token_cifrado), sign_cifrado = VALUES(sign_cifrado),
                               generado = VALUES(generado), expira = VALUES(expira)`,
      [clave.cuit, entorno, servicio, clave.huella, cifrado.cifrar(ta.token), cifrado.cifrar(ta.sign),
       fechaMysql(ta.generado), fechaMysql(ta.expira)]);
    return { token: ta.token, sign: ta.sign, expira: fechaMysql(ta.expira) };
  } finally {
    if (tomado) { try { await conexion.query('SELECT RELEASE_LOCK(?)', [candado]); } catch (e) { /* se libera al cerrar */ } }
    conexion.release();
  }
}

// Estado del TA de un certificado (para el diagnóstico), sin exponerlo.
async function estadoTicket({ cuit, entorno, servicio = 'wsfe', certificadoPem }) {
  const [[fila]] = await pool.query(
    `SELECT generado, expira FROM ARCA_TICKETS
      WHERE cuit = ? AND entorno = ? AND servicio = ? AND huella_certificado = ?`,
    [String(cuit), entorno, servicio, huellaCertificado(certificadoPem)]);
  return fila || null;
}

module.exports = { obtenerTicket, estadoTicket };
