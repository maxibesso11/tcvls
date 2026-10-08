// frontend/js/vistas/facturacion.js
// Facturación electrónica: listado de comprobantes y facturador.
//   #facturacion        listado (borradores, pendientes, emitidos, anulados)
//   #facturador         comprobante nuevo (opcional: _facturadorInicial con
//                       { id_cuenta, viajes } para abrirlo desde un viaje)
//   #facturador/<id>    borrador para editar, o comprobante emitido (lectura)
// El facturador se autocompleta con los viajes del cliente (un renglón por
// viaje, según las plantillas del cliente) y todo queda editable antes de
// emitir. La letra (A, B o C) no se elige: sale de la condición frente al IVA
// de la empresa y del cliente. El número y el CAE los da ARCA al emitir.
// Las funciones son globales a propósito: las usan los onclick="..." del HTML
// generado y los demás archivos. El orden de carga está en index.html.

const FAC_CONDICIONES = ['RESPONSABLE INSCRIPTO', 'MONOTRIBUTO', 'EXENTO', 'CONSUMIDOR FINAL'];
const FAC_TITULO = { FACTURA: 'Factura', NOTA_CREDITO: 'Nota de crédito' };
const FAC_MARCADORES_ITEM = '{origen} {destino} {carga} {remito} {fecha} {fecha_llegada} {resultado} {unidad} {tarifa} {patente} {acoplado} {chofer} {viaje}';
const FAC_MARCADORES_OBS = '{remitos} {cargas} {rutas} {viajes} {km_total} {toneladas_total} {periodo}';
let _facturadorInicial = null;
// En los comprobantes los centavos importan: siempre con dos decimales.
const fmtImporte = n => '$ ' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let _facConfig = null;

const numeroComprobante = f => (f.numero ? `${String(f.punto_venta).padStart(5, '0')}-${String(f.numero).padStart(8, '0')}` : 'sin número');
const nombreComprobante = f => `${FAC_TITULO[f.clase] || 'Comprobante'} ${f.tipo_comprobante}`;

function insigniaFactura(f) {
  if (f.estado === 'EMITIDA') return insignia('Emitida', 'ok');
  if (f.estado === 'ANULADA') return insignia('Anulada', 'peligro');
  if (f.estado === 'PENDIENTE') return `<span class="insignia aviso" title="Esperando la confirmación de ARCA">PENDIENTE</span>`;
  return insignia('Borrador', '');
}

// Letra que corresponde (misma regla que el servidor, para mostrarla al cargar).
function letraFactura(condicionEmisor, condicionReceptor) {
  if (condicionEmisor === 'MONOTRIBUTO' || condicionEmisor === 'EXENTO') return 'C';
  if (condicionEmisor !== 'RESPONSABLE INSCRIPTO' || !condicionReceptor) return null;
  return (condicionReceptor === 'RESPONSABLE INSCRIPTO' || condicionReceptor === 'MONOTRIBUTO') ? 'A' : 'B';
}

async function configFacturacion(forzar = false) {
  if (!_facConfig || forzar) _facConfig = await API.configuracionFacturacion();
  return _facConfig;
}

function avisoConfiguracionHTML(c) {
  const entorno = c.entorno === 'PRODUCCION' ? '' :
    `<p class="tenue"><strong>Modo de prueba (homologación de ARCA):</strong> los comprobantes no tienen validez fiscal.</p>`;
  if (c.lista) return entorno;
  return `<div class="hoja-cuerpo"><p><strong>Todavía no se puede emitir.</strong> Falta: ${c.faltantes.map(esc).join('; ')}.</p>
    <p class="tenue">Lo carga el administrador de la empresa en <em>Mi empresa</em> (datos fiscales y certificado de ARCA). Mientras tanto podés preparar borradores.</p>${entorno}</div>`;
}

// ============================================================
// Listado
// ============================================================
let _facFiltro = '';

async function renderFacturacion() {
  contenido.innerHTML = `
    <div class="vista-cab">
      <div>
        <h1>Facturación</h1>
        <p>Comprobantes electrónicos de ARCA, armados desde los viajes de cada cliente.</p>
      </div>
      <div class="acciones">
        <button class="btn btn-primario" onclick="nuevoComprobante()">${icono('mas')}Nuevo comprobante</button>
      </div>
    </div>
    <div id="fac-aviso"></div>
    <div class="acciones" id="fac-filtros" style="margin-bottom:12px"></div>
    <section class="hoja" id="fac-tabla"><div class="vacio">Cargando…</div></section>`;
  configFacturacion(true).then(c => {
    const aviso = avisoConfiguracionHTML(c);
    if (aviso) $('#fac-aviso').innerHTML = `<section class="hoja" style="margin-bottom:12px">${aviso.startsWith('<div') ? aviso : `<div class="hoja-cuerpo">${aviso}</div>`}</section>`;
  }).catch(() => {});
  const filtros = [['', 'Todos'], ['BORRADOR', 'Borradores'], ['PENDIENTE', 'Pendientes'], ['EMITIDA', 'Emitidos'], ['ANULADA', 'Anulados']];
  $('#fac-filtros').innerHTML = filtros.map(([v, t]) =>
    `<button class="btn btn-chico${_facFiltro === v ? ' btn-primario' : ''}" onclick="_facFiltro='${v}'; renderFacturacion()">${t}</button>`).join('');
  cargarFacturas();
}

