// frontend/js/vistas/cuentasCorrientes.js
// Vista Cuentas corrientes: resumen, detalle de una cuenta, PDF y recibos.
// Las funciones son globales a propósito: las usan los onclick="..." del HTML
// generado y los demás archivos. El orden de carga está en index.html.

// ============================================================
// Cuentas corrientes: resumen, buscador y detalle con PDF
// ============================================================
async function renderCuentasCorrientes() {
  contenido.innerHTML = `
    <div class="vista-cabecera">
      <div>
        <div class="vista-titulo">Cuentas corrientes</div>
        <div class="vista-sub">Movimientos agrupados por cuenta y saldo final (deudor o acreedor)</div>
      </div>
      <div class="toolbar">
        <input class="buscador" id="buscador-cc" placeholder="Buscar por nombre, CUIL o tipo…">
      </div>
    </div>
    <div class="kpi-grid" id="cc-totales"></div>
    <div class="panel">
      <div class="panel-cuerpo sin-padding">
        <div class="tabla-contenedor" id="cc-tabla">
          <div class="estado-vacio">Cargando cuentas…</div>
        </div>
      </div>
    </div>
  `;

  let temporizador;
  $('#buscador-cc').addEventListener('input', e => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => cargarCuentasCorrientes(e.target.value), 350);
  });

  cargarCuentasCorrientes();
}

