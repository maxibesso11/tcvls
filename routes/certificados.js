// routes/certificados.js
// Gestión de certificados de facturación electrónica (ARCA) por empresa.
// Solo accesible por ADMIN. La clave privada se genera y guarda cifrada en el
// servidor; nunca se devuelve por la API. Flujo:
//   POST /:idEmpresa/generar   → genera clave + CSR (guarda clave cifrada)
//   GET  /:idEmpresa/csr       → descarga el CSR para subir a ARCA
//   POST /:idEmpresa/certificado → sube el .crt devuelto por ARCA
//   GET  /:idEmpresa           → estado del certificado (sin datos sensibles)
//   DELETE /:idEmpresa         → elimina el certificado (para regenerar)
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requiereAutenticacion, requiereAdmin } = require('./middleware/autenticacion');
const cifrado = require('../config/cifrado');
const certs = require('../config/certificados');

router.use(requiereAutenticacion, requiereAdmin);

// Estado del certificado de una empresa (sin exponer clave ni CSR completo).
router.get('/:idEmpresa', async (req, res) => {
  try {
    const [[cert]] = await pool.query(
      `SELECT id_certificado, estado, alias, fecha_generacion, fecha_vencimiento,
              (certificado_pem IS NOT NULL) AS tiene_certificado
         FROM CERTIFICADOS_ARCA WHERE id_empresa = ?
         ORDER BY id_certificado DESC LIMIT 1`,
      [req.params.idEmpresa]
    );
    res.json({
      existe: !!cert,
      certificado: cert || null,
      node_forge_disponible: certs.disponible(),
      secreto_inseguro: cifrado.secretoInseguro()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Genera el par de claves y el CSR. Reemplaza cualquier certificado previo de
// la empresa (para regenerar si hiciera falta).
router.post('/:idEmpresa/generar', async (req, res) => {
  try {
    if (!certs.disponible()) {
      return res.status(503).json({ error: 'Falta la dependencia node-forge en el servidor. Instalá con: npm install node-forge' });
    }
    const [[empresa]] = await pool.query(
      'SELECT nombre, cuit FROM EMPRESAS WHERE id_empresa = ?', [req.params.idEmpresa]);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada.' });

    const { clavePrivadaPem, csrPem } = certs.generarClaveYCSR(empresa);
    const claveCifrada = cifrado.cifrar(clavePrivadaPem);
    const alias = `tcv-${String(empresa.cuit || '').replace(/\D/g, '')}`.slice(0, 50);

    // Borrar cualquier certificado anterior de la empresa y crear el nuevo.
    await pool.query('DELETE FROM CERTIFICADOS_ARCA WHERE id_empresa = ?', [req.params.idEmpresa]);
    await pool.query(
      `INSERT INTO CERTIFICADOS_ARCA (id_empresa, estado, alias, clave_privada_cifrada, csr_pem)
       VALUES (?, 'CSR_GENERADO', ?, ?, ?)`,
      [req.params.idEmpresa, alias, claveCifrada, csrPem]
    );
    res.json({ ok: true, alias, mensaje: 'Clave y solicitud (CSR) generadas. Descargá el CSR y subilo a ARCA.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Descarga el CSR en texto para subirlo a ARCA.
router.get('/:idEmpresa/csr', async (req, res) => {
  try {
    const [[cert]] = await pool.query(
      'SELECT csr_pem, alias FROM CERTIFICADOS_ARCA WHERE id_empresa = ? ORDER BY id_certificado DESC LIMIT 1',
      [req.params.idEmpresa]);
    if (!cert || !cert.csr_pem) return res.status(404).json({ error: 'No hay un CSR generado para esta empresa.' });
    res.setHeader('Content-Type', 'application/x-pem-file');
    res.setHeader('Content-Disposition', `attachment; filename="${cert.alias || 'solicitud'}.csr"`);
    res.send(cert.csr_pem);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sube el certificado (.crt) que devuelve ARCA. Valida que sea un certificado
// real y que corresponda a la clave privada generada.
router.post('/:idEmpresa/certificado', async (req, res) => {
  try {
    const pem = (req.body.certificado_pem || '').trim();
    if (!pem) return res.status(400).json({ error: 'Pegá o subí el certificado (.crt) devuelto por ARCA.' });

    const [[cert]] = await pool.query(
      'SELECT id_certificado, clave_privada_cifrada FROM CERTIFICADOS_ARCA WHERE id_empresa = ? ORDER BY id_certificado DESC LIMIT 1',
      [req.params.idEmpresa]);
    if (!cert) return res.status(400).json({ error: 'Primero generá la clave y el CSR para esta empresa.' });

    const analisis = certs.analizarCertificado(pem);
    if (!analisis.valido) return res.status(400).json({ error: analisis.error });

    // Verificar que el certificado corresponda a la clave privada generada.
    const clavePrivada = cifrado.descifrar(cert.clave_privada_cifrada);
    if (!certs.certificadoCoincideConClave(pem, clavePrivada)) {
      return res.status(400).json({ error: 'El certificado no corresponde a la clave generada. Verificá que sea el .crt descargado de ARCA para este CSR.' });
    }

    const vence = analisis.fecha_vencimiento;
    const fechaVenc = vence ? new Date(vence).toISOString().slice(0, 10) : null;
    await pool.query(
      `UPDATE CERTIFICADOS_ARCA SET certificado_pem = ?, estado = 'ACTIVO', fecha_vencimiento = ?
        WHERE id_certificado = ?`,
      [pem, fechaVenc, cert.id_certificado]);
    res.json({ ok: true, fecha_vencimiento: fechaVenc, mensaje: 'Certificado cargado. La facturación electrónica quedó habilitada.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Elimina el certificado de la empresa (para regenerar desde cero).
router.delete('/:idEmpresa', async (req, res) => {
  try {
    await pool.query('DELETE FROM CERTIFICADOS_ARCA WHERE id_empresa = ?', [req.params.idEmpresa]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
