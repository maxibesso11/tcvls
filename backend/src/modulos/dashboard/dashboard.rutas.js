// backend/src/modulos/dashboard/dashboard.rutas.js
// Métricas y KPIs agregados. Todas las consultas se restringen a la empresa
// del usuario autenticado (req.usuario.id_empresa).
const express = require('express');
const pool = require('../../config/db');
const { SQL_BASE_VIAJE, sqlIvaViaje, SQL_UNIDADES_DEL_VIAJE, sqlConsumoDelEquipo, filtros } = require('./dashboard.consultas');
const { sueldoFijoProrrateado } = require('./dashboard.calculos');
const { responderError } = require('../../lib/errores');
const { discriminaIva } = require('../../lib/condicionFiscal');
const router = express.Router();

// Atajo: solo filtro de empresa
const emp = req => req.usuario.id_empresa;

// Las métricas de ingresos y rentabilidad son para quien administra la
// empresa: un usuario común (rol USUARIO) ve rendimiento, consumos y reportes.
const veFinanzas = req => req.usuario.rol !== 'USUARIO';

// Rendimiento de combustible: solo cuentan las cargas con los km recorridos
// cargados (10 km o más; un 0 o un 1 es un dato de relleno). Si se sumaran
// los litros de las cargas sin km, el km/L quedaría artificialmente bajo.
const KM_VALIDO = 10;
const CON_KM = `cc.km_recorridos >= ${KM_VALIDO}`;
function soloFinanzas(req, res, next) {
  if (veFinanzas(req)) return next();
  res.status(403).json({ error: 'Las métricas de ingresos y rentabilidad son solo para quienes administran la empresa.' });
}

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

    // Ingresos = valor de los viajes con trabajo terminado (finalizados o
    // facturados). Se excluyen los viajes en curso/planificados, cuyo valor
    // todavía no es un ingreso realizado. Nota: "facturado" no implica
    // "cobrado"; lo efectivamente pendiente de cobro sale de las cuentas
    // corrientes (consulta siguiente).
    const [[ingresos]] = await pool.query(`
      SELECT COALESCE(SUM(CASE WHEN tipo_tarifa = 'UNICA' THEN tarifa
                   ELSE tarifa * COALESCE(resultado, cantidad_cargada, 0) END), 0) AS ingresos_totales
      FROM VIAJES${fViajes.clausula} AND estado IN ('FINALIZADO','FACTURADO')
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
        COALESCE(SUM(CASE WHEN km_recorridos >= ${KM_VALIDO} THEN km_recorridos END)
          / NULLIF(SUM(CASE WHEN km_recorridos >= ${KM_VALIDO} THEN cantidad_litros END), 0), 0) AS rendimiento_global,
        COUNT(*) AS cargas, SUM(km_recorridos >= ${KM_VALIDO}) AS cargas_con_km
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
        (SELECT COUNT(*) FROM EQUIPO WHERE id_empresa = ? AND activo = 1) AS total_equipos
    `, [emp(req), emp(req), emp(req)]);

    const ingresosTotales = Number(ingresos.ingresos_totales);
    const costos = Number(combustible.gasto_combustible) + Number(gastosGenerales.total) + Number(gastosAdmin.total);
    const gananciaNeta = ingresosTotales - costos;
    const margen = ingresosTotales > 0 ? (gananciaNeta / ingresosTotales) * 100 : 0;

    res.json({
      viajes,
      costos_totales: costos,
      ingresos: !veFinanzas(req) ? null : {
        ingresos_totales: ingresosTotales,
        pendiente_cobro: Number(cobros.pendiente_cobro),
        costos_totales: costos,
        ganancia_neta: gananciaNeta,
        margen
      },
      combustible: {
        litros_totales: Number(combustible.litros_totales),
        gasto_combustible: Number(combustible.gasto_combustible),
        rendimiento_global: Number(combustible.rendimiento_global),
        cargas: Number(combustible.cargas),
        cargas_con_km: Number(combustible.cargas_con_km || 0)
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
    responderError(res, err, req);
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
      LEFT JOIN UNIDADES u ON u.id_unidad = v.id_unidad
      WHERE v.id_empresa = ? AND v.fecha_vencimiento <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
      ORDER BY v.fecha_vencimiento LIMIT ${LIMITE}
    `, [e]);

    const [mantenimientos] = await pool.query(`
      SELECT m.id_mantenimiento, m.concepto, m.fecha_vencimiento, u.patente,
             DATEDIFF(m.fecha_vencimiento, CURDATE()) AS dias_restantes
      FROM MANTENIMIENTOS m
      LEFT JOIN UNIDADES u ON u.id_unidad = m.id_unidad
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

    // Cobros vencidos: clientes con plazo de pago definido que hoy están en
    // deuda (saldo < 0, condición DEUDOR) desde hace más días que su plazo.
    // "Desde cuándo debe" = fecha en que el saldo acumulado entró en deuda y
    // se mantuvo así hasta hoy. Se calcula recorriendo los movimientos en
    // orden cronológico.
    const [clientesConPlazo] = await pool.query(`
      SELECT id_cuenta, nombre, plazo_pago_dias
      FROM CUENTA
      WHERE id_empresa = ? AND tipo = 'CLIENTE'
        AND plazo_pago_dias IS NOT NULL AND plazo_pago_dias > 0
    `, [e]);

    const cobros = [];
    for (const cli of clientesConPlazo) {
      const [movs] = await pool.query(
        `SELECT monto, fecha FROM MOVIMIENTOS
          WHERE id_empresa = ? AND id_cuenta = ?
          ORDER BY fecha ASC, id_movimiento ASC`,
        [e, cli.id_cuenta]
      );
      // Recorrer acumulando el saldo. Registrar la fecha en que el saldo
      // pasó a ser deuda (< 0) viniendo de >= 0; esa es la fecha desde la
      // que el cliente debe de forma continua.
      let saldo = 0;
      let fechaInicioDeuda = null;
      for (const m of movs) {
        const antes = saldo;
        saldo = Math.round((saldo + Number(m.monto)) * 100) / 100;
        if (antes >= 0 && saldo < 0) fechaInicioDeuda = m.fecha;   // entra en deuda
        if (saldo >= 0) fechaInicioDeuda = null;                    // se saldó
      }
      if (saldo < 0 && fechaInicioDeuda) {
        const inicio = new Date(fechaInicioDeuda);
        const hoy = new Date();
        const diasDebiendo = Math.floor((hoy - inicio) / (1000 * 60 * 60 * 24));
        const diasExcedido = diasDebiendo - cli.plazo_pago_dias;
        if (diasExcedido > 0) {
          cobros.push({
            id_cuenta: cli.id_cuenta,
            nombre: cli.nombre,
            saldo_adeudado: Math.abs(saldo),
            plazo_pago_dias: cli.plazo_pago_dias,
            dias_debiendo: diasDebiendo,
            dias_excedido: diasExcedido,
            fecha_inicio_deuda: fechaInicioDeuda
          });
        }
      }
    }
    // Más vencidos primero
    cobros.sort((a, b) => b.dias_excedido - a.dias_excedido);
    const cobrosLimitados = cobros.slice(0, LIMITE);

    const [[totales]] = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM CHOFERES WHERE id_empresa = ? AND vencimiento_carnet <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)) AS carnets,
        (SELECT COUNT(*) FROM VENCIMIENTOS WHERE id_empresa = ? AND fecha_vencimiento <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)) AS vencimientos,
        (SELECT COUNT(*) FROM MANTENIMIENTOS WHERE id_empresa = ? AND fecha_vencimiento <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)) AS mantenimientos,
        (SELECT COUNT(*) FROM CHOFERES WHERE id_empresa = ? AND ultima_jornada_descanso IS NOT NULL AND DATEDIFF(CURDATE(), ultima_jornada_descanso) >= 25) AS descansos
    `, [e, e, e, e]);

    res.json({
      carnets, vencimientos, mantenimientos, descansos, cobros: cobrosLimitados,
      totales: {
        carnets: Number(totales.carnets), vencimientos: Number(totales.vencimientos),
        mantenimientos: Number(totales.mantenimientos), descansos: Number(totales.descansos),
        cobros: cobros.length
      },
      limite: LIMITE
    });
  } catch (err) {
    responderError(res, err, req);
  }
});

// ==================== RENDIMIENTO POR EQUIPO ====================
router.get('/rendimiento-equipos', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT e.id_equipo, e.activo, e.fecha_baja, up.patente AS patente_principal, us.patente AS patente_secundaria,
        ch.nombre AS chofer,
        COALESCE(SUM(cc.cantidad_litros), 0) AS litros,
        COALESCE(SUM(cc.cantidad_litros * cc.precio_por_litro), 0) AS gasto,
        COUNT(cc.id_consumo_combustible) AS cargas,
        COALESCE(SUM(${CON_KM}), 0) AS cargas_con_km,
        COALESCE(SUM(CASE WHEN ${CON_KM} THEN cc.km_recorridos END), 0) AS km,
        COALESCE(SUM(CASE WHEN ${CON_KM} THEN cc.km_recorridos END)
          / NULLIF(SUM(CASE WHEN ${CON_KM} THEN cc.cantidad_litros END), 0), 0) AS km_por_litro,
        COALESCE(SUM(CASE WHEN ${CON_KM} THEN cc.cantidad_litros * cc.precio_por_litro END)
          / NULLIF(SUM(CASE WHEN ${CON_KM} THEN cc.km_recorridos END), 0), 0) AS costo_por_km
      FROM EQUIPO e
      JOIN UNIDADES up ON up.id_unidad = e.id_unidad_principal
      JOIN UNIDADES us ON us.id_unidad = e.id_unidad_secundaria
      JOIN CHOFERES ch ON ch.id_chofer = e.id_chofer
      LEFT JOIN CONSUMOS_COMBUSTIBLE cc ON cc.id_equipo = e.id_equipo
      WHERE e.id_empresa = ?
      GROUP BY e.id_equipo, e.activo, e.fecha_baja, up.patente, us.patente, ch.nombre
      -- Los equipos dados de baja aparecen solo si tienen datos.
      HAVING e.activo = 1 OR litros > 0
      ORDER BY km_por_litro DESC LIMIT 50
    `, [emp(req)]);
    res.json(rows);
  } catch (err) {
    responderError(res, err, req);
  }
});

