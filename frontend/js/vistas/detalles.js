// frontend/js/vistas/detalles.js
// Vistas de detalle de un viaje (#viaje-detalle/<id>) y de un equipo
// (#equipo-detalle/<id>), con el mismo criterio que la ficha de una unidad:
// la información ordenada en hojas y todas las acciones del registro arriba.
// Las funciones son globales a propósito: las usan los onclick="..." del HTML
// generado y los demás archivos. El orden de carga está en index.html.

const datoDetalle = (rotulo, valor) => (valor === null || valor === undefined || valor === ''
  ? '' : `<div class="ficha-dato"><span class="rotulo">${rotulo}</span><b>${valor}</b></div>`);
const enlace = (texto, hash) => `<a href="#${hash}">${texto}</a>`;

function cabeceraDetalle({ migas, titulo, sub, estado = '', acciones = [] }) {
  return `
    <div class="vista-cab">
      <div>
        <div class="migas"><button onclick="location.hash='${migas.hash}'">${migas.texto}</button> / ${titulo}</div>
        <h1 class="titulo-detalle">${titulo}${estado}</h1>
        ${sub ? `<p>${sub}</p>` : ''}
      </div>
      <div class="acciones">${acciones.map(a =>
        `<button class="btn${a.primario ? ' btn-primario' : ''}${a.peligro ? ' btn-peligro' : ''}" onclick="${a.onclick}">${a.icono ? icono(a.icono) : ''}${a.texto}</button>`).join('')}</div>
    </div>`;
}

