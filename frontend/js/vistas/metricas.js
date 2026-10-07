// frontend/js/vistas/metricas.js
// Vista de detalle de cada métrica del tablero (#metrica/<clave>).
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

// Cifra con rótulo y valor para el pulso de una métrica
const cifraSimple = (rotulo, valor, detalle = '', titulo = '') =>
  `<div class="cifra"><span class="rotulo"${titulo ? ` title="${esc(titulo)}"` : ''}>${rotulo}</span><span class="cifra-valor">${valor}</span>${detalle ? `<span class="cifra-delta tenue">${detalle}</span>` : ''}</div>`;

// Monto con el color del estado: ≥ 0 bueno (ok), < 0 malo (peligro)
const montoEstado = n => `<span class="cifra-delta ${Number(n) >= 0 ? 'sube' : 'baja'}">${fmtDinero(n)}</span>`;

async function renderMetricaDetalle(clave) {
  const def = METRICAS[clave];
  if (!def) { location.hash = 'dashboard'; return; }

  contenido.innerHTML = `
    <div class="vista-cab">
      <div>
        <div class="migas"><button onclick="location.hash='dashboard'">Tablero</button> / ${def.titulo}</div>
        <h1>${def.titulo}</h1>
        <p>${def.sub}</p>
      </div>
      <div class="acciones"><button class="btn" onclick="location.hash='dashboard'">Volver al tablero</button></div>
    </div>
    <div class="filtros">
      <div class="campo">
        <label for="m-desde">Desde</label>
        <input type="date" id="m-desde" value="${filtroMetrica.fecha_desde}">
      </div>
      <div class="campo">
        <label for="m-hasta">Hasta</label>
        <input type="date" id="m-hasta" value="${filtroMetrica.fecha_hasta}">
      </div>
      ${def.conEquipo ? `
      <div class="campo">
        <label for="m-equipo">Equipo</label>
        <select id="m-equipo"><option value="">Todos los equipos</option></select>
      </div>` : ''}
      <button class="btn btn-chico" id="m-limpiar">Últimos 30 días</button>
    </div>
    <div class="pila" id="m-contenido"><div class="vacio">Cargando…</div></div>
  `;

  // Poblar selector de equipos si aplica
  if (def.conEquipo) {
    try {
      const [equipos, unidades] = await Promise.all([API.listarTodo('equipos'), API.listarTodo('unidades')]);
      const pat = id => (unidades.find(u => u.id_unidad === id) || {}).patente || '?';
      $('#m-equipo').innerHTML = '<option value="">Todos los equipos</option>' +
        equipos.map(e => `<option value="${e.id_equipo}" ${filtroMetrica.id_equipo == e.id_equipo ? 'selected' : ''}>${esc(pat(e.id_unidad_principal))} / ${esc(pat(e.id_unidad_secundaria))}</option>`).join('');
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
        <div class="pulso">
          ${cifraSimple('Viajes en el período', filas.length)}
          ${cifraSimple('Ingreso total (sin IVA)', fmtMillones(total))}
          ${cifraSimple('IVA facturado', fmtMillones(totalIva), '', 'IVA de los viajes facturados con IVA. Se cobra al cliente pero se le debe a ARCA.')}
          ${cifraSimple('Total con IVA', fmtMillones(total + totalIva))}
          ${cifraSimple('Promedio por viaje', fmtMillones(filas.length ? total / filas.length : 0))}
        </div>
        ${hojaHTML('Viajes del período', '', filas.length === 0 ? '<div class="vacio">Sin viajes para los filtros seleccionados.</div>' : `
          <div class="tabla-marco"><table class="tabla">
            <thead><tr>
              <th>Fecha</th><th>Ruta</th><th>Carga</th><th>Equipo</th><th>Tipo</th><th>Estado</th><th class="num">Sin IVA</th><th class="num">IVA</th><th class="num">Con IVA</th>
            </tr></thead>
            <tbody>
            ${filas.map(v => `<tr>
              <td>${fmtFecha(v.fecha_origen)}</td>
              <td>${esc(v.origen)} → ${esc(v.destino)}</td>
              <td>${esc(v.tipo_carga)}</td>
              <td>${patentesEquipo(v)}</td>
              <td>${esc(v.tipo_tarifa)}</td>
              <td>${insigniaEstado(v.estado)}</td>
              <td class="num">${fmtDinero(v.ingreso)}</td>
              <td class="num tenue">${Number(v.iva) > 0 ? fmtDinero(v.iva) : '—'}</td>
              <td class="num fuerte">${fmtDinero(v.ingreso_con_iva ?? v.ingreso)}</td>
            </tr>`).join('')}
            </tbody>
          </table></div>`, '', 'El IVA aparece solo en los viajes facturados con IVA (líquido producto o factura). Los marcados como «sin facturar» no lo generan.')}`;

    } else if (clave === 'consumos-por-equipo') {
      const filas = await API.consumosPorEquipo(params);
      const total = filas.reduce((s, c) => s + Number(c.monto), 0);
      cont.innerHTML = `
        <div class="pulso">
          ${cifraSimple('Consumos en el período', filas.length)}
          ${cifraSimple('Total gastado', fmtMillones(total))}
        </div>
        ${hojaHTML('Consumos del período', '', filas.length === 0 ? '<div class="vacio">Sin consumos para los filtros seleccionados.</div>' : `
          <div class="tabla-marco"><table class="tabla">
            <thead><tr>
              <th>Fecha</th><th>Unidad</th><th>Proveedor</th><th>Concepto</th><th class="num">Monto</th>
            </tr></thead>
            <tbody>
            ${filas.map(c => `<tr>
              <td>${fmtFecha(c.fecha)}</td>
              <td>${patenteHTML(c.patente)}</td>
              <td>${esc(c.proveedor)}</td>
              <td>${esc(c.concepto)}</td>
              <td class="num">${fmtDinero(c.monto)}</td>
            </tr>`).join('')}
            </tbody>
          </table></div>`)}`;

    } else if (clave === 'rentabilidad-equipos') {
      const data = await API.rentabilidadEquipos(params);
      const filas = data.equipos || [];
      const totalIngresos = filas.reduce((s, r) => s + Number(r.ingresos), 0);
      const totalCostos = filas.reduce((s, r) => s + Number(r.costos), 0);
      const rentEquipos = data.rentabilidad_equipos || 0;
      const gAdmin = data.gastos_administrativos || 0;
      const gSinEquipo = data.gastos_unidades_sin_equipo || 0;
      const rentNeta = data.rentabilidad_neta || 0;
      const ivaTotal = data.iva_total || 0;
      const rentNetaIva = data.rentabilidad_neta_con_iva ?? rentNeta;
      const maxBarra = Math.max(0, ...filas.map(r => Math.max(Number(r.ingresos), Number(r.costos))));
      const suma = k => filas.reduce((s, r) => s + Number(r[k] || 0), 0);

      const cascada = filas.length === 0 || totalIngresos <= 0 ? '' : hojaHTML('Resultado del período', 'Ingresos menos cada costo; debajo de cada costo, su porcentaje sobre los ingresos',
        `<div class="hoja-cuerpo">${graficoCascada({
          ingresos: totalIngresos,
          costos: [
            { nombre: 'Combustible', valor: suma('costo_combustible') },
            { nombre: 'Consumos', valor: suma('costo_generales') },
            { nombre: 'Sueldos', valor: suma('sueldo') },
            { nombre: 'Administración', valor: Number(gAdmin) },
            ...(Number(gSinEquipo) ? [{ nombre: 'Sin equipo', valor: Number(gSinEquipo) }] : [])
          ],
          resultado: Number(rentNeta)
        })}</div>`);

      cont.innerHTML = `
        <div class="pulso">
          ${cifraSimple('Ingresos sin IVA', fmtMillones(totalIngresos))}
          ${cifraSimple('Costos de equipos', fmtMillones(totalCostos))}
          ${cifraSimple('Gastos administrativos', fmtMillones(gAdmin))}
          <div class="cifra"><span class="rotulo">Rentabilidad neta</span><span class="cifra-valor">${fmtMillones(rentNeta)}</span><span class="cifra-delta ${rentNeta >= 0 ? 'sube' : 'baja'}">${rentNeta >= 0 ? 'Resultado positivo' : 'Resultado negativo'}</span></div>
        </div>
        ${cascada}
        ${hojaHTML('Rentabilidad por equipo', '', filas.length === 0 ? '<div class="vacio">Sin equipos para los filtros seleccionados.</div>' : `
          <div class="tabla-marco"><table class="tabla">
            <thead><tr>
              <th>Equipo</th><th>Chofer</th><th>Costos ← → Ingresos</th><th class="num">Ingresos</th><th class="num">Combustible</th><th class="num">Generales</th><th class="num">Sueldo</th><th class="num">Rentabilidad</th><th class="num">Margen</th>
            </tr></thead>
            <tbody>
            ${filas.map(r => `<tr>
              <td>${patentesEquipo(r)}</td>
              <td>${esc(r.chofer)}${marcaBaja(r)}</td>
              <td>${barraDoble(r.costos, r.ingresos, maxBarra)}</td>
              <td class="num">${fmtDinero(r.ingresos)}</td>
              <td class="num">${fmtDinero(r.costo_combustible)}</td>
              <td class="num">${fmtDinero(r.costo_generales)}</td>
              <td class="num">${fmtDinero(r.sueldo)}<br><span class="tenue">fijo ${fmtDinero(r.sueldo_fijo || 0)} + var. ${fmtDinero(r.sueldo_variable || 0)}</span></td>
              <td class="num fuerte">${montoEstado(r.rentabilidad)}</td>
              <td class="num">${fmtNum(r.margen)} %</td>
            </tr>`).join('')}
              <tr><td colspan="7" class="fuerte">Subtotal rentabilidad de equipos</td><td class="num fuerte">${fmtDinero(rentEquipos)}</td><td></td></tr>
              <tr><td colspan="7">− Gastos administrativos del período</td><td class="num">${fmtDinero(gAdmin)}</td><td></td></tr>
              ${gSinEquipo ? `<tr title="Consumos de unidades que en esa fecha no estaban en ningún equipo (por ejemplo, en el taller)"><td colspan="7">− Gastos de unidades sin equipo (en el taller, sin asignar)</td><td class="num">${fmtDinero(gSinEquipo)}</td><td></td></tr>` : ''}
            </tbody>
            <tfoot>
              <tr><td colspan="7">Rentabilidad neta</td><td class="num">${fmtDinero(rentNeta)}</td><td></td></tr>
            </tfoot>
          </table></div>`)}

        ${hojaHTML('Rentabilidad con IVA incluido', '', filas.length === 0 ? '<div class="vacio">Sin equipos para los filtros seleccionados.</div>' : `
          <div class="tabla-marco"><table class="tabla">
            <thead><tr>
              <th>Equipo</th><th class="num">Ingresos sin IVA</th><th class="num">IVA</th><th class="num">Ingresos con IVA</th><th class="num">Costos</th><th class="num">Rent. sin IVA</th><th class="num">Rent. con IVA</th>
            </tr></thead>
            <tbody>
            ${filas.map(r => `<tr>
              <td>${patentesEquipo(r)}</td>
              <td class="num">${fmtDinero(r.ingresos)}</td>
              <td class="num tenue">${Number(r.iva) > 0 ? fmtDinero(r.iva) : '—'}</td>
              <td class="num">${fmtDinero(r.ingresos_con_iva ?? r.ingresos)}</td>
              <td class="num">${fmtDinero(r.costos)}</td>
              <td class="num">${montoEstado(r.rentabilidad)}</td>
              <td class="num fuerte">${montoEstado(r.rentabilidad_con_iva ?? r.rentabilidad)}</td>
            </tr>`).join('')}
              <tr>
                <td class="fuerte">Totales</td>
                <td class="num fuerte">${fmtDinero(totalIngresos)}</td>
                <td class="num fuerte">${fmtDinero(ivaTotal)}</td>
                <td class="num fuerte">${fmtDinero(totalIngresos + ivaTotal)}</td>
                <td class="num fuerte">${fmtDinero(totalCostos)}</td>
                <td class="num fuerte">${fmtDinero(rentEquipos)}</td>
                <td class="num fuerte">${fmtDinero(data.rentabilidad_equipos_con_iva ?? rentEquipos)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td colspan="5">Rentabilidad neta (tras gastos administrativos)</td>
                <td class="num">${fmtDinero(rentNeta)}</td>
                <td class="num">${fmtDinero(rentNetaIva)}</td>
              </tr>
            </tfoot>
          </table></div>`, '', 'El IVA se cobra al cliente pero se le debe a ARCA: no es ganancia propia. La columna «Rent. sin IVA» refleja la rentabilidad real del equipo; la de «con IVA» sirve para ver el dinero que efectivamente ingresa por caja.')}
        ${filas.some(r => Number(r.sueldo_fijo) > 0) ? `<div class="vacio">El sueldo fijo se prorratea por los días que cada chofer estuvo asignado al equipo en el período (${data.dias_periodo} días en total).</div>` : ''}`;

    } else if (clave === 'gastos-administrativos') {
      const filas = await API.gastosAdministrativos({ ...params, detalle: '1' });
      const total = filas.reduce((s, g) => s + Number(g.monto), 0);
      cont.innerHTML = `
        <div class="pulso">
          ${cifraSimple('Gastos en el período', filas.length)}
          ${cifraSimple('Total', fmtMillones(total))}
        </div>
        ${hojaHTML('Gastos del período', '', filas.length === 0 ? '<div class="vacio">Sin gastos para los filtros seleccionados.</div>' : `
          <div class="tabla-marco"><table class="tabla">
            <thead><tr>
              <th>Fecha</th><th>Proveedor</th><th>Concepto</th><th class="num">Monto</th>
            </tr></thead>
            <tbody>
            ${filas.map(g => `<tr>
              <td>${fmtFecha(g.fecha)}</td>
              <td>${esc(g.proveedor)}</td>
              <td>${esc(g.concepto)}</td>
              <td class="num">${fmtDinero(g.monto)}</td>
            </tr>`).join('')}
            </tbody>
          </table></div>`)}`;

    } else if (clave === 'rendimiento-equipos') {
      const filas = await API.rendimientoEquipos();
      const conDatos = filas.filter(r => Number(r.km_por_litro) > 0);
      cont.innerHTML = `
        ${conDatos.length ? hojaHTML('Km/L contra el promedio', 'Azul: por encima del promedio de la flota · naranja: por debajo',
          `<div class="hoja-cuerpo">${graficoPuntosPromedio(conDatos.map(r => ({
            rotulo: `${r.patente_principal} · ${String(r.chofer || '').split(' ').slice(-1)[0]}`,
            valor: Number(r.km_por_litro)
          })))}</div>`) : ''}
        ${hojaHTML('Rendimiento por equipo', '', filas.length === 0 ? '<div class="vacio">Sin datos de consumo.</div>' : `
          <div class="tabla-marco"><table class="tabla">
            <thead><tr>
              <th>Equipo</th><th>Chofer</th><th class="num">Litros</th><th class="num">Km</th><th class="num">Km/L</th><th class="num">Gasto</th><th class="num">Costo/km</th>
            </tr></thead>
            <tbody>
            ${filas.map(r => `<tr>
              <td>${patentesEquipo(r)}</td>
              <td>${esc(r.chofer)}${marcaBaja(r)}</td>
              <td class="num">${fmtNum(r.litros, 0)}</td>
              <td class="num">${fmtNum(r.km, 0)}</td>
              <td class="num fuerte">${fmtNum(r.km_por_litro)}</td>
              <td class="num">${fmtDinero(r.gasto)}</td>
              <td class="num">${fmtDinero(r.costo_por_km)}</td>
            </tr>`).join('')}
            </tbody>
          </table></div>`, '', 'El rendimiento de combustible no se filtra por fecha porque agrega el histórico de cada equipo.')}`;
    }
  } catch (err) {
    cont.innerHTML = `<div class="vacio">Error: ${esc(err.message)}</div>`;
  }
}
