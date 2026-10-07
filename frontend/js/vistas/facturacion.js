// frontend/js/vistas/facturacion.js
// Vista Facturación: listado, facturar viaje, factura manual y nota de crédito.
// Las funciones son globales a propósito: las usan los onclick="..." del HTML
// generado y los demás archivos. El orden de carga está en index.html.

// ============================================================
// Facturación: listado, facturar viaje, factura manual, PDF
// ============================================================
async function renderFacturacion() {
  contenido.innerHTML = `
    <div class="vista-cab">
      <div>
        <h1>Facturación</h1>
        <p>Comprobantes tipo Factura A.</p>
      </div>
      <div class="acciones">
        <button class="btn" onclick="abrirFacturarViaje()">Facturar viaje</button>
        <button class="btn btn-primario" onclick="abrirFacturaManual()">Emitir factura manual</button>
      </div>
    </div>
    <section class="hoja" id="fac-tabla"><div class="vacio">Cargando…</div></section>`;
  cargarFacturas();
}

let _facturas = [];
const numeroComprobante = f => `${String(f.punto_venta).padStart(4, '0')}-${String(f.numero).padStart(8, '0')}`;

// La fila abre el comprobante: ahí viven descargar el PDF y la nota de crédito.
function abrirComprobante(i) {
  const f = _facturas[i];
  const esNC = f.clase === 'NOTA_CREDITO';
  const nro = numeroComprobante(f);
  $('#modal-titulo').textContent = `${esNC ? 'Nota de crédito A' : 'Factura A'} ${nro}`;
  $('#modal-cuerpo').innerHTML = `
    <div class="ficha-datos">
      <div class="ficha-dato"><span class="rotulo">Fecha</span><b>${fmtFecha(f.fecha_emision)}</b></div>
      <div class="ficha-dato"><span class="rotulo">Receptor</span><b>${esc(f.receptor_nombre)}</b></div>
      <div class="ficha-dato"><span class="rotulo">CUIT</span><b class="mono">${esc(f.receptor_cuit)}</b></div>
      <div class="ficha-dato"><span class="rotulo">Total</span><b>${fmtDinero(f.total)}</b></div>
    </div>
    <div class="formulario">${bloqueAcciones([
      { texto: 'Descargar PDF', onclick: `descargarPdfFactura(${f.id_factura})` },
      // La nota de crédito solo aplica a facturas no anuladas
      ...((!esNC && f.estado !== 'ANULADA') ? [{ texto: 'Emitir nota de crédito', peligro: true, onclick: `emitirNotaCredito(${f.id_factura}, '${nro}')` }] : [])
    ])}</div>`;
  $('#btn-guardar').hidden = true;
  abrirModalGenerico();
}