// ==================== RENDIMIENTO POR CHOFER ====================
// Por el chofer que HIZO cada viaje (foto VIAJES.id_chofer), no por el que
// tiene hoy el equipo: si los choferes rotan, cada uno conserva sus viajes.
router.get('/rendimiento-choferes', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT ch.id_chofer, ch.nombre,
        COUNT(v.id_viaje) AS viajes,
        COALESCE(SUM(CASE WHEN v.tipo_tarifa='UNICA' THEN v.tarifa
                 ELSE v.tarifa * COALESCE(v.resultado, v.cantidad_cargada, 0) END), 0) AS ingresos
      FROM CHOFERES ch
      LEFT JOIN VIAJES v ON v.id_chofer = ch.id_chofer AND v.id_empresa = ch.id_empresa
      WHERE ch.id_empresa = ?
      GROUP BY ch.id_chofer, ch.nombre
      ORDER BY ingresos DESC LIMIT 50
    `, [emp(req)]);
    // Sin el monto para un usuario común: solo la cantidad de viajes.
    res.json(veFinanzas(req) ? rows : rows.map(({ ingresos, ...r }) => r).sort((a, b) => b.viajes - a.viajes));
  } catch (err) {
    responderError(res, err, req);
  }
});

// ==================== INGRESOS MENSUALES ====================
router.get('/ingresos-mensuales', soloFinanzas, async (req, res) => {
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
    responderError(res, err, req);
  }
});

// ==================== CLIENTES TOP ====================
router.get('/clientes-top', soloFinanzas, async (req, res) => {
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
    responderError(res, err, req);
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
        JOIN EQUIPO e ON e.id_empresa = cg.id_empresa AND ${sqlConsumoDelEquipo('e.id_equipo')}
        WHERE cg.id_empresa = ? ${fechaCond} ${equipoCond}
        ORDER BY cg.fecha DESC LIMIT 200
      `, [e, ...pFecha, ...equipoParam]);
      return res.json(rows);
    }

    const [rows] = await pool.query(`
      SELECT e.id_equipo, e.activo, e.fecha_baja, up.patente AS patente_principal, us.patente AS patente_secundaria,
        ch.nombre AS chofer,
        COUNT(cg.id_consumo_general) AS cantidad,
        COALESCE(SUM(cg.monto), 0) AS total
      FROM EQUIPO e
      JOIN UNIDADES up ON up.id_unidad = e.id_unidad_principal
      JOIN UNIDADES us ON us.id_unidad = e.id_unidad_secundaria
      JOIN CHOFERES ch ON ch.id_chofer = e.id_chofer
      LEFT JOIN CONSUMOS_GENERALES cg
        ON cg.id_empresa = e.id_empresa AND ${sqlConsumoDelEquipo('e.id_equipo')} ${fechaCond}
      WHERE e.id_empresa = ? ${equipoCond}
      GROUP BY e.id_equipo, e.activo, e.fecha_baja, up.patente, us.patente, ch.nombre
      HAVING e.activo = 1 OR cantidad > 0
      ORDER BY total DESC LIMIT 50
    `, [...pFecha, e, ...equipoParam]);
    res.json(rows);
  } catch (err) {
    responderError(res, err, req);
  }
});

