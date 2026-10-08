// frontend/js/vistas/dashboard.js
// Vista Tablero: pulso de cifras, resultado en cascada, alertas, rentabilidad,
// rendimiento y su vista ampliada. Los gráficos son SVG propios (ver
// nucleo/graficos.js). Las funciones son globales a propósito: las usan los
// onclick="..." del HTML generado y los demás archivos. El orden de carga
// está en index.html.

// ============================================================
// Tablero
// ============================================================
// Estado del filtro de fecha global del tablero
const filtroDash = { ...rango30Dias(), tipo: 'rango' };

const TIPOS_PERIODO = [
  { id: 'rango', texto: 'Rango' },
  { id: 'mes', texto: 'Mes' },
  { id: 'trimestre', texto: 'Trimestre' },
  { id: 'anio', texto: 'Año' }
];

async function renderDashboard() {
  // Valores preseleccionados en los selectores de período: si ya hay un
  // período aplicado se refleja ese; si no, el mes/trimestre/año en curso.
  const refFecha = filtroDash.fecha_desde
    ? new Date(filtroDash.fecha_desde + 'T00:00:00')
    : new Date();
  const anioActual = refFecha.getFullYear();
  const mesActual = refFecha.getMonth() + 1;
  const trimestreActual = Math.floor(refFecha.getMonth() / 3) + 1;
  let tipoUI = filtroDash.tipo;

  contenido.innerHTML = `
    <div class="vista-cab">
      <div>
        <h1>Tablero</h1>
        <p id="dash-periodo-activo">Resumen operativo y financiero de la empresa.</p>
      </div>
      <div class="acciones"><button class="btn" onclick="renderDashboard()">Actualizar</button></div>
    </div>
    <div class="filtros" id="dash-filtros">
      <div class="segmentado" role="group" aria-label="Tipo de período" id="dash-tipo">
        ${TIPOS_PERIODO.map(t => `<button type="button" data-tipo="${t.id}" aria-pressed="${t.id === tipoUI}">${t.texto}</button>`).join('')}
      </div>
      <div class="campo" data-periodo="rango">
        <label for="dash-desde">Desde</label>
        <input type="date" id="dash-desde" value="${filtroDash.fecha_desde}">
      </div>
      <div class="campo" data-periodo="rango">
        <label for="dash-hasta">Hasta</label>
        <input type="date" id="dash-hasta" value="${filtroDash.fecha_hasta}">
      </div>
      <div class="campo" data-periodo="mes">
        <label for="dash-mes">Mes</label>
        <select id="dash-mes">
          ${NOMBRES_MES.map((n, i) => `<option value="${i + 1}"${(i + 1) === mesActual ? ' selected' : ''}>${n}</option>`).join('')}
        </select>
      </div>
      <div class="campo" data-periodo="trimestre">
        <label for="dash-trimestre">Trimestre</label>
        <select id="dash-trimestre">
          ${[1, 2, 3, 4].map(q => `<option value="${q}"${q === trimestreActual ? ' selected' : ''}>${q}° trimestre (${NOMBRES_MES[(q - 1) * 3].slice(0, 3)}–${NOMBRES_MES[(q - 1) * 3 + 2].slice(0, 3)})</option>`).join('')}
        </select>
      </div>
      <div class="campo" data-periodo="mes trimestre anio">
        <label for="dash-anio">Año</label>
        <select id="dash-anio">
          ${aniosDisponibles().map(a => `<option value="${a}"${a === anioActual ? ' selected' : ''}>${a}</option>`).join('')}
        </select>
      </div>
      <button class="btn btn-tinta btn-chico" id="dash-aplicar">Aplicar período</button>
      <button class="btn btn-fantasma btn-chico" id="dash-limpiar">Últimos 30 días</button>
    </div>
    <div id="dash-kpis"><div class="vacio">Cargando métricas…</div></div>
    <div class="pila" id="dash-paneles"></div>
  `;

  // Muestra solo los controles que corresponden al tipo de período elegido.
  function mostrarControlesPeriodo() {
    document.querySelectorAll('#dash-tipo button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tipo === tipoUI)));
    document.querySelectorAll('#dash-filtros [data-periodo]').forEach(el => {
      el.hidden = !el.dataset.periodo.split(' ').includes(tipoUI);
    });
  }
  $('#dash-tipo').addEventListener('click', e => {
    const b = e.target.closest('button[data-tipo]');
    if (!b) return;
    tipoUI = b.dataset.tipo;
    mostrarControlesPeriodo();
  });
  mostrarControlesPeriodo();

  $('#dash-aplicar').addEventListener('click', () => {
    filtroDash.tipo = tipoUI;
    const anio = Number($('#dash-anio').value);
    let r;
    if (tipoUI === 'mes') r = rangoMes(anio, Number($('#dash-mes').value));
    else if (tipoUI === 'trimestre') r = rangoTrimestre(anio, Number($('#dash-trimestre').value));
    else if (tipoUI === 'anio') r = rangoAnio(anio);
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
    // Ingresos y rentabilidad: solo para quien administra la empresa.
    const finanzas = veFinanzas();
    const sinDato = valor => Promise.resolve(valor);
    const [kpis, alertas, rendEquipos, rendChoferes, clientes, consumosEq, ingresosViaje, rentabilidad, gastosAdmin] = await Promise.all([
      API.kpis(periodo), API.alertas(), API.rendimientoEquipos(),
      API.rendimientoChoferes(), finanzas ? API.clientesTop() : sinDato([]),
      API.consumosPorEquipo(periodo),
      finanzas ? API.ingresosPorViaje(periodo) : sinDato({ resumen: {}, top_viajes: [] }),
      finanzas ? API.rentabilidadEquipos(periodo) : sinDato({ equipos: [] }),
      API.gastosAdministrativos(periodo)
    ]);

    // --- Pulso: la primera cifra (resultado neto) es la más ancha ---
    const ing = kpis.ingresos || {};
    $('#dash-kpis').innerHTML = `
      <div class="pulso tablero">
        ${finanzas ? `<div class="cifra cifra-xl">
          <span class="rotulo">Resultado neto</span>
          <span class="cifra-valor">${fmtMillones(ing.ganancia_neta)}</span>
          <span class="cifra-delta ${ing.ganancia_neta >= 0 ? 'sube' : 'baja'}">${ing.ganancia_neta >= 0 ? '▲' : '▼'} ${fmtNum(ing.margen, 1)} % <span class="tenue">de margen</span></span>
        </div>
        <div class="cifra">
          <span class="rotulo">Ingresos</span>
          <span class="cifra-valor">${fmtMillones(ing.ingresos_totales)}</span>
          <span class="cifra-delta tenue">viajes finalizados y facturados</span>
        </div>` : ''}
        <div class="cifra${finanzas ? '' : ' cifra-xl'}">
          <span class="rotulo">Costos</span>
          <span class="cifra-valor">${fmtMillones(kpis.costos_totales)}</span>
          <span class="cifra-delta tenue">${fmtDinero(kpis.combustible.gasto_combustible)} en combustible</span>
        </div>
        ${finanzas ? `<div class="cifra">
          <span class="rotulo">Pendiente de cobro</span>
          <span class="cifra-valor">${fmtMillones(ing.pendiente_cobro)}</span>
          <span class="cifra-delta tenue">viajes sin cobrar</span>
        </div>` : ''}
        <div class="cifra">
          <span class="rotulo">Rendimiento</span>
          <span class="cifra-valor">${fmtNum(kpis.combustible.rendimiento_global)}<small>km/L</small></span>
          <span class="cifra-delta tenue">${fmtNum(kpis.combustible.litros_totales, 0)} L cargados</span>
        </div>
        <div class="cifra">
          <span class="rotulo">Viajes activos</span>
          <span class="cifra-valor">${kpis.viajes.viajes_activos || 0}</span>
          <span class="cifra-delta tenue">${kpis.flota.total_equipos} equipos · ${kpis.flota.total_unidades} unidades · ${kpis.flota.total_choferes} choferes</span>
        </div>
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
      ? '<div class="vacio">Sin alertas. Todo en orden.</div>'
      : `<ul class="alertas">${alertasMostradas.map(filaAlertaUnificada).join('')}</ul>`;
    const pieAlertas = restantesAlertas > 0
      ? `y ${restantesAlertas} alerta${restantesAlertas === 1 ? '' : 's'} más — <a href="#alertas">ver todas</a>`
      : '';

    // Limita una lista a 7 elementos en el tablero; el resto se ve en la
    // vista ampliada de cada métrica.
    const TOPE_DASH = 7;
    const top7 = arr => (arr || []).slice(0, TOPE_DASH);
    const pieResto = (arr, claveMetrica) => {
      const restantes = (arr || []).length - TOPE_DASH;
      return restantes > 0 ? `y ${restantes} más — <a href="#metrica/${claveMetrica}">ver todos</a>` : '';
    };
    const botonAmpliar = clave => `<button class="btn btn-chico" onclick="location.hash='metrica/${clave}'">Ampliar</button>`;

    // --- Rendimiento por equipo: km/L contra el promedio ---
    const conRend = rendEquipos.filter(r => Number(r.km_por_litro) > 0);
    const htmlEquipos = rendEquipos.length === 0
      ? '<div class="vacio">Sin datos de consumo todavía.</div>'
      : `<div class="hoja-cuerpo">${graficoPuntosPromedio(top7(conRend).map(r => ({
          rotulo: `${r.patente_principal} · ${String(r.chofer || '').split(' ').slice(-1)[0]}`,
          valor: Number(r.km_por_litro)
        })))}</div>` +
        tablaSimple(
          ['Equipo', 'Chofer', 'Km/L', 'Costo/km'],
          top7(rendEquipos).map(r => [
            patentesEquipo(r),
            esc(r.chofer) + marcaBaja(r),
            `<td class="num">${fmtNum(r.km_por_litro)}</td>`,
            `<td class="num">${fmtDinero(r.costo_por_km)}</td>`
          ])
        );

    const htmlChoferes = rendChoferes.length === 0
      ? '<div class="vacio">Sin choferes registrados.</div>'
      : tablaSimple(
          finanzas ? ['Chofer', 'Viajes', 'Ingresos'] : ['Chofer', 'Viajes'],
          top7(rendChoferes).map(r => [
            esc(r.nombre),
            `<td class="num">${r.viajes}</td>`,
            ...(finanzas ? [`<td class="num">${fmtDinero(r.ingresos)}</td>`] : [])
          ])
        );
    const pieChoferes = rendChoferes.length > TOPE_DASH ? `Mostrando los ${TOPE_DASH} con más ${finanzas ? 'ingresos' : 'viajes'} de ${rendChoferes.length}.` : '';

    const htmlClientes = clientes.length === 0
      ? '<div class="vacio">Sin viajes con pagador registrado.</div>'
      : tablaSimple(
          ['Cliente', 'Viajes', 'Ingresos'],
          top7(clientes).map(r => [
            esc(r.pagador),
            `<td class="num">${r.viajes}</td>`,
            `<td class="num">${fmtDinero(r.ingresos)}</td>`
          ])
        );
    const pieClientes = clientes.length > TOPE_DASH ? `Mostrando los ${TOPE_DASH} con más ingresos de ${clientes.length}.` : '';

    // --- Consumos generales por equipo ---
    const htmlConsumosEq = consumosEq.length === 0
      ? '<div class="vacio">Sin consumos generales en el período.</div>'
      : tablaSimple(
          ['Equipo', 'Consumos', 'Total'],
          top7(consumosEq).map(r => [
            patentesEquipo(r),
            `<td class="num">${r.cantidad}</td>`,
            `<td class="num">${fmtDinero(r.total)}</td>`
          ])
        );

    // --- Rentabilidad por equipo: barra doble (costos ← | → ingresos) ---
    const rentEquipos = rentabilidad.equipos || [];
    const maxRent = Math.max(0, ...rentEquipos.map(r => Math.max(Number(r.ingresos), Number(r.costos))));
    const htmlRentabilidad = rentEquipos.length === 0
      ? '<div class="vacio">Sin equipos para calcular rentabilidad.</div>'
      : tablaSimple(
          ['Equipo', 'Costos ← → Ingresos', 'Ingresos', 'Costos', 'Rentabilidad'],
          top7(rentEquipos).map(r => [
            patentesEquipo(r),
            `<td>${barraDoble(r.costos, r.ingresos, maxRent)}</td>`,
            `<td class="num">${fmtDinero(r.ingresos)}</td>`,
            `<td class="num">${fmtDinero(r.costos)}</td>`,
            `<td class="num fuerte"><span class="${r.rentabilidad >= 0 ? 'cifra-delta sube' : 'cifra-delta baja'}">${fmtDinero(r.rentabilidad)}</span></td>`
          ])
        );
    const resumenRent = rentEquipos.length === 0 ? '' : `
      <div class="tabla-marco"><table class="tabla">
        <tbody>
          <tr><td>Rentabilidad de equipos</td><td class="num">${fmtDinero(rentabilidad.rentabilidad_equipos || 0)}</td></tr>
          <tr><td>− Gastos administrativos</td><td class="num">${fmtDinero(rentabilidad.gastos_administrativos || 0)}</td></tr>
          ${rentabilidad.gastos_unidades_sin_equipo ? `<tr title="Consumos de unidades que en esa fecha no estaban en ningún equipo (por ejemplo, en el taller)"><td>− Gastos de unidades sin equipo</td><td class="num">${fmtDinero(rentabilidad.gastos_unidades_sin_equipo)}</td></tr>` : ''}
        </tbody>
        <tfoot><tr><td>Rentabilidad neta</td><td class="num">${fmtDinero(rentabilidad.rentabilidad_neta || 0)}</td></tr></tfoot>
      </table></div>`;

    // --- Resultado del período en cascada ---
    const suma = clave => rentEquipos.reduce((s, r) => s + Number(r[clave] || 0), 0);
    const htmlCascada = rentEquipos.length === 0 || suma('ingresos') <= 0
      ? '<div class="vacio">Sin ingresos en el período para armar la cascada.</div>'
      : `<div class="hoja-cuerpo">${graficoCascada({
          ingresos: suma('ingresos'),
          costos: [
            { nombre: 'Combustible', valor: suma('costo_combustible') },
            { nombre: 'Consumos', valor: suma('costo_generales') },
            { nombre: 'Sueldos', valor: suma('sueldo') },
            { nombre: 'Administración', valor: Number(rentabilidad.gastos_administrativos || 0) },
            ...(Number(rentabilidad.gastos_unidades_sin_equipo) ? [{ nombre: 'Sin equipo', valor: Number(rentabilidad.gastos_unidades_sin_equipo) }] : [])
          ],
          resultado: Number(rentabilidad.rentabilidad_neta || 0)
        })}</div>`;

    // --- Gastos administrativos: barra inline por proveedor (nunca tortas) ---
    const provs = gastosAdmin.por_proveedor || [];
    const maxProv = Math.max(0, ...provs.map(p => Number(p.total)));
    const htmlGastosAdmin = (gastosAdmin.cantidad || 0) === 0
      ? '<div class="vacio">Sin gastos administrativos en el período.</div>'
      : `<div class="hoja-cuerpo"><div class="cifra"><span class="rotulo">Total del período</span><span class="cifra-valor">${fmtMillones(gastosAdmin.total)}</span><span class="cifra-delta tenue">${gastosAdmin.cantidad} gasto${gastosAdmin.cantidad === 1 ? '' : 's'} registrado${gastosAdmin.cantidad === 1 ? '' : 's'}</span></div></div>` +
        tablaSimple(
          ['Proveedor', 'Participación', 'Gastos', 'Total'],
          top7(provs).map(r => [
            esc(r.proveedor),
            `<td>${barraSimple(maxProv ? Number(r.total) / maxProv * 100 : 0, true)}</td>`,
            `<td class="num">${r.cantidad}</td>`,
            `<td class="num">${fmtDinero(r.total)}</td>`
          ])
        );

    // --- Ingresos por viaje ---
    const ipv = ingresosViaje.resumen;
    const topViajes = ingresosViaje.top_viajes || [];
    const htmlIngresosViaje = ipv.cantidad_viajes === 0
      ? '<div class="vacio">Sin viajes en el período.</div>'
      : `<div class="hoja-cuerpo"><div class="ficha-datos">
          <div class="ficha-dato"><span class="rotulo">Viajes</span><b>${ipv.cantidad_viajes}</b></div>
          <div class="ficha-dato"><span class="rotulo">Ingreso sin IVA</span><b>${fmtDinero(ipv.ingreso_total)}</b></div>
          <div class="ficha-dato"><span class="rotulo" title="IVA de los viajes facturados con IVA. No es ingreso propio: se debe a ARCA.">IVA facturado</span><b>${fmtDinero(ipv.iva_total || 0)}</b></div>
          <div class="ficha-dato"><span class="rotulo">Total con IVA</span><b>${fmtDinero(ipv.ingreso_total_con_iva || ipv.ingreso_total)}</b></div>
        </div></div>` +
        tablaSimple(
          ['Viaje', 'Ruta', 'Pagador', 'Sin IVA', 'IVA', 'Con IVA'],
          topViajes.map(v => [
            `<td class="mono">#${v.id_viaje}</td>`,
            `${esc(v.origen)} → ${esc(v.destino)}`,
            esc(v.pagador || '—'),
            `<td class="num">${fmtDinero(v.ingreso)}</td>`,
            `<td class="num tenue">${Number(v.iva) > 0 ? fmtDinero(v.iva) : '—'}</td>`,
            `<td class="num">${fmtDinero(v.ingreso_con_iva ?? v.ingreso)}</td>`
          ])
        );
    const pieIngresosViaje = ipv.cantidad_viajes > topViajes.length
      ? `Mostrando los ${topViajes.length} de mayor ingreso — <a href="#metrica/ingresos-por-viaje">ver todos los ${ipv.cantidad_viajes}</a>`
      : '';

    // Cada hoja se muestra solo si su módulo está activo. Las alertas
    // dependen de los módulos de flota; ingresos/rentabilidad de viajes;
    // consumos y gastos de sus respectivos módulos.
    const hayFlota = moduloActivo('mantenimientos') || moduloActivo('vencimientos') || moduloActivo('choferes');
    const delViajes = moduloActivo('viajes');
    const finanzasViajes = delViajes && finanzas;
    // Las hojas son las mismas de siempre; solo se agrupan por tema, con un título
    // de sección, para leer el tablero de arriba hacia abajo.
    const hoja_cascada = finanzasViajes && hojaHTML('Resultado del período', 'Ingresos menos cada costo, como porcentaje de los ingresos', htmlCascada, botonAmpliar('rentabilidad-equipos'));
    const hoja_alertas = hayFlota && hojaHTML(`Alertas ${insignia(totalAlertas, totalAlertas ? 'peligro' : 'ok')}`, 'Ordenadas por urgencia', htmlAlertas,
      totalAlertas > 0 ? `<button class="btn btn-chico" onclick="location.hash='alertas'">Ampliar</button>` : '', pieAlertas);
    const hoja_rentabilidad = finanzasViajes && hojaHTML('Rentabilidad por equipo', 'Ingresos menos costos de combustible, consumos y sueldo del chofer', htmlRentabilidad + resumenRent, botonAmpliar('rentabilidad-equipos'), pieResto(rentEquipos, 'rentabilidad-equipos'));
    const hoja_rendimiento = moduloActivo('consumos-combustible') && hojaHTML('Rendimiento por equipo', 'Kilómetros por litro contra el promedio de la flota', htmlEquipos, botonAmpliar('rendimiento-equipos'), pieResto(rendEquipos, 'rendimiento-equipos'));
    const hoja_ingresosViaje = finanzasViajes && hojaHTML('Ingresos por viaje', 'Viajes con más ingresos del período', htmlIngresosViaje, botonAmpliar('ingresos-por-viaje'), pieIngresosViaje);
    const hoja_gastosAdmin = moduloActivo('gastos-administrativos') && hojaHTML('Gastos administrativos', 'Gastos de estructura por proveedor', htmlGastosAdmin, botonAmpliar('gastos-administrativos'), pieResto(provs, 'gastos-administrativos'));
    const hoja_consumos = moduloActivo('consumos-generales') && hojaHTML('Consumos generales por equipo', '', htmlConsumosEq, botonAmpliar('consumos-por-equipo'), pieResto(consumosEq, 'consumos-por-equipo'));
    const hoja_choferes = delViajes && hojaHTML('Rendimiento por chofer', '', htmlChoferes, '', pieChoferes);
    const hoja_clientes = finanzasViajes && hojaHTML('Principales clientes', '', htmlClientes, '', pieClientes);

    const seccion = (titulo, hojas, clase) => {
      const visibles = hojas.filter(Boolean);
      if (!visibles.length) return '';
      return `<h2 class="seccion-tablero">${titulo}</h2>` +
        (visibles.length === 1 ? `<div class="pila">${visibles[0]}</div>` : `<div class="${clase}">${visibles.join('')}</div>`);
    };
    $('#dash-paneles').innerHTML =
      seccion('Resultado y alertas', [hoja_cascada, hoja_alertas], 'grilla-2') +
      seccion('Equipos', [hoja_rentabilidad, hoja_rendimiento], 'grilla-2') +
      seccion('Ingresos', [hoja_ingresosViaje], 'grilla-2') +
      seccion('Clientes y choferes', [hoja_clientes, hoja_choferes], 'grilla-2-iguales') +
      seccion('Costos y estructura', [hoja_consumos, hoja_gastosAdmin], 'grilla-2-iguales');
  } catch (err) {
    // Si el usuario ya cambió de vista mientras cargaba, no hay dónde mostrarlo.
    const destino = $('#dash-kpis');
    if (!destino) return;
    destino.innerHTML = `<div class="vacio">No se pudo conectar con la base de datos.<br>${esc(err.message)}</div>`;
  }
}

