// backend/src/modulos/cuentas/cuentasCorrientes.pdf.js
// Dibuja y envía el resumen de cuenta corriente en PDF (pdfkit).
// Recibe el detalle ya calculado (ver obtenerDetalleCuenta en
// cuentasCorrientes.rutas.js) y el nombre de la empresa emisora.
const PDFDocument = require('pdfkit');

function enviarResumenCuentaPDF(res, { cuenta, movimientos, resumen }, nombreEmpresa) {
  const fmt = n => '$ ' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtFecha = f => (f ? String(f).slice(0, 10).split('-').reverse().join('/') : '—');

  const nombreArchivo = `resumen_cuenta_${cuenta.id_cuenta}_${cuenta.nombre.replace(/\s+/g, '_')}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);

  const verde = '#15231f';
  const ambar = '#b87a1e';
  const gris = '#6b7470';

  // Encabezado
  doc.rect(50, 50, 495, 70).fill(verde);
  doc.fillColor('#ffffff').fontSize(18).font('Helvetica-Bold')
     .text(nombreEmpresa, 70, 68, { width: 300, ellipsis: true });
  doc.fontSize(10).font('Helvetica')
     .text('Resumen de cuenta corriente', 70, 92);
  doc.fontSize(9)
     .text(`Emitido: ${new Date().toLocaleDateString('es-AR')}`, 380, 70, { width: 145, align: 'right' })
     .text(`Cuenta N° ${cuenta.id_cuenta}`, 380, 84, { width: 145, align: 'right' });

  // Datos del titular
  let y = 140;
  doc.fillColor(verde).fontSize(12).font('Helvetica-Bold').text('Datos del titular', 50, y);
  y += 20;
  doc.fontSize(10).font('Helvetica').fillColor('#202624');
  doc.text(`Titular: ${cuenta.nombre}`, 50, y);
  doc.text(`Tipo: ${cuenta.tipo}`, 320, y);
  y += 16;
  doc.text(`CUIL/CUIT: ${cuenta.cuil}`, 50, y);
  doc.text(`Teléfono: ${cuenta.telefono || '—'}`, 320, y);
  y += 16;
  doc.text(`Domicilio: ${cuenta.domicilio || '—'}`, 50, y);
  y += 30;

  // Tabla de movimientos
  doc.fillColor(verde).fontSize(12).font('Helvetica-Bold').text('Movimientos', 50, y);
  y += 20;

  const col = { fecha: 50, concepto: 115, debito: 330, credito: 405, saldo: 478 };
  const filaAltura = 18;

  function cabeceraTabla() {
    doc.rect(50, y, 495, filaAltura).fill('#ecebe5');
    doc.fillColor(gris).fontSize(8).font('Helvetica-Bold');
    doc.text('FECHA', col.fecha + 4, y + 5);
    doc.text('CONCEPTO', col.concepto, y + 5);
    doc.text('DÉBITO', col.debito, y + 5, { width: 70, align: 'right' });
    doc.text('CRÉDITO', col.credito, y + 5, { width: 68, align: 'right' });
    doc.text('SALDO', col.saldo, y + 5, { width: 62, align: 'right' });
    y += filaAltura;
  }

  cabeceraTabla();
  doc.font('Helvetica').fontSize(8);

  if (movimientos.length === 0) {
    doc.fillColor(gris).text('La cuenta no registra movimientos.', 50, y + 8);
    y += 30;
  }

  movimientos.forEach((m, i) => {
    if (y > 740) {
      doc.addPage();
      y = 50;
      cabeceraTabla();
      doc.font('Helvetica').fontSize(8);
    }
    if (i % 2 === 1) doc.rect(50, y, 495, filaAltura).fill('#faf9f5');
    doc.fillColor('#202624');
    doc.text(fmtFecha(m.fecha), col.fecha + 4, y + 5);
    doc.text(String(m.concepto).slice(0, 48), col.concepto, y + 5, { width: 210 });
    // Desde la perspectiva de la empresa: débito al titular = a favor de
    // la empresa (verde); crédito al titular = la empresa debe (rojo).
    doc.fillColor(m.debito ? '#2e7d4f' : gris)
       .text(m.debito ? fmt(m.debito) : '—', col.debito, y + 5, { width: 70, align: 'right' });
    doc.fillColor(m.credito ? '#c0392b' : gris)
       .text(m.credito ? fmt(m.credito) : '—', col.credito, y + 5, { width: 68, align: 'right' });
    doc.fillColor('#202624')
       .text(fmt(m.saldo_parcial), col.saldo, y + 5, { width: 62, align: 'right' });
    y += filaAltura;
  });

  // Resumen final
  y += 14;
  if (y > 680) { doc.addPage(); y = 50; }

  doc.rect(50, y, 495, 88).fill('#faf9f5');
  doc.rect(50, y, 495, 88).strokeColor('#e2e1da').lineWidth(0.5).stroke();

  doc.fillColor(verde).fontSize(11).font('Helvetica-Bold').text('Resumen', 66, y + 12);
  doc.fontSize(9).font('Helvetica').fillColor('#202624');
  doc.text(`Total débitos: ${fmt(resumen.total_debitos)}`, 66, y + 32);
  doc.text(`Total créditos: ${fmt(resumen.total_creditos)}`, 66, y + 48);
  doc.text(`Movimientos: ${resumen.cantidad_movimientos}`, 66, y + 64);

  const esDeudor = resumen.saldo_final < 0;
  doc.fontSize(10).font('Helvetica-Bold').fillColor(gris)
     .text('SALDO FINAL', 330, y + 18, { width: 195, align: 'right' });
  // Desde la empresa: deudor (saldo < 0) es a favor → verde; acreedor (> 0) es pasivo → rojo
  doc.fontSize(16).fillColor(esDeudor ? '#2e7d4f' : resumen.saldo_final > 0 ? '#c0392b' : gris)
     .text(fmt(Math.abs(resumen.saldo_final)), 330, y + 34, { width: 195, align: 'right' });
  const textoCond = resumen.condicion === 'DEUDOR' ? 'A favor'
                  : resumen.condicion === 'ACREEDOR' ? 'En contra'
                  : 'Saldada';
  doc.fontSize(9).fillColor(ambar)
     .text(`Condición: ${textoCond}`, 330, y + 58, { width: 195, align: 'right' });

  // Pie
  doc.fontSize(7).fillColor(gris).font('Helvetica')
     .text('Documento generado automáticamente por TCV LogiSuite ERP. Saldo positivo: la empresa adeuda al titular (acreedor). Saldo negativo: el titular adeuda a la empresa (deudor).',
           50, 790, { width: 495, align: 'center' });

  doc.end();
}

module.exports = { enviarResumenCuentaPDF };