// ==================== INGRESOS POR VIAJE ====================
router.get('/ingresos-por-viaje', soloFinanzas, async (req, res) => {
  try {
    const SQL_IVA_VIAJE = sqlIvaViaje(await discriminaIva(emp(req)));
    const f = filtros(req, { colFecha: 'v.fecha_origen', colEquipo: 'v.id_equipo', aliasEmpresa: 'v.id_empresa' });

    if (req.query.detalle === '1') {
      const [rows] = await pool.query(`
        SELECT v.id_viaje, v.fecha_origen, v.origen, v.destino, v.tipo_carga,
          v.tarifa, v.tipo_tarifa, v.resultado, v.cantidad_cargada, v.estado, v.pagador, v.numero_remito,
          v.comision, v.modo_facturacion,
          up.patente AS patente_principal, us.patente AS patente_secundaria,
          ${SQL_BASE_VIAJE} AS ingreso,
          ${SQL_IVA_VIAJE} AS iva,
          (${SQL_BASE_VIAJE} + ${SQL_IVA_VIAJE}) AS ingreso_con_iva
        FROM VIAJES v
        JOIN EQUIPO e ON e.id_equipo = v.id_equipo
        ${SQL_UNIDADES_DEL_VIAJE}
        ${f.clausula}
        ORDER BY ingreso DESC LIMIT 200
      `, f.params);
      return res.json(rows);
    }

    const [[resumen]] = await pool.query(`
      SELECT COUNT(*) AS cantidad_viajes,
        COALESCE(SUM(${SQL_BASE_VIAJE}), 0) AS ingreso_total,
        COALESCE(AVG(${SQL_BASE_VIAJE}), 0) AS ingreso_promedio,
        COALESCE(SUM(${SQL_IVA_VIAJE}), 0) AS iva_total,
        COALESCE(SUM(${SQL_BASE_VIAJE} + ${SQL_IVA_VIAJE}), 0) AS ingreso_total_con_iva,
        SUM(CASE WHEN ${SQL_IVA_VIAJE} > 0 THEN 1 ELSE 0 END) AS viajes_con_iva
      FROM VIAJES v${f.clausula}
    `, f.params);

    const [porTipo] = await pool.query(`
      SELECT v.tipo_tarifa, COUNT(*) AS cantidad,
        COALESCE(SUM(${SQL_BASE_VIAJE}), 0) AS ingreso,
        COALESCE(SUM(${SQL_IVA_VIAJE}), 0) AS iva,
        COALESCE(SUM(${SQL_BASE_VIAJE} + ${SQL_IVA_VIAJE}), 0) AS ingreso_con_iva
      FROM VIAJES v${f.clausula}
      GROUP BY v.tipo_tarifa ORDER BY ingreso DESC
    `, f.params);

    // Top 7 viajes con más ingresos (para el panel del dashboard)
    const [topViajes] = await pool.query(`
      SELECT v.id_viaje, v.fecha_origen, v.origen, v.destino, v.pagador,
        up.patente AS patente_principal,
        ${SQL_BASE_VIAJE} AS ingreso,
        ${SQL_IVA_VIAJE} AS iva,
        (${SQL_BASE_VIAJE} + ${SQL_IVA_VIAJE}) AS ingreso_con_iva
      FROM VIAJES v
      JOIN EQUIPO e ON e.id_equipo = v.id_equipo
      ${SQL_UNIDADES_DEL_VIAJE}
      ${f.clausula}
      ORDER BY ingreso DESC LIMIT 7
    `, f.params);

    res.json({
      resumen: {
        cantidad_viajes: Number(resumen.cantidad_viajes),
        ingreso_total: Number(resumen.ingreso_total),
        ingreso_promedio: Number(resumen.ingreso_promedio),
        iva_total: Number(resumen.iva_total),
        ingreso_total_con_iva: Number(resumen.ingreso_total_con_iva),
        viajes_con_iva: Number(resumen.viajes_con_iva)
      },
      top_viajes: topViajes,
      por_tipo: porTipo
    });
  } catch (err) {
    responderError(res, err, req);
  }
});

