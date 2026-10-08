// backend/src/modulos/facturacion/facturacion.rutas.js
// API de facturación electrónica (comprobantes A, B o C según la condición
// frente al IVA de la empresa y del cliente):
//   GET    /configuracion                 datos fiscales y si se puede emitir
//   GET    /                              comprobantes (filtros: estado, id_cuenta)
//   GET    /cuentas                       clientes y pagadores, con viajes pendientes
//   GET    /viajes-facturables?id_cuenta  viajes finalizados de un cliente sin comprobante
//   POST   /preparar                      propuesta del facturador para un cliente y sus viajes
//   POST   /                              guardar un borrador nuevo
//   GET    /:id                           comprobante con renglones y viajes
//   PUT    /:id                           modificar un borrador
//   DELETE /:id                           eliminar un borrador
//   POST   /:id/emitir                    pedir el CAE a ARCA
//   POST   /:id/verificar                 aclarar con ARCA un comprobante PENDIENTE
//   POST   /:id/nota-credito              anular un comprobante emitido
//   GET    /:id/pdf                       PDF del comprobante (con QR de ARCA)
//   PUT    /plantillas/:idCuenta          plantillas de texto del cliente
//
// La lógica está en facturacion.servicio.js y el PDF en facturacion.pdf.js.
const express = require('express');
const pool = require('../../config/db');
const { calcularPaginacion } = require('../../lib/paginacion');
const { responderError, ErrorNegocio } = require('../../lib/errores');
const servicio = require('./facturacion.servicio');
const { enviarFacturaPDF } = require('./facturacion.pdf');

const router = express.Router();
const emp = req => req.usuario.id_empresa;
const id = req => Number(req.params.id);

// Los errores de comunicación con ARCA llegan con un mensaje para el usuario.
const manejar = fn => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err && err.name === 'ErrorArca') return responderError(res, new ErrorNegocio(err.message, 502), req);
    responderError(res, err, req);
  }
};

router.get('/configuracion', manejar(async (req, res) => {
  const c = await servicio.configuracion(emp(req));
  res.json({
    entorno: c.entorno, condicion_iva: c.condicion, letras: c.letras, lista: c.lista, faltantes: c.faltantes,
    punto_venta: c.empresa.punto_venta
  });
}));

router.get('/', manejar(async (req, res) => {
  const idEmpresa = emp(req);
  const filtros = ['f.id_empresa = ?'];
  const valores = [idEmpresa];
  if (req.query.estado) { filtros.push('f.estado = ?'); valores.push(String(req.query.estado)); }
  if (req.query.id_cuenta) { filtros.push('f.id_cuenta = ?'); valores.push(Number(req.query.id_cuenta)); }
  const donde = filtros.join(' AND ');
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM FACTURAS f WHERE ${donde}`, valores);
  const { pagina, porPagina, totalPaginas, offset } = calcularPaginacion(req.query, total);
  const [filas] = await pool.query(
    `SELECT f.id_factura, f.clase, f.tipo_comprobante, f.punto_venta, f.numero, f.fecha_emision, f.entorno,
            f.id_cuenta, f.receptor_nombre, f.receptor_cuit, f.id_factura_asociada,
            f.neto_gravado, f.iva, f.total, f.cae, f.estado,
            (SELECT COUNT(*) FROM FACTURA_VIAJES fv WHERE fv.id_factura = f.id_factura) AS cantidad_viajes
       FROM FACTURAS f
      WHERE ${donde}
      ORDER BY FIELD(f.estado, 'PENDIENTE', 'BORRADOR') DESC, f.id_factura DESC LIMIT ? OFFSET ?`,
    [...valores, porPagina, offset]);
  res.json({ datos: filas, paginacion: { pagina, por_pagina: porPagina, total, total_paginas: totalPaginas } });
}));

router.get('/cuentas', manejar(async (req, res) => {
  res.json(await servicio.cuentasFacturables(emp(req)));
}));

router.get('/viajes-facturables', manejar(async (req, res) => {
  if (!req.query.id_cuenta) throw new ErrorNegocio('Elegí el cliente.');
  const filas = await servicio.viajesFacturables(emp(req), Number(req.query.id_cuenta),
    { incluirFactura: Number(req.query.id_factura) || null });
  res.json(filas.map(v => ({
    id_viaje: v.id_viaje, fecha_origen: v.fecha_origen, origen: v.origen, destino: v.destino,
    numero_remito: v.numero_remito, tipo_carga: v.tipo_carga, tipo_tarifa: v.tipo_tarifa, tarifa: v.tarifa,
    resultado: v.resultado, cantidad_cargada: v.cantidad_cargada, comision: v.comision,
    patente_principal: v.patente_principal, chofer: v.chofer
  })));
}));

router.post('/preparar', manejar(async (req, res) => {
  const { id_cuenta, viajes } = req.body || {};
  if (!id_cuenta) throw new ErrorNegocio('Elegí el cliente.');
  res.json(await servicio.preparar(emp(req), { id_cuenta: Number(id_cuenta), viajes: Array.isArray(viajes) ? viajes : [] }));
}));

router.put('/plantillas/:idCuenta(\\d+)', manejar(async (req, res) => {
  await servicio.guardarPlantillas(emp(req), Number(req.params.idCuenta), req.body || {});
  res.json({ ok: true });
}));

router.post('/', manejar(async (req, res) => {
  const idFactura = await servicio.guardarBorrador(emp(req), req.body || {});
  res.status(201).json(await servicio.obtener(emp(req), idFactura));
}));

router.get('/:id(\\d+)', manejar(async (req, res) => {
  res.json(await servicio.obtener(emp(req), id(req)));
}));

router.put('/:id(\\d+)', manejar(async (req, res) => {
  await servicio.guardarBorrador(emp(req), req.body || {}, id(req));
  res.json(await servicio.obtener(emp(req), id(req)));
}));

router.delete('/:id(\\d+)', manejar(async (req, res) => {
  await servicio.eliminarBorrador(emp(req), id(req));
  res.json({ ok: true });
}));

router.post('/:id(\\d+)/emitir', manejar(async (req, res) => {
  res.json(await servicio.emitir(emp(req), id(req)));
}));

router.post('/:id(\\d+)/verificar', manejar(async (req, res) => {
  res.json(await servicio.verificar(emp(req), id(req)));
}));

router.post('/:id(\\d+)/nota-credito', manejar(async (req, res) => {
  const nc = await servicio.anularConNotaCredito(emp(req), id(req), { observaciones: req.body && req.body.observaciones });
  res.status(201).json(nc);
}));

router.get('/:id(\\d+)/pdf', manejar(async (req, res) => {
  const idEmpresa = emp(req);
  const factura = await servicio.obtener(idEmpresa, id(req));
  if (factura.estado !== 'EMITIDA' && factura.estado !== 'ANULADA') {
    throw new ErrorNegocio('El comprobante todavía no fue emitido: no tiene CAE.');
  }
  const [[empresa]] = await pool.query('SELECT * FROM EMPRESAS WHERE id_empresa = ?', [idEmpresa]);
  await enviarFacturaPDF(res, empresa, factura);
}));

module.exports = router;