function nuevoComprobante() {
  _facturadorInicial = null;
  location.hash = 'facturador';
}

async function cargarFacturas(pagina = 1) {
  try {
    const { datos, paginacion } = await API.listarFacturas(pagina, _facFiltro ? { estado: _facFiltro } : {});
    if (!datos.length) {
      $('#fac-tabla').innerHTML = `<div class="vacio">${_facFiltro ? 'No hay comprobantes en este estado.' : 'Todavía no hay comprobantes. Tocá "Nuevo comprobante" para armar el primero desde los viajes de un cliente.'}</div>`;
      return;
    }
    $('#fac-tabla').innerHTML = tablaSimple(
      ['Comprobante', 'Fecha', 'Cliente', 'Viajes', 'Total', 'Estado'],
      datos.map(f => [
        `<td class="fuerte">${nombreComprobante(f)} <span class="mono">${numeroComprobante(f)}</span>${f.entorno === 'HOMOLOGACION' ? ' <span class="insignia sin-punto" title="Emitido en el entorno de pruebas de ARCA">PRUEBA</span>' : ''}</td>`,
        fmtFecha(f.fecha_emision),
        `${esc(f.receptor_nombre)}<br><span class="tenue mono">${esc(f.receptor_cuit)}</span>`,
        `<td class="num">${f.cantidad_viajes || '—'}</td>`,
        `<td class="num fuerte">${fmtImporte(f.total)}</td>`,
        insigniaFactura(f)
      ]),
      { clic: i => `location.hash='facturador/${datos[i].id_factura}'` }
    ) + controlesPaginacion(paginacion, p => cargarFacturas(p));
  } catch (err) {
    $('#fac-tabla').innerHTML = `<div class="vacio">Error: ${esc(err.message)}</div>`;
  }
}

// ============================================================
// Facturador
// ============================================================
// Estado del comprobante en edición.
let F = null;

