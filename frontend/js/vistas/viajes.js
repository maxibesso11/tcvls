// frontend/js/vistas/viajes.js
// Viajes: avance secuencial de estado y modal de facturación del viaje.
// Las funciones son globales a propósito: las usan los onclick="..." del HTML
// generado y los demás archivos. El orden de carga está en index.html.

// ============================================================
// Avance secuencial de estado de viajes
// Si pasa a FINALIZADO con tarifa POR KM/POR TONELADA sin resultado,
// se pide en un modal. Luego el backend genera liquidación al chofer
// y, al pasar a FACTURADO, imputa al pagador.
// ============================================================
const SECUENCIA_VIAJE = ['EN CURSO', 'EN DESTINO', 'FINALIZADO', 'FACTURADO'];

let modoAvanzarConResultado = null;

async function avanzarEstadoViaje(idViaje) {
  let viaje;
  try { viaje = await API.obtener('viajes', idViaje); }
  catch (err) { mostrarToast(err.message, true); return; }

  const idx = SECUENCIA_VIAJE.indexOf(viaje.estado);
  if (idx === -1 || idx === SECUENCIA_VIAJE.length - 1) {
    mostrarToast('El viaje ya está en el último estado', true);
    return;
  }
  const siguiente = SECUENCIA_VIAJE[idx + 1];

  // Para FINALIZADO con tarifa POR KM/POR TONELADA, pedir resultado si falta
  const necesitaResultado = (viaje.tipo_tarifa === 'POR KM' || viaje.tipo_tarifa === 'POR TONELADA');
  const sinResultado = viaje.resultado === null || viaje.resultado === undefined || viaje.resultado === '';
  if (siguiente === 'FINALIZADO' && necesitaResultado && sinResultado) {
    abrirModalResultado(viaje, siguiente);
    return;
  }

  // Auto-completar fecha_llegada al transicionar a FINALIZADO
  const datos = { estado: siguiente };
  if (siguiente === 'FINALIZADO' && !viaje.fecha_llegada) {
    datos.fecha_llegada = new Date().toISOString().slice(0, 19).replace('T', ' ');
  }

  // Al avanzar a FACTURADO, abrir el modal para elegir cómo imputar en la
  // cuenta del cliente (sin IVA, líquido producto o emitir factura).
  if (siguiente === 'FACTURADO') {
    registroEditando = idViaje;
    _registroActual = viaje;
    return abrirModalFacturarViaje({ ...viaje, estado: 'FACTURADO' });
  }

  try {
    await API.actualizar('viajes', idViaje, datos);
    mostrarToast(`Viaje #${idViaje} avanzado a ${siguiente}`);
    cargarTabla('viajes', $('#buscador')?.value || '', $('#filtro-equipo')?.value || '', $('#filtro-deposito')?.value || '', recogerExtras(), 1);
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

function abrirModalResultado(viaje, siguienteEstado) {
  modoAvanzarConResultado = { idViaje: viaje.id_viaje, estado: siguienteEstado, viaje };

  const unidad = viaje.tipo_tarifa === 'POR KM' ? 'Kilómetros recorridos' : 'Toneladas descargadas';

  $('#modal-titulo').textContent = `Finalizar viaje · ${unidad}`;
  $('#modal-cuerpo').innerHTML = `
    <div class="campo ancho-completo" style="font-size:13px;color:var(--texto-suave); padding:10px 12px; background:#faf9f5; border-radius:6px">
      <div><strong>${esc(viaje.origen)}</strong> → <strong>${esc(viaje.destino)}</strong></div>
      <div>Tarifa: ${fmtDinero(viaje.tarifa)} · ${viaje.tipo_tarifa}</div>
      ${viaje.cantidad_cargada ? `<div>Cantidad cargada: ${viaje.cantidad_cargada}</div>` : ''}
    </div>
    <div class="campo ancho-completo">
      <label for="res-valor">${unidad} *</label>
      <input id="res-valor" type="number" step="any" min="0" required autofocus>
    </div>
  `;
  $('#modal-fondo').hidden = false;
  setTimeout(() => $('#res-valor')?.focus(), 50);
}

async function guardarResultadoYAvanzar() {
  const { idViaje, estado, viaje } = modoAvanzarConResultado;
  const valor = parseFloat($('#res-valor').value);
  if (!Number.isFinite(valor) || valor <= 0) {
    mostrarToast('Ingresa un valor mayor a cero', true);
    return;
  }

  const datos = { estado, resultado: valor };
  if (!viaje.fecha_llegada) {
    datos.fecha_llegada = new Date().toISOString().slice(0, 19).replace('T', ' ');
  }

  try {
    await API.actualizar('viajes', idViaje, datos);
    mostrarToast(`Viaje #${idViaje} finalizado`);
    cerrarModal();
    cargarTabla('viajes', $('#buscador')?.value || '', $('#filtro-equipo')?.value || '', $('#filtro-deposito')?.value || '', recogerExtras(), 1);
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

// Modal que se abre al marcar un viaje como FACTURADO. Ofrece tres caminos de
// imputación en la cuenta del cliente: emitir factura formal, líquido producto
// (con IVA) o sin facturar (sin IVA). El monto se previsualiza localmente.
function calcularMontosViaje(datos) {
  const base = datos.tipo_tarifa === 'UNICA'
    ? Number(datos.tarifa) || 0
    : (Number(datos.tarifa) || 0) * (Number(datos.resultado ?? datos.cantidad_cargada) || 0);
  const comision = Number(datos.comision) || 0;
  const neto = base * (1 - comision / 100);
  const conIVA = neto * 1.21;
  return { base, comision, neto, conIVA };
}

// Valor imputado en la cuenta del cliente para un viaje ya FACTURADO.
// Depende del modo de facturación elegido: sin factura no lleva IVA, líquido
// producto y factura formal sí. Los viajes anteriores a esa columna (NULL)
// se muestran con IVA, igual que como fueron imputados.
function valorViajeFacturado(fila) {
  if (fila.estado !== 'FACTURADO') {
    return '<span style="color:var(--texto-suave)">—</span>';
  }
  const { neto, conIVA } = calcularMontosViaje(fila);
  const sinIva = fila.modo_facturacion === 'SIN_FACTURAR';
  const total = sinIva ? neto : conIVA;
  const detalle = sinIva ? 'sin IVA'
    : fila.modo_facturacion === 'FACTURA' ? 'Factura A · IVA incl.'
    : 'líquido producto · IVA incl.';
  return `<strong>${fmtDinero(total)}</strong><br><span class="filtro-label">${detalle}</span>`;
}

let _datosViajeFacturar = null;
function abrirModalFacturarViaje(datos) {
  _datosViajeFacturar = datos;
  const { base, comision, neto, conIVA } = calcularMontosViaje(datos);
  const filaComision = comision > 0
    ? `<div class="resumen-fila" style="display:flex;justify-content:space-between;padding:3px 0"><span>Comisión (${comision}%)</span><span>− ${fmtDinero(base - neto)}</span></div>`
    : '';

  $('#modal-titulo').textContent = 'Facturar viaje';
  $('#modal-cuerpo').innerHTML = `
    <p style="color:var(--texto-suave);font-size:14px;margin-bottom:16px">
      Elegí cómo imputar este viaje en la cuenta del cliente <strong>${esc(datos.pagador || '')}</strong>.
    </p>
    <div style="background:var(--fondo-suave,#f5f5f5);border-radius:10px;padding:14px 16px;margin-bottom:18px;font-size:14px">
      <div class="resumen-fila" style="display:flex;justify-content:space-between;padding:3px 0"><span>Base del viaje</span><span>${fmtDinero(base)}</span></div>
      ${filaComision}
      <div class="resumen-fila" style="display:flex;justify-content:space-between;padding:3px 0;font-weight:600"><span>Neto (a cobrar)</span><span>${fmtDinero(neto)}</span></div>
      <div class="resumen-fila" style="display:flex;justify-content:space-between;padding:3px 0"><span>+ IVA 21%</span><span>${fmtDinero(conIVA - neto)}</span></div>
      <div class="resumen-fila" style="display:flex;justify-content:space-between;padding:8px 0 0;margin-top:6px;font-weight:700;border-top:1px solid var(--borde)"><span>Total con IVA</span><span>${fmtDinero(conIVA)}</span></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px">
      <button class="btn btn-primario" onclick="confirmarFacturarViaje('FACTURA')">Emitir factura A · ${fmtDinero(conIVA)}</button>
      <button class="btn btn-secundario" onclick="confirmarFacturarViaje('LIQUIDO_PRODUCTO')">Facturado líquido producto (con IVA) · ${fmtDinero(conIVA)}</button>
      <button class="btn btn-secundario" onclick="confirmarFacturarViaje('SIN_FACTURAR')">Continuar sin facturar (sin IVA) · ${fmtDinero(neto)}</button>
    </div>
    <p style="color:var(--texto-suave);font-size:12px;margin-top:14px;line-height:1.5">
      <strong>Emitir factura A</strong> genera el comprobante formal e imputa el total en la cuenta.
      <strong>Líquido producto</strong> imputa el total con IVA sin emitir comprobante.
      <strong>Sin facturar</strong> imputa solo el neto, sin IVA.
    </p>`;
  $('#btn-guardar').style.display = 'none';
  $('#btn-cancelar').style.display = '';
  abrirModalGenerico();
}

async function confirmarFacturarViaje(modo) {
  if (!_datosViajeFacturar) return;
  const datos = { ..._datosViajeFacturar, modo_facturacion: modo };

  try {
    // Guardar el viaje con su modo. El hook del backend imputa el movimiento
    // en la cuenta del cliente según el modo elegido.
    let idViaje = registroEditando;
    if (registroEditando) {
      await API.actualizar('viajes', registroEditando, datos);
    } else {
      const creado = await API.crear('viajes', datos);
      idViaje = creado && (creado.id_viaje || creado.insertId || creado.id);
    }

    if (modo === 'FACTURA') {
      if (idViaje) {
        try {
          await API.facturarViaje(idViaje);
          mostrarToast('Viaje facturado y comprobante emitido');
        } catch (errFac) {
          mostrarToast('Viaje guardado, pero la factura no se emitió: ' + errFac.message, true);
        }
      } else {
        mostrarToast('Viaje guardado. Emití el comprobante desde Facturación.');
      }
    } else if (modo === 'LIQUIDO_PRODUCTO') {
      mostrarToast('Viaje imputado con IVA (líquido producto)');
    } else {
      mostrarToast('Viaje imputado sin IVA');
    }

    _datosViajeFacturar = null;
    cerrarModal();
    cargarTabla(moduloActual, $('#buscador')?.value || '', $('#filtro-equipo')?.value || '', $('#filtro-deposito')?.value || '', recogerExtras(), 1);
  } catch (err) {
    mostrarToast(err.message, true);
  }
}
