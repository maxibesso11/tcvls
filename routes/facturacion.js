// routes/facturacion.js
// Módulo de facturación (Factura A). Permite:
//   - Listar las facturas emitidas (paginado).
//   - Facturar un viaje al CUIT del pagador (cuenta CLIENTE).
//   - Emitir una factura manual asociada a una cuenta, con ítems libres.
//   - Descargar el PDF de una factura.
//
// La numeración es correlativa por (empresa, punto de venta, tipo). El CAE se
// solicita a ARCA mediante config/arca.js (hoy devuelve null → BORRADOR).
const express = require('express');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { solicitarCAE } = require('../config/arca');

const router = express.Router();
const IVA_ALICUOTA = 0.21;
const emp = req => req.usuario.id_empresa;
const r2 = n => Math.round(Number(n) * 100) / 100;

// --------------------------------------------------------------
// Helpers
// --------------------------------------------------------------

// Calcula el próximo número correlativo para empresa + clase + punto de venta.
// Facturas y notas de crédito llevan secuencias independientes.
async function proximoNumero(conexion, idEmpresa, clase, puntoVenta) {
  const [[fila]] = await conexion.query(
    `SELECT COALESCE(MAX(numero), 0) AS ultimo
       FROM FACTURAS WHERE id_empresa = ? AND clase = ? AND tipo_comprobante = 'A' AND punto_venta = ?`,
    [idEmpresa, clase, puntoVenta]
  );
  return fila.ultimo + 1;
}