async function renderFacturador(id) {
  contenido.innerHTML = `<div class="vista-cab"><div><h1>Comprobante</h1></div></div><section class="hoja"><div class="vacio">Cargando…</div></section>`;
  let config, clientes, factura = null;
  try {
    [config, clientes] = await Promise.all([configFacturacion(true), API.cuentasFacturables()]);
    if (id) factura = await API.obtenerFactura(id);
  } catch (err) {
    contenido.innerHTML = `<div class="vacio">Error: ${esc(err.message)}</div>`;
    return;
  }
  if (factura && (factura.estado !== 'BORRADOR' || factura.clase !== 'FACTURA')) return renderComprobanteEmitido(factura, config);

  F = {
    id_factura: factura ? factura.id_factura : null,
    id_cuenta: factura ? factura.id_cuenta : null,
    cliente: null,
    viajesDisponibles: [],
    viajes: new Set(factura ? factura.viajes : []),
    items: factura ? factura.items.map(it => ({ ...it, cantidad: Number(it.cantidad), precio_unitario: Number(it.precio_unitario) })) : [],
    observaciones: factura ? (factura.observaciones || '') : '',
    obsEditada: !!(factura && factura.observaciones),
    fechas: factura ? {
      fecha_emision: hoyISO(), fecha_servicio_desde: String(factura.fecha_servicio_desde || '').slice(0, 10),
      fecha_servicio_hasta: String(factura.fecha_servicio_hasta || '').slice(0, 10), fecha_vto_pago: String(factura.fecha_vto_pago || '').slice(0, 10)
    } : { fecha_emision: hoyISO(), fecha_servicio_desde: hoyISO(), fecha_servicio_hasta: hoyISO(), fecha_vto_pago: hoyISO() },
    fechasEditadas: !!factura,
    receptor_condicion_iva: factura ? factura.receptor_condicion_iva : null,
    receptor_documento: factura ? factura.receptor_cuit : null,
    respuesta: factura ? factura.respuesta_arca : null,
    config, clientes
  };
  if (factura && factura.fecha_vto_pago && String(factura.fecha_emision).slice(0, 10) !== hoyISO()) {
    // Un borrador de otro día: la fecha de emisión pasa a hoy y el vencimiento se corre igual.
    const dias = Math.round((new Date(hoyISO()) - new Date(String(factura.fecha_emision).slice(0, 10))) / 86400000);
    F.fechas.fecha_vto_pago = sumarDiasISO(String(factura.fecha_vto_pago).slice(0, 10), dias);
  }

  contenido.innerHTML = `
    <div class="vista-cab">
      <div>
        <h1>${factura ? 'Borrador de factura' : 'Nuevo comprobante'}</h1>
        <p>Elegí el cliente y sus viajes: los renglones se completan solos y podés editarlos antes de emitir.</p>
      </div>
      <div class="acciones">
        <button class="btn" onclick="location.hash='facturacion'">Volver</button>
      </div>
    </div>
    <div id="fd-aviso">${config.lista ? '' : `<section class="hoja" style="margin-bottom:12px">${avisoConfiguracionHTML(config)}</section>`}</div>
    ${F.respuesta && (F.respuesta.errores || F.respuesta.observaciones) ? `<section class="hoja" style="margin-bottom:12px"><div class="hoja-cuerpo">
      <p><strong>ARCA no autorizó el último intento:</strong></p>
      <ul>${[...(F.respuesta.errores || []), ...(F.respuesta.observaciones || [])].map(e => `<li>[${esc(e.codigo)}] ${esc(e.mensaje)}</li>`).join('')}</ul>
      <p class="tenue">Corregí lo indicado y volvé a emitir. El comprobante no se emitió y no usó número.</p></div></section>` : ''}

    <section class="hoja" style="margin-bottom:12px">
      <header class="hoja-cabecera"><div><h2 class="hoja-titulo">Cliente</h2></div><div id="fd-letra"></div></header>
      <div class="hoja-cuerpo"><div class="formulario">
        <div class="campo ancho"><label for="fd-cliente">Cliente</label>
          <select id="fd-cliente" ${factura ? 'disabled' : ''} onchange="_fdElegirCliente(this.value)">
            <option value="">Elegí el cliente</option>
            ${clientes.map(c => `<option value="${c.id_cuenta}"${c.id_cuenta === F.id_cuenta ? ' selected' : ''}>${esc(c.nombre)} (${c.tipo === 'PROVEEDOR' ? 'proveedor, ' : ''}${esc(c.cuil)})${c.viajes_pendientes ? `, ${c.viajes_pendientes} viaje${c.viajes_pendientes === 1 ? '' : 's'} por facturar` : ''}</option>`).join('')}
          </select>
        </div>
        <div class="campo"><label for="fd-condicion">Condición frente al IVA del cliente</label>
          <select id="fd-condicion" onchange="F.receptor_condicion_iva = this.value || null; _fdLetra()">
            <option value="">Indicá la condición</option>
            ${FAC_CONDICIONES.map(c => `<option value="${c}">${c}</option>`).join('')}
          </select>
          <span class="ayuda">Define la letra del comprobante. Si el cliente no la tenía cargada, queda guardada.</span>
        </div>
        <div class="campo"><label for="fd-documento">CUIT del cliente (o DNI si es consumidor final)</label>
          <input id="fd-documento" class="mono" oninput="F.receptor_documento = this.value.trim()">
        </div>
      </div>
      <details class="plegable" id="fd-plantillas-hoja" hidden>
        <summary>Plantillas de texto de este cliente</summary>
        <p class="tenue">Cómo se arma la descripción de cada renglón y las observaciones. Quedan guardadas para las próximas facturas del cliente.</p>
        <div class="formulario">
          <div class="campo ancho"><label for="fd-pl-item">Renglón de cada viaje</label><input id="fd-pl-item" maxlength="255">
            <span class="ayuda">Marcadores: ${FAC_MARCADORES_ITEM}</span></div>
          <div class="campo ancho"><label for="fd-pl-obs">Observaciones</label><input id="fd-pl-obs" maxlength="2000">
            <span class="ayuda">Marcadores: ${FAC_MARCADORES_OBS}. Ejemplo: "CTG {remitos}, KM {km_total}, período {periodo}"</span></div>
          <div class="campo ancho"><div class="acciones">
            <button class="btn btn-chico" onclick="_fdGuardarPlantillas(true)">Guardar y aplicar a esta factura</button>
          </div></div>
        </div>
      </details>
      </div>
    </section>

    <section class="hoja" style="margin-bottom:12px" id="fd-viajes-hoja">
      <header class="hoja-cabecera"><div><h2 class="hoja-titulo">Viajes a facturar</h2><div class="hoja-sub" id="fd-viajes-resumen">Viajes finalizados del cliente que todavía no están en otro comprobante.</div></div>
        <button class="btn btn-chico" id="fd-viajes-plegar" hidden onclick="_fdPlegarViajes()">Ocultar lista</button></header>
      <div id="fd-viajes" class="fd-viajes"><div class="vacio">Elegí el cliente.</div></div>
    </section>

    <section class="hoja" style="margin-bottom:12px">
      <header class="hoja-cabecera"><div><h2 class="hoja-titulo">Renglones</h2><div class="hoja-sub" id="fd-sub-items"></div></div>
        <div class="acciones"><button class="btn btn-chico" onclick="_fdAgregarRenglon()">${icono('mas')}Agregar renglón</button></div></header>
      <div id="fd-items"></div>
      <div class="hoja-cuerpo"><div class="pulso" id="fd-totales"></div></div>
    </section>

    <section class="hoja" style="margin-bottom:12px">
      <header class="hoja-cabecera"><div><h2 class="hoja-titulo">Fechas y observaciones</h2></div></header>
      <div class="hoja-cuerpo"><div class="formulario">
        <div class="campo"><label for="fd-fecha">Fecha del comprobante</label><input type="date" id="fd-fecha" data-f="fecha_emision"></div>
        <div class="campo"><label for="fd-vto">Vencimiento del pago</label><input type="date" id="fd-vto" data-f="fecha_vto_pago"></div>
        <div class="campo"><label for="fd-desde">Período facturado desde</label><input type="date" id="fd-desde" data-f="fecha_servicio_desde"></div>
        <div class="campo"><label for="fd-hasta">Período facturado hasta</label><input type="date" id="fd-hasta" data-f="fecha_servicio_hasta"></div>
        <div class="campo ancho"><label for="fd-obs">Observaciones (salen impresas en el comprobante)</label>
          <textarea id="fd-obs" rows="3" maxlength="2000" oninput="F.observaciones = this.value; F.obsEditada = true"></textarea></div>
      </div>
      <p class="tenue">La fecha puede estar hasta 10 días antes o después de hoy. El período va del primer al último viaje.</p></div>
    </section>

    <div class="acciones" style="justify-content:flex-end;margin-bottom:24px">
      ${factura ? `<button class="btn btn-peligro" onclick="_fdEliminar()">Eliminar borrador</button>` : ''}
      <button class="btn" onclick="_fdGuardar(false)">Guardar borrador</button>
      <button class="btn btn-primario" id="fd-emitir" onclick="_fdEmitir()">Emitir comprobante</button>
    </div>`;

  document.querySelectorAll('#contenido input[data-f]').forEach(el => {
    el.value = F.fechas[el.dataset.f] || '';
    el.addEventListener('input', () => { F.fechas[el.dataset.f] = el.value; F.fechasEditadas = true; });
  });
  $('#fd-obs').value = F.observaciones;

  if (F.id_cuenta) await _fdElegirCliente(F.id_cuenta, { conservar: true });
  else if (_facturadorInicial) {
    const ini = _facturadorInicial;
    _facturadorInicial = null;
    $('#fd-cliente').value = ini.id_cuenta;
    await _fdElegirCliente(ini.id_cuenta, { viajes: ini.viajes });
  }
  _fdPintarItems();
}

