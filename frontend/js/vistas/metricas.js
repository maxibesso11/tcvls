// frontend/js/vistas/metricas.js
// Vista de detalle de cada métrica del dashboard (#metrica/<clave>).
// Las funciones son globales a propósito: las usan los onclick="..." del HTML
// generado y los demás archivos. El orden de carga está en index.html.

// ============================================================
// Vista de detalle de una métrica (pestaña individual)
// ============================================================
const METRICAS = {
  'ingresos-por-viaje': {
    titulo: 'Ingresos por viaje',
    sub: 'Detalle de cada viaje y su valor de flete (sin IVA)',
    conEquipo: true
  },
  'consumos-por-equipo': {
    titulo: 'Consumos generales por equipo',
    sub: 'Gastos generales atribuidos a cada equipo a través de sus unidades',
    conEquipo: true
  },
  'rendimiento-equipos': {
    titulo: 'Rendimiento de combustible por equipo',
    sub: 'Km por litro y costo por km de cada equipo',
    conEquipo: false
  },
  'rentabilidad-equipos': {
    titulo: 'Rentabilidad general por equipo',
    sub: 'Ingresos menos costos (combustible, generales y sueldo del chofer) por período',
    conEquipo: true
  },
  'gastos-administrativos': {
    titulo: 'Gastos administrativos',
    sub: 'Gastos de estructura no asociados a unidades: contabilidad, impuestos, asesorías',
    conEquipo: false
  }
};

const filtroMetrica = { ...rango30Dias(), id_equipo: '' };

async function renderMetricaDetalle(clave) {
  const def = METRICAS[clave];
  if (!def) { location.hash = 'dashboard'; return; }

  contenido.innerHTML = `
    <div class="vista-cabecera">
      <div>
        <div class="vista-titulo">${def.titulo}</div>
        <div class="vista-sub">${def.sub}</div>
      </div>
      <button class="btn btn-secundario" onclick="location.hash='dashboard'">← Volver al dashboard</button>
    </div>
    <div class="filtros-avanzados">
      <div class="filtro-grupo">
        <label class="filtro-label">Desde</label>
        <input type="date" class="buscador filtro-fecha" id="m-desde" value="${filtroMetrica.fecha_desde}">
      </div>
      <div class="filtro-grupo">
        <label class="filtro-label">Hasta</label>
        <input type="date" class="buscador filtro-fecha" id="m-hasta" value="${filtroMetrica.fecha_hasta}">
      </div>
      ${def.conEquipo ? `
      <div class="filtro-grupo">
        <label class="filtro-label">Equipo</label>
        <select class="buscador" id="m-equipo" style="min-width:180px"><option value="">Todos los equipos</option></select>
      </div>` : ''}
      <button class="btn btn-secundario btn-mini" id="m-limpiar">Últimos 30 días</button>
    </div>
    <div id="m-contenido"><div class="estado-vacio">Cargando…</div></div>
  `;

  // Poblar selector de equipos si aplica
  if (def.conEquipo) {
    try {
      const [equipos, unidades] = await Promise.all([API.listarTodo('equipos'), API.listarTodo('unidades')]);
      const pat = id => (unidades.find(u => u.id_unidad === id) || {}).patente || '?';
      $('#m-equipo').innerHTML = '<option value="">Todos los equipos</option>' +
        equipos.map(e => `<option value="${e.id_equipo}" ${filtroMetrica.id_equipo == e.id_equipo ? 'selected' : ''}>${pat(e.id_unidad_principal)} / ${pat(e.id_unidad_secundaria)}</option>`).join('');
    } catch {}
    $('#m-equipo').addEventListener('change', () => { filtroMetrica.id_equipo = $('#m-equipo').value; cargarMetrica(clave); });
  }

  const recargarM = () => {
    filtroMetrica.fecha_desde = $('#m-desde').value;
    filtroMetrica.fecha_hasta = $('#m-hasta').value;
    cargarMetrica(clave);
  };
  $('#m-desde').addEventListener('change', recargarM);
  $('#m-hasta').addEventListener('change', recargarM);
  $('#m-limpiar').addEventListener('click', () => {
    const r = rango30Dias();
    filtroMetrica.fecha_desde = r.fecha_desde;
    filtroMetrica.fecha_hasta = r.fecha_hasta;
    filtroMetrica.id_equipo = '';
    renderMetricaDetalle(clave);
  });

  cargarMetrica(clave);
}

