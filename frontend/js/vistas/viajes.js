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
    recargarVistaModulo('viajes');
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

function abrirModalResultado(viaje, siguienteEstado) {
  modoAvanzarConResultado = { idViaje: viaje.id_viaje, estado: siguienteEstado, viaje };

  const unidad = viaje.tipo_tarifa === 'POR KM' ? 'Kilómetros recorridos' : 'Toneladas descargadas';

  $('#modal-titulo').textContent = `Finalizar viaje de ${unidad}`;
  $('#modal-cuerpo').innerHTML = `
    <div class="formulario">
      <div class="campo ancho">
        <span><strong>${esc(viaje.origen)}</strong> → <strong>${esc(viaje.destino)}</strong></span>
        <span class="ayuda">Tarifa ${fmtDinero(viaje.tarifa)} ${String(viaje.tipo_tarifa).toLowerCase()}${viaje.cantidad_cargada ? `, cantidad cargada ${fmtNum(viaje.cantidad_cargada)}` : ''}</span>
      </div>
      <div class="campo ancho">
        <label for="res-valor">${unidad} *</label>
        <input id="res-valor" type="number" step="any" min="0" required autofocus>
      </div>
    </div>
  `;
  $('#modal-fondo').hidden = false;
  setTimeout(() => $('#res-valor')?.focus(), 50);
}

async function guardarResultadoYAvanzar() {
  const { idViaje, estado, viaje } = modoAvanzarConResultado;
  const valor = parseFloat($('#res-valor').value);
  if (!Number.isFinite(valor) || valor <= 0) {
    mostrarToast('Ingresá un valor mayor a cero', true);
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
    recargarVistaModulo('viajes');
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
    return '<span class="tenue">—</span>';
  }
  const { neto, conIVA } = calcularMontosViaje(fila);
  const sinIva = fila.modo_facturacion === 'SIN_FACTURAR';
  const total = sinIva ? neto : conIVA;
  const detalle = sinIva ? 'sin IVA'
    : fila.modo_facturacion === 'FACTURA' ? 'factura electrónica'
    : 'líquido producto, IVA incluido';
  return `<strong>${fmtDinero(total)}</strong><br><span class="tenue">${detalle}</span>`;
}

let _datosViajeFacturar = null;
function abrirModalFacturarViaje(datos) {
  _datosViajeFacturar = datos;
  const { base, comision, neto, conIVA } = calcularMontosViaje(datos);
  // La factura A solo se ofrece si la facturación está habilitada en el sistema.
  const conFactura = moduloActivo('facturacion');
  const filaComision = comision > 0
    ? `<tr><td>Comisión (${fmtNum(comision)} %)</td><td class="num">− ${fmtDinero(base - neto)}</td></tr>`
    : '';

  $('#modal-titulo').textContent = 'Facturar viaje';
  $('#modal-cuerpo').innerHTML = `
    <p>Elegí cómo imputar este viaje en la cuenta del cliente <strong>${esc(datos.pagador || '')}</strong>.</p>
    <div class="tabla-marco"><table class="tabla">
      <tbody>
        <tr><td>Base del viaje</td><td class="num">${fmtDinero(base)}</td></tr>
        ${filaComision}
        <tr><td class="fuerte">Neto (a cobrar)</td><td class="num fuerte">${fmtDinero(neto)}</td></tr>
        <tr><td>+ IVA 21 %</td><td class="num">${fmtDinero(conIVA - neto)}</td></tr>
      </tbody>
      <tfoot><tr><td>Total con IVA</td><td class="num">${fmtDinero(conIVA)}</td></tr></tfoot>
    </table></div>
    <div class="grupo-titulo"></div>
    <div class="acciones">
      ${conFactura ? `<button class="btn btn-primario" onclick="confirmarFacturarViaje('COMPROBANTE')">Armar factura electrónica…</button>` : ''}
      <button class="btn ${conFactura ? '' : 'btn-primario'}" onclick="confirmarFacturarViaje('LIQUIDO_PRODUCTO')">Facturar líquido producto con IVA, ${fmtDinero(conIVA)}</button>
      <button class="btn" onclick="confirmarFacturarViaje('SIN_FACTURAR')">Continuar sin facturar ni IVA, ${fmtDinero(neto)}</button>
    </div>
    <p class="tenue">
      ${conFactura ? '<strong>Factura electrónica</strong> deja el viaje finalizado y abre el facturador con este viaje (podés sumar otros del mismo cliente); al emitir, el viaje pasa a facturado y el total se imputa en la cuenta.' : ''}
      <strong>Líquido producto</strong> imputa el total con IVA sin emitir comprobante.
      <strong>Sin facturar</strong> imputa solo el neto, sin IVA.
    </p>`;
  $('#btn-guardar').hidden = true;
  $('#btn-cancelar').hidden = false;
  abrirModalGenerico();
}

async function confirmarFacturarViaje(modo) {
  if (!_datosViajeFacturar) return;
  // Factura electrónica: el viaje queda FINALIZADO y se arma el comprobante
  // en el facturador; al emitirlo, el viaje pasa a FACTURADO.
  const datos = modo === 'COMPROBANTE'
    ? { ..._datosViajeFacturar, estado: 'FINALIZADO', modo_facturacion: null }
    : { ..._datosViajeFacturar, modo_facturacion: modo };

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

    if (modo === 'COMPROBANTE') {
      _datosViajeFacturar = null;
      cerrarModal();
      if (idViaje) facturarViajeConComprobante(Number(idViaje), datos.pagador);
      else mostrarToast('Viaje guardado como finalizado. Armá la factura desde Facturación.');
      return;
    } else if (modo === 'LIQUIDO_PRODUCTO') {
      mostrarToast('Viaje imputado con IVA (líquido producto)');
    } else {
      mostrarToast('Viaje imputado sin IVA');
    }

    _datosViajeFacturar = null;
    cerrarModal();
    recargarVistaModulo(moduloActual);
  } catch (err) {
    mostrarToast(err.message, true);
  }
}
