// frontend/js/vistas/cuentasCorrientes.js
// Vista Cuentas corrientes: resumen, detalle de una cuenta, PDF y recibos.
// Las funciones son globales a propósito: las usan los onclick="..." del HTML
// generado y los demás archivos. El orden de carga está en index.html.

// ============================================================
// Cuentas corrientes: resumen, buscador y detalle con PDF
// ============================================================
async function renderCuentasCorrientes() {
  contenido.innerHTML = `
    <div class="vista-cab">
      <div>
        <h1>Cuentas corrientes</h1>
        <p>Movimientos agrupados por cuenta y saldo final (deudor o acreedor).</p>
      </div>
      <div class="acciones">
        <button class="btn btn-primario" id="btn-liquidar-sueldos">Liquidar sueldos fijos del mes</button>
      </div>
    </div>
    <div class="filtros">
      <input class="entrada" id="buscador-cc" placeholder="Buscar por nombre, CUIL o tipo…" aria-label="Buscar cuenta">
    </div>
    <div class="pulso" id="cc-totales"></div>
    <section class="hoja" id="cc-tabla">
      <div class="vacio">Cargando cuentas…</div>
    </section>
  `;

  let temporizador;
  $('#buscador-cc').addEventListener('input', e => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => cargarCuentasCorrientes(e.target.value), 350);
  });
  $('#btn-liquidar-sueldos').addEventListener('click', () => abrirModalLiquidarSueldos());

  cargarCuentasCorrientes();
}

// Acción mensual: liquida el sueldo fijo de cada chofer con remuneración
// mixta o fija (sueldo_fijo_mensual). Antes de confirmar muestra quiénes se
// van a pagar y el total, con la posibilidad de destildar a alguno; después
// de liquidar, cada chofer liquidado queda con un botón para descargar su
// recibo en PDF y aparece un botón para el PDF general del período (son
// comprobantes internos de pago, no facturas fiscales de ARCA). Correr la
// acción dos veces para el mismo período no duplica nada.
let _lsPeriodoActual = null;
let _lsHayLiquidados = false;

function abrirModalLiquidarSueldos() {
  const hoy = new Date();
  const periodoActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  $('#modal-titulo').textContent = 'Liquidar sueldos fijos del mes';
  $('#modal-cuerpo').innerHTML = `
    <div class="formulario">
      <div class="campo ancho">
        <label for="ls-periodo">Período a liquidar *</label>
        <input id="ls-periodo" type="month" value="${periodoActual}" required>
        <span class="ayuda">Tildá a quiénes pagar este período. Si un chofer ya fue liquidado, no se puede volver a incluir.</span>
      </div>
    </div>
    <div id="ls-lista"><div class="vacio">Cargando…</div></div>
    <div class="pulso" id="ls-totales" hidden></div>
    <p class="campo error"><span class="ayuda" id="ls-error" hidden></span></p>
  `;
  $('#ls-periodo').addEventListener('change', () => _cargarListaLiquidar($('#ls-periodo').value));
  configurarGuardado(async () => {
    const periodo = $('#ls-periodo').value;
    if (!periodo) { _lsError('Elegí el período a liquidar.'); return false; }
    const ids = Array.from(document.querySelectorAll('.ls-chk:checked')).map(c => Number(c.value));
    if (ids.length === 0) { _lsError('No hay choferes seleccionados para liquidar.'); return false; }
    $('#ls-error').hidden = true;
    try {
      const r = await API.liquidarSueldosFijos(periodo, ids);
      mostrarToast(`Sueldos fijos de ${r.periodo}: ${r.liquidados} liquidado(s)${r.ya_liquidados ? `, ${r.ya_liquidados} ya estaban liquidados` : ''}.`);
      await _cargarListaLiquidar(periodo);
      cargarCuentasCorrientes($('#buscador-cc')?.value || '');
    } catch (err) {
      _lsError(err.message);
    }
    return false; // el modal queda abierto: acá se descargan los PDF
  });
  abrirModalGenerico();
  _cargarListaLiquidar(periodoActual);
}

