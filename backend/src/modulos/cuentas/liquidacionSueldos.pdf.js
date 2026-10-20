// backend/src/modulos/cuentas/liquidacionSueldos.pdf.js
// Comprobantes internos (pdfkit) de "Liquidar sueldos fijos del mes":
// un resumen general por período y un recibo individual por chofer.
// NO son facturas fiscales de ARCA — son documentos internos de pago.
const PDFDocument = require('pdfkit');

const GRAFITO = '#282828'; // Grafito del manual de marca
const GRIS = '#55585d';
const fmt = n => '$ ' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPeriodo = p => {
  const [anio, mes] = String(p).split('-');
  const nombres = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${nombres[Number(mes) - 1] || mes} de ${anio}`;
};

function encabezado(doc, nombreEmpresa, subtitulo) {
  doc.rect(50, 50, 495, 70).fill(GRAFITO);
  doc.fillColor('#ffffff').fontSize(18).font('Helvetica-Bold')
     .text(nombreEmpresa, 70, 68, { width: 300, ellipsis: true });
  doc.fontSize(10).font('Helvetica').text(subtitulo, 70, 92);
  doc.fontSize(9).text(`Emitido: ${new Date().toLocaleDateString('es-AR')}`, 380, 76, { width: 145, align: 'right' });
}

function pie(doc) {
  doc.fontSize(7).fillColor(GRIS).font('Helvetica')
     .text('Comprobante interno de pago generado por TCV LogiSuite ERP. No es un comprobante fiscal válido ante ARCA.',
           50, 790, { width: 495, align: 'center' });
}

// Resumen de todas las liquidaciones de un período, con el total.
function enviarResumenLiquidacionesPDF(res, { periodo, liquidaciones, total }, nombreEmpresa) {
  const nombreArchivo = `liquidacion_sueldos_${periodo}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);

  encabezado(doc, nombreEmpresa, `Liquidación de sueldos fijos de ${fmtPeriodo(periodo)}`);

  let y = 140;
  doc.fillColor(GRAFITO).fontSize(12).font('Helvetica-Bold').text('Choferes liquidados', 50, y);
  y += 20;

  const col = { chofer: 50, cuil: 300, monto: 420 };
  const filaAltura = 20;

  function cabeceraTabla() {
    doc.rect(50, y, 495, filaAltura).fill('#ecedef');
    doc.fillColor(GRIS).fontSize(8).font('Helvetica-Bold');
    doc.text('CHOFER', col.chofer + 4, y + 6);
    doc.text('CUIL', col.cuil, y + 6);
    doc.text('MONTO', col.monto, y + 6, { width: 115, align: 'right' });
    y += filaAltura;
  }

  cabeceraTabla();
  doc.font('Helvetica').fontSize(9);

  if (liquidaciones.length === 0) {
    doc.fillColor(GRIS).text('No hay choferes liquidados en este período.', 50, y + 8);
    y += 30;
  }

  liquidaciones.forEach((l, i) => {
    if (y > 740) { doc.addPage(); y = 50; cabeceraTabla(); doc.font('Helvetica').fontSize(9); }
    if (i % 2 === 1) doc.rect(50, y, 495, filaAltura).fill('#f6f7f8');
    doc.fillColor('#282828');
    doc.text(String(l.nombre), col.chofer + 4, y + 6, { width: 240 });
    doc.text(String(l.cuil), col.cuil, y + 6, { width: 110 });
    doc.text(fmt(l.monto), col.monto, y + 6, { width: 115, align: 'right' });
    y += filaAltura;
  });

  y += 14;
  if (y > 700) { doc.addPage(); y = 50; }
  doc.rect(50, y, 495, 46).fill('#f6f7f8');
  doc.rect(50, y, 495, 46).strokeColor('#d8dce0').lineWidth(0.5).stroke();
  doc.fontSize(10).font('Helvetica-Bold').fillColor(GRIS)
     .text(`TOTAL (${liquidaciones.length} chofer${liquidaciones.length === 1 ? '' : 'es'})`, 66, y + 16);
  doc.fontSize(16).fillColor(GRAFITO).text(fmt(total), 330, y + 10, { width: 195, align: 'right' });

  pie(doc);
  doc.end();
}

// Recibo individual de una liquidación puntual.
function enviarReciboLiquidacionPDF(res, liquidacion, nombreEmpresa) {
  const nombreArchivo = `recibo_sueldo_${liquidacion.id_liquidacion_sueldo}_${String(liquidacion.nombre).replace(/\s+/g, '_')}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);

  encabezado(doc, nombreEmpresa, 'Recibo de sueldo fijo mensual');

  let y = 150;
  doc.fillColor(GRAFITO).fontSize(12).font('Helvetica-Bold').text('Datos del chofer', 50, y);
  y += 20;
  doc.fontSize(10).font('Helvetica').fillColor('#282828');
  doc.text(`Nombre: ${liquidacion.nombre}`, 50, y); y += 16;
  doc.text(`CUIL: ${liquidacion.cuil}`, 50, y); y += 16;
  if (liquidacion.domicilio) { doc.text(`Domicilio: ${liquidacion.domicilio}`, 50, y); y += 16; }
  if (liquidacion.telefono) { doc.text(`Teléfono: ${liquidacion.telefono}`, 50, y); y += 16; }
  y += 20;

  doc.rect(50, y, 495, 90).fill('#f6f7f8');
  doc.rect(50, y, 495, 90).strokeColor('#d8dce0').lineWidth(0.5).stroke();
  doc.fillColor(GRAFITO).fontSize(11).font('Helvetica-Bold').text('Período liquidado', 66, y + 16);
  doc.fontSize(14).font('Helvetica').fillColor('#282828').text(fmtPeriodo(liquidacion.periodo), 66, y + 36);
  doc.fontSize(10).font('Helvetica-Bold').fillColor(GRIS).text('MONTO', 330, y + 16, { width: 195, align: 'right' });
  doc.fontSize(20).fillColor(GRAFITO).text(fmt(liquidacion.monto), 330, y + 34, { width: 195, align: 'right' });

  pie(doc);
  doc.end();
}

module.exports = { enviarResumenLiquidacionesPDF, enviarReciboLiquidacionPDF };
