// frontend/js/vistas/dashboard.js
// Vista Dashboard: KPIs, gráficos, alertas y su vista ampliada.
// Las funciones son globales a propósito: las usan los onclick="..." del HTML
// generado y los demás archivos. El orden de carga está en index.html.

// ============================================================
// Dashboard
// ============================================================
// Estado del filtro de fecha global del dashboard
const filtroDash = { ...rango30Dias(), tipo: 'rango' };

async function renderDashboard() {
  // Valores preseleccionados en los selectores de período: si ya hay un
  // período aplicado se refleja ese; si no, el mes/trimestre/año en curso.
  const refFecha = filtroDash.fecha_desde
    ? new Date(filtroDash.fecha_desde + 'T00:00:00')
    : new Date();
  const anioActual = refFecha.getFullYear();
  const mesActual = refFecha.getMonth() + 1;
  const trimestreActual = Math.floor(refFecha.getMonth() / 3) + 1;

  contenido.innerHTML = `
    <div class="vista-cabecera">
      <div>
        <div class="vista-titulo">Dashboard</div>
        <div class="vista-sub">Resumen operativo y financiero de la empresa</div>
      </div>
      <button class="btn btn-secundario" onclick="renderDashboard()">Actualizar</button>
    </div>
    <div class="filtros-avanzados" id="dash-filtros">
      <div class="filtro-grupo">
        <label class="filtro-label">Período</label>
        <select class="buscador" id="dash-tipo">
          <option value="rango"${filtroDash.tipo === 'rango' ? ' selected' : ''}>Rango de fechas</option>
          <option value="mes"${filtroDash.tipo === 'mes' ? ' selected' : ''}>Mes</option>
          <option value="trimestre"${filtroDash.tipo === 'trimestre' ? ' selected' : ''}>Trimestre</option>
          <option value="anio"${filtroDash.tipo === 'anio' ? ' selected' : ''}>Año</option>
        </select>
      </div>

      <div class="filtro-grupo" data-periodo="rango">
        <label class="filtro-label">Desde</label>
        <input type="date" class="buscador filtro-fecha" id="dash-desde" value="${filtroDash.fecha_desde}">
      </div>
      <div class="filtro-grupo" data-periodo="rango">
        <label class="filtro-label">Hasta</label>
        <input type="date" class="buscador filtro-fecha" id="dash-hasta" value="${filtroDash.fecha_hasta}">
      </div>

      <div class="filtro-grupo" data-periodo="mes">
        <label class="filtro-label">Mes</label>
        <select class="buscador" id="dash-mes">
          ${NOMBRES_MES.map((n, i) => `<option value="${i + 1}"${(i + 1) === mesActual ? ' selected' : ''}>${n}</option>`).join('')}
        </select>
      </div>
      <div class="filtro-grupo" data-periodo="trimestre">
        <label class="filtro-label">Trimestre</label>
        <select class="buscador" id="dash-trimestre">
          ${[1, 2, 3, 4].map(q => `<option value="${q}"${q === trimestreActual ? ' selected' : ''}>${q}° trimestre (${NOMBRES_MES[(q - 1) * 3].slice(0, 3)}–${NOMBRES_MES[(q - 1) * 3 + 2].slice(0, 3)})</option>`).join('')}
        </select>
      </div>
      <div class="filtro-grupo" data-periodo="mes trimestre anio">
        <label class="filtro-label">Año</label>
        <select class="buscador" id="dash-anio">
          ${aniosDisponibles().map(a => `<option value="${a}"${a === anioActual ? ' selected' : ''}>${a}</option>`).join('')}
        </select>
      </div>

      <button class="btn btn-secundario btn-mini" id="dash-aplicar">Aplicar período</button>
      <button class="btn btn-secundario btn-mini" id="dash-limpiar">Últimos 30 días</button>
      <span class="filtro-label" id="dash-periodo-activo" style="align-self:center"></span>
    </div>
    <div id="dash-kpis" class="kpi-grid"><div class="estado-vacio">Cargando métricas…</div></div>
    <div class="panel-grid" id="dash-paneles"></div>
  `;

  // Muestra solo los controles que corresponden al tipo de período elegido.
  function mostrarControlesPeriodo() {
    const tipo = $('#dash-tipo').value;
    document.querySelectorAll('#dash-filtros [data-periodo]').forEach(el => {
      el.style.display = el.dataset.periodo.split(' ').includes(tipo) ? '' : 'none';
    });
  }
  $('#dash-tipo').addEventListener('change', mostrarControlesPeriodo);
  mostrarControlesPeriodo();

  $('#dash-aplicar').addEventListener('click', () => {
    const tipo = $('#dash-tipo').value;
    filtroDash.tipo = tipo;
    const anio = Number($('#dash-anio').value);
    let r;
    if (tipo === 'mes') r = rangoMes(anio, Number($('#dash-mes').value));
    else if (tipo === 'trimestre') r = rangoTrimestre(anio, Number($('#dash-trimestre').value));
    else if (tipo === 'anio') r = rangoAnio(anio);
    else r = { fecha_desde: $('#dash-desde').value, fecha_hasta: $('#dash-hasta').value };
    filtroDash.fecha_desde = r.fecha_desde;
    filtroDash.fecha_hasta = r.fecha_hasta;
    renderDashboard();
  });
  $('#dash-limpiar').addEventListener('click', () => {
    const r = rango30Dias();
    filtroDash.tipo = 'rango';
    filtroDash.fecha_desde = r.fecha_desde;
    filtroDash.fecha_hasta = r.fecha_hasta;
    renderDashboard();
  });
  if (filtroDash.fecha_desde || filtroDash.fecha_hasta) {
    $('#dash-periodo-activo').textContent =
      describirPeriodo(filtroDash.fecha_desde, filtroDash.fecha_hasta);
  }

  const periodo = { fecha_desde: filtroDash.fecha_desde, fecha_hasta: filtroDash.fecha_hasta };

  try {
    const [kpis, alertas, rendEquipos, rendChoferes, clientes, consumosEq, ingresosViaje, rentabilidad, gastosAdmin] = await Promise.all([
      API.kpis(periodo), API.alertas(), API.rendimientoEquipos(),
      API.rendimientoChoferes(), API.clientesTop(),
      API.consumosPorEquipo(periodo), API.ingresosPorViaje(periodo), API.rentabilidadEquipos(periodo),
      API.gastosAdministrativos(periodo)
    ]);

    // --- KPIs ---
    $('#dash-kpis').innerHTML = `
      <div class="kpi">
        <div class="kpi-etiqueta">Viajes activos</div>
        <div class="kpi-valor info">${kpis.viajes.viajes_activos || 0}</div>
        <div class="kpi-detalle">${kpis.viajes.total_viajes} viajes totales registrados</div>
      </div>
      <div class="kpi">
        <div class="kpi-etiqueta">Ingresos totales</div>
        <div class="kpi-valor exito">${fmtDinero(kpis.ingresos.ingresos_totales)}</div>
        <div class="kpi-detalle">Viajes finalizados y facturados · Pendiente de cobro: ${fmtDinero(kpis.ingresos.pendiente_cobro)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-etiqueta">Ganancia neta</div>
        <div class="kpi-valor ${kpis.ingresos.ganancia_neta >= 0 ? 'exito' : 'peligro'}">${fmtDinero(kpis.ingresos.ganancia_neta)}</div>
        <div class="kpi-detalle">Margen: ${fmtNum(kpis.ingresos.margen, 1)}% · Costos: ${fmtDinero(kpis.ingresos.costos_totales)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-etiqueta">Rendimiento de combustible</div>
        <div class="kpi-valor aviso">${fmtNum(kpis.combustible.rendimiento_global)} km/L</div>
        <div class="kpi-detalle">${fmtNum(kpis.combustible.litros_totales, 0)} L · ${fmtDinero(kpis.combustible.gasto_combustible)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-etiqueta">Flota</div>
        <div class="kpi-valor">${kpis.flota.total_equipos}</div>
        <div class="kpi-detalle">${kpis.flota.total_unidades} unidades · ${kpis.flota.total_choferes} choferes</div>
      </div>
    `;

    // --- Paneles ---
    // Totales reales (vienen del backend sin límite); fallback a length
    const tot = alertas.totales || {
      carnets: alertas.carnets.length,
      vencimientos: alertas.vencimientos.length,
      mantenimientos: alertas.mantenimientos.length,
      descansos: alertas.descansos.length
    };
    const totalAlertas = tot.carnets + tot.vencimientos + tot.mantenimientos + tot.descansos + ((alertas.cobros || []).length);

    // Unificar y ordenar por urgencia; mostrar solo las 7 más urgentes
    const alertasOrdenadas = unificarAlertas(alertas);
    const TOPE_ALERTAS = 7;
    const alertasMostradas = alertasOrdenadas.slice(0, TOPE_ALERTAS);
    const restantesAlertas = totalAlertas - alertasMostradas.length;

    const htmlAlertas = totalAlertas === 0
      ? '<div class="estado-vacio">Sin alertas. Todo en orden.</div>'
      : [
          ...alertasMostradas.map(filaAlertaUnificada),
          restantesAlertas > 0
            ? `<div style="padding:8px 14px;border-top:1px solid var(--borde);font-size:12px;color:var(--texto-suave)">
                y ${restantesAlertas} alerta${restantesAlertas === 1 ? '' : 's'} más — <a href="#alertas" style="color:var(--info)">ver todas</a>
              </div>`
            : ''
        ].join('');

    // Limita una lista a 7 elementos en el dashboard; el resto se ve en la
    // vista ampliada de cada métrica.
    const TOPE_DASH = 7;
    const top7 = arr => (arr || []).slice(0, TOPE_DASH);
    const notaResto = (arr, claveMetrica) => {
      const restantes = (arr || []).length - TOPE_DASH;
      if (restantes <= 0) return '';
      return `<div style="padding:8px 14px;border-top:1px solid var(--borde);font-size:12px;color:var(--texto-suave)">
        y ${restantes} más — <a href="#metrica/${claveMetrica}" style="color:var(--info)">ver vista ampliada</a>
      </div>`;
    };

    const htmlEquipos = rendEquipos.length === 0
      ? '<div class="estado-vacio">Sin datos de consumo todavía.</div>'
      : tablaSimple(
          ['Equipo', 'Chofer', 'Km/L', 'Costo/km'],
          top7(rendEquipos).map(r => [
            `${esc(r.patente_principal)} / ${esc(r.patente_secundaria || '?')}`,
            esc(r.chofer),
            `<td class="celda-num">${fmtNum(r.km_por_litro)}</td>`,
            `<td class="celda-num">${fmtDinero(r.costo_por_km)}</td>`
          ])
        ) + notaResto(rendEquipos, 'rendimiento-equipos');

    const htmlChoferes = rendChoferes.length === 0
      ? '<div class="estado-vacio">Sin choferes registrados.</div>'
      : tablaSimple(
          ['Chofer', 'Viajes', 'Ingresos'],
          top7(rendChoferes).map(r => [
            esc(r.nombre),
            `<td class="celda-num">${r.viajes}</td>`,
            `<td class="celda-num">${fmtDinero(r.ingresos)}</td>`
          ])
        ) + (rendChoferes.length > 7 ? `<div style="padding:8px 14px;border-top:1px solid var(--borde);font-size:12px;color:var(--texto-suave)">Mostrando los 7 con más ingresos de ${rendChoferes.length}.</div>` : '');

    const htmlClientes = clientes.length === 0
      ? '<div class="estado-vacio">Sin viajes con pagador registrado.</div>'
      : tablaSimple(
          ['Cliente', 'Viajes', 'Ingresos'],
          top7(clientes).map(r => [
            esc(r.pagador),
            `<td class="celda-num">${r.viajes}</td>`,
            `<td class="celda-num">${fmtDinero(r.ingresos)}</td>`
          ])
        ) + (clientes.length > 7 ? `<div style="padding:8px 14px;border-top:1px solid var(--borde);font-size:12px;color:var(--texto-suave)">Mostrando los 7 con más ingresos de ${clientes.length}.</div>` : '');

    // --- Métrica: consumos generales por equipo ---
    const htmlConsumosEq = consumosEq.length === 0
      ? '<div class="estado-vacio">Sin consumos generales en el período.</div>'
      : tablaSimple(
          ['Equipo', 'Consumos', 'Total'],
          top7(consumosEq).map(r => [
            `${esc(r.patente_principal)} / ${esc(r.patente_secundaria || '?')}`,
            `<td class="celda-num">${r.cantidad}</td>`,
            `<td class="celda-num">${fmtDinero(r.total)}</td>`
          ])
        ) + notaResto(consumosEq, 'consumos-por-equipo');

    // --- Métrica: rentabilidad por equipo ---
    const rentEquipos = rentabilidad.equipos || [];
    const htmlRentabilidad = rentEquipos.length === 0
      ? '<div class="estado-vacio">Sin equipos para calcular rentabilidad.</div>'
      : tablaSimple(
          ['Equipo', 'Ingresos', 'Costos', 'Rentabilidad'],
          top7(rentEquipos).map(r => [
            `${esc(r.patente_principal)} / ${esc(r.patente_secundaria || '?')}`,
            `<td class="celda-num">${fmtDinero(r.ingresos)}</td>`,
            `<td class="celda-num">${fmtDinero(r.costos)}</td>`,
            `<td class="celda-num" style="font-weight:600;color:${r.rentabilidad >= 0 ? 'var(--exito)' : 'var(--peligro)'}">${fmtDinero(r.rentabilidad)}</td>`
          ])
        ) + notaResto(rentEquipos, 'rentabilidad-equipos') + `
        <div style="padding:10px 14px;border-top:1px solid var(--borde);font-size:13px">
          <div style="display:flex;justify-content:space-between"><span>Rentabilidad de equipos</span><strong>${fmtDinero(rentabilidad.rentabilidad_equipos || 0)}</strong></div>
          <div style="display:flex;justify-content:space-between;color:var(--peligro)"><span>− Gastos administrativos</span><strong>${fmtDinero(rentabilidad.gastos_administrativos || 0)}</strong></div>
          <div style="display:flex;justify-content:space-between;margin-top:4px;padding-top:4px;border-top:1px dashed var(--borde);font-size:15px">
            <span><strong>Rentabilidad neta</strong></span>
            <strong style="color:${(rentabilidad.rentabilidad_neta || 0) >= 0 ? 'var(--exito)' : 'var(--peligro)'}">${fmtDinero(rentabilidad.rentabilidad_neta || 0)}</strong>
          </div>
        </div>`;

    // --- Métrica: gastos administrativos ---
    const htmlGastosAdmin = (gastosAdmin.cantidad || 0) === 0
      ? '<div class="estado-vacio">Sin gastos administrativos en el período.</div>'
      : `<div style="padding:8px 14px"><div class="kpi-etiqueta">Total del período</div>
         <div style="font-size:20px;font-weight:600;color:var(--peligro)">${fmtDinero(gastosAdmin.total)}</div>
         <div class="kpi-detalle">${gastosAdmin.cantidad} gasto(s) registrado(s)</div></div>` +
        tablaSimple(
          ['Proveedor', 'Gastos', 'Total'],
          top7(gastosAdmin.por_proveedor).map(r => [
            esc(r.proveedor),
            `<td class="celda-num">${r.cantidad}</td>`,
            `<td class="celda-num">${fmtDinero(r.total)}</td>`
          ])
        ) + notaResto(gastosAdmin.por_proveedor, 'gastos-administrativos');

    // --- Métrica: ingresos por viaje ---
    const ipv = ingresosViaje.resumen;
    const topViajes = ingresosViaje.top_viajes || [];
    const htmlIngresosViaje = ipv.cantidad_viajes === 0
      ? '<div class="estado-vacio">Sin viajes en el período.</div>'
      : `
        <div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:12px">
          <div><div class="kpi-etiqueta">Viajes</div><div style="font-size:18px;font-weight:600">${ipv.cantidad_viajes}</div></div>
          <div><div class="kpi-etiqueta">Ingreso sin IVA</div><div style="font-size:18px;font-weight:600;color:var(--exito)">${fmtDinero(ipv.ingreso_total)}</div></div>
          <div><div class="kpi-etiqueta" title="IVA de los viajes facturados con IVA. No es ingreso propio: se debe a ARCA.">IVA facturado</div><div style="font-size:18px;font-weight:600;color:var(--info)">${fmtDinero(ipv.iva_total || 0)}</div></div>
          <div><div class="kpi-etiqueta">Total con IVA</div><div style="font-size:18px;font-weight:600">${fmtDinero(ipv.ingreso_total_con_iva || ipv.ingreso_total)}</div></div>
        </div>
        <div class="kpi-etiqueta" style="margin-bottom:6px">Viajes con más ingresos</div>
        ${tablaSimple(
          ['Viaje', 'Ruta', 'Pagador', 'Sin IVA', 'IVA', 'Con IVA'],
          topViajes.map(v => [
            `#${v.id_viaje}`,
            `${esc(v.origen)} → ${esc(v.destino)}`,
            esc(v.pagador || '—'),
            `<td class="celda-num">${fmtDinero(v.ingreso)}</td>`,
            `<td class="celda-num" style="color:var(--texto-suave)">${Number(v.iva) > 0 ? fmtDinero(v.iva) : '—'}</td>`,
            `<td class="celda-num">${fmtDinero(v.ingreso_con_iva ?? v.ingreso)}</td>`
          ])
        )}
        ${ipv.cantidad_viajes > topViajes.length
          ? `<div style="padding:8px 0 0;font-size:12px;color:var(--texto-suave)">
              Mostrando los ${topViajes.length} de mayor ingreso —
              <a href="#metrica/ingresos-por-viaje" style="color:var(--info)">ver todos los ${ipv.cantidad_viajes}</a>
            </div>`
          : ''}`;

    // Cada panel se muestra solo si su módulo está activo. Las alertas
    // dependen de los módulos de flota; ingresos/rentabilidad de viajes;
    // consumos y gastos de sus respectivos módulos.
    const hayFlota = moduloActivo('mantenimientos') || moduloActivo('vencimientos') || moduloActivo('choferes');
    const paneles = [];

    if (hayFlota) paneles.push(`
      <div class="panel">
        <div class="panel-cabecera">
          <span>Alertas <span class="insignia ${totalAlertas ? 'rojo' : 'verde'}">${totalAlertas}</span></span>
          ${totalAlertas > 0 ? `<button class="btn btn-secundario btn-mini" onclick="location.hash='alertas'">Ampliar ↗</button>` : ''}
        </div>
        <div class="panel-cuerpo">${htmlAlertas}</div>
      </div>`);

    if (moduloActivo('viajes')) paneles.push(`
      <div class="panel">
        <div class="panel-cabecera">
          <span>Ingresos por viaje</span>
          <button class="btn btn-secundario btn-mini" onclick="location.hash='metrica/ingresos-por-viaje'">Ampliar ↗</button>
        </div>
        <div class="panel-cuerpo">${htmlIngresosViaje}</div>
      </div>`);

    if (moduloActivo('viajes')) paneles.push(`
      <div class="panel">
        <div class="panel-cabecera">
          <span>Rentabilidad por equipo</span>
          <button class="btn btn-secundario btn-mini" onclick="location.hash='metrica/rentabilidad-equipos'">Ampliar ↗</button>
        </div>
        <div class="panel-cuerpo sin-padding"><div class="tabla-contenedor">${htmlRentabilidad}</div></div>
      </div>`);

    if (moduloActivo('gastos-administrativos')) paneles.push(`
      <div class="panel">
        <div class="panel-cabecera">
          <span>Gastos administrativos</span>
          <button class="btn btn-secundario btn-mini" onclick="location.hash='metrica/gastos-administrativos'">Ampliar ↗</button>
        </div>
        <div class="panel-cuerpo sin-padding"><div class="tabla-contenedor">${htmlGastosAdmin}</div></div>
      </div>`);

    if (moduloActivo('consumos-generales')) paneles.push(`
      <div class="panel">
        <div class="panel-cabecera">
          <span>Consumos generales por equipo</span>
          <button class="btn btn-secundario btn-mini" onclick="location.hash='metrica/consumos-por-equipo'">Ampliar ↗</button>
        </div>
        <div class="panel-cuerpo sin-padding"><div class="tabla-contenedor">${htmlConsumosEq}</div></div>
      </div>`);

    if (moduloActivo('consumos-combustible')) paneles.push(`
      <div class="panel">
        <div class="panel-cabecera">
          <span>Rendimiento por equipo</span>
          <button class="btn btn-secundario btn-mini" onclick="location.hash='metrica/rendimiento-equipos'">Ampliar ↗</button>
        </div>
        <div class="panel-cuerpo sin-padding"><div class="tabla-contenedor">${htmlEquipos}</div></div>
      </div>`);

    if (moduloActivo('viajes')) paneles.push(`
      <div class="panel">
        <div class="panel-cabecera">Rendimiento por chofer</div>
        <div class="panel-cuerpo sin-padding"><div class="tabla-contenedor">${htmlChoferes}</div></div>
      </div>`);

    if (moduloActivo('viajes')) paneles.push(`
      <div class="panel">
        <div class="panel-cabecera">Principales clientes</div>
        <div class="panel-cuerpo sin-padding"><div class="tabla-contenedor">${htmlClientes}</div></div>
      </div>`);

    $('#dash-paneles').innerHTML = paneles.join('');
  } catch (err) {
    // Si el usuario ya cambió de vista mientras cargaba, no hay dónde mostrarlo.
    const destino = $('#dash-kpis');
    if (!destino) return;
    destino.innerHTML = `<div class="estado-vacio">No se pudo conectar con la base de datos.<br>${esc(err.message)}</div>`;
  }
}

// Unifica todas las categorías de alertas en una sola lista normalizada y
// la ordena según la prioridad de negocio:
//   1º vencimientos, 2º mantenimientos, 3º licencias de choferes (carnets),
//   y por último los descansos.
// Dentro de cada categoría se ordena por la cantidad de días en alerta:
// lo más urgente primero (los ya vencidos, con días negativos, van arriba).
function unificarAlertas(alertas) {
  // Orden de prioridad por tipo (menor = más prioritario). Los cobros
  // vencidos van primero: es dinero que la empresa debería haber cobrado.
  const PRIORIDAD = { cobro: 1, vencimiento: 2, mantenimiento: 3, carnet: 4, descanso: 5 };

  const items = [];
  (alertas.cobros || []).forEach(a => items.push({
    texto: `Cobro vencido · ${a.nombre}`, dias: -a.dias_excedido, tipo: 'cobro',
    saldo: a.saldo_adeudado, diasExcedido: a.dias_excedido, plazo: a.plazo_pago_dias
  }));
  (alertas.vencimientos || []).forEach(a => items.push({
    texto: `${a.concepto} · ${a.patente}`, dias: a.dias_restantes, tipo: 'vencimiento'
  }));
  (alertas.mantenimientos || []).forEach(a => items.push({
    texto: `${a.concepto} · ${a.patente}`, dias: a.dias_restantes, tipo: 'mantenimiento'
  }));
  (alertas.carnets || []).forEach(a => items.push({
    texto: `Carnet de ${a.nombre}`, dias: a.dias_restantes, tipo: 'carnet'
  }));
  (alertas.descansos || []).forEach(a => items.push({
    texto: `Descanso de ${a.nombre}`, diasSinDescanso: a.dias_sin_descanso, tipo: 'descanso'
  }));

  return items.sort((a, b) => {
    // 1) por categoría
    if (PRIORIDAD[a.tipo] !== PRIORIDAD[b.tipo]) return PRIORIDAD[a.tipo] - PRIORIDAD[b.tipo];
    // 2) dentro de la categoría, por urgencia
    if (a.tipo === 'descanso') {
      return (b.diasSinDescanso || 0) - (a.diasSinDescanso || 0);
    }
    if (a.tipo === 'cobro') {
      // Más días excedido = más urgente
      return b.diasExcedido - a.diasExcedido;
    }
    // Menos días restantes (o más vencido) = más urgente
    return a.dias - b.dias;
  });
}

// Renderiza una fila de alerta unificada (incluye descanso y cobro).
function filaAlertaUnificada(it) {
  if (it.tipo === 'descanso') {
    return `
      <div class="alerta-item">
        <span>${esc(it.texto)}</span>
        <span class="insignia rojo">${it.diasSinDescanso} días sin descanso</span>
      </div>`;
  }
  if (it.tipo === 'cobro') {
    return `
      <div class="alerta-item">
        <span>${esc(it.texto)} · ${fmtDinero(it.saldo)}</span>
        <span class="insignia rojo" title="Plazo de pago: ${it.plazo} días">Vencido hace ${it.diasExcedido} días</span>
      </div>`;
  }
  return filaAlerta(esc(it.texto), it.dias);
}

function filaAlerta(texto, dias) {
  const vencido = dias < 0;
  return `
    <div class="alerta-item">
      <span>${texto}</span>
      <span class="insignia ${vencido ? 'rojo' : 'ambar'}">
        ${vencido ? `Vencido hace ${Math.abs(dias)} días` : `Vence en ${dias} días`}
      </span>
    </div>`;
}

// Vista ampliada: todas las alertas ordenadas por urgencia.
async function renderAlertas() {
  contenido.innerHTML = '<div class="estado-vacio">Cargando alertas…</div>';
  try {
    const alertas = await API.alertas();
    const ordenadas = unificarAlertas(alertas);
    const tot = alertas.totales || {
      carnets: (alertas.carnets || []).length,
      vencimientos: (alertas.vencimientos || []).length,
      mantenimientos: (alertas.mantenimientos || []).length,
      descansos: (alertas.descansos || []).length,
      cobros: (alertas.cobros || []).length
    };
    const total = tot.carnets + tot.vencimientos + tot.mantenimientos + tot.descansos + (tot.cobros || 0);

    contenido.innerHTML = `
      <div class="vista-cabecera">
        <div>
          <div class="vista-titulo">Alertas</div>
          <div class="vista-sub">Vencimientos y avisos ordenados por urgencia</div>
        </div>
        <button class="btn btn-secundario" onclick="location.hash='dashboard'">← Volver al panel</button>
      </div>

      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-etiqueta">Total de alertas</div><div class="kpi-valor ${total ? 'peligro' : 'exito'}">${total}</div></div>
        <div class="kpi"><div class="kpi-etiqueta">Cobros vencidos</div><div class="kpi-valor ${tot.cobros ? 'peligro' : ''}">${tot.cobros || 0}</div></div>
        <div class="kpi"><div class="kpi-etiqueta">Vencimientos</div><div class="kpi-valor">${tot.vencimientos}</div></div>
        <div class="kpi"><div class="kpi-etiqueta">Mantenimientos</div><div class="kpi-valor">${tot.mantenimientos}</div></div>
        <div class="kpi"><div class="kpi-etiqueta">Carnets</div><div class="kpi-valor">${tot.carnets}</div></div>
        <div class="kpi"><div class="kpi-etiqueta">Descansos</div><div class="kpi-valor">${tot.descansos}</div></div>
      </div>

      <div class="panel">
        <div class="panel-cabecera">Detalle (${ordenadas.length})</div>
        <div class="panel-cuerpo">
          ${total === 0
            ? '<div class="estado-vacio">Sin alertas. Todo en orden.</div>'
            : ordenadas.map(filaAlertaUnificada).join('')}
        </div>
      </div>`;
  } catch (err) {
    contenido.innerHTML = `<div class="estado-vacio">Error al cargar alertas: ${esc(err.message)}</div>`;
  }
}
