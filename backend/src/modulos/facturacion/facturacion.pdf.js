// backend/src/modulos/facturacion/facturacion.pdf.js
// Dibuja y envía el PDF de una Factura A o Nota de Crédito A (pdfkit):
// encabezado con la letra A, emisor, receptor, ítems, totales y pie con CAE.
const PDFDocument = require('pdfkit');

function enviarFacturaPDF(res, empresa, factura, items, facturaAsociada = null) {
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

module.exports = { enviarFacturaPDF };