async function cargarCuentasCorrientes(q = '', pagina = 1) {
  try {
    const { totales, cuentas, paginacion } = await API.resumenCuentasCorrientes(q, pagina);

    $('#cc-totales').innerHTML = `
      <div class="kpi">
        <div class="kpi-etiqueta">Cuentas con movimientos</div>
        <div class="kpi-valor">${totales.cuentas}</div>
        <div class="kpi-detalle">${totales.saldadas} saldadas</div>
      </div>
      <div class="kpi">
        <div class="kpi-etiqueta">Total a cobrar</div>
        <div class="kpi-valor exito">${fmtDinero(totales.total_deudor)}</div>
        <div class="kpi-detalle">${totales.deudoras} cuentas que adeudan a la empresa</div>
      </div>
      <div class="kpi">
        <div class="kpi-etiqueta">Total a pagar</div>
        <div class="kpi-valor peligro">${fmtDinero(totales.total_acreedor)}</div>
        <div class="kpi-detalle">${totales.acreedoras} cuentas a las que la empresa adeuda</div>
      </div>
      <div class="kpi">
        <div class="kpi-etiqueta">Posición neta</div>
        <div class="kpi-valor" style="color:${(totales.total_deudor - totales.total_acreedor) > 0 ? 'var(--exito)' : (totales.total_deudor - totales.total_acreedor) < 0 ? 'var(--peligro)' : 'var(--texto-suave)'}">${fmtDinero(totales.total_deudor - totales.total_acreedor)}</div>
        <div class="kpi-detalle">${(totales.total_deudor - totales.total_acreedor) >= 0 ? 'A favor de la empresa' : 'En contra de la empresa'}</div>
      </div>
    `;

    if (cuentas.length === 0) {
      $('#cc-tabla').innerHTML = '<div class="estado-vacio">No se encontraron cuentas con ese criterio.</div>';
      return;
    }

    $('#cc-tabla').innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Titular</th><th>Tipo</th><th>CUIL</th><th>Movs.</th>
            <th>Débitos</th><th>Créditos</th><th>Saldo final</th>
            <th>Condición</th><th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${cuentas.map(c => `
            <tr>
              <td>${esc(c.nombre)}</td>
              <td>${insigniaEstado(c.tipo)}</td>
              <td>${esc(c.cuil)}</td>
              <td class="celda-num">${c.cantidad_movimientos}</td>
              <td class="celda-num">${fmtDinero(c.total_debitos)}</td>
              <td class="celda-num">${fmtDinero(c.total_creditos)}</td>
              <td class="celda-num" style="font-weight:600;color:${colorSaldo(c.condicion)}">${fmtDinero(Math.abs(c.saldo))}</td>
              <td>${insigniaCondicion(c.condicion)}</td>
              <td>
                <button class="btn btn-secundario btn-mini" onclick="location.hash='cuenta-corriente/${c.id_cuenta}'">Ver detalle</button>
                <a class="btn btn-primario btn-mini" style="text-decoration:none" href="${API.urlPdfCuenta(c.id_cuenta)}" target="_blank">PDF</a>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
      ${controlesPaginacion(paginacion, p => cargarCuentasCorrientes(q, p))}`;
  } catch (err) {
    $('#cc-tabla').innerHTML = `<div class="estado-vacio">Error: ${err.message}</div>`;
  }
}

// Color del saldo según la condición, desde la perspectiva de la empresa:
//  DEUDOR   = el titular adeuda a la empresa → saldo a favor → verde
//  ACREEDOR = la empresa adeuda al titular   → pasivo        → rojo
//  SALDADA  = sin saldo                                       → gris
function colorSaldo(condicion) {
  if (condicion === 'DEUDOR') return 'var(--exito)';
  if (condicion === 'ACREEDOR') return 'var(--peligro)';
  return 'var(--texto-suave)';
}

function insigniaCondicion(condicion) {
  const color = condicion === 'DEUDOR' ? 'verde' : condicion === 'ACREEDOR' ? 'rojo' : 'gris';
  const texto = condicion === 'DEUDOR' ? 'A favor'
              : condicion === 'ACREEDOR' ? 'En contra'
              : 'Saldada';
  return `<span class="insignia ${color}" title="${condicion}">${texto}</span>`;
}

async function renderDetalleCuenta(id) {
  contenido.innerHTML = '<div class="estado-vacio">Cargando resumen de cuenta…</div>';

  try {
    const { cuenta, movimientos, resumen } = await API.detalleCuentaCorriente(id);

    contenido.innerHTML = `
      <div class="vista-cabecera">
        <div>
          <div class="vista-titulo">${esc(cuenta.nombre)}</div>
          <div class="vista-sub">${esc(cuenta.tipo)} · CUIL ${esc(cuenta.cuil)}${cuenta.telefono ? ' · Tel. ' + esc(cuenta.telefono) : ''}</div>
        </div>
        <div class="toolbar">
          <button class="btn btn-secundario" onclick="location.hash='cuentas-corrientes'">← Volver</button>
          <button class="btn btn-primario" onclick="abrirModalRecibo(${cuenta.id_cuenta})">+ Nuevo recibo</button>
          <a class="btn btn-primario" style="text-decoration:none" href="${API.urlPdfCuenta(cuenta.id_cuenta)}" target="_blank">Descargar resumen PDF</a>
        </div>
      </div>

      <div class="kpi-grid">
        <div class="kpi">
          <div class="kpi-etiqueta" title="Montos en contra del titular: a favor de la empresa">Total débitos</div>
          <div class="kpi-valor exito">${fmtDinero(resumen.total_debitos)}</div>
        </div>
        <div class="kpi">
          <div class="kpi-etiqueta" title="Montos a favor del titular: la empresa debe">Total créditos</div>
          <div class="kpi-valor peligro">${fmtDinero(resumen.total_creditos)}</div>
        </div>
        <div class="kpi">
          <div class="kpi-etiqueta">Saldo final</div>
          <div class="kpi-valor" style="color:${colorSaldo(resumen.condicion)}">${fmtDinero(Math.abs(resumen.saldo_final))}</div>
          <div class="kpi-detalle">${insigniaCondicion(resumen.condicion)}</div>
        </div>
        <div class="kpi">
          <div class="kpi-etiqueta">Movimientos</div>
          <div class="kpi-valor">${resumen.cantidad_movimientos}</div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-cabecera">Detalle de movimientos</div>
        <div class="panel-cuerpo sin-padding">
          <div class="tabla-contenedor">
            ${movimientos.length === 0
              ? '<div class="estado-vacio">La cuenta no registra movimientos todavía.</div>'
              : `<table>
                  <thead>
                    <tr><th>Fecha</th><th>Concepto</th><th>Débito</th><th>Crédito</th><th>Saldo parcial</th><th>Acciones</th></tr>
                  </thead>
                  <tbody>
                    ${movimientos.map(m => `
                      <tr>
                        <td>${fmtFecha(m.fecha)}</td>
                        <td style="white-space:normal">${m.concepto.startsWith('RECIBO') ? '<span class="insignia azul">RECIBO</span> ' + esc(m.concepto.replace(/^RECIBO\s*/, '')) : esc(m.concepto)}</td>
                        <td class="celda-num" style="color:var(--exito)">${m.debito ? fmtDinero(m.debito) : '—'}</td>
                        <td class="celda-num" style="color:var(--peligro)">${m.credito ? fmtDinero(m.credito) : '—'}</td>
                        <td class="celda-num" style="font-weight:600">${fmtDinero(m.saldo_parcial)}</td>
                        <td>
                          <button class="btn btn-secundario btn-mini" onclick='abrirModalRecibo(${cuenta.id_cuenta}, ${JSON.stringify(m).replace(/'/g, "&#39;")})'>Editar</button>
                          <button class="btn btn-peligro btn-mini" onclick="eliminarMovimientoCuenta(${cuenta.id_cuenta}, ${m.id_movimiento})">Eliminar</button>
                        </td>
                      </tr>`).join('')}
                  </tbody>
                </table>`}
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    contenido.innerHTML = `<div class="estado-vacio">Error: ${err.message}</div>`;
  }
}

// ============================================================
// Recibos dentro de la cuenta corriente
// Un recibo es un MOVIMIENTO cuyo concepto comienza con "RECIBO".
// Se crea, edita y elimina sin salir del detalle de la cuenta.
// ============================================================
let modoRecibo = null; // { idCuenta, idMovimiento } o null

function abrirModalRecibo(idCuenta, mov = null) {
  modoRecibo = { idCuenta, idMovimiento: mov ? mov.id_movimiento : null };
  $('#modal-titulo').textContent = mov ? 'Editar movimiento' : 'Nuevo recibo';

  const esRecibo = mov ? String(mov.concepto).startsWith('RECIBO') : true;
  const montoAbs = mov ? Math.abs(Number(mov.monto)) : '';
  const tipoMov = mov ? (Number(mov.monto) >= 0 ? 'CREDITO' : 'DEBITO') : 'CREDITO';
  const fechaVal = mov && mov.fecha ? String(mov.fecha).slice(0, 16).replace(' ', 'T') : '';

  // Para recibos nuevos se separa número y detalle; al editar se muestra el concepto completo
  $('#modal-cuerpo').innerHTML = mov ? `
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
    <div class="campo ancho-completo">
      <label for="r-concepto">Concepto *</label>
      <input id="r-concepto" type="text" maxlength="150" value="${String(mov.concepto).replace(/"/g, '&quot;')}" required>
    </div>
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
    <div class="campo ancho-completo">
      <label for="r-detalle">Detalle</label>
      <input id="r-detalle" type="text" maxlength="100" placeholder="Pago viaje C-104, adelanto, etc.">
    </div>
  `;

  $('#modal-fondo').hidden = false;
}

async function guardarRecibo() {
  const { idCuenta, idMovimiento } = modoRecibo;
  const fecha = $('#r-fecha').value;
  const tipo = $('#r-tipo').value;
  const montoAbs = parseFloat($('#r-monto').value);

  if (!fecha || isNaN(montoAbs) || montoAbs <= 0) {
    mostrarToast('Completa fecha y monto (mayor a cero)', true);
    return;
  }

  let concepto;
  if (idMovimiento) {
    concepto = $('#r-concepto').value.trim();
    if (!concepto) { mostrarToast('El concepto es obligatorio', true); return; }
  } else {
    const numero = $('#r-numero').value.trim();
    if (!numero) { mostrarToast('Indica el número de recibo', true); return; }
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
  if (!confirm('¿Eliminar este movimiento de la cuenta? Esta acción no se puede deshacer.')) return;
  try {
    await API.eliminar('movimientos', idMovimiento);
    mostrarToast('Movimiento eliminado');
    renderDetalleCuenta(idCuenta);
  } catch (err) {
    mostrarToast(err.message, true);
  }
}