const hoyISO = () => isoLocal(new Date());
function sumarDiasISO(fecha, dias) {
  const d = new Date(fecha + 'T00:00:00'); d.setDate(d.getDate() + (Number(dias) || 0));
  return isoLocal(d);
}

async function _fdElegirCliente(idCuenta, { conservar = false, viajes = [] } = {}) {
  idCuenta = Number(idCuenta) || null;
  const c = F.clientes.find(x => x.id_cuenta === idCuenta) || null;
  if (!conservar) {
    F.viajes = new Set(); F.items = []; F.obsEditada = false; F.fechasEditadas = false;
    F.receptor_condicion_iva = c ? c.condicion_iva || null : null;
    F.receptor_documento = c ? c.cuil : null;
  }
  F.id_cuenta = idCuenta;
  F.cliente = c;
  $('#fd-condicion').value = F.receptor_condicion_iva || '';
  $('#fd-documento').value = F.receptor_documento || '';
  $('#fd-plantillas-hoja').hidden = !c;
  if (c) {
    $('#fd-pl-item').value = c.plantilla_item || '';
    $('#fd-pl-item').placeholder = 'Flete de {carga} de {origen} a {destino}, remito {remito}, {fecha}';
    $('#fd-pl-obs').value = c.plantilla_observaciones || '';
  }
  _fdLetra();
  if (!c) { $('#fd-viajes').innerHTML = '<div class="vacio">Elegí el cliente.</div>'; _fdPintarItems(); return; }
  try {
    F.viajesDisponibles = await API.viajesFacturables(idCuenta, F.id_factura);
  } catch (err) {
    $('#fd-viajes').innerHTML = `<div class="vacio">Error: ${esc(err.message)}</div>`;
    return;
  }
  _fdPintarViajes();
  if (viajes.length) {
    viajes.forEach(v => F.viajes.add(Number(v)));
    _fdPintarViajes();
    await _fdRecalcular();
  }
  _fdPintarItems();
}

function _fdPlegarViajes(forzar) {
  const cont = $('#fd-viajes');
  const plegado = forzar !== undefined ? forzar : !cont.classList.contains('plegado');
  cont.classList.toggle('plegado', plegado);
  $('#fd-viajes-plegar').textContent = plegado ? 'Mostrar lista' : 'Ocultar lista';
}

function _fdResumenViajes() {
  const n = F.viajesDisponibles.length, elegidos = F.viajes.size;
  $('#fd-viajes-resumen').textContent = n
    ? `${n} viaje${n === 1 ? '' : 's'} disponible${n === 1 ? '' : 's'}, ${elegidos} elegido${elegidos === 1 ? '' : 's'}.`
    : 'Viajes finalizados del cliente que todavía no están en otro comprobante.';
  $('#fd-viajes-plegar').hidden = n === 0;
}

