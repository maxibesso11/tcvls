// backend/src/modulos/facturacion/facturacion.rutas.js
// API de facturación (Factura A). Permite:
//   - Listar las facturas emitidas (paginado).
//   - Facturar un viaje al CUIT del pagador (cuenta CLIENTE).
//   - Emitir una factura manual asociada a una cuenta, con ítems libres.
//   - Emitir una nota de crédito que anula una factura.
//   - Descargar el PDF de una factura.
//
// La lógica (numeración, importes, CAE, imputación) está en
// facturacion.servicio.js y el dibujo del PDF en facturacion.pdf.js.
const express = require('express');
const pool = require('../../config/db');
const { calcularPaginacion } = require('../../lib/paginacion');
const { crearFactura, facturarViaje, emitirNotaCredito, importeFacturableDeViaje, r2 } = require('./facturacion.servicio');
const { enviarFacturaPDF } = require('./facturacion.pdf');

const router = express.Router();
const emp = req => req.usuario.id_empresa;

// --------------------------------------------------------------
// Listado paginado de facturas
// --------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const idEmpresa = emp(req);
    const [[{ total }]] = await pool.query(
      'SELECT COUNT(*) AS total FROM FACTURAS WHERE id_empresa = ?', [idEmpresa]);
    const { pagina, porPagina, totalPaginas, offset } = calcularPaginacion(req.query, total);

    const [filas] = await pool.query(
      `SELECT f.id_factura, f.clase, f.tipo_comprobante, f.punto_venta, f.numero, f.fecha_emision,
              f.receptor_nombre, f.receptor_cuit, f.id_viaje, f.id_factura_asociada,
              f.neto_gravado, f.iva, f.total, f.cae, f.estado
         FROM FACTURAS f
        WHERE f.id_empresa = ?
        ORDER BY f.id_factura DESC LIMIT ? OFFSET ?`,
      [idEmpresa, porPagina, offset]
    );
    res.json({ datos: filas, paginacion: { pagina, por_pagina: porPagina, total, total_paginas: totalPaginas } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------------------------
// Viajes facturables (FINALIZADO o FACTURADO, con pagador que tenga cuenta)
// --------------------------------------------------------------
router.get('/viajes-facturables', async (req, res) => {
  try {
    const idEmpresa = emp(req);
    const [filas] = await pool.query(
      `SELECT v.id_viaje, v.fecha_origen, v.origen, v.destino, v.numero_remito,
              v.tarifa, v.tipo_tarifa, v.resultado, v.cantidad_cargada, v.comision, v.pagador,
              c.id_cuenta, c.cuil AS pagador_cuit
         FROM VIAJES v
         JOIN CUENTA c ON c.nombre = v.pagador AND c.id_empresa = v.id_empresa AND c.tipo = 'CLIENTE'
    LEFT JOIN FACTURAS f ON f.id_viaje = v.id_viaje
        WHERE v.id_empresa = ? AND v.estado IN ('FINALIZADO','FACTURADO') AND f.id_factura IS NULL
        ORDER BY v.fecha_origen DESC LIMIT 200`,
      [idEmpresa]
    );
    // Calcular el neto (base − comisión) de cada viaje
    const conNeto = filas.map(v => {
      const { base, neto } = importeFacturableDeViaje(v);
      return { ...v, base: r2(base), neto };
    });
    res.json(conNeto);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------------------------
// Facturar un viaje (al CUIT del pagador)
// --------------------------------------------------------------
router.post('/desde-viaje/:idViaje', async (req, res) => {
  try {
    const idEmpresa = emp(req);
    const [[viaje]] = await pool.query(
      'SELECT * FROM VIAJES WHERE id_viaje = ? AND id_empresa = ?', [req.params.idViaje, idEmpresa]);
    if (!viaje) return res.status(404).json({ error: 'Viaje no encontrado.' });
    if (!viaje.pagador) return res.status(400).json({ error: 'El viaje no tiene un pagador asignado.' });
    if (viaje.estado !== 'FINALIZADO' && viaje.estado !== 'FACTURADO') {
      return res.status(400).json({ error: 'Solo se pueden facturar viajes finalizados.' });
    }

    // Buscar la cuenta CLIENTE del pagador
    const [[cuenta]] = await pool.query(
      `SELECT id_cuenta FROM CUENTA WHERE nombre = ? AND id_empresa = ? AND tipo = 'CLIENTE' LIMIT 1`,
      [viaje.pagador, idEmpresa]);
    if (!cuenta) return res.status(400).json({ error: 'El pagador del viaje no está registrado como cuenta de cliente.' });

    // Verificar que no esté ya facturado
    const [[existe]] = await pool.query(
      'SELECT id_factura FROM FACTURAS WHERE id_viaje = ? AND id_empresa = ?', [viaje.id_viaje, idEmpresa]);
    if (existe) return res.status(409).json({ error: 'Este viaje ya tiene una factura emitida.' });

    // Importe: base (tarifa × resultado, o tarifa si UNICA) menos comisión
    const { neto } = importeFacturableDeViaje(viaje);

    const descripcion = `Flete ${viaje.origen} a ${viaje.destino}` +
      (viaje.numero_remito ? ` — Remito ${viaje.numero_remito}` : '') +
      (viaje.tipo_carga ? ` (${viaje.tipo_carga})` : '');

    // Factura, viaje FACTURADO y débito en la cuenta del cliente, en una
    // sola transacción (ver facturarViaje en facturacion.servicio.js).
    const idFactura = await facturarViaje(idEmpresa, {
      id_cuenta: cuenta.id_cuenta,
      id_viaje: viaje.id_viaje,
      items: [{ descripcion, cantidad: 1, precio_unitario: neto }],
      observaciones: ''
    });

    res.status(201).json({ id_factura: idFactura });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------------------------
// Emitir una factura manual asociada a una cuenta
// --------------------------------------------------------------
router.post('/manual', async (req, res) => {
  try {
    const idEmpresa = emp(req);
    const { id_cuenta, items, observaciones } = req.body;
    if (!id_cuenta) return res.status(400).json({ error: 'Debés seleccionar una cuenta.' });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Agregá al menos un ítem a la factura.' });
    }
    const idFactura = await crearFactura(idEmpresa, { id_cuenta, items, observaciones });
    res.status(201).json({ id_factura: idFactura });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------------------------
// Nota de crédito sobre una factura existente (anula la factura)
// --------------------------------------------------------------
router.post('/:id/nota-credito', async (req, res) => {
  try {
    const idEmpresa = emp(req);
    const [[factura]] = await pool.query(
      `SELECT * FROM FACTURAS WHERE id_factura = ? AND id_empresa = ?`, [req.params.id, idEmpresa]);
    if (!factura) return res.status(404).json({ error: 'Factura no encontrada.' });
    if (factura.clase !== 'FACTURA') {
      return res.status(400).json({ error: 'Solo se puede hacer una nota de crédito sobre una factura, no sobre otra nota de crédito.' });
    }
    if (factura.estado === 'ANULADA') {
      return res.status(409).json({ error: 'Esta factura ya fue anulada con una nota de crédito.' });
    }

    // Copiar los ítems de la factura original
    const [items] = await pool.query('SELECT * FROM FACTURA_ITEMS WHERE id_factura = ?', [factura.id_factura]);
    const itemsNC = items.map(it => ({
      descripcion: it.descripcion, cantidad: Number(it.cantidad),
      unidad: it.unidad, precio_unitario: Number(it.precio_unitario)
    }));

    const nroFactura = `${String(factura.punto_venta).padStart(4, '0')}-${String(factura.numero).padStart(8, '0')}`;
    // Nota de crédito y anulación de la factura, en una sola transacción.
    const idNC = await emitirNotaCredito(idEmpresa, factura, {
      items: itemsNC,
      observaciones: (req.body && req.body.observaciones)
        ? String(req.body.observaciones).slice(0, 255)
        : `Anula la Factura A ${nroFactura}`
    });

    res.status(201).json({ id_factura: idNC });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------------------------
// Descargar el PDF de una factura
// --------------------------------------------------------------
router.get('/:id/pdf', async (req, res) => {
  try {
    const idEmpresa = emp(req);
    const [[factura]] = await pool.query(
      'SELECT * FROM FACTURAS WHERE id_factura = ? AND id_empresa = ?', [req.params.id, idEmpresa]);
    if (!factura) return res.status(404).json({ error: 'Factura no encontrada.' });
    const [[empresa]] = await pool.query('SELECT * FROM EMPRESAS WHERE id_empresa = ?', [idEmpresa]);
    const [items] = await pool.query('SELECT * FROM FACTURA_ITEMS WHERE id_factura = ?', [factura.id_factura]);
    // Si es nota de crédito, traer el número de la factura asociada para el PDF
    let facturaAsociada = null;
    if (factura.clase === 'NOTA_CREDITO' && factura.id_factura_asociada) {
      const [[asoc]] = await pool.query(
        'SELECT punto_venta, numero FROM FACTURAS WHERE id_factura = ?', [factura.id_factura_asociada]);
      facturaAsociada = asoc || null;
    }
    enviarFacturaPDF(res, empresa, factura, items, facturaAsociada);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