async function cargarFacturas(pagina = 1) {
  try {
    const { datos, paginacion } = await API.listarFacturas(pagina);
    if (!datos.length) {
      $('#fac-tabla').innerHTML = '<div class="vacio">Todavía no se emitieron facturas. Usá los botones de arriba para crear la primera.</div>';
      return;
    }
    _facturas = datos;
    $('#fac-tabla').innerHTML = `
      <div class="tabla-marco"><table class="tabla">
        <thead><tr>
          <th>Comprobante</th><th>Fecha</th><th>Receptor</th><th>CUIT</th>
          <th class="num">Neto</th><th class="num">IVA</th><th class="num">Total</th><th>Estado</th>
        </tr></thead>
        <tbody>
          ${datos.map((f, i) => {
            const esNC = f.clase === 'NOTA_CREDITO';
            const tipo = esNC ? 'NC A' : 'Factura A';
            const nro = numeroComprobante(f);
            const estado = f.estado === 'EMITIDA'
              ? insignia('Emitida', 'ok')
              : f.estado === 'ANULADA' ? insignia('Anulada', 'peligro')
              : '<span class="insignia aviso" title="Pendiente de CAE de ARCA">BORRADOR</span>';
            return `<tr class="clic" tabindex="0" onclick="abrirComprobante(${i})" onkeydown="if (event.key === 'Enter') abrirComprobante(${i})">
              <td class="fuerte">${esNC ? '<span class="insignia aviso">NC</span> ' : ''}${tipo} <span class="mono">${nro}</span>${f.id_viaje ? ` <span class="insignia sin-punto" title="Generada desde un viaje">VIAJE #${f.id_viaje}</span>` : ''}</td>
              <td>${fmtFecha(f.fecha_emision)}</td>
              <td>${esc(f.receptor_nombre)}</td>
              <td class="mono">${esc(f.receptor_cuit)}</td>
              <td class="num">${fmtDinero(f.neto_gravado)}</td>
              <td class="num">${fmtDinero(f.iva)}</td>
              <td class="num fuerte">${fmtDinero(f.total)}</td>
              <td>${estado}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>
      ${controlesPaginacion(paginacion, p => cargarFacturas(p))}`;
  } catch (err) {
    $('#fac-tabla').innerHTML = `<div class="vacio">Error: ${esc(err.message)}</div>`;
  }
}

// Emite una nota de crédito que anula una factura existente
async function emitirNotaCredito(idFactura, nro) {
  if (!await confirmar('Se generará una Nota de Crédito A por el total de la factura y la factura quedará anulada. Esta acción no se puede deshacer.', 'Emitir nota de crédito', `¿Anular la Factura A ${nro}?`)) return;
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
      $('#modal-cuerpo').innerHTML = '<div class="vacio">No hay viajes pendientes de facturar. Un viaje es facturable si está finalizado y su pagador está registrado como cuenta de cliente con CUIT.</div>';
      configurarGuardado(async () => true);
      abrirModalGenerico();
      return;
    }
    $('#modal-cuerpo').innerHTML = `
      <p>Elegí el viaje a facturar. Se emite una <strong>Factura A</strong> al CUIT del pagador por el neto del flete (sin comisión) más IVA 21 %.</p>
      <div class="tabla-marco"><table class="tabla">
        <thead><tr><th></th><th>Fecha</th><th>Viaje</th><th>Pagador</th><th class="num">Neto</th></tr></thead>
        <tbody>
          ${viajes.map(v => `
            <tr>
              <td><input type="radio" name="viaje-fac" value="${v.id_viaje}" onchange="_facMarcar(this)" aria-label="Facturar el viaje a ${esc(v.destino)}"></td>
              <td>${fmtFecha(v.fecha_origen)}</td>
              <td class="fuerte">${esc(v.origen)} → ${esc(v.destino)}${v.numero_remito ? `<br><span class="tenue">Remito <span class="mono">${esc(v.numero_remito)}</span></span>` : ''}</td>
              <td>${esc(v.pagador)}<br><span class="tenue">CUIT <span class="mono">${esc(v.pagador_cuit)}</span></span></td>
              <td class="num">${fmtDinero(v.neto)}</td>
            </tr>`).join('')}
        </tbody>
      </table></div>
      <p class="campo error"><span class="ayuda" id="fac-error" hidden></span></p>`;
    configurarGuardado(async () => {
      const sel = document.querySelector('input[name="viaje-fac"]:checked');
      if (!sel) { _facError('Elegí un viaje.'); return false; }
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
      <p>Emití una <strong>Factura A</strong> a una cuenta del sistema. Cargá los ítems con su precio sin IVA; el total se calcula solo.</p>
      <div class="formulario">
        <div class="campo ancho">
          <label for="fm-cuenta">Cuenta (receptor)</label>
          <select id="fm-cuenta">
            <option value="">— Seleccionar cuenta —</option>
            ${conCuit.map(c => `<option value="${c.id_cuenta}">${esc(c.nombre)} — ${esc(c.cuil)} (${esc(c.tipo)})</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="tabla-marco"><table class="tabla">
        <thead><tr><th>Descripción</th><th class="num">Cant.</th><th>Unidad</th><th class="num">P. unitario</th><th></th></tr></thead>
        <tbody id="fm-items"></tbody>
      </table></div>
      <div class="acciones"><button type="button" class="btn btn-chico" onclick="_fmAgregarItem()">${icono('mas')}Agregar ítem</button></div>
      <div class="formulario">
        <div class="campo ancho"><label for="fm-obs">Observaciones (opcional)</label><input id="fm-obs" placeholder="Notas adicionales para el comprobante"></div>
      </div>
      <div class="pulso" id="fm-total"></div>
      <p class="campo error"><span class="ayuda" id="fac-error" hidden></span></p>`;
    _fmAgregarItem();
    configurarGuardado(async () => {
      const id_cuenta = $('#fm-cuenta').value;
      if (!id_cuenta) { _facError('Elegí una cuenta.'); return false; }
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
  const fila = document.createElement('tr');
  const unidades = ['unidades', 'horas', 'kilómetros', 'toneladas', 'kilogramos', 'litros', 'días', 'viajes', 'metros cúbicos', 'global'];
  fila.innerHTML = `
    <td><input class="entrada fm-desc" placeholder="Descripción del ítem" aria-label="Descripción"></td>
    <td><input class="entrada fm-cant" type="number" min="0" step="0.01" value="1" aria-label="Cantidad"></td>
    <td><select class="entrada fm-unidad" aria-label="Unidad">
      ${unidades.map(u => `<option value="${u}">${u}</option>`).join('')}
    </select></td>
    <td><input class="entrada fm-precio" type="number" min="0" step="0.01" placeholder="0,00" aria-label="Precio unitario"></td>
    <td><button type="button" class="btn btn-peligro btn-chico" title="Quitar ítem" aria-label="Quitar ítem">Quitar</button></td>`;
  fila.querySelector('button').onclick = () => { fila.remove(); _fmActualizarTotal(); };
  fila.querySelectorAll('input, select').forEach(i => i.addEventListener('input', _fmActualizarTotal));
  cont.appendChild(fila);
  _fmActualizarTotal();
}

function _fmRecogerItems() {
  return Array.from(document.querySelectorAll('#fm-items > tr')).map(f => ({
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
    <div class="cifra"><span class="rotulo">Neto gravado</span><span class="cifra-valor">${fmtDinero(neto)}</span></div>
    <div class="cifra"><span class="rotulo">IVA 21 %</span><span class="cifra-valor">${fmtDinero(iva)}</span></div>
    <div class="cifra"><span class="rotulo">Total</span><span class="cifra-valor">${fmtDinero(neto + iva)}</span></div>`;
}

// Marca la fila del viaje elegido
function _facMarcar(input) {
  document.querySelectorAll('input[name="viaje-fac"]').forEach(r => r.closest('tr').classList.remove('sel'));
  if (input.checked) input.closest('tr').classList.add('sel');
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