function _fdPintarViajes() {
  const lista = F.viajesDisponibles;
  _fdResumenViajes();
  if (!lista.length) {
    $('#fd-viajes').innerHTML = '<div class="vacio">Este cliente no tiene viajes finalizados sin facturar. Podés cargar renglones a mano.</div>';
    return;
  }
  const todos = lista.every(v => F.viajes.has(v.id_viaje));
  $('#fd-viajes').innerHTML = tablaSimple(
    [`<input type="checkbox" aria-label="Elegir todos" ${todos ? 'checked' : ''} onchange="_fdTodos(this.checked)">`, 'Fecha', 'Viaje', 'Remito', 'Carga', 'Cantidad', 'Tarifa'],
    lista.map(v => [
      `<input type="checkbox" aria-label="Facturar el viaje #${v.id_viaje}" ${F.viajes.has(v.id_viaje) ? 'checked' : ''} onchange="_fdMarcar(${v.id_viaje}, this.checked)">`,
      fmtFecha(v.fecha_origen),
      `<span class="fuerte">#${v.id_viaje}</span> ${esc(v.origen)} → ${esc(v.destino)}${v.patente_principal ? `<br><span class="tenue mono">${esc(v.patente_principal)}</span>` : ''}`,
      `<span class="mono">${esc(v.numero_remito || '—')}</span>`,
      esc(v.tipo_carga || '—'),
      `<td class="num">${v.tipo_tarifa === 'UNICA' ? '1 viaje' : `${fmtNum(v.resultado ?? v.cantidad_cargada)} ${v.tipo_tarifa === 'POR KM' ? 'km' : 'tn'}`}</td>`,
      `<td class="num">${fmtImporte(v.tarifa)}${Number(v.comision) ? `<br><span class="tenue">comisión ${fmtNum(v.comision)} %</span>` : ''}</td>`
    ])
  );
}

async function _fdMarcar(idViaje, marcado) {
  if (marcado) F.viajes.add(idViaje); else F.viajes.delete(idViaje);
  _fdResumenViajes();
  await _fdRecalcular();
}

async function _fdTodos(marcado) {
  F.viajes = new Set(marcado ? F.viajesDisponibles.map(v => v.id_viaje) : []);
  _fdPintarViajes();
  await _fdRecalcular();
}

// Pide al servidor la propuesta para los viajes elegidos y la combina con lo
// que el usuario ya editó: conserva los renglones de viajes que siguen
// elegidos y los cargados a mano; agrega los de viajes nuevos.
async function _fdRecalcular({ reemplazarTextos = false } = {}) {
  const ids = [...F.viajes];
  let p = null;
  if (ids.length) {
    try { p = await API.prepararFactura(F.id_cuenta, ids); }
    catch (err) { mostrarToast(err.message, true); return; }
  }
  const propuestos = p ? p.items : [];
  const quedan = F.items.filter(it => !it.id_viaje || F.viajes.has(Number(it.id_viaje)));
  const yaEstan = new Set(quedan.filter(it => it.id_viaje).map(it => Number(it.id_viaje)));
  if (reemplazarTextos) {
    quedan.forEach(it => {
      const nuevo = propuestos.find(x => x.id_viaje === Number(it.id_viaje));
      if (nuevo) it.descripcion = nuevo.descripcion;
    });
  }
  F.items = [...quedan, ...propuestos.filter(it => !yaEstan.has(it.id_viaje))];
  if (p && !F.fechasEditadas) {
    Object.assign(F.fechas, {
      fecha_servicio_desde: p.fecha_servicio_desde, fecha_servicio_hasta: p.fecha_servicio_hasta,
      fecha_emision: p.fecha_emision, fecha_vto_pago: p.fecha_vto_pago
    });
    document.querySelectorAll('#contenido input[data-f]').forEach(el => { el.value = F.fechas[el.dataset.f] || ''; });
  }
  if (p && (!F.obsEditada || reemplazarTextos)) {
    F.observaciones = p.observaciones || '';
    $('#fd-obs').value = F.observaciones;
    F.obsEditada = false;
  }
  _fdPintarItems();
}

function _fdLetra() {
  const letra = letraFactura(F.config.condicion_iva, F.receptor_condicion_iva);
  F.letra = letra;
  const el = $('#fd-letra');
  if (el) el.innerHTML = letra
    ? `<span class="insignia ok" style="font-size:15px">FACTURA ${letra}</span>`
    : `<span class="insignia aviso">${F.config.condicion_iva ? 'Indicá la condición del cliente' : 'Falta la condición de la empresa'}</span>`;
  _fdPintarItems();
}