// ============================================================
// Viaje
// ============================================================
async function renderViajeDetalle(idViaje) {
  moduloActual = 'viajes';
  registroEditando = null;
  contenido.innerHTML = '<div class="vacio">Cargando viaje…</div>';
  let viaje, unidades, choferes, cuentas, comprobantes = [];
  try {
    [viaje, unidades, choferes, cuentas] = await Promise.all([
      API.obtener('viajes', idViaje), obtenerCacheUnidades(true), API.listarTodo('choferes'), API.listarTodo('cuentas')
    ]);
    if (moduloActivo('facturacion')) {
      comprobantes = (await API.listarFacturas(1, { id_viaje: idViaje }).catch(() => ({ datos: [] }))).datos || [];
    }
  } catch (err) {
    contenido.innerHTML = `<div class="vacio">No se pudo cargar el viaje: ${esc(err.message)}</div>`;
    return;
  }
  const v = viaje;
  const camion = unidades[v.id_unidad_principal] || {};
  const acoplado = unidades[v.id_unidad_secundaria] || {};
  const chofer = choferes.find(c => c.id_chofer === v.id_chofer);
  const pagador = cuentas.find(c => c.nombre === v.pagador && (c.tipo === 'CLIENTE' || c.tipo === 'PROVEEDOR'));
  const { base, neto, conIVA } = calcularMontosViaje(v);
  const unidadCantidad = v.tipo_tarifa === 'POR KM' ? 'km' : v.tipo_tarifa === 'POR TONELADA' ? 'tn' : '';
  const finalizado = v.estado === 'FINALIZADO';
  const comprobanteVigente = comprobantes.find(f => f.estado !== 'ANULADA');

  const acciones = [{ texto: 'Editar', primario: true, onclick: `abrirModal('viajes', ${v.id_viaje})` }];
  // Finalizado: "Facturar" abre la elección de siempre (factura electrónica,
  // líquido producto o sin facturar). Antes de finalizar: avanzar el estado.
  if (finalizado && !comprobanteVigente) acciones.push({ texto: 'Facturar', onclick: `avanzarEstadoViaje(${v.id_viaje})` });
  else if (v.estado !== 'FACTURADO' && !finalizado) acciones.push({ texto: 'Avanzar estado', onclick: `avanzarEstadoViaje(${v.id_viaje})` });
  if (v.estado !== 'FACTURADO') acciones.push({ texto: 'Eliminar', peligro: true, onclick: `eliminarRegistro('viajes', ${v.id_viaje})` });

  const recorrido = `<div class="hoja-cuerpo"><div class="ficha-datos ficha-detalle">
    ${datoDetalle('Origen', esc(v.origen))}
    ${datoDetalle('Destino', esc(v.destino))}
    ${datoDetalle('Salida', fmtFechaHora(v.fecha_origen))}
    ${datoDetalle('Llegada', v.fecha_llegada ? fmtFechaHora(v.fecha_llegada) : '<span class="tenue">Sin cargar</span>')}
    ${datoDetalle('Carga', esc(v.tipo_carga))}
    ${datoDetalle('Remito', `<span class="mono">${esc(v.numero_remito || '')}</span>`)}
  </div></div>`;

  const equipo = `<div class="hoja-cuerpo"><div class="ficha-datos ficha-detalle">
    ${datoDetalle('Camión', camion.patente ? `<span class="con-patente"><a href="#unidad-detalle/${v.id_unidad_principal}">${patenteHTML(camion.patente)}</a><span>${esc(camion.modelo || '')}</span></span>` : '')}
    ${datoDetalle('Acoplado', acoplado.patente ? `<span class="con-patente"><a href="#unidad-detalle/${v.id_unidad_secundaria}">${patenteHTML(acoplado.patente)}</a><span>${esc(acoplado.modelo || '')}</span></span>` : '')}
    ${datoDetalle('Chofer', chofer ? enlace(esc(chofer.nombre), `chofer-detalle/${chofer.id_chofer}`) : '')}
    ${datoDetalle('Equipo', v.id_equipo ? enlace(`Equipo #${v.id_equipo}`, `equipo-detalle/${v.id_equipo}`) : '')}
  </div><p class="tenue nota-detalle">El camión, el acoplado y el chofer son los que hicieron este viaje, aunque el equipo haya cambiado después.</p></div>`;

  const tarifa = `<div class="hoja-cuerpo"><div class="ficha-datos ficha-detalle">
    ${datoDetalle('Pagador', pagador ? enlace(esc(v.pagador), `cuenta-corriente/${pagador.id_cuenta}`) : esc(v.pagador || ''))}
    ${datoDetalle('Tarifa', `${fmtDinero(v.tarifa)} <span class="tenue">${esc(String(v.tipo_tarifa || '').toLowerCase())}</span>`)}
    ${datoDetalle('Cantidad cargada', v.cantidad_cargada != null ? `${fmtNum(v.cantidad_cargada)} ${unidadCantidad}` : '')}
    ${datoDetalle('Resultado', v.resultado != null ? `${fmtNum(v.resultado)} ${unidadCantidad}` : '<span class="tenue">Sin cargar</span>')}
    ${datoDetalle('Comisión', Number(v.comision) ? `${fmtNum(v.comision)} %` : '')}
    ${datoDetalle('Neto del viaje', fmtDinero(neto) + (Number(v.comision) ? ` <span class="tenue">de ${fmtDinero(base)}</span>` : ''))}
    ${empresaDiscriminaIva() ? datoDetalle('Con IVA', fmtDinero(conIVA)) : ''}
    ${datoDetalle('Facturación', v.estado === 'FACTURADO' ? valorViajeFacturado(v) : '<span class="tenue">Todavía no facturado</span>')}
  </div></div>`;

  const htmlComprobantes = comprobantes.length === 0 ? '' : hojaHTML('Comprobantes', 'Facturas y notas de crédito que incluyen este viaje',
    tablaSimple(['Comprobante', 'Fecha', 'Total', 'Estado'], comprobantes.map(f => [
      `<td class="fuerte">${nombreComprobante(f)} <span class="mono">${numeroComprobante(f)}</span></td>`,
      fmtFecha(f.fecha_emision), `<td class="num">${fmtImporte(f.total)}</td>`, insigniaFactura(f)
    ]), { clic: i => `location.hash='facturador/${comprobantes[i].id_factura}'` }));

  contenido.innerHTML = cabeceraDetalle({
    migas: { texto: 'Viajes', hash: 'viajes' },
    titulo: `Viaje #${v.id_viaje}`,
    sub: `${esc(v.origen)} a ${esc(v.destino)}`,
    estado: insigniaEstado(v.estado),
    acciones
  }) + `
    <div class="grilla-2-iguales">
      ${hojaHTML('Recorrido', '', recorrido)}
      ${hojaHTML('Equipo del viaje', '', equipo)}
    </div>
    ${hojaHTML('Tarifa y facturación', '', tarifa)}
    ${htmlComprobantes}`;
}