// ==================== RENTABILIDAD POR EQUIPO ====================
router.get('/rentabilidad-equipos', soloFinanzas, async (req, res) => {
  try {
    const SQL_IVA_VIAJE = sqlIvaViaje(await discriminaIva(emp(req)));
    const e = emp(req);
    const desde = req.query.fecha_desde || null;
    const hasta = req.query.fecha_hasta || null;
    const idEquipoFiltro = req.query.id_equipo || null;

    // Ventana efectiva del período (siempre concreta, para prorratear el
    // sueldo fijo según EQUIPO_HISTORIAL): si falta alguno de los dos
    // límites, se completa con un período de 30 días terminado hoy.
    const hoy = new Date().toISOString().slice(0, 10);
    const efectivoHasta = hasta || hoy;
    const efectivoDesde = desde || (() => {
      const d = new Date(efectivoHasta);
      d.setDate(d.getDate() - 29);
      return d.toISOString().slice(0, 10);
    })();
    const diasPeriodo = Math.max(1, Math.round(
      (new Date(efectivoHasta) - new Date(efectivoDesde)) / 86400000) + 1);

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
      SELECT e.id_equipo, e.id_unidad_principal, e.id_unidad_secundaria, e.activo, e.fecha_baja,
        up.patente AS patente_principal, us.patente AS patente_secundaria,
        ch.id_chofer, ch.nombre AS chofer
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
        SELECT COALESCE(SUM(${SQL_BASE_VIAJE}), 0) AS ingresos,
               COALESCE(SUM(${SQL_IVA_VIAJE}), 0) AS iva
        FROM VIAJES v WHERE v.id_empresa = ? AND v.id_equipo = ?${wVi}
      `, [e, eq.id_equipo, ...pVi]);

      const [[comb]] = await pool.query(`
        SELECT COALESCE(SUM(cc.cantidad_litros * cc.precio_por_litro), 0) AS gasto
        FROM CONSUMOS_COMBUSTIBLE cc WHERE cc.id_empresa = ? AND cc.id_equipo = ?${wCo}
      `, [e, eq.id_equipo, ...pCo]);

      const [[gen]] = await pool.query(`
        SELECT COALESCE(SUM(cg.monto), 0) AS gasto
        FROM CONSUMOS_GENERALES cg
        WHERE cg.id_empresa = ? AND ${sqlConsumoDelEquipo('?')}${wGe}
      `, [e, eq.id_equipo, ...pGe]);

      // Sueldo variable: lo efectivamente liquidado a cada chofer por los
      // viajes del equipo (movimientos VIAJE_LIQUIDACION), con la
      // remuneración y el chofer de cada viaje. Así una rotación de choferes o
      // un cambio de remuneración no reescribe la rentabilidad pasada.
      const [[liq]] = await pool.query(`
        SELECT COALESCE(SUM(m.monto), 0) AS sueldo
        FROM MOVIMIENTOS m
        JOIN VIAJES v ON v.id_viaje = m.origen_id AND v.id_empresa = m.id_empresa
        WHERE m.id_empresa = ? AND m.origen_tipo = 'VIAJE_LIQUIDACION' AND v.id_equipo = ?${wVi}
      `, [e, eq.id_equipo, ...pVi]);
      const sueldoVariable = Number(liq.sueldo);

      // Sueldo fijo: se prorratea por los días que cada chofer estuvo
      // asignado al equipo según EQUIPO_HISTORIAL (no por el chofer actual),
      // de cualquier chofer con sueldo_fijo_mensual (no solo los "FIJA" de
      // antes: así el mixto suma las dos partes). Nunca usa los movimientos
      // de LIQUIDACIONES_SUELDO, para que un mes sin liquidar no aparezca
      // más rentable de lo que es.
      const [periodos] = await pool.query(`
        SELECT ch.sueldo_fijo_mensual, h.desde, h.hasta
        FROM EQUIPO_HISTORIAL h
        JOIN CHOFERES ch ON ch.id_chofer = h.id_chofer
        WHERE h.id_empresa = ? AND h.id_equipo = ?
      `, [e, eq.id_equipo]);
      const sueldoFijo = sueldoFijoProrrateado(periodos, efectivoDesde, efectivoHasta);
      const sueldo = sueldoVariable + sueldoFijo;

      const ingresos = Number(ing.ingresos);
      const iva = Number(ing.iva);
      const ingresosConIva = ingresos + iva;
      const costoComb = Number(comb.gasto);
      const costoGen = Number(gen.gasto);
      const costos = costoComb + costoGen + sueldo;
      const rentabilidad = ingresos - costos;
      // Un equipo dado de baja aparece solo si tuvo actividad en el período:
      // su historia cuenta, pero no ensucia los meses en que ya no trabajaba.
      if (!eq.activo && ingresos === 0 && costos === 0) continue;
      resultado.push({
        id_equipo: eq.id_equipo, activo: Boolean(eq.activo), fecha_baja: eq.fecha_baja,
        patente_principal: eq.patente_principal,
        patente_secundaria: eq.patente_secundaria, chofer: eq.chofer,
        ingresos, iva, ingresos_con_iva: ingresosConIva,
        costo_combustible: costoComb, costo_generales: costoGen,
        sueldo, sueldo_fijo: sueldoFijo, sueldo_variable: sueldoVariable,
        costos, rentabilidad,
        rentabilidad_con_iva: ingresosConIva - costos,
        margen: ingresos > 0 ? (rentabilidad / ingresos) * 100 : 0,
        margen_con_iva: ingresosConIva > 0 ? ((ingresosConIva - costos) / ingresosConIva) * 100 : 0
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

    // Consumos generales de unidades que en esa fecha no estaban en ningún
    // equipo (ej. un camión parado en el taller): no se pierden, se muestran
    // aparte y se descuentan de la rentabilidad neta.
    const [[sinEquipo]] = await pool.query(`
      SELECT COALESCE(SUM(cg.monto), 0) AS total
      FROM CONSUMOS_GENERALES cg
      WHERE cg.id_empresa = ?${wGe} AND NOT EXISTS (
        SELECT 1 FROM EQUIPO_HISTORIAL h
         WHERE h.id_empresa = cg.id_empresa
           AND cg.id_unidad IN (h.id_unidad_principal, h.id_unidad_secundaria)
           AND (h.desde IS NULL OR h.desde <= cg.fecha) AND (h.hasta IS NULL OR h.hasta > cg.fecha))
    `, [e, ...pGe]);

    const sumaRent = resultado.reduce((s, r) => s + r.rentabilidad, 0);
    const sumaIva = resultado.reduce((s, r) => s + r.iva, 0);
    const totalGA = Number(gastosAdmin.total);
    const totalSinEquipo = idEquipoFiltro ? 0 : Number(sinEquipo.total);
    res.json({
      equipos: resultado, dias_periodo: diasPeriodo,
      gastos_administrativos: totalGA,
      gastos_unidades_sin_equipo: totalSinEquipo,
      rentabilidad_equipos: sumaRent,
      rentabilidad_neta: sumaRent - totalGA - totalSinEquipo,
      iva_total: sumaIva,
      rentabilidad_equipos_con_iva: sumaRent + sumaIva,
      rentabilidad_neta_con_iva: sumaRent + sumaIva - totalGA - totalSinEquipo
    });
  } catch (err) {
    responderError(res, err, req);
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
    responderError(res, err, req);
  }
});

module.exports = router;