async function _cargarListaLiquidar(periodo) {
  _lsPeriodoActual = periodo;
  const cont = $('#ls-lista');
  if (!cont) return; // el modal ya se cerró
  cont.innerHTML = '<div class="vacio">Cargando…</div>';
  $('#ls-totales').hidden = true;
  try {
    const choferes = await API.liquidablesSueldosFijos(periodo);
    if (choferes.length === 0) {
      cont.innerHTML = '<div class="vacio">Ningún chofer tiene sueldo fijo mensual cargado.</div>';
    } else {
      cont.innerHTML = `
        <div class="tabla-marco"><table class="tabla">
          <thead><tr><th></th><th>Chofer</th><th>CUIL</th><th class="num">Sueldo fijo</th><th></th></tr></thead>
          <tbody>
            ${choferes.map(c => c.ya_liquidado ? `
              <tr>
                <td></td>
                <td class="fuerte">${esc(c.nombre)}</td>
                <td class="mono">${esc(c.cuil)}</td>
                <td class="num">${fmtDinero(c.sueldo_fijo_mensual)}</td>
                <td>${insignia('Liquidado', 'ok')} <button type="button" class="btn btn-chico" onclick="descargarPdfLiquidacion(${c.id_liquidacion_sueldo})">Descargar PDF</button></td>
              </tr>` : `
              <tr class="sel">
                <td><input type="checkbox" class="ls-chk" value="${c.id_chofer}" data-monto="${c.sueldo_fijo_mensual}" checked onchange="_lsToggleFila(this)" aria-label="Liquidar a ${esc(c.nombre)}"></td>
                <td class="fuerte">${esc(c.nombre)}</td>
                <td class="mono">${esc(c.cuil)}</td>
                <td class="num">${fmtDinero(c.sueldo_fijo_mensual)}</td>
                <td></td>
              </tr>`).join('')}
          </tbody>
        </table></div>`;
    }
    _lsHayLiquidados = choferes.some(c => c.ya_liquidado);
    _lsActualizarTotal();
  } catch (err) {
    cont.innerHTML = `<div class="vacio">Error: ${esc(err.message)}</div>`;
  }
}

function _lsToggleFila(input) {
  input.closest('tr').classList.toggle('sel', input.checked);
  _lsActualizarTotal();
}

function _lsActualizarTotal() {
  const el = $('#ls-totales');
  if (!el) return;
  const checks = Array.from(document.querySelectorAll('.ls-chk:checked'));
  const total = checks.reduce((s, c) => s + Number(c.dataset.monto), 0);
  el.hidden = false;
  el.innerHTML = `
    <div class="cifra"><span class="rotulo">A liquidar</span><span class="cifra-valor">${checks.length}<small>chofer${checks.length === 1 ? '' : 'es'}</small></span></div>
    <div class="cifra"><span class="rotulo">Total</span><span class="cifra-valor">${fmtDinero(total)}</span></div>
    ${_lsHayLiquidados ? `<div class="cifra"><button type="button" class="btn btn-chico" onclick="descargarPdfLiquidacionesPeriodo('${_lsPeriodoActual}')">PDF general del período</button></div>` : ''}
  `;
}

function _lsError(msg) {
  const box = $('#ls-error');
  if (box) { box.textContent = msg; box.hidden = false; }
}

async function descargarPdfLiquidacionesPeriodo(periodo) {
  try { await API.descargarPdfLiquidacionesPeriodo(periodo); }
  catch (err) { mostrarToast(err.message, true); }
}

async function descargarPdfLiquidacion(id) {
  try { await API.descargarPdfLiquidacion(id); }
  catch (err) { mostrarToast(err.message, true); }
}