function _fdPintarItems() {
  if (!F || !$('#fd-items')) return;
  const sinIva = F.letra !== 'C';
  $('#fd-sub-items').textContent = F.letra === 'C'
    ? 'Precios finales (la factura C no discrimina IVA).'
    : 'Precios SIN IVA: el 21 % se suma al total.' + (F.letra === 'B' ? ' En la factura B impresa se muestran con el IVA incluido.' : '');
  if (!F.items.length) {
    $('#fd-items').innerHTML = '<div class="vacio">Sin renglones. Elegí viajes o agregá un renglón.</div>';
  } else {
    $('#fd-items').innerHTML = `<div class="tabla-marco"><table class="tabla tabla-edicion">
      <thead><tr><th class="col-viaje">Viaje</th><th>Descripción</th><th class="num col-cant">Cantidad</th><th class="col-unidad">Unidad</th>
        <th class="num col-precio">${sinIva ? 'Precio sin IVA' : 'Precio'}</th><th class="num col-subtotal">Subtotal</th><th class="col-quitar"></th></tr></thead>
      <tbody>${F.items.map((it, i) => `<tr>
        <td class="col-viaje">${it.id_viaje ? `<span class="insignia sin-punto">#${it.id_viaje}</span>` : '<span class="tenue">Manual</span>'}</td>
        <td><input class="entrada" value="${esc(it.descripcion)}" maxlength="255" oninput="F.items[${i}].descripcion = this.value" aria-label="Descripción del renglón ${i + 1}"></td>
        <td><input class="entrada num" type="number" step="0.001" min="0" value="${it.cantidad}" oninput="F.items[${i}].cantidad = parseFloat(this.value) || 0; _fdTotales()" aria-label="Cantidad"></td>
        <td><input class="entrada" value="${esc(it.unidad || '')}" maxlength="20" oninput="F.items[${i}].unidad = this.value" aria-label="Unidad"></td>
        <td><input class="entrada num" type="number" step="0.01" min="0" value="${it.precio_unitario}" oninput="F.items[${i}].precio_unitario = parseFloat(this.value) || 0; _fdTotales()" aria-label="Precio unitario"></td>
        <td class="num fuerte" id="fd-sub-${i}"></td>
        <td class="col-quitar"><button class="btn btn-chico btn-fantasma" onclick="_fdQuitar(${i})" aria-label="Quitar renglón" title="Quitar renglón">${icono('borrar')}</button></td>
      </tr>`).join('')}</tbody></table></div>`;
  }
  _fdTotales();
}

const r2 = n => Math.round(Number(n) * 100) / 100;

function _fdTotales() {
  if (!F) return;
  F.items.forEach((it, i) => { const el = $(`#fd-sub-${i}`); if (el) el.textContent = fmtImporte(r2(it.cantidad * it.precio_unitario)); });
  const neto = r2(F.items.reduce((s, it) => s + r2(it.cantidad * it.precio_unitario), 0));
  const iva = F.letra === 'C' ? 0 : r2(neto * 0.21);
  const el = $('#fd-totales');
  if (!el) return;
  el.innerHTML = F.letra === 'C'
    ? `<div class="cifra"><span class="rotulo">Total</span><span class="cifra-valor">${fmtImporte(neto)}</span></div>`
    : `<div class="cifra"><span class="rotulo">Neto gravado</span><span class="cifra-valor">${fmtImporte(neto)}</span></div>
       <div class="cifra"><span class="rotulo">IVA 21 %</span><span class="cifra-valor">${fmtImporte(iva)}</span></div>
       <div class="cifra"><span class="rotulo">Total</span><span class="cifra-valor">${fmtImporte(r2(neto + iva))}</span></div>`;
  F.total = r2(neto + iva);
}

function _fdAgregarRenglon() {
  F.items.push({ id_viaje: null, descripcion: '', cantidad: 1, unidad: '', precio_unitario: 0 });
  _fdPintarItems();
}

function _fdQuitar(i) {
  const it = F.items[i];
  F.items.splice(i, 1);
  // Si era el renglón de un viaje y no queda otro de ese viaje, el viaje sale del comprobante.
  if (it.id_viaje && !F.items.some(x => Number(x.id_viaje) === Number(it.id_viaje))) {
    F.viajes.delete(Number(it.id_viaje));
    _fdPintarViajes();
  }
  _fdPintarItems();
}

async function _fdGuardarPlantillas(aplicar) {
  const datos = { plantilla_item: $('#fd-pl-item').value.trim(), plantilla_observaciones: $('#fd-pl-obs').value.trim() };
  try {
    await API.guardarPlantillasCliente(F.id_cuenta, datos);
    Object.assign(F.cliente, datos);
    mostrarToast('Plantillas del cliente guardadas.');
    if (aplicar && F.viajes.size) await _fdRecalcular({ reemplazarTextos: true });
  } catch (err) { mostrarToast(err.message, true); }
}

function _fdDatos() {
  return {
    id_cuenta: F.id_cuenta,
    viajes: [...F.viajes],
    items: F.items.map(it => ({ id_viaje: it.id_viaje || null, descripcion: it.descripcion, cantidad: it.cantidad, unidad: it.unidad, precio_unitario: it.precio_unitario })),
    observaciones: F.observaciones,
    receptor_condicion_iva: F.receptor_condicion_iva,
    receptor_documento: F.receptor_documento,
    ...F.fechas
  };
}