async function cargarMetrica(clave) {
  const params = {
    fecha_desde: filtroMetrica.fecha_desde,
    fecha_hasta: filtroMetrica.fecha_hasta,
    id_equipo: filtroMetrica.id_equipo,
    detalle: '1'
  };
  const cont = $('#m-contenido');
  try {
    if (clave === 'ingresos-por-viaje') {
      const filas = await API.ingresosPorViaje(params);
      const total = filas.reduce((s, v) => s + Number(v.ingreso), 0);
      const totalIva = filas.reduce((s, v) => s + Number(v.iva || 0), 0);
      cont.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-etiqueta">Viajes en el período</div><div class="kpi-valor">${filas.length}</div></div>
          <div class="kpi"><div class="kpi-etiqueta">Ingreso total (sin IVA)</div><div class="kpi-valor exito">${fmtDinero(total)}</div></div>
          <div class="kpi"><div class="kpi-etiqueta" title="IVA de los viajes facturados con IVA. Se cobra al cliente pero se le debe a ARCA.">IVA facturado</div><div class="kpi-valor info">${fmtDinero(totalIva)}</div></div>
          <div class="kpi"><div class="kpi-etiqueta">Total con IVA</div><div class="kpi-valor">${fmtDinero(total + totalIva)}</div></div>
          <div class="kpi"><div class="kpi-etiqueta">Promedio por viaje</div><div class="kpi-valor info">${fmtDinero(filas.length ? total / filas.length : 0)}</div></div>
        </div>
        <div class="panel"><div class="panel-cuerpo sin-padding"><div class="tabla-contenedor">
        ${filas.length === 0 ? '<div class="estado-vacio">Sin viajes para los filtros seleccionados.</div>' : `
          <table><thead><tr>
            <th>Fecha</th><th>Ruta</th><th>Carga</th><th>Equipo</th><th>Tipo</th><th>Estado</th><th>Sin IVA</th><th>IVA</th><th>Con IVA</th>
          </tr></thead><tbody>
          ${filas.map(v => `<tr>
            <td>${fmtFecha(v.fecha_origen)}</td>
            <td>${esc(v.origen)} → ${esc(v.destino)}</td>
            <td>${esc(v.tipo_carga)}</td>
            <td>${esc(v.patente_principal)}/${esc(v.patente_secundaria)}</td>
            <td>${esc(v.tipo_tarifa)}</td>
            <td>${insigniaEstado(v.estado)}</td>
            <td class="celda-num">${fmtDinero(v.ingreso)}</td>
            <td class="celda-num" style="color:var(--texto-suave)">${Number(v.iva) > 0 ? fmtDinero(v.iva) : '—'}</td>
            <td class="celda-num" style="font-weight:600">${fmtDinero(v.ingreso_con_iva ?? v.ingreso)}</td>
          </tr>`).join('')}
          </tbody></table>`}
        </div></div></div>
        <div style="padding:10px 4px;font-size:12px;color:var(--texto-suave);line-height:1.5">
          El IVA aparece solo en los viajes facturados con IVA (líquido producto o factura).
          Los marcados como "sin facturar" no lo generan.
        </div>`;

    } else if (clave === 'consumos-por-equipo') {
      const filas = await API.consumosPorEquipo(params);
      const total = filas.reduce((s, c) => s + Number(c.monto), 0);
      cont.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-etiqueta">Consumos en el período</div><div class="kpi-valor">${filas.length}</div></div>
          <div class="kpi"><div class="kpi-etiqueta">Total gastado</div><div class="kpi-valor peligro">${fmtDinero(total)}</div></div>
        </div>
        <div class="panel"><div class="panel-cuerpo sin-padding"><div class="tabla-contenedor">
        ${filas.length === 0 ? '<div class="estado-vacio">Sin consumos para los filtros seleccionados.</div>' : `
          <table><thead><tr>
            <th>Fecha</th><th>Unidad</th><th>Proveedor</th><th>Concepto</th><th>Monto</th>
          </tr></thead><tbody>
          ${filas.map(c => `<tr>
            <td>${fmtFecha(c.fecha)}</td>
            <td>${esc(c.patente)}</td>
            <td>${esc(c.proveedor)}</td>
            <td style="white-space:normal">${esc(c.concepto)}</td>
            <td class="celda-num">${fmtDinero(c.monto)}</td>
          </tr>`).join('')}
          </tbody></table>`}
        </div></div></div>`;

    } else if (clave === 'rentabilidad-equipos') {
      const data = await API.rentabilidadEquipos(params);
      const filas = data.equipos || [];
      const totalIngresos = filas.reduce((s, r) => s + Number(r.ingresos), 0);
      const totalCostos = filas.reduce((s, r) => s + Number(r.costos), 0);
      const rentEquipos = data.rentabilidad_equipos || 0;
      const gAdmin = data.gastos_administrativos || 0;
      const rentNeta = data.rentabilidad_neta || 0;
      const ivaTotal = data.iva_total || 0;
      const rentNetaIva = data.rentabilidad_neta_con_iva ?? rentNeta;
      cont.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-etiqueta">Ingresos sin IVA</div><div class="kpi-valor exito">${fmtDinero(totalIngresos)}</div></div>
          <div class="kpi"><div class="kpi-etiqueta">Costos de equipos</div><div class="kpi-valor peligro">${fmtDinero(totalCostos)}</div></div>
          <div class="kpi"><div class="kpi-etiqueta">Gastos administrativos</div><div class="kpi-valor peligro">${fmtDinero(gAdmin)}</div></div>
          <div class="kpi"><div class="kpi-etiqueta">Rentabilidad neta</div><div class="kpi-valor ${rentNeta >= 0 ? 'exito' : 'peligro'}">${fmtDinero(rentNeta)}</div></div>
        </div>
        <div class="panel"><div class="panel-cuerpo sin-padding"><div class="tabla-contenedor">
        ${filas.length === 0 ? '<div class="estado-vacio">Sin equipos para los filtros seleccionados.</div>' : `
          <table><thead><tr>
            <th>Equipo</th><th>Chofer</th><th>Ingresos</th><th>Combustible</th><th>Generales</th><th>Sueldo</th><th>Rentabilidad</th><th>Margen</th>
          </tr></thead><tbody>
          ${filas.map(r => `<tr>
            <td>${esc(r.patente_principal)} / ${esc(r.patente_secundaria || '?')}</td>
            <td>${esc(r.chofer)}<br><span class="filtro-label">${esc(r.tipo_remuneracion || '—')}</span></td>
            <td class="celda-num">${fmtDinero(r.ingresos)}</td>
            <td class="celda-num">${fmtDinero(r.costo_combustible)}</td>
            <td class="celda-num">${fmtDinero(r.costo_generales)}</td>
            <td class="celda-num">${fmtDinero(r.sueldo)}</td>
            <td class="celda-num" style="font-weight:600;color:${r.rentabilidad >= 0 ? 'var(--exito)' : 'var(--peligro)'}">${fmtDinero(r.rentabilidad)}</td>
            <td class="celda-num">${fmtNum(r.margen)}%</td>
          </tr>`).join('')}
          <tr style="border-top:2px solid var(--borde);font-weight:600">
            <td colspan="6">Subtotal rentabilidad de equipos</td>
            <td class="celda-num" style="color:${rentEquipos >= 0 ? 'var(--exito)' : 'var(--peligro)'}">${fmtDinero(rentEquipos)}</td>
            <td></td>
          </tr>
          <tr style="color:var(--peligro)">
            <td colspan="6">− Gastos administrativos del período</td>
            <td class="celda-num">${fmtDinero(gAdmin)}</td>
            <td></td>
          </tr>
          <tr style="font-weight:700;font-size:15px;border-top:1px dashed var(--borde)">
            <td colspan="6">RENTABILIDAD NETA</td>
            <td class="celda-num" style="color:${rentNeta >= 0 ? 'var(--exito)' : 'var(--peligro)'}">${fmtDinero(rentNeta)}</td>
            <td></td>
          </tr>
          </tbody></table>`}
        </div></div></div>

        <div class="panel" style="margin-top:16px">
          <div class="panel-cabecera">
            <span>Rentabilidad con IVA incluido</span>
          </div>
          <div class="panel-cuerpo sin-padding"><div class="tabla-contenedor">
          ${filas.length === 0 ? '<div class="estado-vacio">Sin equipos para los filtros seleccionados.</div>' : `
            <table><thead><tr>
              <th>Equipo</th><th>Ingresos sin IVA</th><th>IVA</th><th>Ingresos con IVA</th><th>Costos</th><th>Rent. sin IVA</th><th>Rent. con IVA</th>
            </tr></thead><tbody>
            ${filas.map(r => `<tr>
              <td>${esc(r.patente_principal)} / ${esc(r.patente_secundaria || '?')}</td>
              <td class="celda-num">${fmtDinero(r.ingresos)}</td>
              <td class="celda-num" style="color:var(--texto-suave)">${Number(r.iva) > 0 ? fmtDinero(r.iva) : '—'}</td>
              <td class="celda-num">${fmtDinero(r.ingresos_con_iva ?? r.ingresos)}</td>
              <td class="celda-num">${fmtDinero(r.costos)}</td>
              <td class="celda-num" style="color:${r.rentabilidad >= 0 ? 'var(--exito)' : 'var(--peligro)'}">${fmtDinero(r.rentabilidad)}</td>
              <td class="celda-num" style="font-weight:600;color:${(r.rentabilidad_con_iva ?? r.rentabilidad) >= 0 ? 'var(--exito)' : 'var(--peligro)'}">${fmtDinero(r.rentabilidad_con_iva ?? r.rentabilidad)}</td>
            </tr>`).join('')}
            <tr style="border-top:2px solid var(--borde);font-weight:600">
              <td>Totales</td>
              <td class="celda-num">${fmtDinero(totalIngresos)}</td>
              <td class="celda-num">${fmtDinero(ivaTotal)}</td>
              <td class="celda-num">${fmtDinero(totalIngresos + ivaTotal)}</td>
              <td class="celda-num">${fmtDinero(totalCostos)}</td>
              <td class="celda-num" style="color:${rentEquipos >= 0 ? 'var(--exito)' : 'var(--peligro)'}">${fmtDinero(rentEquipos)}</td>
              <td class="celda-num" style="color:${(data.rentabilidad_equipos_con_iva ?? rentEquipos) >= 0 ? 'var(--exito)' : 'var(--peligro)'}">${fmtDinero(data.rentabilidad_equipos_con_iva ?? rentEquipos)}</td>
            </tr>
            <tr style="font-weight:700;border-top:1px dashed var(--borde)">
              <td colspan="5">RENTABILIDAD NETA (tras gastos administrativos)</td>
              <td class="celda-num" style="color:${rentNeta >= 0 ? 'var(--exito)' : 'var(--peligro)'}">${fmtDinero(rentNeta)}</td>
              <td class="celda-num" style="color:${rentNetaIva >= 0 ? 'var(--exito)' : 'var(--peligro)'}">${fmtDinero(rentNetaIva)}</td>
            </tr>
            </tbody></table>`}
          </div></div>
          <div style="padding:10px 16px;font-size:12px;color:var(--texto-suave);line-height:1.5;border-top:1px solid var(--borde)">
            El IVA se cobra al cliente pero se le debe a ARCA: no es ganancia propia.
            La columna <strong>Rent. sin IVA</strong> es la que refleja la rentabilidad real del equipo;
            la de <strong>con IVA</strong> sirve para ver el dinero que efectivamente ingresa por caja.
          </div>
        </div>
        ${filas.some(r => r.tipo_remuneracion === 'FIJA') ? `<div class="estado-vacio">Para choferes con sueldo FIJO, el costo se prorratea: (remuneración ÷ 30) × ${data.dias_periodo} días del período.</div>` : ''}`;

    } else if (clave === 'gastos-administrativos') {
      const filas = await API.gastosAdministrativos({ ...params, detalle: '1' });
      const total = filas.reduce((s, g) => s + Number(g.monto), 0);
      cont.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-etiqueta">Gastos en el período</div><div class="kpi-valor">${filas.length}</div></div>
          <div class="kpi"><div class="kpi-etiqueta">Total</div><div class="kpi-valor peligro">${fmtDinero(total)}</div></div>
        </div>
        <div class="panel"><div class="panel-cuerpo sin-padding"><div class="tabla-contenedor">
        ${filas.length === 0 ? '<div class="estado-vacio">Sin gastos para los filtros seleccionados.</div>' : `
          <table><thead><tr>
            <th>Fecha</th><th>Proveedor</th><th>Concepto</th><th>Monto</th>
          </tr></thead><tbody>
          ${filas.map(g => `<tr>
            <td>${fmtFecha(g.fecha)}</td>
            <td>${esc(g.proveedor)}</td>
            <td style="white-space:normal">${esc(g.concepto)}</td>
            <td class="celda-num">${fmtDinero(g.monto)}</td>
          </tr>`).join('')}
          </tbody></table>`}
        </div></div></div>`;

    } else if (clave === 'rendimiento-equipos') {
      const filas = await API.rendimientoEquipos();
      cont.innerHTML = `
        <div class="panel"><div class="panel-cuerpo sin-padding"><div class="tabla-contenedor">
        ${filas.length === 0 ? '<div class="estado-vacio">Sin datos de consumo.</div>' : `
          <table><thead><tr>
            <th>Equipo</th><th>Chofer</th><th>Litros</th><th>Km</th><th>Km/L</th><th>Gasto</th><th>Costo/km</th>
          </tr></thead><tbody>
          ${filas.map(r => `<tr>
            <td>${esc(r.patente_principal)} / ${esc(r.patente_secundaria || '?')}</td>
            <td>${esc(r.chofer)}</td>
            <td class="celda-num">${fmtNum(r.litros, 0)}</td>
            <td class="celda-num">${fmtNum(r.km, 0)}</td>
            <td class="celda-num">${fmtNum(r.km_por_litro)}</td>
            <td class="celda-num">${fmtDinero(r.gasto)}</td>
            <td class="celda-num">${fmtDinero(r.costo_por_km)}</td>
          </tr>`).join('')}
          </tbody></table>`}
        </div></div></div>
        <div class="estado-vacio">El rendimiento de combustible no se filtra por fecha porque agrega el histórico de cada equipo.</div>`;
    }
  } catch (err) {
    cont.innerHTML = `<div class="estado-vacio">Error: ${esc(err.message)}</div>`;
  }
}

function tablaSimple(cabeceras, filas) {
  return `
    <table>
      <thead><tr>${cabeceras.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${filas.map(f => `<tr>${f.map(c => c.startsWith('<td') ? c : `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;
}
