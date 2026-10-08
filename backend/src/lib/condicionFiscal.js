// backend/src/lib/condicionFiscal.js
// Condición frente al IVA de la empresa que usa el sistema. Solo un
// responsable inscripto discrimina IVA: a un monotributista o exento nunca se
// le suma IVA a sus viajes, cuentas corrientes ni indicadores (factura C).
const pool = require('../config/db');
const { normalizarCondicion } = require('../modulos/facturacion/facturacion.reglas');

async function condicionEmpresa(idEmpresa, db = pool) {
  const [[e]] = await db.query('SELECT condicion_iva FROM EMPRESAS WHERE id_empresa = ?', [idEmpresa]);
  // Sin cargar se toma como responsable inscripto (el valor por defecto de la tabla).
  return normalizarCondicion(e && e.condicion_iva) || 'RESPONSABLE INSCRIPTO';
}

async function discriminaIva(idEmpresa, db = pool) {
  return (await condicionEmpresa(idEmpresa, db)) === 'RESPONSABLE INSCRIPTO';
}

module.exports = { condicionEmpresa, discriminaIva };