async function _fdGuardar(silencioso) {
  if (!F.id_cuenta) { mostrarToast('Elegí el cliente.', true); return null; }
  if (!F.receptor_condicion_iva) { mostrarToast('Indicá la condición frente al IVA del cliente.', true); return null; }
  try {
    const f = await API.guardarFactura(F.id_factura, _fdDatos());
    const nuevo = !F.id_factura;
    F.id_factura = f.id_factura;
    if (!silencioso) mostrarToast('Borrador guardado.');
    if (nuevo) history.replaceState(null, '', `#facturador/${f.id_factura}`);
    return f;
  } catch (err) {
    mostrarToast(err.message, true);
    return null;
  }
}

async function _fdEmitir() {
  if (!F.config.lista) { mostrarToast('Todavía no se puede emitir: ' + F.config.faltantes.join('; '), true); return; }
  const f = await _fdGuardar(true);
  if (!f) return;
  const prueba = F.config.entorno !== 'PRODUCCION';
  const ok = await confirmar(
    `Se va a pedir a ARCA el CAE de la Factura ${f.tipo_comprobante} a ${f.receptor_nombre} por ${fmtImporte(f.total)}.` +
    (prueba ? ' (Entorno de PRUEBA: sin validez fiscal.)' : ' Una vez emitida no se puede modificar: solo anular con nota de crédito.'),
    'Emitir', `¿Emitir la Factura ${f.tipo_comprobante}?`);
  if (!ok) return;
  const btn = $('#fd-emitir');
  if (btn) { btn.disabled = true; btn.textContent = 'Emitiendo con ARCA…'; }
  try {
    const emitida = await API.emitirFactura(f.id_factura);
    mostrarToast(`Factura ${emitida.tipo_comprobante} ${numeroComprobante(emitida)} emitida.`);
    history.replaceState(null, '', `#facturador/${emitida.id_factura}`);
    renderFacturador(emitida.id_factura);
  } catch (err) {
    mostrarToast(err.message, true);
    // Se vuelve a mostrar el comprobante como quedó (borrador con el motivo, o pendiente).
    history.replaceState(null, '', `#facturador/${f.id_factura}`);
    renderFacturador(f.id_factura);
  }
}

async function _fdEliminar() {
  if (!await confirmar('El borrador se elimina y sus viajes quedan libres para facturar.', 'Eliminar', '¿Eliminar el borrador?')) return;
  try {
    await API.eliminarFactura(F.id_factura);
    mostrarToast('Borrador eliminado.');
    location.hash = 'facturacion';
  } catch (err) { mostrarToast(err.message, true); }
}

