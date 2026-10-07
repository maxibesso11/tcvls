// backend/src/modulos/admin/certificados.rutas.js
// Gestión de certificados de facturación electrónica (ARCA) por empresa.
// Solo accesible por ADMIN. La lógica vive en certificados.servicio.js,
// compartida con modulos/empresa/empresa.rutas.js (ADMIN_EMPRESA, su propia
// empresa). La clave privada se genera y guarda cifrada en el servidor;
// nunca se devuelve por la API. Flujo:
//   POST /:idEmpresa/generar   → genera clave + CSR (guarda clave cifrada)
//   GET  /:idEmpresa/csr       → descarga el CSR para subir a ARCA
//   POST /:idEmpresa/certificado → sube el .crt devuelto por ARCA
//   GET  /:idEmpresa           → estado del certificado (sin datos sensibles)
//   DELETE /:idEmpresa         → elimina el certificado (para regenerar)
const express = require('express');
const router = express.Router();
const { requiereAutenticacion, requiereAdmin } = require('../../middleware/autenticacion');
const certificadosServicio = require('./certificados.servicio');
const { responderError } = require('../../lib/errores');

router.use(requiereAutenticacion, requiereAdmin);

router.get('/:idEmpresa', async (req, res) => {
  try {
    res.json(await certificadosServicio.estado(req.params.idEmpresa));
  } catch (err) {
    responderError(res, err, req);
  }
});

router.post('/:idEmpresa/generar', async (req, res) => {
  try {
    res.json(await certificadosServicio.generar(req.params.idEmpresa));
  } catch (err) {
    responderError(res, err, req);
  }
});

router.get('/:idEmpresa/csr', async (req, res) => {
  try {
    const cert = await certificadosServicio.obtenerCsr(req.params.idEmpresa);
    res.setHeader('Content-Type', 'application/x-pem-file');
    res.setHeader('Content-Disposition', `attachment; filename="${cert.alias || 'solicitud'}.csr"`);
    res.send(cert.csr_pem);
  } catch (err) {
    responderError(res, err, req);
  }
});

router.post('/:idEmpresa/certificado', async (req, res) => {
  try {
    res.json(await certificadosServicio.subirCertificado(req.params.idEmpresa, req.body.certificado_pem));
  } catch (err) {
    responderError(res, err, req);
  }
});

router.delete('/:idEmpresa', async (req, res) => {
  try {
    res.json(await certificadosServicio.eliminar(req.params.idEmpresa));
  } catch (err) {
    responderError(res, err, req);
  }
});

module.exports = router;