// Inserta un comprobante (factura o nota de crédito) con sus ítems dentro de
// una transacción y, si ARCA está configurado, solicita el CAE. Devuelve el id.
async function crearFactura(idEmpresa, { id_cuenta, id_viaje, items, observaciones, clase = 'FACTURA', id_factura_asociada = null }) {
  const conexion = await pool.getConnection();
  try {
    // Datos del emisor (empresa) y del receptor (cuenta)
    const [[empresa]] = await conexion.query('SELECT * FROM EMPRESAS WHERE id_empresa = ?', [idEmpresa]);
    if (!empresa) throw new Error('Empresa no encontrada.');
    const [[cuenta]] = await conexion.query(
      'SELECT * FROM CUENTA WHERE id_cuenta = ? AND id_empresa = ?', [id_cuenta, idEmpresa]);
    if (!cuenta) throw new Error('La cuenta indicada no existe.');
    if (!cuenta.cuil) throw new Error('La cuenta no tiene CUIT cargado; es obligatorio para Factura A.');

    // Calcular importes a partir de los ítems (precios sin IVA).
    // La unidad de medida (horas, km, toneladas, etc.) se guarda en su propio
    // campo y se muestra junto a la cantidad en el comprobante.
    const itemsCalc = items.map(it => {
      const cantidad = Number(it.cantidad) || 1;
      const precio = Number(it.precio_unitario) || 0;
      const unidad = String(it.unidad || '').trim().slice(0, 20) || null;
      return { descripcion: String(it.descripcion || '').trim().slice(0, 255), cantidad, unidad, precio_unitario: precio, subtotal: r2(cantidad * precio) };
    });
    const netoGravado = r2(itemsCalc.reduce((s, it) => s + it.subtotal, 0));
    const iva = r2(netoGravado * IVA_ALICUOTA);
    const total = r2(netoGravado + iva);
    if (netoGravado <= 0) throw new Error('El importe de la factura debe ser mayor a cero.');

    const puntoVenta = empresa.punto_venta || 1;

    await conexion.beginTransaction();

    // Intentar obtener el CAE de ARCA. Si ARCA está activo, el número del
    // comprobante lo determina ARCA (último autorizado + 1); si no, se usa el
    // contador interno y la factura queda como borrador.
    let numero, cae = null, caeVto = null, estado = 'BORRADOR';
    try {
      const resp = await solicitarCAE({
        id_empresa: idEmpresa, emisor_cuit: empresa.cuit, punto_venta: puntoVenta, clase,
        // La cuenta no guarda condición de IVA; en Factura A el receptor es
        // responsable inscripto (default en config/arca.js).
        receptor_cuit: cuenta.cuil, receptor_condicion_iva: cuenta.condicion_iva || 'RESPONSABLE INSCRIPTO',
        neto_gravado: netoGravado, iva, total, fecha: new Date()
      });
      if (resp && resp.cae) {
        numero = resp.numero;
        cae = resp.cae;
        caeVto = resp.cae_vencimiento;
        estado = 'EMITIDA';
      }
    } catch (errArca) {
      // No se pudo emitir: se aborta para no dejar una factura inconsistente.
      await conexion.rollback();
      throw new Error('Error al solicitar el CAE a ARCA: ' + errArca.message);
    }

    // Si ARCA no asignó número (modo borrador), usar el contador interno.
    if (numero == null) {
      numero = await proximoNumero(conexion, idEmpresa, clase, puntoVenta);
    }

    const [res] = await conexion.query(
      `INSERT INTO FACTURAS
        (id_empresa, clase, tipo_comprobante, punto_venta, numero, fecha_emision, id_cuenta, id_viaje, id_factura_asociada,
         receptor_cuit, receptor_nombre, receptor_domicilio, receptor_condicion_iva,
         neto_gravado, iva, total, cae, cae_vencimiento, estado, observaciones)
       VALUES (?, ?, 'A', ?, ?, CURDATE(), ?, ?, ?, ?, ?, ?, 'RESPONSABLE INSCRIPTO', ?, ?, ?, ?, ?, ?, ?)`,
      [idEmpresa, clase, puntoVenta, numero, id_cuenta, id_viaje || null, id_factura_asociada || null,
       cuenta.cuil, cuenta.nombre, cuenta.domicilio || null,
       netoGravado, iva, total, cae, caeVto, estado, (observaciones || '').slice(0, 255)]
    );
    const idFactura = res.insertId;

    for (const it of itemsCalc) {
      await conexion.query(
        `INSERT INTO FACTURA_ITEMS (id_factura, descripcion, cantidad, unidad, precio_unitario, subtotal)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [idFactura, it.descripcion, it.cantidad, it.unidad, it.precio_unitario, it.subtotal]
      );
    }

    // Imputar el comprobante en la cuenta corriente del cliente.
    // - Las facturas MANUALES (sin viaje asociado) generan el débito acá.
    //   Las facturas emitidas DESDE un viaje no se imputan aquí, porque el
    //   propio viaje ya crea su movimiento en la cuenta (evita duplicar).
    // - Las notas de crédito siempre imputan un crédito que reduce la deuda.
    const numeroFmt = String(numero).padStart(8, '0');
    const ptoFmt = String(puntoVenta).padStart(4, '0');
    if (clase === 'NOTA_CREDITO') {
      await conexion.query('INSERT INTO MOVIMIENTOS SET ?', [{
        id_empresa: idEmpresa,
        id_cuenta,
        monto: Math.abs(total), // crédito: reduce lo que debe el cliente
        fecha: new Date(),
        concepto: `NOTA DE CREDITO A ${ptoFmt}-${numeroFmt} (anula factura)`.slice(0, 255)
      }]);
    } else if (!id_viaje) {
      await conexion.query('INSERT INTO MOVIMIENTOS SET ?', [{
        id_empresa: idEmpresa,
        id_cuenta,
        monto: -Math.abs(total), // débito: el cliente debe el total con IVA
        fecha: new Date(),
        concepto: `FACTURA A ${ptoFmt}-${numeroFmt} [IVA 21%]`.slice(0, 255)
      }]);
    }

    await conexion.commit();
    return idFactura;
  } catch (err) {
    try { await conexion.rollback(); } catch (e) { /* ya estaba sin transacción */ }
    throw err;
  } finally {
    conexion.release();
  }
}

// --------------------------------------------------------------
// Listado paginado de facturas
// --------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const idEmpresa = emp(req);
    const porPagina = Math.min(Math.max(parseInt(req.query.por_pagina, 10) || 50, 1), 200);
    const [[{ total }]] = await pool.query(
      'SELECT COUNT(*) AS total FROM FACTURAS WHERE id_empresa = ?', [idEmpresa]);
    const totalPaginas = Math.max(Math.ceil(total / porPagina), 1);
    let pagina = parseInt(req.query.pagina, 10) || 1;
    if (pagina < 1) pagina = 1;
    if (pagina > totalPaginas) pagina = totalPaginas;
    const offset = (pagina - 1) * porPagina;

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
      const base = v.tipo_tarifa === 'UNICA'
        ? Number(v.tarifa)
        : Number(v.tarifa) * Number(v.resultado != null ? v.resultado : (v.cantidad_cargada || 0));
      const neto = r2(base * (1 - (Number(v.comision) || 0) / 100));
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
    const base = viaje.tipo_tarifa === 'UNICA'
      ? Number(viaje.tarifa)
      : Number(viaje.tarifa) * Number(viaje.resultado != null ? viaje.resultado : (viaje.cantidad_cargada || 0));
    const neto = r2(base * (1 - (Number(viaje.comision) || 0) / 100));

    const descripcion = `Flete ${viaje.origen} a ${viaje.destino}` +
      (viaje.numero_remito ? ` — Remito ${viaje.numero_remito}` : '') +
      (viaje.tipo_carga ? ` (${viaje.tipo_carga})` : '');

    const idFactura = await crearFactura(idEmpresa, {
      id_cuenta: cuenta.id_cuenta,
      id_viaje: viaje.id_viaje,
      items: [{ descripcion, cantidad: 1, precio_unitario: neto }],
      observaciones: ''
    });

    // Marcar el viaje como FACTURADO si no lo estaba
    await pool.query(
      `UPDATE VIAJES SET estado = 'FACTURADO' WHERE id_viaje = ? AND id_empresa = ? AND estado <> 'FACTURADO'`,
      [viaje.id_viaje, idEmpresa]);

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
    const idNC = await crearFactura(idEmpresa, {
      id_cuenta: factura.id_cuenta,
      items: itemsNC,
      observaciones: (req.body && req.body.observaciones)
        ? String(req.body.observaciones).slice(0, 255)
        : `Anula la Factura A ${nroFactura}`,
      clase: 'NOTA_CREDITO',
      id_factura_asociada: factura.id_factura
    });

    // Marcar la factura original como anulada
    await pool.query(`UPDATE FACTURAS SET estado = 'ANULADA' WHERE id_factura = ? AND id_empresa = ?`,
      [factura.id_factura, idEmpresa]);

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
    generarPDF(res, empresa, factura, items, facturaAsociada);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------------------------
// Generación del PDF de la Factura A
// --------------------------------------------------------------
function generarPDF(res, empresa, factura, items, facturaAsociada = null) {
  const esNC = factura.clase === 'NOTA_CREDITO';
  const titulo = esNC ? 'NOTA DE CRÉDITO' : 'FACTURA';
  const codigo = esNC ? 'COD. 003' : 'COD. 001';
  const prefijoArchivo = esNC ? 'nota_credito_A' : 'factura_A';
  const nro = `${String(factura.punto_venta).padStart(4, '0')}-${String(factura.numero).padStart(8, '0')}`;
  const nombreArchivo = `${prefijoArchivo}_${nro}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(res);

  const tinta = '#16386b';
  const gris = '#5a6b7d';
  const lineaColor = '#dce6f2';
  const acento = '#1e4d8f';
  const alerta = '#b5642a';
  const fmt = n => '$ ' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtFecha = f => f ? new Date(f).toLocaleDateString('es-AR') : '—';

  const M = 40;            // margen izquierdo
  const ANCHO = 515;       // ancho útil (A4 595 - 2*40)
  const DER = M + ANCHO;   // borde derecho = 555

  // ====================== Encabezado ======================
  // Marco superior con la letra "A" centrada y un divisor vertical
  doc.lineWidth(0.5).strokeColor(lineaColor);
  doc.rect(M, 40, ANCHO, 100).stroke();
  const xMedio = M + ANCHO / 2;             // 297.5
  doc.moveTo(xMedio, 40).lineTo(xMedio, 140).stroke();

  // Recuadro de la letra A, centrado sobre el divisor
  doc.rect(xMedio - 22, 40, 44, 38).fillAndStroke('#ffffff', tinta);
  doc.fillColor(tinta).fontSize(28).font('Helvetica-Bold').text('A', xMedio - 22, 45, { width: 44, align: 'center' });
  doc.fontSize(7).fillColor(gris).font('Helvetica').text(codigo, xMedio - 22, 80, { width: 44, align: 'center' });

  // --- Emisor (mitad izquierda) ---
  const xIzq = M + 12, anchoIzq = ANCHO / 2 - 40;
  doc.fillColor(tinta).fontSize(15).font('Helvetica-Bold')
     .text(empresa.nombre || '', xIzq, 54, { width: anchoIzq });
  let yE = 82;
  doc.fillColor('#202624').fontSize(8).font('Helvetica');
  doc.text(empresa.condicion_iva || 'RESPONSABLE INSCRIPTO', xIzq, yE, { width: anchoIzq }); yE += 11;
  if (empresa.domicilio) { doc.text(empresa.domicilio, xIzq, yE, { width: anchoIzq }); yE += 11; }
  if (empresa.telefono) { doc.text(`Tel: ${empresa.telefono}`, xIzq, yE, { width: anchoIzq }); yE += 11; }

  // --- Datos del comprobante (mitad derecha) ---
  // Empieza con margen suficiente para no tocar el recuadro de la letra A.
  const xDer = xMedio + 34, anchoDer = ANCHO / 2 - 46;
  doc.fillColor(tinta).fontSize(esNC ? 12 : 14).font('Helvetica-Bold')
     .text(titulo, xDer, 52, { width: anchoDer, align: 'left' });
  doc.fillColor('#202624').fontSize(9).font('Helvetica');
  let yD = 74;
  doc.font('Helvetica-Bold').text(`N° ${nro}`, xDer, yD, { width: anchoDer }); yD += 15;
  doc.font('Helvetica').fontSize(8);
  doc.text(`Fecha de emisión: ${fmtFecha(factura.fecha_emision)}`, xDer, yD, { width: anchoDer }); yD += 11;
  doc.text(`CUIT: ${empresa.cuit || '—'}`, xDer, yD, { width: anchoDer }); yD += 11;
  doc.text(`Ing. Brutos: ${empresa.ingresos_brutos || '—'}`, xDer, yD, { width: anchoDer }); yD += 11;
  doc.text(`Inicio de actividades: ${fmtFecha(empresa.inicio_actividades)}`, xDer, yD, { width: anchoDer });

  // ====================== Receptor ======================
  let y = 152;
  // El marco es más alto en notas de crédito para alojar la referencia.
  const altoReceptor = (esNC && facturaAsociada) ? 72 : 54;
  doc.strokeColor(lineaColor).rect(M, y, ANCHO, altoReceptor).stroke();
  doc.fillColor(gris).fontSize(7).font('Helvetica-Bold').text('FACTURAR A', M + 10, y + 7);
  doc.fillColor('#202624').fontSize(11).font('Helvetica-Bold')
     .text(factura.receptor_nombre, M + 10, y + 18, { width: ANCHO - 20 });
  doc.fontSize(8).font('Helvetica');
  doc.text(`CUIT: ${factura.receptor_cuit}`, M + 10, y + 36);
  doc.text(factura.receptor_condicion_iva || 'RESPONSABLE INSCRIPTO', M + 160, y + 36);
  doc.text(`Domicilio: ${factura.receptor_domicilio || '—'}`, M + 320, y + 36, { width: ANCHO - 330 });

  // Referencia al comprobante asociado (solo en notas de crédito), dentro del marco
  if (esNC && facturaAsociada) {
    const nroAsoc = `${String(facturaAsociada.punto_venta).padStart(4, '0')}-${String(facturaAsociada.numero).padStart(8, '0')}`;
    doc.strokeColor(lineaColor).lineWidth(0.5).moveTo(M + 10, y + 52).lineTo(DER - 10, y + 52).stroke();
    doc.fillColor(alerta).fontSize(8).font('Helvetica-Bold')
       .text(`Comprobante asociado: Factura A ${nroAsoc}`, M + 10, y + 57);
  }
  y += altoReceptor;

  // ====================== Tabla de ítems ======================
  // Columnas con posición de inicio y ancho fijos, alineadas a derecha los números.
  y += 16;
  const colDescX = M + 8,  colDescW = 244;            // 48 .. 292
  const colCantX = M + 256, colCantW = 70;            // 296 .. 366 (centrada)
  const colPrecX = M + 326, colPrecW = 95;            // 366 .. 461 (derecha)
  const colSubX  = M + 421, colSubW  = 86;            // 461 .. 547 (derecha)

  doc.rect(M, y, ANCHO, 20).fill(tinta);
  doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold');
  doc.text('DESCRIPCIÓN', colDescX, y + 6);
  doc.text('CANT.', colCantX, y + 6, { width: colCantW, align: 'center' });
  doc.text('P. UNITARIO', colPrecX, y + 6, { width: colPrecW, align: 'right' });
  doc.text('SUBTOTAL', colSubX, y + 6, { width: colSubW, align: 'right' });
  y += 20;

  doc.fillColor('#202624').font('Helvetica').fontSize(8);
  items.forEach((it, i) => {
    const cantTexto = it.unidad ? `${Number(it.cantidad)} ${it.unidad}` : String(Number(it.cantidad));
    // Altura de la fila según la descripción (puede ocupar varias líneas)
    const altoDesc = doc.heightOfString(it.descripcion, { width: colDescW });
    const alto = Math.max(20, altoDesc + 10);
    // Fondo alternado para legibilidad
    if (i % 2 === 1) doc.rect(M, y, ANCHO, alto).fill('#f6f5f0');
    doc.fillColor('#202624').font('Helvetica').fontSize(8);
    const yTexto = y + 6;
    doc.text(it.descripcion, colDescX, yTexto, { width: colDescW });
    doc.text(cantTexto, colCantX, yTexto, { width: colCantW, align: 'center' });
    doc.text(fmt(it.precio_unitario), colPrecX, yTexto, { width: colPrecW, align: 'right' });
    doc.font('Helvetica-Bold').text(fmt(it.subtotal), colSubX, yTexto, { width: colSubW, align: 'right' });
    y += alto;
    doc.strokeColor(lineaColor).lineWidth(0.5).moveTo(M, y).lineTo(DER, y).stroke();
  });

  // ====================== Totales ======================
  // Caja de totales alineada a la derecha. La etiqueta ocupa la mitad izquierda
  // y el valor la derecha, sin superponerse aunque el monto sea grande.
  y += 14;
  const cajaX = M + 295, cajaW = ANCHO - 295;         // 335 .. 555
  const etqX = cajaX + 10, etqW = 90;                 // etiqueta: 345 .. 435
  const valX = cajaX + 100, valW = cajaW - 110;       // valor:    435 .. 545 (align right)

  const filaTotal = (etiqueta, valor, destacado) => {
    if (destacado) {
      doc.rect(cajaX, y - 4, cajaW, 26).fill(tinta);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(12);
      doc.text(etiqueta, etqX, y + 3, { width: etqW });
      doc.text(valor, valX, y + 3, { width: valW, align: 'right' });
      y += 26;
    } else {
      doc.fillColor('#202624').font('Helvetica').fontSize(9);
      doc.text(etiqueta, etqX, y, { width: etqW });
      doc.font('Helvetica-Bold').text(valor, valX, y, { width: valW, align: 'right' });
      y += 17;
    }
  };
  filaTotal('Neto gravado', fmt(factura.neto_gravado), false);
  filaTotal('IVA 21%', fmt(factura.iva), false);
  y += 2;
  filaTotal('TOTAL', fmt(factura.total), true);

  // ====================== Pie con CAE ======================
  y += 18;
  doc.strokeColor(lineaColor).lineWidth(0.5).rect(M, y, ANCHO, 44).stroke();
  if (factura.cae) {
    doc.fillColor('#202624').font('Helvetica-Bold').fontSize(10)
       .text(`CAE N°: ${factura.cae}`, M + 12, y + 12);
    doc.font('Helvetica').fontSize(9)
       .text(`Vencimiento del CAE: ${fmtFecha(factura.cae_vencimiento)}`, M + 12, y + 27);
  } else {
    doc.fillColor(alerta).font('Helvetica-Bold').fontSize(9)
       .text('COMPROBANTE NO VÁLIDO COMO FACTURA', M + 12, y + 10, { width: ANCHO - 24 });
    doc.fillColor(gris).font('Helvetica').fontSize(7.5)
       .text('Pendiente de autorización (CAE) de ARCA. Documento interno; para validez fiscal debe obtenerse el CAE.',
             M + 12, y + 24, { width: ANCHO - 24 });
  }
  y += 56;

  doc.fillColor(gris).fontSize(7).font('Helvetica')
     .text('Generado por TCV LogiSuite ERP', M, y, { width: ANCHO, align: 'center' });

  doc.end();
}

module.exports = router;
