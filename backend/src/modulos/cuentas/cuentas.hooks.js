// backend/src/modulos/cuentas/cuentas.hooks.js
// Sincronización entre CHOFERES y CUENTA (tipo CHOFER), aislada por empresa.
// El CUIL identifica al chofer dentro de su empresa (puede repetirse entre
// empresas distintas).
const pool = require('../../config/db');

async function alCrearChofer(chofer, req) {
  const idEmpresa = req.usuario.id_empresa;
  const [[existente]] = await pool.query(
    'SELECT id_cuenta FROM CUENTA WHERE cuil = ? AND id_empresa = ?',
    [chofer.cuil, idEmpresa]
  );
  if (existente) return;

  await pool.query('INSERT INTO CUENTA SET ?', [{
    id_empresa: idEmpresa,
    tipo: 'CHOFER',
    cuil: chofer.cuil,
    nombre: chofer.nombre,
    domicilio: chofer.domicilio || null,
    telefono: chofer.telefono || null
  }]);
}

async function alActualizarChofer(chofer, anterior, req) {
  const idEmpresa = req.usuario.id_empresa;
  const cuilBusqueda = anterior?.cuil || chofer.cuil;

  const [resultado] = await pool.query(
    `UPDATE CUENTA SET cuil = ?, nombre = ?, domicilio = ?, telefono = ?
     WHERE cuil = ? AND id_empresa = ? AND tipo = 'CHOFER'`,
    [chofer.cuil, chofer.nombre, chofer.domicilio || null, chofer.telefono || null, cuilBusqueda, idEmpresa]
  );

  if (resultado.affectedRows === 0) {
    await alCrearChofer(chofer, req);
  }
}

async function alEliminarChofer(chofer, req) {
  const idEmpresa = req.usuario.id_empresa;
  const [[cuenta]] = await pool.query(
    "SELECT id_cuenta FROM CUENTA WHERE cuil = ? AND id_empresa = ? AND tipo = 'CHOFER'",
    [chofer.cuil, idEmpresa]
  );
  if (!cuenta) return;

  const [[mov]] = await pool.query(
    'SELECT COUNT(*) AS total FROM MOVIMIENTOS WHERE id_cuenta = ?', [cuenta.id_cuenta]
  );
  if (Number(mov.total) === 0) {
    await pool.query('DELETE FROM CUENTA WHERE id_cuenta = ?', [cuenta.id_cuenta]);
  }
}

// ---------- Validaciones sobre CUENTA ----------

function antesDeCrearCuenta(data) {
  if (data.tipo === 'CHOFER') {
    return 'Las cuentas de tipo CHOFER se crean automáticamente al registrar un chofer en el módulo Choferes.';
  }
  return null;
}

async function antesDeActualizarCuenta(id, data, anterior) {
  if (anterior && anterior.tipo === 'CHOFER') {
    return 'Las cuentas de tipo CHOFER deben editarse desde el módulo Choferes.';
  }
  if (data.tipo === 'CHOFER') {
    return 'No se puede cambiar el tipo de una cuenta a CHOFER manualmente.';
  }
  return null;
}

function antesDeEliminarCuenta(cuenta) {
  if (cuenta.tipo === 'CHOFER') {
    return 'Las cuentas de tipo CHOFER se eliminan automáticamente al eliminar el chofer del módulo Choferes.';
  }
  return null;
}

module.exports = {
  alCrearChofer,
  alActualizarChofer,
  alEliminarChofer,
  antesDeCrearCuenta,
  antesDeActualizarCuenta,
  antesDeEliminarCuenta
};
