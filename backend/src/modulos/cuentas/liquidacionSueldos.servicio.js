// backend/src/modulos/cuentas/liquidacionSueldos.servicio.js
// Acción "Liquidar sueldos fijos del mes": crea un movimiento de crédito por
// chofer y período (AAAA-MM) para todos los que tienen sueldo_fijo_mensual
// cargado, y lo registra en LIQUIDACIONES_SUELDO (único por chofer y
// período) para que correrla dos veces no duplique nada.
const { ORIGEN, crearMovimientoAutomatico } = require('./movimientos.servicio');
const { ErrorNegocio } = require('../../lib/errores');

const PATRON_PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/;

function validarPeriodo(periodo) {
  if (!PATRON_PERIODO.test(periodo || '')) {
    throw new ErrorNegocio('El período debe tener el formato AAAA-MM.');
  }
}

// Choferes con sueldo fijo cargado, con su monto y si ya se liquidaron para
// ese período. Para la vista previa antes de confirmar la acción.
async function listarLiquidables(db, idEmpresa, periodo) {
  validarPeriodo(periodo);

  const [choferes] = await db.query(`
    SELECT ch.id_chofer, ch.nombre, ch.cuil, ch.sueldo_fijo_mensual,
           ls.id_liquidacion_sueldo
    FROM CHOFERES ch
    LEFT JOIN LIQUIDACIONES_SUELDO ls
           ON ls.id_empresa = ch.id_empresa AND ls.id_chofer = ch.id_chofer AND ls.periodo = ?
    WHERE ch.id_empresa = ? AND ch.sueldo_fijo_mensual > 0
    ORDER BY ch.nombre
  `, [periodo, idEmpresa]);

  return choferes.map(c => ({
    id_chofer: c.id_chofer,
    nombre: c.nombre,
    cuil: c.cuil,
    sueldo_fijo_mensual: Number(c.sueldo_fijo_mensual),
    ya_liquidado: c.id_liquidacion_sueldo != null,
    id_liquidacion_sueldo: c.id_liquidacion_sueldo || null
  }));
}

// idChoferes: opcional. Si viene, acota la liquidación a esos choferes (además
// de exigir sueldo_fijo_mensual > 0, nunca se confía ciegamente en la lista
// del cliente). Sin idChoferes, liquida a todos como antes.
async function liquidarSueldosFijosDelMes(db, idEmpresa, periodo, idChoferes) {
  validarPeriodo(periodo);

  const condiciones = ['ch.id_empresa = ?', 'ch.sueldo_fijo_mensual > 0'];
  const params = [idEmpresa];
  if (Array.isArray(idChoferes)) {
    const ids = idChoferes.map(Number).filter(id => Number.isInteger(id) && id > 0);
    if (ids.length === 0) return { periodo, liquidados: 0, ya_liquidados: 0, total_choferes: 0 };
    condiciones.push(`ch.id_chofer IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }

  const [choferes] = await db.query(`
    SELECT ch.id_chofer, ch.nombre, ch.sueldo_fijo_mensual, cu.id_cuenta
    FROM CHOFERES ch
    JOIN CUENTA cu ON cu.cuil = ch.cuil AND cu.id_empresa = ch.id_empresa AND cu.tipo = 'CHOFER'
    WHERE ${condiciones.join(' AND ')}
  `, params);

  let liquidados = 0;
  let yaLiquidados = 0;
  for (const chofer of choferes) {
    const [existentes] = await db.query(
      'SELECT id_liquidacion_sueldo FROM LIQUIDACIONES_SUELDO WHERE id_empresa = ? AND id_chofer = ? AND periodo = ?',
      [idEmpresa, chofer.id_chofer, periodo]
    );
    if (existentes.length > 0) { yaLiquidados += 1; continue; }

    const monto = Number(chofer.sueldo_fijo_mensual);
    const [resultado] = await db.query('INSERT INTO LIQUIDACIONES_SUELDO SET ?', [{
      id_empresa: idEmpresa, id_chofer: chofer.id_chofer, periodo, monto
    }]);

    await crearMovimientoAutomatico(db, {
      idEmpresa,
      idCuenta: chofer.id_cuenta,
      monto,
      fecha: `${periodo}-01`,
      concepto: `SUELDO FIJO ${periodo} — ${chofer.nombre}`,
      origenTipo: ORIGEN.LIQUIDACION_SUELDO_FIJO,
      origenId: resultado.insertId
    });
    liquidados += 1;
  }

  return { periodo, liquidados, ya_liquidados: yaLiquidados, total_choferes: choferes.length };
}

// Liquidaciones de un período, con datos del chofer — para el PDF general.
async function obtenerLiquidacionesDelPeriodo(db, idEmpresa, periodo) {
  validarPeriodo(periodo);
  const [filas] = await db.query(`
    SELECT ls.id_liquidacion_sueldo, ls.periodo, ls.monto, ch.id_chofer, ch.nombre, ch.cuil
    FROM LIQUIDACIONES_SUELDO ls
    JOIN CHOFERES ch ON ch.id_chofer = ls.id_chofer
    WHERE ls.id_empresa = ? AND ls.periodo = ?
    ORDER BY ch.nombre
  `, [idEmpresa, periodo]);
  return filas.map(f => ({ ...f, monto: Number(f.monto) }));
}

// Una liquidación puntual, con datos del chofer — para el recibo individual.
async function obtenerLiquidacion(db, idEmpresa, idLiquidacion) {
  const [[fila]] = await db.query(`
    SELECT ls.id_liquidacion_sueldo, ls.periodo, ls.monto,
           ch.id_chofer, ch.nombre, ch.cuil, ch.domicilio, ch.telefono
    FROM LIQUIDACIONES_SUELDO ls
    JOIN CHOFERES ch ON ch.id_chofer = ls.id_chofer
    WHERE ls.id_empresa = ? AND ls.id_liquidacion_sueldo = ?
  `, [idEmpresa, idLiquidacion]);
  if (!fila) return null;
  return { ...fila, monto: Number(fila.monto) };
}

module.exports = {
  listarLiquidables,
  liquidarSueldosFijosDelMes,
  obtenerLiquidacionesDelPeriodo,
  obtenerLiquidacion
};