// Unifica todas las categorías de alertas en una sola lista normalizada y
// la ordena según la prioridad de negocio:
//   1º cobros vencidos, 2º vencimientos, 3º mantenimientos, 4º licencias de
//   choferes (carnets), y por último los descansos.
// Dentro de cada categoría se ordena por la cantidad de días en alerta:
// lo más urgente primero (los ya vencidos, con días negativos, van arriba).
function unificarAlertas(alertas) {
  // Orden de prioridad por tipo (menor = más prioritario). Los cobros
  // vencidos van primero: es dinero que la empresa debería haber cobrado.
  const PRIORIDAD = { cobro: 1, vencimiento: 2, mantenimiento: 3, carnet: 4, descanso: 5 };

  const items = [];
  (alertas.cobros || []).forEach(a => items.push({
    tipo: 'cobro', dias: -a.dias_excedido, diasExcedido: a.dias_excedido,
    titulo: `Cobro vencido · ${esc(a.nombre)}`,
    detalle: `${fmtDinero(a.saldo_adeudado)} · plazo de pago ${a.plazo_pago_dias} días`,
    hash: 'cuentas-corrientes', accion: 'Cobrar'
  }));
  (alertas.vencimientos || []).forEach(a => items.push({
    tipo: 'vencimiento', dias: a.dias_restantes,
    titulo: `${esc(a.concepto)} · ${a.patente ? patenteHTML(a.patente) : '<span class="tenue">General de la flota</span>'}`,
    detalle: `Vencimiento documental · ${fmtFecha(a.fecha_vencimiento)}`,
    hash: 'vencimientos', accion: 'Renovar'
  }));
  (alertas.mantenimientos || []).forEach(a => items.push({
    tipo: 'mantenimiento', dias: a.dias_restantes,
    titulo: `${esc(a.concepto)} · ${a.patente ? patenteHTML(a.patente) : '<span class="tenue">General de la flota</span>'}`,
    detalle: `Mantenimiento programado · ${fmtFecha(a.fecha_vencimiento)}`,
    hash: 'mantenimientos', accion: 'Programar'
  }));
  (alertas.carnets || []).forEach(a => items.push({
    tipo: 'carnet', dias: a.dias_restantes,
    titulo: `Carnet de ${esc(a.nombre)}`,
    detalle: `Licencia de conducir · ${fmtFecha(a.vencimiento_carnet)}`,
    hash: 'choferes', accion: 'Ver chofer'
  }));
  (alertas.descansos || []).forEach(a => items.push({
    tipo: 'descanso', dias: null, diasSinDescanso: a.dias_sin_descanso,
    titulo: `Descanso de ${esc(a.nombre)}`,
    detalle: `Última jornada de descanso · ${fmtFecha(a.ultima_jornada_descanso)}`,
    hash: 'choferes', accion: 'Ver chofer'
  }));

  return items.sort((a, b) => {
    // 1) por categoría
    if (PRIORIDAD[a.tipo] !== PRIORIDAD[b.tipo]) return PRIORIDAD[a.tipo] - PRIORIDAD[b.tipo];
    // 2) dentro de la categoría, por urgencia
    if (a.tipo === 'descanso') return (b.diasSinDescanso || 0) - (a.diasSinDescanso || 0);
    if (a.tipo === 'cobro') return b.diasExcedido - a.diasExcedido; // más días excedido = más urgente
    return a.dias - b.dias; // menos días restantes (o más vencido) = más urgente
  });
}

