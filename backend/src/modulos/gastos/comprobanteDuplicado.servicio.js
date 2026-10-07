// backend/src/modulos/gastos/comprobanteDuplicado.servicio.js
// Bloque 7 · índice único lógico por (empresa, proveedor, tipo, letra, punto
// de venta, número): la misma factura de un proveedor no se puede cargar dos
// veces, ni siquiera en una tabla distinta (combustible, generales o gastos
// administrativos). Real UNIQUE de MySQL no alcanza porque son tres tablas.
const { TIPOS_SIN_DATOS_FISCALES } = require('./comprobanteCompra');

const TABLAS = [
  { tabla: 'CONSUMOS_COMBUSTIBLE', idCampo: 'id_consumo_combustible' },
  { tabla: 'CONSUMOS_GENERALES', idCampo: 'id_consumo_general' },
  { tabla: 'GASTOS_ADMINISTRATIVOS', idCampo: 'id_gasto_administrativo' }
];

// Solo un comprobante con número identifica una factura concreta:
// NO_INFORMADO/SIN_COMPROBANTE o sin punto de venta/número no se controlan.
function identificaComprobante(datos) {
  return datos.comprobante_tipo && !TIPOS_SIN_DATOS_FISCALES.has(datos.comprobante_tipo) &&
    datos.comprobante_punto_venta != null && datos.comprobante_numero != null;
}

// tablaActual/idActual: para excluirse a sí mismo al editar un registro.
async function validarComprobanteNoDuplicado(db, idEmpresa, proveedor, datos, tablaActual, idActual) {
  if (!identificaComprobante(datos)) return null;

  for (const { tabla, idCampo } of TABLAS) {
    const excluirPropio = tabla === tablaActual && idActual ? `AND ${idCampo} <> ?` : '';
    const params = [idEmpresa, proveedor, datos.comprobante_tipo, datos.comprobante_letra || null,
      datos.comprobante_punto_venta, datos.comprobante_numero];
    if (excluirPropio) params.push(idActual);

    const [filas] = await db.query(
      `SELECT ${idCampo} FROM ${tabla}
        WHERE id_empresa = ? AND proveedor = ? AND comprobante_tipo = ?
          AND comprobante_letra <=> ? AND comprobante_punto_venta = ? AND comprobante_numero = ?
          ${excluirPropio} LIMIT 1`,
      params
    );
    if (filas.length > 0) {
      const letra = datos.comprobante_letra ? ` ${datos.comprobante_letra}` : '';
      return `Ya existe un comprobante ${datos.comprobante_tipo}${letra} ` +
        `${datos.comprobante_punto_venta}-${datos.comprobante_numero} cargado para "${proveedor}".`;
    }
  }
  return null;
}

module.exports = { validarComprobanteNoDuplicado };
