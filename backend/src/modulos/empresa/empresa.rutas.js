// backend/src/modulos/empresa/empresa.rutas.js
// Panel de "Mi empresa" para el rol ADMIN_EMPRESA: usuarios, certificado ARCA
// y datos fiscales de su propia empresa. La empresa siempre sale del token
// (req.usuario.id_empresa vía alcanceEmpresaPropia), nunca de la URL ni del
// cuerpo del pedido, así que estas rutas no llevan :idEmpresa.
// Comparte la lógica de negocio con modulos/admin/ (usuarios.servicio.js y
// certificados.servicio.js), parametrizada por alcance.
const express = require('express');
const router = express.Router();
const pool = require('../../config/db');
const { requiereAutenticacion, requiereRol, alcanceEmpresaPropia } = require('../../middleware/autenticacion');
const usuariosServicio = require('../admin/usuarios.servicio');
const certificadosServicio = require('../admin/certificados.servicio');
const { responderError, ErrorNegocio } = require('../../lib/errores');

router.use(requiereAutenticacion, requiereRol('ADMIN_EMPRESA'), alcanceEmpresaPropia);

function alcance(req) {
  return { idEmpresa: req.idEmpresaObjetivo };
}

// ==================== BITÁCORA ====================

// Actividad de la empresa con la que se está operando
router.get('/auditoria', async (req, res) => {
  try {
    res.json(await require('../../lib/auditoria').listar({ idEmpresa: req.idEmpresaObjetivo, query: req.query }));
  } catch (err) {
    responderError(res, err, req);
  }
});

// ==================== USUARIOS ====================

router.get('/usuarios', async (req, res) => {
  try {
    res.json(await usuariosServicio.listar(alcance(req)));
  } catch (err) {
    responderError(res, err, req);
  }
});

router.post('/usuarios', async (req, res) => {
  try {
    res.status(201).json(await usuariosServicio.crear(req.body, alcance(req)));
  } catch (err) {
    responderError(res, err, req);
  }
});

router.put('/usuarios/:id', async (req, res) => {
  try {
    res.json(await usuariosServicio.actualizar(req.params.id, req.body, alcance(req), req.usuario));
  } catch (err) {
    responderError(res, err, req);
  }
});

router.delete('/usuarios/:id', async (req, res) => {
  try {
    res.json(await usuariosServicio.eliminar(req.params.id, alcance(req), req.usuario));
  } catch (err) {
    responderError(res, err, req);
  }
});

// ==================== CERTIFICADO ARCA ====================

router.get('/certificado', async (req, res) => {
  try {
    res.json(await certificadosServicio.estado(req.idEmpresaObjetivo));
  } catch (err) {
    responderError(res, err, req);
  }
});

router.post('/certificado/generar', async (req, res) => {
  try {
    res.json(await certificadosServicio.generar(req.idEmpresaObjetivo));
  } catch (err) {
    responderError(res, err, req);
  }
});

router.get('/certificado/csr', async (req, res) => {
  try {
    const cert = await certificadosServicio.obtenerCsr(req.idEmpresaObjetivo);
    res.setHeader('Content-Type', 'application/x-pem-file');
    res.setHeader('Content-Disposition', `attachment; filename="${cert.alias || 'solicitud'}.csr"`);
    res.send(cert.csr_pem);
  } catch (err) {
    responderError(res, err, req);
  }
});

router.post('/certificado', async (req, res) => {
  try {
    res.json(await certificadosServicio.subirCertificado(req.idEmpresaObjetivo, req.body.certificado_pem));
  } catch (err) {
    responderError(res, err, req);
  }
});

router.delete('/certificado', async (req, res) => {
  try {
    res.json(await certificadosServicio.eliminar(req.idEmpresaObjetivo));
  } catch (err) {
    responderError(res, err, req);
  }
});

// ==================== DATOS FISCALES ====================
// Nombre, CUIT y estado activa/inactiva son solo del ADMIN de plataforma
// (ver admin.rutas.js); acá solo lo que hace falta para facturar.

router.get('/datos-fiscales', async (req, res) => {
  try {
    const [[empresa]] = await pool.query(
      `SELECT id_empresa, nombre, cuit, telefono, domicilio, email, condicion_iva, ingresos_brutos, inicio_actividades, punto_venta
         FROM EMPRESAS WHERE id_empresa = ?`,
      [req.idEmpresaObjetivo]
    );
    if (!empresa) throw new ErrorNegocio('Empresa no encontrada.', 404);
    res.json(empresa);
  } catch (err) {
    responderError(res, err, req);
  }
});

router.put('/datos-fiscales', async (req, res) => {
  try {
    const { telefono, domicilio, email, condicion_iva, ingresos_brutos, inicio_actividades, punto_venta } = req.body;
    const data = {};
    if (telefono !== undefined) data.telefono = telefono || null;
    if (domicilio !== undefined) data.domicilio = domicilio || null;
    if (email !== undefined) data.email = email || null;
    if (condicion_iva !== undefined) data.condicion_iva = condicion_iva || null;
    if (ingresos_brutos !== undefined) data.ingresos_brutos = ingresos_brutos || null;
    if (inicio_actividades !== undefined) data.inicio_actividades = inicio_actividades || null;
    if (punto_venta !== undefined) data.punto_venta = parseInt(punto_venta, 10) || 1;
    await pool.query('UPDATE EMPRESAS SET ? WHERE id_empresa = ?', [data, req.idEmpresaObjetivo]);
    res.json({ id_empresa: req.idEmpresaObjetivo, ...data });
  } catch (err) {
    responderError(res, err, req);
  }
});

module.exports = router;
