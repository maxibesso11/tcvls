// routes/cuentasCorrientes.js
// Resumen de cuentas corrientes: agrupa los MOVIMIENTOS por CUENTA,
// compara créditos y débitos y determina el saldo final (deudor o acreedor).
// Incluye generación de resumen de cuenta en PDF.
// Convención: monto positivo = crédito (a favor del titular),
//             monto negativo = débito (en contra del titular).
// Saldo > 0 → ACREEDOR · Saldo < 0 → DEUDOR · Saldo = 0 → SALDADA
const express = require('express');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const router = express.Router();

const clasificarSaldo = saldo =>
  saldo > 0 ? 'ACREEDOR' : saldo < 0 ? 'DEUDOR' : 'SALDADA';

// ------------------------------------------------------------
// GET /api/cuentas-corrientes
// Resumen de todas las cuentas con búsqueda opcional (?q=)
// ------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const params = [req.usuario.id_empresa];
    let filtro = 'WHERE c.id_empresa = ?';
    if (req.query.q) {
      filtro += ' AND (c.nombre LIKE ? OR c.cuil LIKE ? OR c.tipo LIKE ?)';
      const q = `%${req.query.q}%`;
      params.push(q, q, q);
    }

    const [filas] = await pool.query(`
      SELECT
        c.id_cuenta, c.nombre, c.cuil, c.tipo,
        COUNT(m.id_movimiento) AS cantidad_movimientos,
        COALESCE(SUM(CASE WHEN m.monto > 0 THEN m.monto ELSE 0 END), 0) AS total_creditos,
        COALESCE(SUM(CASE WHEN m.monto < 0 THEN ABS(m.monto) ELSE 0 END), 0) AS total_debitos,
        COALESCE(SUM(m.monto), 0) AS saldo,
        MAX(m.fecha) AS ultimo_movimiento
      FROM CUENTA c
      LEFT JOIN MOVIMIENTOS m ON m.id_cuenta = c.id_cuenta
      ${filtro}
      GROUP BY c.id_cuenta, c.nombre, c.cuil, c.tipo
      ORDER BY ABS(SUM(COALESCE(m.monto, 0))) DESC
    `, params);

    const cuentas = filas.map(f => ({
      ...f,
      total_creditos: Number(f.total_creditos),
      total_debitos: Number(f.total_debitos),
      saldo: Number(f.saldo),
      condicion: clasificarSaldo(Number(f.saldo))
    }));

    // Totales calculados sobre TODAS las cuentas que cumplen el filtro
    const totales = {
      cuentas: cuentas.length,
      total_acreedor: cuentas.filter(c => c.saldo > 0).reduce((a, c) => a + c.saldo, 0),
      total_deudor: cuentas.filter(c => c.saldo < 0).reduce((a, c) => a + Math.abs(c.saldo), 0),
      acreedoras: cuentas.filter(c => c.saldo > 0).length,
      deudoras: cuentas.filter(c => c.saldo < 0).length,
      saldadas: cuentas.filter(c => c.saldo === 0).length
    };

    // Paginación de la lista (50 por página); los totales siguen siendo globales
    const porPagina = Math.min(Math.max(parseInt(req.query.por_pagina, 10) || 50, 1), 200);
    const total = cuentas.length;
    const totalPaginas = Math.max(Math.ceil(total / porPagina), 1);
    let pagina = parseInt(req.query.pagina, 10) || 1;
    if (pagina < 1) pagina = 1;
    if (pagina > totalPaginas) pagina = totalPaginas;
    const inicio = (pagina - 1) * porPagina;
    const cuentasPagina = cuentas.slice(inicio, inicio + porPagina);

    res.json({
      totales,
      cuentas: cuentasPagina,
      paginacion: { pagina, por_pagina: porPagina, total, total_paginas: totalPaginas }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// Consulta compartida: detalle de una cuenta con saldo parcial
// ------------------------------------------------------------
async function obtenerDetalleCuenta(id, idEmpresa) {
  const [[cuenta]] = await pool.query(
    'SELECT * FROM CUENTA WHERE id_cuenta = ? AND id_empresa = ?', [id, idEmpresa]
  );
  if (!cuenta) return null;

  const [movimientos] = await pool.query(`
    SELECT id_movimiento, fecha, concepto, monto
    FROM MOVIMIENTOS
    WHERE id_cuenta = ? AND id_empresa = ?
    ORDER BY fecha ASC, id_movimiento ASC
  `, [id, idEmpresa]);

  let saldoParcial = 0;
  const detalle = movimientos.map(m => {
    const monto = Number(m.monto);
    saldoParcial += monto;
    return {
      ...m,
      monto,
      credito: monto > 0 ? monto : 0,
      debito: monto < 0 ? Math.abs(monto) : 0,
      saldo_parcial: saldoParcial
    };
  });

  const totalCreditos = detalle.reduce((a, m) => a + m.credito, 0);
  const totalDebitos = detalle.reduce((a, m) => a + m.debito, 0);

  return {
    cuenta,
    movimientos: detalle,
    resumen: {
      total_creditos: totalCreditos,
      total_debitos: totalDebitos,
      saldo_final: saldoParcial,
      condicion: clasificarSaldo(saldoParcial),
      cantidad_movimientos: detalle.length
    }
  };
}

// ------------------------------------------------------------
// GET /api/cuentas-corrientes/:id
// Detalle de una cuenta: movimientos con saldo parcial acumulado
// ------------------------------------------------------------
router.get('/:id', async (req, res) => {
  try {
    const detalle = await obtenerDetalleCuenta(req.params.id, req.usuario.id_empresa);
    if (!detalle) return res.status(404).json({ error: 'Cuenta no encontrada' });
    res.json(detalle);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// GET /api/cuentas-corrientes/:id/pdf
// Resumen de cuenta en PDF descargable
// ------------------------------------------------------------
router.get('/:id/pdf', async (req, res) => {
  try {
    const detalle = await obtenerDetalleCuenta(req.params.id, req.usuario.id_empresa);
    if (!detalle) return res.status(404).json({ error: 'Cuenta no encontrada' });

    const { cuenta, movimientos, resumen } = detalle;
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
       .text('3 DE ABRIL SAS', 70, 68);
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
      doc.fillColor(m.debito ? '#c0392b' : gris)
         .text(m.debito ? fmt(m.debito) : '—', col.debito, y + 5, { width: 70, align: 'right' });
      doc.fillColor(m.credito ? '#2e7d4f' : gris)
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
    doc.text(`Total créditos: ${fmt(resumen.total_creditos)}`, 66, y + 32);
    doc.text(`Total débitos: ${fmt(resumen.total_debitos)}`, 66, y + 48);
    doc.text(`Movimientos: ${resumen.cantidad_movimientos}`, 66, y + 64);

    const esDeudor = resumen.saldo_final < 0;
    doc.fontSize(10).font('Helvetica-Bold').fillColor(gris)
       .text('SALDO FINAL', 330, y + 18, { width: 195, align: 'right' });
    // Desde la empresa: deudor (saldo < 0) es a favor → verde; acreedor (> 0) es pasivo → rojo
    doc.fontSize(16).fillColor(esDeudor ? '#2e7d4f' : resumen.saldo_final > 0 ? '#c0392b' : gris)
       .text(fmt(Math.abs(resumen.saldo_final)), 330, y + 34, { width: 195, align: 'right' });
    const textoCond = resumen.condicion === 'DEUDOR' ? 'A favor (le deben a la empresa)'
                    : resumen.condicion === 'ACREEDOR' ? 'En contra (la empresa debe)'
                    : 'Saldada';
    doc.fontSize(9).fillColor(ambar)
       .text(`Condición: ${textoCond}`, 330, y + 58, { width: 195, align: 'right' });

    // Pie
    doc.fontSize(7).fillColor(gris).font('Helvetica')
       .text('Documento generado automáticamente por TCV LogiSuite ERP. Saldo positivo: la empresa adeuda al titular (acreedor). Saldo negativo: el titular adeuda a la empresa (deudor).',
             50, 790, { width: 495, align: 'center' });

    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