// ============================================================
// Equipo
// ============================================================
async function renderEquipoDetalle(idEquipo) {
  moduloActual = 'equipos';
  registroEditando = null;
  contenido.innerHTML = '<div class="vacio">Cargando equipo…</div>';
  let equipo, unidades, choferes, periodos, viajes;
  try {
    [equipo, unidades, choferes, periodos, viajes] = await Promise.all([
      API.obtener('equipos', idEquipo), obtenerCacheUnidades(true), API.listarTodo('choferes'),
      API.historialEquipo(idEquipo), API.listar('viajes', '', idEquipo, '', {}, 1)
    ]);
  } catch (err) {
    contenido.innerHTML = `<div class="vacio">No se pudo cargar el equipo: ${esc(err.message)}</div>`;
    return;
  }
  const e = equipo;
  const camion = unidades[e.id_unidad_principal] || {};
  const acoplado = unidades[e.id_unidad_secundaria] || {};
  const chofer = choferes.find(c => c.id_chofer === e.id_chofer);
  const activo = e.activo !== 0;
  const ultimos = (viajes.datos || []).slice(0, 8);

  const acciones = [
    { texto: 'Editar', primario: true, onclick: `abrirModal('equipos', ${e.id_equipo})` },
    { texto: 'Copiar datos', icono: 'copiar', onclick: `copiarEquipo(${e.id_equipo})` },
    activo
      ? { texto: 'Dar de baja', onclick: `darDeBajaEquipo(${e.id_equipo})` }
      : { texto: 'Reactivar', onclick: `reactivarEquipo(${e.id_equipo})` },
    { texto: 'Eliminar', peligro: true, onclick: `eliminarRegistro('equipos', ${e.id_equipo})` }
  ];

  const pieza = (idUnidad, u, silueta) => `
    <div class="comp-pieza" role="link" tabindex="0" onclick="location.hash='unidad-detalle/${idUnidad}'" onkeydown="if (event.key === 'Enter') location.hash='unidad-detalle/${idUnidad}'">
      ${silueta}${patenteHTML(u.patente || '?', '')}<span class="comp-modelo">${esc(u.modelo || '')}</span>
    </div>`;
  const composicion = `<div class="hoja-cuerpo">
    <div class="composicion">
      ${pieza(e.id_unidad_principal, camion, siluetaTractor())}
      <div class="comp-enganche"></div>
      ${pieza(e.id_unidad_secundaria, acoplado, siluetaAcoplado())}
      <div class="comp-chofer"><span class="rotulo">Chofer</span><b>${chofer ? enlace(esc(chofer.nombre), `chofer-detalle/${chofer.id_chofer}`) : ''}</b></div>
    </div>
    <div class="ficha-datos ficha-detalle" style="margin-top:var(--space-5)">
      ${datoDetalle('Peso de tara', e.peso_tara != null ? `${fmtNum(e.peso_tara, 0)} kg` : '')}
      ${datoDetalle('Peso bruto', e.peso_bruto != null ? `${fmtNum(e.peso_bruto, 0)} kg` : '')}
      ${datoDetalle('Capacidad de carga', e.peso_tara != null && e.peso_bruto != null ? `${fmtNum(Number(e.peso_bruto) - Number(e.peso_tara), 0)} kg` : '')}
      ${datoDetalle('Estado', activo ? insignia('Activo', 'ok') : `${insignia('Baja', 'aviso')} <span class="tenue">desde el ${fmtFechaHora(e.fecha_baja)}</span>`)}
    </div>
  </div>`;

  const htmlViajes = ultimos.length === 0 ? '<div class="vacio">Este equipo todavía no tiene viajes.</div>'
    : tablaSimple(['Viaje', 'Fecha', 'Recorrido', 'Estado'], ultimos.map(v => [
      `<td class="mono">#${v.id_viaje}</td>`, fmtFecha(v.fecha_origen), `${esc(v.origen)} a ${esc(v.destino)}`, insigniaEstado(v.estado)
    ]), { clic: i => `location.hash='viaje-detalle/${ultimos[i].id_viaje}'` });

  contenido.innerHTML = cabeceraDetalle({
    migas: { texto: 'Equipos', hash: 'equipos' },
    titulo: `Equipo #${e.id_equipo}`,
    sub: `${esc(camion.patente || '?')} y ${esc(acoplado.patente || '?')}${chofer ? `, con ${esc(chofer.nombre)}` : ''}`,
    estado: activo ? '' : insignia('Baja', 'aviso'),
    acciones
  }) + `
    ${hojaHTML('Composición actual', 'Tocá una unidad para ver su ficha', composicion)}
    ${hojaHTML('Historial de composición', 'Cada fila es un período con el mismo camión, acoplado y chofer. Si un cambio se cargó tarde, corregí la fecha en que empezó: los viajes y las liquidaciones de esas fechas se recalculan solos.',
      historialEquipoHTML(periodos))}
    ${hojaHTML('Últimos viajes', '', htmlViajes,
      ultimos.length ? `<button class="btn btn-chico" onclick="verViajesDeEquipo(${e.id_equipo})">Ver todos</button>` : '')}`;
}

// Abre la lista de viajes filtrada por un equipo.
function verViajesDeEquipo(idEquipo) {
  _filtroEquipoInicial = String(idEquipo);
  location.hash = 'viajes';
}
