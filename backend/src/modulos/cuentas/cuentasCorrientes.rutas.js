// backend/src/modulos/cuentas/cuentasCorrientes.rutas.js
// Resumen de cuentas corrientes: agrupa los MOVIMIENTOS por CUENTA,
// compara créditos y débitos y determina el saldo final (deudor o acreedor).
// El resumen de cuenta en PDF se dibuja en cuentasCorrientes.pdf.js.
// Convención: monto positivo = crédito (a favor del titular),
//             monto negativo = débito (en contra del titular).
// Saldo > 0 → ACREEDOR · Saldo < 0 → DEUDOR · Saldo = 0 → SALDADA
const express = require('express');
const pool = require('../../config/db');
const { calcularPaginacion } = require('../../lib/paginacion');
const { enviarResumenCuentaPDF } = require('./cuentasCorrientes.pdf');
const {
  listarLiquidables, liquidarSueldosFijosDelMes, obtenerLiquidacionesDelPeriodo, obtenerLiquidacion
} = require('./liquidacionSueldos.servicio');
const { enviarResumenLiquidacionesPDF, enviarReciboLiquidacionPDF } = require('./liquidacionSueldos.pdf');
const { responderError } = require('../../lib/errores');
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
    const total = cuentas.length;
    const { pagina, porPagina, totalPaginas, offset } = calcularPaginacion(req.query, total);
    const cuentasPagina = cuentas.slice(offset, offset + porPagina);

    res.json({
      totales,
      cuentas: cuentasPagina,
      paginacion: { pagina, por_pagina: porPagina, total, total_paginas: totalPaginas }
    });
  } catch (err) {
    responderError(res, err, req);
  }
});

// ------------------------------------------------------------
// GET /api/cuentas-corrientes/liquidar-sueldos-fijos?periodo=AAAA-MM
// Vista previa: choferes con sueldo fijo cargado, su monto y si ya se
// liquidaron para ese período. Para mostrar antes de confirmar la acción.
// ------------------------------------------------------------
router.get('/liquidar-sueldos-fijos', async (req, res) => {
  try {
    const choferes = await listarLiquidables(pool, req.usuario.id_empresa, req.query.periodo);
    res.json(choferes);
  } catch (err) {
    responderError(res, err, req);
  }
});

// ------------------------------------------------------------
// POST /api/cuentas-corrientes/liquidar-sueldos-fijos  { periodo, id_choferes? }
// Crea el movimiento del sueldo fijo mensual de cada chofer con
// sueldo_fijo_mensual cargado. Correrla dos veces para el mismo período no
// duplica nada (LIQUIDACIONES_SUELDO es único por chofer y período).
// id_choferes es opcional: si viene, acota la liquidación a esos choferes
// (elegidos en la vista previa); sin él, liquida a todos como antes.
// ------------------------------------------------------------
router.post('/liquidar-sueldos-fijos', async (req, res) => {
  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    const resultado = await liquidarSueldosFijosDelMes(
      conexion, req.usuario.id_empresa, req.body.periodo, req.body.id_choferes);
    await conexion.commit();
    res.json(resultado);
  } catch (err) {
    try { await conexion.rollback(); } catch (e) { /* sin transacción */ }
    responderError(res, err, req);
  } finally {
    conexion.release();
  }
});

// ------------------------------------------------------------
// GET /api/cuentas-corrientes/liquidacion-sueldos/periodo/:periodo/pdf
// Resumen en PDF de todas las liquidaciones de un período (comprobante
// interno, no fiscal).
// ------------------------------------------------------------
router.get('/liquidacion-sueldos/periodo/:periodo/pdf', async (req, res) => {
  try {
    const liquidaciones = await obtenerLiquidacionesDelPeriodo(pool, req.usuario.id_empresa, req.params.periodo);
    if (liquidaciones.length === 0) {
      return res.status(404).json({ error: 'No hay liquidaciones registradas para ese período.' });
    }
    const total = liquidaciones.reduce((a, l) => a + l.monto, 0);
    const [[empresa]] = await pool.query('SELECT nombre FROM EMPRESAS WHERE id_empresa = ?', [req.usuario.id_empresa]);
    enviarResumenLiquidacionesPDF(res, { periodo: req.params.periodo, liquidaciones, total }, (empresa && empresa.nombre) || 'Empresa');
  } catch (err) {
    responderError(res, err, req);
  }
});

// ------------------------------------------------------------
// GET /api/cuentas-corrientes/liquidacion-sueldos/:id/pdf
// Recibo individual de una liquidación puntual (comprobante interno).
// ------------------------------------------------------------
router.get('/liquidacion-sueldos/:id/pdf', async (req, res) => {
  try {
    const liquidacion = await obtenerLiquidacion(pool, req.usuario.id_empresa, req.params.id);
    if (!liquidacion) return res.status(404).json({ error: 'Liquidación no encontrada.' });
    const [[empresa]] = await pool.query('SELECT nombre FROM EMPRESAS WHERE id_empresa = ?', [req.usuario.id_empresa]);
    enviarReciboLiquidacionPDF(res, liquidacion, (empresa && empresa.nombre) || 'Empresa');
  } catch (err) {
    responderError(res, err, req);
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

  // Redondeo a 2 decimales en cada paso: la acumulación con números de punto
  // flotante deja residuos (ej. 0.0000000001) que en pantalla se ven como
  // $ 0,00 pero clasificarían la cuenta como deudora/acreedora en vez de
  // saldada.
  const r2 = n => Math.round(n * 100) / 100;

  let saldoParcial = 0;
  const detalle = movimientos.map(m => {
    const monto = Number(m.monto);
    saldoParcial = r2(saldoParcial + monto);
    return {
      ...m,
      monto,
      credito: monto > 0 ? monto : 0,
      debito: monto < 0 ? Math.abs(monto) : 0,
      saldo_parcial: saldoParcial
    };
  });

  const totalCreditos = r2(detalle.reduce((a, m) => a + m.credito, 0));
  const totalDebitos = r2(detalle.reduce((a, m) => a + m.debito, 0));

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
    responderError(res, err, req);
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

    // Datos de la empresa emisora (la que está usando el sistema), para el
    // encabezado. Se toma de la base según el tenant, no un valor fijo.
    const [[empresa]] = await pool.query(
      'SELECT nombre, cuit, domicilio FROM EMPRESAS WHERE id_empresa = ?',
      [req.usuario.id_empresa]
    );
    const nombreEmpresa = (empresa && empresa.nombre) ? empresa.nombre : 'Empresa';

    enviarResumenCuentaPDF(res, detalle, nombreEmpresa);
  } catch (err) {
    responderError(res, err, req);
  }
});

module.exports = router;
