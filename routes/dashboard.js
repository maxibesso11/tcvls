// routes/dashboard.js
// Métricas y KPIs agregados. Todas las consultas se restringen a la empresa
// del usuario autenticado (req.usuario.id_empresa).
const express = require('express');
const pool = require('../config/db');
const router = express.Router();

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

// Atajo: solo filtro de empresa
const emp = req => req.usuario.id_empresa;

// ==================== KPIs ====================
router.get('/kpis', async (req, res) => {
  try {
    const fViajes = filtros(req, { colFecha: 'fecha_origen' });
    const fComb   = filtros(req, { colFecha: 'fecha' });
    const fGen    = filtros(req, { colFecha: 'fecha' });
    const fAdmin  = filtros(req, { colFecha: 'fecha' });

    const [[viajes]] = await pool.query(`
      SELECT COUNT(*) AS total_viajes,
        SUM(estado IN ('EN CURSO','EN DESTINO')) AS viajes_activos,
        SUM(estado = 'FINALIZADO') AS viajes_finalizados,
        SUM(estado = 'FACTURADO') AS viajes_facturados
      FROM VIAJES${fViajes.clausula}
    `, fViajes.params);

    const [[ingresos]] = await pool.query(`
      SELECT COALESCE(SUM(CASE WHEN tipo_tarifa = 'UNICA' THEN tarifa
                   ELSE tarifa * COALESCE(resultado, cantidad_cargada, 0) END), 0) AS ingresos_totales
      FROM VIAJES${fViajes.clausula}
    `, fViajes.params);

    const [[cobros]] = await pool.query(`
      SELECT COALESCE(SUM(saldo_negativo), 0) AS pendiente_cobro
      FROM (
        SELECT LEAST(COALESCE(SUM(m.monto), 0), 0) * -1 AS saldo_negativo
        FROM CUENTA c
        LEFT JOIN MOVIMIENTOS m ON m.id_cuenta = c.id_cuenta
        WHERE c.id_empresa = ? AND c.tipo IN ('CLIENTE', 'PROVEEDOR')
        GROUP BY c.id_cuenta
      ) AS saldos
    `, [emp(req)]);

    const [[combustible]] = await pool.query(`
      SELECT COALESCE(SUM(cantidad_litros), 0) AS litros_totales,
        COALESCE(SUM(cantidad_litros * precio_por_litro), 0) AS gasto_combustible,
        COALESCE(SUM(km_recorridos) / NULLIF(SUM(cantidad_litros), 0), 0) AS rendimiento_global
      FROM CONSUMOS_COMBUSTIBLE${fComb.clausula}
    `, fComb.params);

    const [[gastosGenerales]] = await pool.query(`
      SELECT COALESCE(SUM(monto), 0) AS total FROM CONSUMOS_GENERALES${fGen.clausula}
    `, fGen.params);

    const [[gastosAdmin]] = await pool.query(`
      SELECT COALESCE(SUM(monto), 0) AS total FROM GASTOS_ADMINISTRATIVOS${fAdmin.clausula}
    `, fAdmin.params);

    const [[conteos]] = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM CHOFERES WHERE id_empresa = ?) AS total_choferes,
        (SELECT COUNT(*) FROM UNIDADES WHERE id_empresa = ?) AS total_unidades,
        (SELECT COUNT(*) FROM EQUIPO WHERE id_empresa = ?) AS total_equipos
    `, [emp(req), emp(req), emp(req)]);

    const ingresosTotales = Number(ingresos.ingresos_totales);
    const costos = Number(combustible.gasto_combustible) + Number(gastosGenerales.total) + Number(gastosAdmin.total);
    const gananciaNeta = ingresosTotales - costos;
    const margen = ingresosTotales > 0 ? (gananciaNeta / ingresosTotales) * 100 : 0;

    res.json({
      viajes,
      ingresos: {
        ingresos_totales: ingresosTotales,
        pendiente_cobro: Number(cobros.pendiente_cobro),
        costos_totales: costos,
        ganancia_neta: gananciaNeta,
        margen
      },
      combustible: {
        litros_totales: Number(combustible.litros_totales),
        gasto_combustible: Number(combustible.gasto_combustible),
        rendimiento_global: Number(combustible.rendimiento_global)
      },
      gastos_generales: Number(gastosGenerales.total),
      gastos_administrativos: Number(gastosAdmin.total),
      flota: {
        total_choferes: Number(conteos.total_choferes),
        total_unidades: Number(conteos.total_unidades),
        total_equipos: Number(conteos.total_equipos)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== ALERTAS ====================
router.get('/alertas', async (req, res) => {
  const LIMITE = 50;
  const e = emp(req);
  try {
    const [carnets] = await pool.query(`
      SELECT id_chofer, nombre, vencimiento_carnet,
             DATEDIFF(vencimiento_carnet, CURDATE()) AS dias_restantes
      FROM CHOFERES
      WHERE id_empresa = ? AND vencimiento_carnet <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
      ORDER BY vencimiento_carnet LIMIT ${LIMITE}
    `, [e]);

    const [vencimientos] = await pool.query(`
      SELECT v.id_vencimiento, v.concepto, v.fecha_vencimiento, u.patente,
             DATEDIFF(v.fecha_vencimiento, CURDATE()) AS dias_restantes
      FROM VENCIMIENTOS v
      JOIN UNIDADES u ON u.id_unidad = v.id_unidad
      WHERE v.id_empresa = ? AND v.fecha_vencimiento <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
      ORDER BY v.fecha_vencimiento LIMIT ${LIMITE}
    `, [e]);

    const [mantenimientos] = await pool.query(`
      SELECT m.id_mantenimiento, m.concepto, m.fecha_vencimiento, u.patente,
             DATEDIFF(m.fecha_vencimiento, CURDATE()) AS dias_restantes
      FROM MANTENIMIENTOS m
      JOIN UNIDADES u ON u.id_unidad = m.id_unidad
      WHERE m.id_empresa = ? AND m.fecha_vencimiento <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
      ORDER BY m.fecha_vencimiento LIMIT ${LIMITE}
    `, [e]);

    const [descansos] = await pool.query(`
      SELECT id_chofer, nombre, ultima_jornada_descanso,
             DATEDIFF(CURDATE(), ultima_jornada_descanso) AS dias_sin_descanso
      FROM CHOFERES
      WHERE id_empresa = ? AND ultima_jornada_descanso IS NOT NULL
        AND DATEDIFF(CURDATE(), ultima_jornada_descanso) >= 25
      ORDER BY ultima_jornada_descanso LIMIT ${LIMITE}
    `, [e]);

    const [[totales]] = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM CHOFERES WHERE id_empresa = ? AND vencimiento_carnet <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)) AS carnets,
        (SELECT COUNT(*) FROM VENCIMIENTOS WHERE id_empresa = ? AND fecha_vencimiento <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)) AS vencimientos,
        (SELECT COUNT(*) FROM MANTENIMIENTOS WHERE id_empresa = ? AND fecha_vencimiento <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)) AS mantenimientos,
        (SELECT COUNT(*) FROM CHOFERES WHERE id_empresa = ? AND ultima_jornada_descanso IS NOT NULL AND DATEDIFF(CURDATE(), ultima_jornada_descanso) >= 25) AS descansos
    `, [e, e, e, e]);

    res.json({
      carnets, vencimientos, mantenimientos, descansos,
      totales: {
        carnets: Number(totales.carnets), vencimientos: Number(totales.vencimientos),
        mantenimientos: Number(totales.mantenimientos), descansos: Number(totales.descansos)
      },
      limite: LIMITE
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== RENDIMIENTO POR EQUIPO ====================
router.get('/rendimiento-equipos', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT e.id_equipo, up.patente AS patente_principal, us.patente AS patente_secundaria,
        ch.nombre AS chofer,
        COALESCE(SUM(cc.cantidad_litros), 0) AS litros,
        COALESCE(SUM(cc.km_recorridos), 0) AS km,
        COALESCE(SUM(cc.cantidad_litros * cc.precio_por_litro), 0) AS gasto,
        COALESCE(SUM(cc.km_recorridos) / NULLIF(SUM(cc.cantidad_litros), 0), 0) AS km_por_litro,
        COALESCE(SUM(cc.cantidad_litros * cc.precio_por_litro) / NULLIF(SUM(cc.km_recorridos), 0), 0) AS costo_por_km
      FROM EQUIPO e
      JOIN UNIDADES up ON up.id_unidad = e.id_unidad_principal
      JOIN UNIDADES us ON us.id_unidad = e.id_unidad_secundaria
      JOIN CHOFERES ch ON ch.id_chofer = e.id_chofer
      LEFT JOIN CONSUMOS_COMBUSTIBLE cc ON cc.id_equipo = e.id_equipo
      WHERE e.id_empresa = ?
      GROUP BY e.id_equipo, up.patente, us.patente, ch.nombre
      ORDER BY km_por_litro DESC LIMIT 50
    `, [emp(req)]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== RENDIMIENTO POR CHOFER ====================
router.get('/rendimiento-choferes', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT ch.id_chofer, ch.nombre,
        COUNT(v.id_viaje) AS viajes,
        COALESCE(SUM(CASE WHEN v.tipo_tarifa='UNICA' THEN v.tarifa
                 ELSE v.tarifa * COALESCE(v.resultado, v.cantidad_cargada, 0) END), 0) AS ingresos
      FROM CHOFERES ch
      LEFT JOIN EQUIPO e ON e.id_chofer = ch.id_chofer
      LEFT JOIN VIAJES v ON v.id_equipo = e.id_equipo
      WHERE ch.id_empresa = ?
      GROUP BY ch.id_chofer, ch.nombre
      ORDER BY ingresos DESC LIMIT 50
    `, [emp(req)]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== INGRESOS MENSUALES ====================
router.get('/ingresos-mensuales', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT DATE_FORMAT(fecha_origen, '%Y-%m') AS mes,
        COUNT(*) AS viajes,
        COALESCE(SUM(CASE WHEN tipo_tarifa='UNICA' THEN tarifa
                 ELSE tarifa * COALESCE(resultado, cantidad_cargada, 0) END), 0) AS ingresos
      FROM VIAJES
      WHERE id_empresa = ? AND fecha_origen >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
      GROUP BY mes ORDER BY mes
    `, [emp(req)]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== CLIENTES TOP ====================
router.get('/clientes-top', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT pagador,
        COUNT(*) AS viajes,
        COALESCE(SUM(CASE WHEN tipo_tarifa='UNICA' THEN tarifa
                 ELSE tarifa * COALESCE(resultado, cantidad_cargada, 0) END), 0) AS ingresos
      FROM VIAJES
      WHERE id_empresa = ? AND pagador IS NOT NULL AND pagador <> ''
      GROUP BY pagador ORDER BY ingresos DESC LIMIT 10
    `, [emp(req)]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== CONSUMOS GENERALES POR EQUIPO ====================
router.get('/consumos-por-equipo', async (req, res) => {
  try {
    const e = emp(req);
    const equipoCond = req.query.id_equipo ? ' AND e.id_equipo = ?' : '';
    const equipoParam = req.query.id_equipo ? [req.query.id_equipo] : [];

    const condFecha = [];
    const pFecha = [];
    if (req.query.fecha_desde) { condFecha.push('DATE(cg.fecha) >= ?'); pFecha.push(req.query.fecha_desde); }
    if (req.query.fecha_hasta) { condFecha.push('DATE(cg.fecha) <= ?'); pFecha.push(req.query.fecha_hasta); }
    const fechaCond = condFecha.length ? ' AND ' + condFecha.join(' AND ') : '';

    if (req.query.detalle === '1') {
      const [rows] = await pool.query(`
        SELECT cg.id_consumo_general, cg.fecha, cg.proveedor, cg.concepto, cg.monto, u.patente, e.id_equipo
        FROM CONSUMOS_GENERALES cg
        JOIN UNIDADES u ON u.id_unidad = cg.id_unidad
        JOIN EQUIPO e ON (e.id_unidad_principal = u.id_unidad OR e.id_unidad_secundaria = u.id_unidad)
        WHERE cg.id_empresa = ? ${fechaCond} ${equipoCond}
        ORDER BY cg.fecha DESC LIMIT 200
      `, [e, ...pFecha, ...equipoParam]);
      return res.json(rows);
    }

    const [rows] = await pool.query(`
      SELECT e.id_equipo, up.patente AS patente_principal, us.patente AS patente_secundaria,
        ch.nombre AS chofer,
        COUNT(cg.id_consumo_general) AS cantidad,
        COALESCE(SUM(cg.monto), 0) AS total
      FROM EQUIPO e
      JOIN UNIDADES up ON up.id_unidad = e.id_unidad_principal
      JOIN UNIDADES us ON us.id_unidad = e.id_unidad_secundaria
      JOIN CHOFERES ch ON ch.id_chofer = e.id_chofer
      LEFT JOIN CONSUMOS_GENERALES cg
        ON (cg.id_unidad = e.id_unidad_principal OR cg.id_unidad = e.id_unidad_secundaria) ${fechaCond}
      WHERE e.id_empresa = ? ${equipoCond}
      GROUP BY e.id_equipo, up.patente, us.patente, ch.nombre
      ORDER BY total DESC LIMIT 50
    `, [...pFecha, e, ...equipoParam]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== INGRESOS POR VIAJE ====================
router.get('/ingresos-por-viaje', async (req, res) => {
  try {
    const f = filtros(req, { colFecha: 'v.fecha_origen', colEquipo: 'v.id_equipo', aliasEmpresa: 'v.id_empresa' });

    if (req.query.detalle === '1') {
      const [rows] = await pool.query(`
        SELECT v.id_viaje, v.fecha_origen, v.origen, v.destino, v.tipo_carga,
          v.tarifa, v.tipo_tarifa, v.resultado, v.cantidad_cargada, v.estado, v.pagador, v.numero_remito,
          up.patente AS patente_principal, us.patente AS patente_secundaria,
          (CASE WHEN v.tipo_tarifa='UNICA' THEN v.tarifa
                ELSE v.tarifa * COALESCE(v.resultado, v.cantidad_cargada, 0) END) AS ingreso
        FROM VIAJES v
        JOIN EQUIPO e ON e.id_equipo = v.id_equipo
        JOIN UNIDADES up ON up.id_unidad = e.id_unidad_principal
        JOIN UNIDADES us ON us.id_unidad = e.id_unidad_secundaria
        ${f.clausula}
        ORDER BY ingreso DESC LIMIT 200
      `, f.params);
      return res.json(rows);
    }

    const [[resumen]] = await pool.query(`
      SELECT COUNT(*) AS cantidad_viajes,
        COALESCE(SUM(CASE WHEN v.tipo_tarifa='UNICA' THEN v.tarifa
                 ELSE v.tarifa * COALESCE(v.resultado, v.cantidad_cargada, 0) END), 0) AS ingreso_total,
        COALESCE(AVG(CASE WHEN v.tipo_tarifa='UNICA' THEN v.tarifa
                 ELSE v.tarifa * COALESCE(v.resultado, v.cantidad_cargada, 0) END), 0) AS ingreso_promedio
      FROM VIAJES v${f.clausula}
    `, f.params);

    const [porTipo] = await pool.query(`
      SELECT v.tipo_tarifa, COUNT(*) AS cantidad,
        COALESCE(SUM(CASE WHEN v.tipo_tarifa='UNICA' THEN v.tarifa
                 ELSE v.tarifa * COALESCE(v.resultado, v.cantidad_cargada, 0) END), 0) AS ingreso
      FROM VIAJES v${f.clausula}
      GROUP BY v.tipo_tarifa ORDER BY ingreso DESC
    `, f.params);

    // Top 7 viajes con más ingresos (para el panel del dashboard)
    const [topViajes] = await pool.query(`
      SELECT v.id_viaje, v.fecha_origen, v.origen, v.destino, v.pagador,
        up.patente AS patente_principal,
        (CASE WHEN v.tipo_tarifa='UNICA' THEN v.tarifa
              ELSE v.tarifa * COALESCE(v.resultado, v.cantidad_cargada, 0) END) AS ingreso
      FROM VIAJES v
      JOIN EQUIPO e ON e.id_equipo = v.id_equipo
      JOIN UNIDADES up ON up.id_unidad = e.id_unidad_principal
      ${f.clausula}
      ORDER BY ingreso DESC LIMIT 7
    `, f.params);

    res.json({
      resumen: {
        cantidad_viajes: Number(resumen.cantidad_viajes),
        ingreso_total: Number(resumen.ingreso_total),
        ingreso_promedio: Number(resumen.ingreso_promedio)
      },
      top_viajes: topViajes,
      por_tipo: porTipo
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== RENTABILIDAD POR EQUIPO ====================
router.get('/rentabilidad-equipos', async (req, res) => {
  try {
    const e = emp(req);
    const desde = req.query.fecha_desde || null;
    const hasta = req.query.fecha_hasta || null;
    const idEquipoFiltro = req.query.id_equipo || null;

    let diasPeriodo = 30;
    if (desde && hasta) {
      const d1 = new Date(desde), d2 = new Date(hasta);
      diasPeriodo = Math.max(1, Math.round((d2 - d1) / 86400000) + 1);
    }

    const fVi = []; const pVi = [];
    if (desde) { fVi.push('DATE(v.fecha_origen) >= ?'); pVi.push(desde); }
    if (hasta) { fVi.push('DATE(v.fecha_origen) <= ?'); pVi.push(hasta); }
    const wVi = fVi.length ? ' AND ' + fVi.join(' AND ') : '';

    const fCo = []; const pCo = [];
    if (desde) { fCo.push('DATE(cc.fecha) >= ?'); pCo.push(desde); }
    if (hasta) { fCo.push('DATE(cc.fecha) <= ?'); pCo.push(hasta); }
    const wCo = fCo.length ? ' AND ' + fCo.join(' AND ') : '';

    const fGe = []; const pGe = [];
    if (desde) { fGe.push('DATE(cg.fecha) >= ?'); pGe.push(desde); }
    if (hasta) { fGe.push('DATE(cg.fecha) <= ?'); pGe.push(hasta); }
    const wGe = fGe.length ? ' AND ' + fGe.join(' AND ') : '';

    const equipoCond = idEquipoFiltro ? ' AND e.id_equipo = ?' : '';
    const equipoParam = idEquipoFiltro ? [idEquipoFiltro] : [];

    const [equipos] = await pool.query(`
      SELECT e.id_equipo, e.id_unidad_principal, e.id_unidad_secundaria,
        up.patente AS patente_principal, us.patente AS patente_secundaria,
        ch.id_chofer, ch.nombre AS chofer, ch.tipo_remuneracion, ch.remuneracion
      FROM EQUIPO e
      JOIN UNIDADES up ON up.id_unidad = e.id_unidad_principal
      JOIN UNIDADES us ON us.id_unidad = e.id_unidad_secundaria
      JOIN CHOFERES ch ON ch.id_chofer = e.id_chofer
      WHERE e.id_empresa = ?${equipoCond}
      ORDER BY e.id_equipo
    `, [e, ...equipoParam]);

    const resultado = [];
    for (const eq of equipos) {
      const [[ing]] = await pool.query(`
        SELECT COALESCE(SUM(CASE WHEN v.tipo_tarifa='UNICA' THEN v.tarifa
                 ELSE v.tarifa * COALESCE(v.resultado, v.cantidad_cargada, 0) END), 0) AS ingresos
        FROM VIAJES v WHERE v.id_empresa = ? AND v.id_equipo = ?${wVi}
      `, [e, eq.id_equipo, ...pVi]);

      const [[comb]] = await pool.query(`
        SELECT COALESCE(SUM(cc.cantidad_litros * cc.precio_por_litro), 0) AS gasto
        FROM CONSUMOS_COMBUSTIBLE cc WHERE cc.id_empresa = ? AND cc.id_equipo = ?${wCo}
      `, [e, eq.id_equipo, ...pCo]);

      const [[gen]] = await pool.query(`
        SELECT COALESCE(SUM(cg.monto), 0) AS gasto
        FROM CONSUMOS_GENERALES cg
        WHERE cg.id_empresa = ? AND cg.id_unidad IN (?, ?)${wGe}
      `, [e, eq.id_unidad_principal, eq.id_unidad_secundaria, ...pGe]);

      let sueldo = 0;
      const remu = Number(eq.remuneracion) || 0;
      if (eq.tipo_remuneracion === 'PORCENTAJE') {
        const [[liq]] = await pool.query(`
          SELECT COALESCE(SUM((CASE WHEN v.tipo_tarifa='UNICA' THEN v.tarifa
                   ELSE v.tarifa * COALESCE(v.resultado, v.cantidad_cargada, 0) END) * ? / 100), 0) AS sueldo
          FROM VIAJES v WHERE v.id_empresa = ? AND v.id_equipo = ?
            AND v.estado IN ('FINALIZADO','FACTURADO')${wVi}
        `, [remu, e, eq.id_equipo, ...pVi]);
        sueldo = Number(liq.sueldo);
      } else if (eq.tipo_remuneracion === 'POR KM') {
        const [[liq]] = await pool.query(`
          SELECT COALESCE(SUM(COALESCE(v.resultado, 0) * ?), 0) AS sueldo
          FROM VIAJES v WHERE v.id_empresa = ? AND v.id_equipo = ? AND v.tipo_tarifa='POR KM'
            AND v.estado IN ('FINALIZADO','FACTURADO')${wVi}
        `, [remu, e, eq.id_equipo, ...pVi]);
        sueldo = Number(liq.sueldo);
      } else if (eq.tipo_remuneracion === 'FIJA') {
        sueldo = (remu / 30) * diasPeriodo;
      }

      const ingresos = Number(ing.ingresos);
      const costoComb = Number(comb.gasto);
      const costoGen = Number(gen.gasto);
      const costos = costoComb + costoGen + sueldo;
      resultado.push({
        id_equipo: eq.id_equipo, patente_principal: eq.patente_principal,
        patente_secundaria: eq.patente_secundaria, chofer: eq.chofer,
        tipo_remuneracion: eq.tipo_remuneracion,
        ingresos, costo_combustible: costoComb, costo_generales: costoGen,
        sueldo, costos, rentabilidad: ingresos - costos,
        margen: ingresos > 0 ? ((ingresos - costos) / ingresos) * 100 : 0
      });
    }

    resultado.sort((a, b) => b.rentabilidad - a.rentabilidad);

    const wGa = []; const pGa = [];
    if (desde) { wGa.push('DATE(fecha) >= ?'); pGa.push(desde); }
    if (hasta) { wGa.push('DATE(fecha) <= ?'); pGa.push(hasta); }
    const whereGa = wGa.length ? ' AND ' + wGa.join(' AND ') : '';
    const [[gastosAdmin]] = await pool.query(
      `SELECT COALESCE(SUM(monto), 0) AS total FROM GASTOS_ADMINISTRATIVOS WHERE id_empresa = ?${whereGa}`,
      [e, ...pGa]
    );

    const sumaRent = resultado.reduce((s, r) => s + r.rentabilidad, 0);
    const totalGA = Number(gastosAdmin.total);
    res.json({
      equipos: resultado, dias_periodo: diasPeriodo,
      gastos_administrativos: totalGA,
      rentabilidad_equipos: sumaRent,
      rentabilidad_neta: sumaRent - totalGA
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== GASTOS ADMINISTRATIVOS ====================
router.get('/gastos-administrativos', async (req, res) => {
  try {
    const e = emp(req);
    const cond = ['id_empresa = ?']; const params = [e];
    if (req.query.fecha_desde) { cond.push('DATE(fecha) >= ?'); params.push(req.query.fecha_desde); }
    if (req.query.fecha_hasta) { cond.push('DATE(fecha) <= ?'); params.push(req.query.fecha_hasta); }
    const where = ' WHERE ' + cond.join(' AND ');

    if (req.query.detalle === '1') {
      const [rows] = await pool.query(`
        SELECT id_gasto_administrativo, proveedor, concepto, fecha, monto
        FROM GASTOS_ADMINISTRATIVOS${where} ORDER BY fecha DESC LIMIT 200
      `, params);
      return res.json(rows);
    }

    const [[total]] = await pool.query(
      `SELECT COALESCE(SUM(monto), 0) AS total, COUNT(*) AS cantidad FROM GASTOS_ADMINISTRATIVOS${where}`, params
    );
    const [porProveedor] = await pool.query(`
      SELECT proveedor, COUNT(*) AS cantidad, COALESCE(SUM(monto), 0) AS total
      FROM GASTOS_ADMINISTRATIVOS${where}
      GROUP BY proveedor ORDER BY total DESC LIMIT 50
    `, params);

    res.json({ total: Number(total.total), cantidad: Number(total.cantidad), por_proveedor: porProveedor });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