async function cargarCuentasCorrientes(q = '', pagina = 1) {
  try {
    const { totales, cuentas, paginacion } = await API.resumenCuentasCorrientes(q, pagina);
    const neta = totales.total_deudor - totales.total_acreedor;

    $('#cc-totales').innerHTML = `
      <div class="cifra">
        <span class="rotulo">Cuentas con movimientos</span>
        <span class="cifra-valor">${totales.cuentas}</span>
        <span class="cifra-delta tenue">${totales.saldadas} saldadas</span>
      </div>
      <div class="cifra">
        <span class="rotulo">Total a cobrar</span>
        <span class="cifra-valor">${fmtMillones(totales.total_deudor)}</span>
        <span class="cifra-delta tenue">${totales.deudoras} ${totales.deudoras === 1 ? 'cuenta adeuda' : 'cuentas adeudan'} a la empresa</span>
      </div>
      <div class="cifra">
        <span class="rotulo">Total a pagar</span>
        <span class="cifra-valor">${fmtMillones(totales.total_acreedor)}</span>
        <span class="cifra-delta tenue">${totales.acreedoras} ${totales.acreedoras === 1 ? 'cuenta' : 'cuentas'} a las que la empresa adeuda</span>
      </div>
      <div class="cifra">
        <span class="rotulo">Posición neta</span>
        <span class="cifra-valor">${fmtMillones(neta)}</span>
        <span class="cifra-delta ${neta > 0 ? 'sube' : neta < 0 ? 'baja' : 'tenue'}">${neta >= 0 ? 'A favor de la empresa' : 'En contra de la empresa'}</span>
      </div>
    `;

    if (cuentas.length === 0) {
      $('#cc-tabla').innerHTML = '<div class="vacio">No se encontraron cuentas con ese criterio.</div>';
      return;
    }

    $('#cc-tabla').innerHTML = `
      <div class="tabla-marco">
        <table class="tabla">
          <thead>
            <tr>
              <th>Titular</th><th>Tipo</th><th>CUIL</th><th class="num">Movs.</th>
              <th class="num">Débitos</th><th class="num">Créditos</th><th class="num">Saldo final</th>
              <th>Condición</th>
            </tr>
          </thead>
          <tbody>
            ${cuentas.map(c => `
              <tr class="clic" tabindex="0" onclick="location.hash='cuenta-corriente/${c.id_cuenta}'" onkeydown="if (event.key === 'Enter') location.hash='cuenta-corriente/${c.id_cuenta}'">
                <td class="fuerte">${esc(c.nombre)}</td>
                <td>${insigniaEstado(c.tipo)}</td>
                <td class="mono">${esc(c.cuil)}</td>
                <td class="num">${c.cantidad_movimientos}</td>
                <td class="num">${Number(c.total_debitos) ? `<span class="monto-neg">${fmtDinero(c.total_debitos)}</span>` : fmtDinero(0)}</td>
                <td class="num">${Number(c.total_creditos) ? `<span class="monto-pos">${fmtDinero(c.total_creditos)}</span>` : fmtDinero(0)}</td>
                <td class="num fuerte">${fmtDinero(Math.abs(c.saldo))}</td>
                <td>${insigniaCondicion(c.condicion)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${controlesPaginacion(paginacion, p => cargarCuentasCorrientes(q, p))}`;
  } catch (err) {
    $('#cc-tabla').innerHTML = `<div class="vacio">Error: ${esc(err.message)}</div>`;
  }
}

// Condición de la cuenta, desde la perspectiva de la empresa:
//  DEUDOR   = el titular adeuda a la empresa → saldo a favor → ok
//  ACREEDOR = la empresa adeuda al titular   → pasivo        → peligro
//  SALDADA  = sin saldo                                       → neutra
function insigniaCondicion(condicion) {
  const variante = condicion === 'DEUDOR' ? 'ok' : condicion === 'ACREEDOR' ? 'peligro' : '';
  const texto = condicion === 'DEUDOR' ? 'A favor'
              : condicion === 'ACREEDOR' ? 'En contra'
              : 'Saldada';
  return `<span class="insignia ${variante}" title="${condicion}">${texto.toUpperCase()}</span>`;
}

async function renderDetalleCuenta(id) {
  contenido.innerHTML = '<div class="vacio">Cargando resumen de cuenta…</div>';

  try {
    const { cuenta, movimientos, resumen } = await API.detalleCuentaCorriente(id);

    contenido.innerHTML = `
      <div class="vista-cab">
        <div>
          <div class="migas"><button onclick="location.hash='cuentas-corrientes'">Cuentas corrientes</button> / ${esc(cuenta.nombre)}</div>
          <h1>${esc(cuenta.nombre)}</h1>
          <p>${esc(cuenta.tipo)} · CUIL ${esc(cuenta.cuil)}${cuenta.telefono ? ' · Tel. ' + esc(cuenta.telefono) : ''}</p>
        </div>
        <div class="acciones">
          <button class="btn" onclick="descargarPdfCuenta(${cuenta.id_cuenta})">Descargar resumen PDF</button>
          <button class="btn btn-primario" onclick="abrirModalRecibo(${cuenta.id_cuenta})">+ Nuevo recibo</button>
        </div>
      </div>

      <div class="pulso">
        <div class="cifra">
          <span class="rotulo" title="Montos en contra del titular: a favor de la empresa">Total débitos</span>
          <span class="cifra-valor">${fmtMillones(resumen.total_debitos)}</span>
        </div>
        <div class="cifra">
          <span class="rotulo" title="Montos a favor del titular: la empresa debe">Total créditos</span>
          <span class="cifra-valor">${fmtMillones(resumen.total_creditos)}</span>
        </div>
        <div class="cifra">
          <span class="rotulo">Saldo final</span>
          <span class="cifra-valor">${fmtMillones(Math.abs(resumen.saldo_final))}</span>
          <span class="cifra-delta">${insigniaCondicion(resumen.condicion)}</span>
        </div>
        <div class="cifra">
          <span class="rotulo">Movimientos</span>
          <span class="cifra-valor">${resumen.cantidad_movimientos}</span>
        </div>
      </div>

      <section class="hoja">
        <header class="hoja-cabecera"><div><h2 class="hoja-titulo">Detalle de movimientos</h2></div></header>
        ${movimientos.length === 0
          ? '<div class="vacio">La cuenta no registra movimientos todavía.</div>'
          : `<div class="tabla-marco"><table class="tabla">
              <thead>
                <tr><th>Fecha</th><th>Concepto</th><th class="num">Débito</th><th class="num">Crédito</th><th class="num">Saldo parcial</th></tr>
              </thead>
              <tbody>
                ${movimientos.map((m, i) => `
                  <tr class="clic" tabindex="0" onclick="abrirModalRecibo(${cuenta.id_cuenta}, _movimientosCuenta[${i}])" onkeydown="if (event.key === 'Enter') abrirModalRecibo(${cuenta.id_cuenta}, _movimientosCuenta[${i}])">
                    <td>${fmtFecha(m.fecha)}</td>
                    <td>${m.concepto.startsWith('RECIBO') ? '<span class="insignia info">RECIBO</span> ' + esc(m.concepto.replace(/^RECIBO\s*/, '')) : esc(m.concepto)}</td>
                    <td class="num">${m.debito ? `<span class="monto-neg">${fmtDinero(m.debito)}</span>` : '—'}</td>
                    <td class="num">${m.credito ? `<span class="monto-pos">${fmtDinero(m.credito)}</span>` : '—'}</td>
                    <td class="num fuerte">${fmtDineroSigno(m.saldo_parcial)}</td>
                  </tr>`).join('')}
              </tbody>
            </table></div>`}
      </section>
    `;
    _movimientosCuenta = movimientos;
  } catch (err) {
    contenido.innerHTML = `<div class="vacio">Error: ${esc(err.message)}</div>`;
  }
}
let _movimientosCuenta = [];

// ============================================================
// Recibos dentro de la cuenta corriente
// Un recibo es un MOVIMIENTO cuyo concepto comienza con "RECIBO".
// Se crea, edita y elimina sin salir del detalle de la cuenta (al hacer
// clic en la fila del movimiento se abre su formulario con "Eliminar").
// ============================================================
let modoRecibo = null; // { idCuenta, idMovimiento } o null

function abrirModalRecibo(idCuenta, mov = null) {
  modoRecibo = { idCuenta, idMovimiento: mov ? mov.id_movimiento : null };
  $('#modal-titulo').textContent = mov ? 'Editar movimiento' : 'Nuevo recibo';

  const montoAbs = mov ? Math.abs(Number(mov.monto)) : '';
  const tipoMov = mov ? (Number(mov.monto) >= 0 ? 'CREDITO' : 'DEBITO') : 'CREDITO';
  const fechaVal = mov && mov.fecha ? String(mov.fecha).slice(0, 16).replace(' ', 'T') : '';

  // Para recibos nuevos se separa número y detalle; al editar se muestra el concepto completo
  $('#modal-cuerpo').innerHTML = `<div class="formulario">${mov ? `
    <div class="campo">
      <label for="r-fecha">Fecha *</label>
      <input id="r-fecha" type="datetime-local" value="${fechaVal}" required>
    </div>
    <div class="campo">
      <label for="r-tipo">Tipo *</label>
      <select id="r-tipo">
        <option value="CREDITO" ${tipoMov === 'CREDITO' ? 'selected' : ''}>Crédito (a favor del titular)</option>
        <option value="DEBITO" ${tipoMov === 'DEBITO' ? 'selected' : ''}>Débito (a cargo del titular)</option>
      </select>
    </div>
    <div class="campo">
      <label for="r-monto">Monto ($) *</label>
      <input id="r-monto" type="number" step="any" min="0" value="${montoAbs}" required>
    </div>
    <div class="campo ancho">
      <label for="r-concepto">Concepto *</label>
      <input id="r-concepto" type="text" maxlength="150" value="${esc(mov.concepto)}" required>
    </div>
    ${bloqueAcciones([{ texto: 'Eliminar movimiento', peligro: true, onclick: `eliminarMovimientoCuenta(${idCuenta}, ${mov.id_movimiento})` }])}
  ` : `
    <div class="campo">
      <label for="r-numero">N° de recibo *</label>
      <input id="r-numero" type="text" maxlength="20" placeholder="0001-00000123" required>
    </div>
    <div class="campo">
      <label for="r-fecha">Fecha *</label>
      <input id="r-fecha" type="datetime-local" required>
    </div>
    <div class="campo">
      <label for="r-tipo">Tipo *</label>
      <select id="r-tipo">
        <option value="CREDITO">Crédito (a favor del titular)</option>
        <option value="DEBITO">Débito (a cargo del titular)</option>
      </select>
    </div>
    <div class="campo">
      <label for="r-monto">Monto ($) *</label>
      <input id="r-monto" type="number" step="any" min="0" required>
    </div>
    <div class="campo ancho">
      <label for="r-detalle">Detalle</label>
      <input id="r-detalle" type="text" maxlength="100" placeholder="Pago viaje C-104, adelanto, etc.">
    </div>
  `}</div>`;

  $('#modal-fondo').hidden = false;
}

async function guardarRecibo() {
  const { idCuenta, idMovimiento } = modoRecibo;
  const fecha = $('#r-fecha').value;
  const tipo = $('#r-tipo').value;
  const montoAbs = parseFloat($('#r-monto').value);

  if (!fecha || isNaN(montoAbs) || montoAbs <= 0) {
    mostrarToast('Completá fecha y monto (mayor a cero)', true);
    return;
  }

  let concepto;
  if (idMovimiento) {
    concepto = $('#r-concepto').value.trim();
    if (!concepto) { mostrarToast('El concepto es obligatorio', true); return; }
  } else {
    const numero = $('#r-numero').value.trim();
    if (!numero) { mostrarToast('Indicá el número de recibo', true); return; }
    const detalle = $('#r-detalle').value.trim();
    concepto = `RECIBO N° ${numero}${detalle ? ' — ' + detalle : ''}`;
  }

  const datos = {
    id_cuenta: idCuenta,
    fecha: fecha.replace('T', ' ') + ':00',
    monto: tipo === 'DEBITO' ? -montoAbs : montoAbs,
    concepto
  };

  try {
    if (idMovimiento) {
      await API.actualizar('movimientos', idMovimiento, datos);
      mostrarToast('Movimiento actualizado');
    } else {
      await API.crear('movimientos', datos);
      mostrarToast('Recibo registrado en la cuenta');
    }
    cerrarModal();
    renderDetalleCuenta(idCuenta);
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

async function eliminarMovimientoCuenta(idCuenta, idMovimiento) {
  if (!await confirmar('Esta acción no se puede deshacer.', 'Eliminar movimiento', '¿Eliminar este movimiento de la cuenta?')) return;
  try {
    await API.eliminar('movimientos', idMovimiento);
    mostrarToast('Movimiento eliminado');
    renderDetalleCuenta(idCuenta);
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

// Descarga el resumen de cuenta en PDF (token por cabecera, no en la URL).
async function descargarPdfCuenta(idCuenta) {
  try { await API.descargarPdfCuenta(idCuenta); }
  catch (err) { mostrarToast(err.message, true); }
}