// Renderiza una fila de alerta unificada: cuenta regresiva + texto + acción.
function filaAlertaUnificada(it) {
  const accion = `<button class="btn btn-chico" onclick="location.hash='${it.hash}'">${it.accion}</button>`;
  if (it.tipo === 'descanso') {
    return alertaHTML({ dias: null, sinDias: { valor: it.diasSinDescanso, unidad: 'sin desc.' }, urgente: true, titulo: it.titulo, detalle: it.detalle, accion });
  }
  return alertaHTML({ dias: it.dias, titulo: it.titulo, detalle: it.detalle, accion });
}

// Vista ampliada: todas las alertas ordenadas por urgencia.
async function renderAlertas() {
  contenido.innerHTML = '<div class="vacio">Cargando alertas…</div>';
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
      <div class="vista-cab">
        <div>
          <div class="migas"><button onclick="location.hash='dashboard'">Tablero</button> / Alertas</div>
          <h1>Alertas</h1>
          <p>Vencimientos y avisos ordenados por urgencia.</p>
        </div>
        <div class="acciones"><button class="btn" onclick="location.hash='dashboard'">Volver al tablero</button></div>
      </div>

      <div class="pulso">
        <div class="cifra"><span class="rotulo">Total de alertas</span><span class="cifra-valor">${total}</span></div>
        <div class="cifra"><span class="rotulo">Cobros vencidos</span><span class="cifra-valor">${tot.cobros || 0}</span></div>
        <div class="cifra"><span class="rotulo">Vencimientos</span><span class="cifra-valor">${tot.vencimientos}</span></div>
        <div class="cifra"><span class="rotulo">Mantenimientos</span><span class="cifra-valor">${tot.mantenimientos}</span></div>
        <div class="cifra"><span class="rotulo">Carnets</span><span class="cifra-valor">${tot.carnets}</span></div>
        <div class="cifra"><span class="rotulo">Descansos</span><span class="cifra-valor">${tot.descansos}</span></div>
      </div>

      ${hojaHTML(`Detalle (${ordenadas.length})`, '', total === 0
        ? '<div class="vacio">Sin alertas. Todo en orden.</div>'
        : `<ul class="alertas">${ordenadas.map(filaAlertaUnificada).join('')}</ul>`)}`;
  } catch (err) {
    contenido.innerHTML = `<div class="vacio">Error al cargar alertas: ${esc(err.message)}</div>`;
  }
}
