// frontend/js/vistas/facturacion.js
// Vista Facturación: listado, facturar viaje, factura manual y nota de crédito.
// Las funciones son globales a propósito: las usan los onclick="..." del HTML
// generado y los demás archivos. El orden de carga está en index.html.

// ============================================================
// Facturación: listado, facturar viaje, factura manual, PDF
// ============================================================
async function renderFacturacion() {
  contenido.innerHTML = `
    <div class="vista-cabecera">
      <div>
        <div class="vista-titulo">Facturación</div>
        <div class="vista-sub">Comprobantes tipo Factura A</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-secundario" onclick="abrirFacturarViaje()">Facturar un viaje</button>
        <button class="btn btn-primario" onclick="abrirFacturaManual()">Factura manual</button>
      </div>
    </div>
    <div class="tabla-contenedor" id="fac-tabla"><div class="estado-vacio">Cargando…</div></div>`;
  cargarFacturas();
}

async function cargarFacturas(pagina = 1) {
  try {
    const { datos, paginacion } = await API.listarFacturas(pagina);
    if (!datos.length) {
      $('#fac-tabla').innerHTML = '<div class="estado-vacio">Todavía no se emitieron facturas. Usá los botones de arriba para crear la primera.</div>';
      return;
    }
    $('#fac-tabla').innerHTML = `
      <table>
        <thead><tr>
          <th>Comprobante</th><th>Fecha</th><th>Receptor</th><th>CUIT</th>
          <th>Neto</th><th>IVA</th><th>Total</th><th>Estado</th><th>Acciones</th>
        </tr></thead>
        <tbody>
          ${datos.map(f => {
            const esNC = f.clase === 'NOTA_CREDITO';
            const tipo = esNC ? 'NC A' : 'Factura A';
            const nro = `${String(f.punto_venta).padStart(4,'0')}-${String(f.numero).padStart(8,'0')}`;
            const estado = f.estado === 'EMITIDA'
              ? '<span class="insignia verde">Emitida</span>'
              : f.estado === 'ANULADA' ? '<span class="insignia gris">Anulada</span>'
              : '<span class="insignia ambar" title="Pendiente de CAE de ARCA">Borrador</span>';
            // El botón de nota de crédito solo aplica a facturas no anuladas
            const btnNC = (!esNC && f.estado !== 'ANULADA')
              ? `<button class="btn btn-secundario btn-mini" onclick="emitirNotaCredito(${f.id_factura}, '${nro}')">Nota de crédito</button>`
              : '';
            return `<tr>
              <td><strong>${esNC ? '<span class="insignia ambar">NC</span> ' : ''}${tipo}</strong> ${nro}${f.id_viaje ? ` <span class="insignia" title="Generada desde un viaje">viaje #${f.id_viaje}</span>` : ''}</td>
              <td>${fmtFecha(f.fecha_emision)}</td>
              <td>${esc(f.receptor_nombre)}</td>
              <td>${esc(f.receptor_cuit)}</td>
              <td class="celda-num">${fmtDinero(f.neto_gravado)}</td>
              <td class="celda-num">${fmtDinero(f.iva)}</td>
              <td class="celda-num" style="font-weight:600">${fmtDinero(f.total)}</td>
              <td>${estado}</td>
              <td style="white-space:nowrap">
                <button class="btn btn-primario btn-mini" onclick="descargarPdfFactura(${f.id_factura})">PDF</button>
                ${btnNC}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      ${controlesPaginacion(paginacion, p => cargarFacturas(p))}`;
  } catch (err) {
    $('#fac-tabla').innerHTML = `<div class="estado-vacio">Error: ${esc(err.message)}</div>`;
  }
}

// Emite una nota de crédito que anula una factura existente
async function emitirNotaCredito(idFactura, nro) {
  if (!confirm(`¿Emitir una nota de crédito que anule la Factura A ${nro}?\n\nSe generará una Nota de Crédito A por el total de la factura y la factura quedará anulada. Esta acción no se puede deshacer.`)) return;
  try {
    const { id_factura } = await API.notaCredito(idFactura);
    mostrarToast('Nota de crédito emitida.');
    descargarPdfFactura(id_factura);
    renderFacturacion();
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

async function abrirFacturarViaje() {
  try {
    const viajes = await API.viajesFacturables();
    $('#modal-titulo').textContent = 'Facturar un viaje';
    if (!viajes.length) {
      $('#modal-cuerpo').innerHTML = '<div class="estado-vacio">No hay viajes pendientes de facturar. Un viaje es facturable si está finalizado y su pagador está registrado como cuenta de cliente con CUIT.</div>';
      configurarGuardado(async () => true);
      abrirModalGenerico();
      return;
    }
    $('#modal-cuerpo').innerHTML = `
      <div class="fac-intro">
        <span class="fac-intro-icono">A</span>
        <span>Elegí el viaje a facturar. Se emite una <strong>Factura A</strong> al CUIT del pagador por el neto del flete (sin comisión) más IVA 21%.</span>
      </div>
      <div class="fac-lista">
        ${viajes.map(v => `
          <label class="fac-opcion">
            <input type="radio" name="viaje-fac" value="${v.id_viaje}" onchange="_facMarcar(this)">
            <div class="fac-op-info">
              <div class="fac-op-ruta">${esc(v.origen)} → ${esc(v.destino)}</div>
              <div class="fac-op-meta">${fmtFecha(v.fecha_origen)} · ${esc(v.pagador)} · CUIT ${esc(v.pagador_cuit)}${v.numero_remito ? ' · Remito ' + esc(v.numero_remito) : ''}</div>
            </div>
            <div class="fac-op-monto">${fmtDinero(v.neto)}<small>neto</small></div>
          </label>`).join('')}
      </div>
      <div id="fac-error" class="login-error" hidden></div>`;
    configurarGuardado(async () => {
      const sel = document.querySelector('input[name="viaje-fac"]:checked');
      if (!sel) { _facError('Seleccioná un viaje.'); return false; }
      try {
        const { id_factura } = await API.facturarViaje(sel.value);
        mostrarToast('Factura generada.');
        descargarPdfFactura(id_factura);
        renderFacturacion();
        return true;
      } catch (err) { _facError(err.message); return false; }
    });
    abrirModalGenerico();
  } catch (err) {
    mostrarToast('No se pudieron cargar los viajes: ' + err.message, true);
  }
}

async function abrirFacturaManual() {
  try {
    const cuentas = await API.listarTodo('cuentas');
    const conCuit = cuentas.filter(c => c.cuil);
    $('#modal-titulo').textContent = 'Factura manual';
    $('#modal-cuerpo').innerHTML = `
      <div class="fac-intro">
        <span class="fac-intro-icono">A</span>
        <span>Emití una <strong>Factura A</strong> a una cuenta del sistema. Cargá los ítems con su precio sin IVA; el total se calcula solo.</span>
      </div>
      <div class="campo ancho-completo">
        <label>Cuenta (receptor)</label>
        <select id="fm-cuenta">
          <option value="">— Seleccionar cuenta —</option>
          ${conCuit.map(c => `<option value="${c.id_cuenta}">${esc(c.nombre)} — ${esc(c.cuil)} (${esc(c.tipo)})</option>`).join('')}
        </select>
      </div>
      <div class="fac-items">
        <div class="fac-items-cabecera">
          <span>Descripción</span><span>Cant.</span><span>Unidad</span><span>P. unitario</span><span></span>
        </div>
        <div id="fm-items"></div>
        <button type="button" class="btn btn-secundario btn-mini fac-agregar" onclick="_fmAgregarItem()">+ Agregar ítem</button>
      </div>
      <div class="campo ancho-completo"><label>Observaciones (opcional)</label><input id="fm-obs" placeholder="Notas adicionales para el comprobante"></div>
      <div class="fac-totales" id="fm-total"></div>
      <div id="fac-error" class="login-error" hidden></div>`;
    _fmAgregarItem();
    configurarGuardado(async () => {
      const id_cuenta = $('#fm-cuenta').value;
      if (!id_cuenta) { _facError('Seleccioná una cuenta.'); return false; }
      const items = _fmRecogerItems();
      if (!items.length) { _facError('Agregá al menos un ítem con importe.'); return false; }
      try {
        const { id_factura } = await API.facturarManual({ id_cuenta, items, observaciones: $('#fm-obs').value });
        mostrarToast('Factura generada.');
        descargarPdfFactura(id_factura);
        renderFacturacion();
        return true;
      } catch (err) { _facError(err.message); return false; }
    });
    abrirModalGenerico();
  } catch (err) {
    mostrarToast('No se pudieron cargar las cuentas: ' + err.message, true);
  }
}

function _fmAgregarItem() {
  const cont = $('#fm-items');
  const fila = document.createElement('div');
  fila.className = 'fac-item-fila';
  const unidades = ['unidades', 'horas', 'kilómetros', 'toneladas', 'kilogramos', 'litros', 'días', 'viajes', 'metros cúbicos', 'global'];
  fila.innerHTML = `
    <input class="fm-desc" placeholder="Descripción del ítem">
    <input class="fm-cant" type="number" min="0" step="0.01" value="1">
    <select class="fm-unidad">
      ${unidades.map(u => `<option value="${u}">${u}</option>`).join('')}
    </select>
    <input class="fm-precio" type="number" min="0" step="0.01" placeholder="0,00">
    <button type="button" class="btn btn-peligro fac-item-quitar" title="Quitar ítem">×</button>`;
  fila.querySelector('button').onclick = () => { fila.remove(); _fmActualizarTotal(); };
  fila.querySelectorAll('input, select').forEach(i => i.addEventListener('input', _fmActualizarTotal));
  cont.appendChild(fila);
  _fmActualizarTotal();
}

function _fmRecogerItems() {
  return Array.from(document.querySelectorAll('#fm-items > div')).map(f => ({
    descripcion: f.querySelector('.fm-desc').value.trim(),
    cantidad: parseFloat(f.querySelector('.fm-cant').value) || 0,
    unidad: f.querySelector('.fm-unidad').value,
    precio_unitario: parseFloat(f.querySelector('.fm-precio').value) || 0
  })).filter(it => it.descripcion && it.precio_unitario > 0 && it.cantidad > 0);
}

function _fmActualizarTotal() {
  const items = _fmRecogerItems();
  const neto = items.reduce((s, it) => s + it.cantidad * it.precio_unitario, 0);
  const iva = neto * 0.21;
  const el = $('#fm-total');
  if (el) el.innerHTML = `
    <div class="fac-total-item"><div class="et">Neto gravado</div><div class="va">${fmtDinero(neto)}</div></div>
    <div class="fac-total-item"><div class="et">IVA 21%</div><div class="va">${fmtDinero(iva)}</div></div>
    <div class="fac-total-item destacado"><div class="et">Total</div><div class="va">${fmtDinero(neto + iva)}</div></div>`;
}

// Resalta visualmente la tarjeta de viaje elegida
function _facMarcar(input) {
  document.querySelectorAll('.fac-opcion').forEach(o => o.classList.remove('elegida'));
  if (input.checked) input.closest('.fac-opcion').classList.add('elegida');
}

function _facError(msg) {
  const box = $('#fac-error');
  if (box) { box.textContent = msg; box.hidden = false; }
}

// Descarga el PDF de un comprobante (token por cabecera, no en la URL).
async function descargarPdfFactura(idFactura) {
  try { await API.descargarPdfFactura(idFactura); }
  catch (err) { mostrarToast(err.message, true); }
}
