// backend/src/modulos/dashboard/dashboard.consultas.js
// Piezas de SQL reutilizadas por los endpoints del dashboard: expresiones de
// importes de un viaje (alias de tabla "v") y el armado de filtros WHERE.
const { IVA_ALICUOTA } = require('../../config/constantes');

// ---------- Expresiones de importes de viajes (reutilizables en SQL) ----------
// Valor bruto del viaje (tarifa × resultado, o tarifa fija si es UNICA).
const SQL_BASE_VIAJE = `(CASE WHEN v.tipo_tarifa='UNICA' THEN v.tarifa
      ELSE v.tarifa * COALESCE(v.resultado, v.cantidad_cargada, 0) END)`;

// Neto que se le cobra al cliente: la comisión reduce el valor a cobrar.
const SQL_NETO_VIAJE = `(${SQL_BASE_VIAJE} * (1 - COALESCE(v.comision, 0) / 100))`;

// IVA del viaje. Solo existe cuando el viaje fue FACTURADO y su modo de
// facturación lleva IVA (líquido producto o factura formal). Los viajes
// marcados SIN_FACTURAR no generan IVA. Los viajes anteriores a la columna
// modo_facturacion (NULL) se tratan como con IVA, igual que su imputación.
const SQL_IVA_VIAJE = `(CASE WHEN v.estado = 'FACTURADO'
        AND COALESCE(v.modo_facturacion, 'LIQUIDO_PRODUCTO') <> 'SIN_FACTURAR'
      THEN ${SQL_NETO_VIAJE} * ${IVA_ALICUOTA} ELSE 0 END)`;

// Construye condiciones WHERE incluyendo SIEMPRE el filtro de empresa,
// más rango de fechas y equipo opcionales. La columna de empresa puede
// llevar alias (ej. 'v.id_empresa').
function filtros(req, { colFecha = null, colEquipo = null, aliasEmpresa = 'id_empresa' } = {}) {
  const cond = [`${aliasEmpresa} = ?`];
  const params = [req.usuario.id_empresa];
  if (colFecha && req.query.fecha_desde) { cond.push(`DATE(${colFecha}) >= ?`); params.push(req.query.fecha_desde); }
  if (colFecha && req.query.fecha_hasta) { cond.push(`DATE(${colFecha}) <= ?`); params.push(req.query.fecha_hasta); }
  if (colEquipo && req.query.id_equipo) { cond.push(`${colEquipo} = ?`); params.push(req.query.id_equipo); }
  return {
    clausula: ' WHERE ' + cond.join(' AND '),
    and: ' AND ' + cond.join(' AND '),
    params
  };
}

module.exports = { SQL_BASE_VIAJE, SQL_NETO_VIAJE, SQL_IVA_VIAJE, filtros };
