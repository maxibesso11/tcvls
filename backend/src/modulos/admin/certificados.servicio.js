// backend/src/modulos/admin/certificados.servicio.js
// Lógica de certificados de facturación electrónica (ARCA), compartida entre
// el ADMIN de plataforma (cualquier empresa) y el ADMIN_EMPRESA (la suya).
// La clave privada se guarda cifrada y nunca se devuelve por la API.
const pool = require('../../config/db');
const cifrado = require('../../lib/seguridad/cifrado');
const certs = require('../../integraciones/certificados');
const { ErrorNegocio } = require('../../lib/errores');

// Estado del certificado de una empresa (sin exponer clave ni CSR completo).
async function estado(idEmpresa) {
  const [[cert]] = await pool.query(
    `SELECT id_certificado, estado, alias, fecha_generacion, fecha_vencimiento,
            (certificado_pem IS NOT NULL) AS tiene_certificado
       FROM CERTIFICADOS_ARCA WHERE id_empresa = ?
       ORDER BY id_certificado DESC LIMIT 1`,
    [idEmpresa]
  );
  return {
    existe: !!cert,
    certificado: cert || null,
    node_forge_disponible: certs.disponible(),
    secreto_inseguro: cifrado.secretoInseguro()
  };
}

// Genera el par de claves y el CSR. Reemplaza cualquier certificado previo de
// la empresa (para regenerar si hiciera falta).
async function generar(idEmpresa) {
  if (!certs.disponible()) {
    throw new ErrorNegocio('Falta la dependencia node-forge en el servidor. Instalá con: npm install node-forge', 503);
  }
  const [[empresa]] = await pool.query('SELECT nombre, cuit FROM EMPRESAS WHERE id_empresa = ?', [idEmpresa]);
  if (!empresa) throw new ErrorNegocio('Empresa no encontrada.', 404);

  const { clavePrivadaPem, csrPem } = certs.generarClaveYCSR(empresa);
  const claveCifrada = cifrado.cifrar(clavePrivadaPem);
  const alias = `tcv-${String(empresa.cuit || '').replace(/\D/g, '')}`.slice(0, 50);

  await pool.query('DELETE FROM CERTIFICADOS_ARCA WHERE id_empresa = ?', [idEmpresa]);
  await pool.query(
    `INSERT INTO CERTIFICADOS_ARCA (id_empresa, estado, alias, clave_privada_cifrada, csr_pem)
     VALUES (?, 'CSR_GENERADO', ?, ?, ?)`,
    [idEmpresa, alias, claveCifrada, csrPem]
  );
  return { ok: true, alias, mensaje: 'Clave y solicitud (CSR) generadas. Descargá el CSR y subilo a ARCA.' };
}

// Datos para descargar el CSR en texto (nombre de archivo y contenido).
async function obtenerCsr(idEmpresa) {
  const [[cert]] = await pool.query(
    'SELECT csr_pem, alias FROM CERTIFICADOS_ARCA WHERE id_empresa = ? ORDER BY id_certificado DESC LIMIT 1',
    [idEmpresa]);
  if (!cert || !cert.csr_pem) throw new ErrorNegocio('No hay un CSR generado para esta empresa.', 404);
  return cert;
}

// Sube el certificado (.crt) que devuelve ARCA. Valida que sea un certificado
// real y que corresponda a la clave privada generada.
async function subirCertificado(idEmpresa, pemCrudo) {
  const pem = (pemCrudo || '').trim();
  if (!pem) throw new ErrorNegocio('Pegá o subí el certificado (.crt) devuelto por ARCA.');

  const [[cert]] = await pool.query(
    'SELECT id_certificado, clave_privada_cifrada FROM CERTIFICADOS_ARCA WHERE id_empresa = ? ORDER BY id_certificado DESC LIMIT 1',
    [idEmpresa]);
  if (!cert) throw new ErrorNegocio('Primero generá la clave y el CSR para esta empresa.');

  const analisis = certs.analizarCertificado(pem);
  if (!analisis.valido) throw new ErrorNegocio(analisis.error);

  const clavePrivada = cifrado.descifrar(cert.clave_privada_cifrada);
  if (!certs.certificadoCoincideConClave(pem, clavePrivada)) {
    throw new ErrorNegocio('El certificado no corresponde a la clave generada. Verificá que sea el .crt descargado de ARCA para este CSR.');
  }

  const vence = analisis.fecha_vencimiento;
  const fechaVenc = vence ? new Date(vence).toISOString().slice(0, 10) : null;
  await pool.query(
    `UPDATE CERTIFICADOS_ARCA SET certificado_pem = ?, estado = 'ACTIVO', fecha_vencimiento = ?
      WHERE id_certificado = ?`,
    [pem, fechaVenc, cert.id_certificado]);
  return { ok: true, fecha_vencimiento: fechaVenc, mensaje: 'Certificado cargado. La facturación electrónica quedó habilitada.' };
}

// Elimina el certificado de la empresa (para regenerar desde cero).
async function eliminar(idEmpresa) {
  await pool.query('DELETE FROM CERTIFICADOS_ARCA WHERE id_empresa = ?', [idEmpresa]);
  return { ok: true };
}

module.exports = { estado, generar, obtenerCsr, subirCertificado, eliminar };