// ============================================================
// Comprobante emitido, pendiente o anulado (solo lectura)
// ============================================================
function renderComprobanteEmitido(f, config) {
  const esNC = f.clase === 'NOTA_CREDITO';
  const conIvaIncluido = f.tipo_comprobante === 'B';
  const precio = it => conIvaIncluido ? Number(it.precio_unitario) * 1.21 : Number(it.precio_unitario);
  const sub = it => conIvaIncluido ? Number(it.subtotal) * 1.21 : Number(it.subtotal);
  const acciones = [];
  if (f.estado === 'EMITIDA' || f.estado === 'ANULADA') acciones.push(`<button class="btn" onclick="_facPdf(${f.id_factura}, ${jsArg(`${esNC ? 'nota_credito' : 'factura'}_${f.tipo_comprobante}_${numeroComprobante(f)}.pdf`)})">Descargar PDF</button>`);
  if (f.estado === 'PENDIENTE') acciones.push(`<button class="btn btn-primario" onclick="_facVerificar(${f.id_factura})">Verificar con ARCA</button>`);
  if (!esNC && f.estado === 'EMITIDA') acciones.push(`<button class="btn btn-peligro" onclick="_facNotaCredito(${f.id_factura}, ${jsArg(numeroComprobante(f))}, ${jsArg(f.tipo_comprobante)})">Anular con nota de crédito</button>`);

  contenido.innerHTML = `
    <div class="vista-cab">
      <div>
        <h1>${nombreComprobante(f)} <span class="mono">${numeroComprobante(f)}</span></h1>
        <p>${insigniaFactura(f)}${f.entorno === 'HOMOLOGACION' ? ' <span class="insignia sin-punto">PRUEBA SIN VALIDEZ FISCAL</span>' : ''}</p>
      </div>
      <div class="acciones"><button class="btn" onclick="location.hash='facturacion'">Volver</button>${acciones.join('')}</div>
    </div>
    ${f.estado === 'PENDIENTE' ? `<section class="hoja" style="margin-bottom:12px"><div class="hoja-cuerpo">
      <p><strong>Se cortó la comunicación con ARCA mientras se emitía.</strong> El número quedó reservado.
      Tocá "Verificar con ARCA": si ARCA lo autorizó, queda emitido; si no, vuelve a borrador para emitirlo de nuevo.
      No lo cargues otra vez.</p></div></section>` : ''}
    <section class="hoja" style="margin-bottom:12px"><div class="hoja-cuerpo">
      <div class="ficha-datos">
        <div class="ficha-dato"><span class="rotulo">Fecha</span><b>${fmtFecha(f.fecha_emision)}</b></div>
        <div class="ficha-dato"><span class="rotulo">Cliente</span><b>${esc(f.receptor_nombre)}</b></div>
        <div class="ficha-dato"><span class="rotulo">Documento</span><b class="mono">${esc(f.receptor_cuit)}</b></div>
        <div class="ficha-dato"><span class="rotulo">Condición IVA</span><b>${esc(f.receptor_condicion_iva || '—')}</b></div>
        <div class="ficha-dato"><span class="rotulo">Período</span><b>${fmtFecha(f.fecha_servicio_desde)} al ${fmtFecha(f.fecha_servicio_hasta)}</b></div>
        <div class="ficha-dato"><span class="rotulo">Vence el pago</span><b>${fmtFecha(f.fecha_vto_pago)}</b></div>
        <div class="ficha-dato"><span class="rotulo">CAE</span><b class="mono">${esc(f.cae || '—')}</b></div>
        <div class="ficha-dato"><span class="rotulo">Vto. CAE</span><b>${fmtFecha(f.cae_vencimiento)}</b></div>
        ${f.asociada ? `<div class="ficha-dato"><span class="rotulo">${esNC ? 'Anula' : 'Asociado'}</span><b><a href="#facturador/${f.asociada.id_factura}">${nombreComprobante(f.asociada)} ${numeroComprobante(f.asociada)}</a></b></div>` : ''}
        ${f.viajes.length ? `<div class="ficha-dato"><span class="rotulo">Viajes</span><b>${f.viajes.map(v => '#' + v).join(', ')}</b></div>` : ''}
      </div>
    </div></section>
    <section class="hoja" style="margin-bottom:12px">
      ${tablaSimple(['Descripción', 'Cantidad', conIvaIncluido ? 'P. unit. (IVA incl.)' : 'P. unitario', 'Subtotal'],
        f.items.map(it => [esc(it.descripcion), `<td class="num">${fmtNum(it.cantidad, 3)} ${esc(it.unidad || '')}</td>`,
          `<td class="num">${fmtImporte(precio(it))}</td>`, `<td class="num fuerte">${fmtImporte(sub(it))}</td>`]))}
      <div class="hoja-cuerpo"><div class="pulso">
        ${f.tipo_comprobante === 'A' ? `<div class="cifra"><span class="rotulo">Neto gravado</span><span class="cifra-valor">${fmtImporte(f.neto_gravado)}</span></div>
          <div class="cifra"><span class="rotulo">IVA 21 %</span><span class="cifra-valor">${fmtImporte(f.iva)}</span></div>` : ''}
        ${f.tipo_comprobante === 'B' ? `<div class="cifra"><span class="rotulo">IVA contenido</span><span class="cifra-valor">${fmtImporte(f.iva)}</span></div>` : ''}
        <div class="cifra"><span class="rotulo">Total</span><span class="cifra-valor">${fmtImporte(f.total)}</span></div>
      </div>
      ${f.observaciones ? `<p><span class="rotulo">Observaciones</span><br>${esc(f.observaciones)}</p>` : ''}</div>
    </section>`;
}

async function _facPdf(id, nombre) {
  try { await API.descargarPdfFactura(id, nombre); }
  catch (err) { mostrarToast(err.message, true); }
}

async function _facVerificar(id) {
  try {
    const f = await API.verificarFactura(id);
    if (f.estado === 'EMITIDA') mostrarToast('ARCA confirmó el comprobante: quedó emitido.');
    else if (f.estado === 'BORRADOR') mostrarToast('ARCA no lo registró: volvió a borrador, podés emitirlo de nuevo.');
    else mostrarToast('ARCA todavía no lo tiene registrado. Probá de nuevo en unos minutos.', true);
    renderFacturador(id);
  } catch (err) { mostrarToast(err.message, true); }
}

async function _facNotaCredito(id, nro, letra) {
  if (!await confirmar(`Se emite una Nota de crédito ${letra} por el total: la factura queda anulada, la cuenta del cliente se compensa y sus viajes vuelven a estar disponibles para facturar. No se puede deshacer.`,
    'Emitir nota de crédito', `¿Anular la Factura ${letra} ${nro}?`)) return;
  try {
    const nc = await API.notaCredito(id);
    mostrarToast(`Nota de crédito ${nc.tipo_comprobante} ${numeroComprobante(nc)} emitida.`);
    location.hash = `facturador/${nc.id_factura}`;
  } catch (err) {
    mostrarToast(err.message, true);
    renderFacturador(id);
  }
}

// Abre el facturador con un viaje ya elegido (desde la vista Viajes).
async function facturarViajeConComprobante(idViaje, pagador) {
  try {
    const cuentas = await API.cuentasFacturables();
    const c = cuentas.find(x => x.nombre === pagador);
    if (!c) { mostrarToast(`El pagador "${pagador}" no tiene cuenta: cargalo en Cuentas.`, true); return; }
    _facturadorInicial = { id_cuenta: c.id_cuenta, viajes: [idViaje] };
    location.hash = 'facturador';
  } catch (err) { mostrarToast(err.message, true); }
}
