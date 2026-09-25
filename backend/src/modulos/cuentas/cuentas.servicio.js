// backend/src/modulos/cuentas/cuentas.servicio.js
// Operaciones sobre CUENTA compartidas por otros módulos (consumos y gastos
// administrativos): buscar la cuenta de un proveedor y validar que exista.
// Siempre dentro de la empresa del usuario.
const pool = require('../../config/db');

// Busca la cuenta del proveedor por nombre exacto DENTRO de la empresa.
// Si hay una PROVEEDOR y una CLIENTE con el mismo nombre, prefiere PROVEEDOR.
async function buscarCuentaProveedor(nombre, idEmpresa) {
  if (!nombre) return null;
  const [[cuenta]] = await pool.query(
    `SELECT id_cuenta FROM CUENTA
     WHERE nombre = ? AND id_empresa = ? AND tipo IN ('PROVEEDOR', 'CLIENTE')
     ORDER BY FIELD(tipo, 'PROVEEDOR', 'CLIENTE') LIMIT 1`,
    [nombre, idEmpresa]
  );
  return cuenta || null;
}

// Validación estricta: el proveedor debe existir como cuenta de la empresa.
// Devuelve un mensaje de error o null si es válido.
async function validarProveedor(data, anterior, idEmpresa) {
  const proveedor = data.proveedor !== undefined ? data.proveedor : anterior?.proveedor;
  if (!proveedor) {
    return 'El proveedor es obligatorio y debe corresponder a una cuenta registrada en el sistema.';
  }
  const cuenta = await buscarCuentaProveedor(proveedor, idEmpresa);
  if (!cuenta) {
    return `El proveedor "${proveedor}" no está registrado como cuenta PROVEEDOR o CLIENTE. Crea primero la cuenta en el módulo Cuentas.`;
  }
  return null;
}

module.exports = { buscarCuentaProveedor, validarProveedor };
