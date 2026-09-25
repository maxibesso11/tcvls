// frontend/js/vistas/stock.js
// Stock: mover todo el contenido de un depósito a otro.
// Las funciones son globales a propósito: las usan los onclick="..." del HTML
// generado y los demás archivos. El orden de carga está en index.html.

// ============================================================
// Mover depósito: reasigna todo el stock de un depósito a otro
// ============================================================
let modoMoverDeposito = null; // clave del módulo activo o null

async function abrirModalMoverDeposito(clave) {
  modoMoverDeposito = clave;
  $('#modal-titulo').textContent = 'Mover depósito';

  let depositos = [];
  try { depositos = await API.depositos(); }
  catch (err) { mostrarToast(err.message, true); return; }

  if (depositos.length === 0) {
    mostrarToast('No hay depósitos con elementos para mover', true);
    modoMoverDeposito = null;
    return;
  }

  const opciones = depositos.map(d =>
    `<option value="${String(d.deposito).replace(/"/g, '&quot;')}">${d.deposito} (${d.elementos} elem. · ${fmtDinero(d.valuacion_total)})</option>`
  ).join('');

  $('#modal-cuerpo').innerHTML = `
    <div class="campo ancho-completo">
      <label for="md-origen">Depósito de origen *</label>
      <select id="md-origen">${opciones}</select>
    </div>
    <div class="campo ancho-completo">
      <label for="md-destino">Depósito de destino *</label>
      <input id="md-destino" type="text" maxlength="100" list="md-lista-destinos" placeholder="Existente o nuevo (ej: Equipo #2 · AD789GH)">
      <datalist id="md-lista-destinos">
        ${depositos.map(d => `<option value="${String(d.deposito).replace(/"/g, '&quot;')}"></option>`).join('')}
      </datalist>
    </div>
    <div class="campo ancho-completo" style="font-size:13px;color:var(--texto-suave)">
      Se moverán <strong>todos</strong> los elementos del depósito de origen al de destino en una sola operación.
    </div>
  `;

  $('#modal-fondo').hidden = false;
}

async function guardarMoverDeposito() {
  const origen = $('#md-origen').value;
  const destino = $('#md-destino').value.trim();

  if (!destino) { mostrarToast('Indica el depósito de destino', true); return; }
  if (origen === destino) { mostrarToast('El origen y el destino no pueden ser iguales', true); return; }

  try {
    const resp = await API.moverDeposito(origen, destino);
    mostrarToast(resp.mensaje);
    const clave = modoMoverDeposito;
    cerrarModal();
    renderModulo(clave); // recarga vista y repuebla el selector de depósitos
  } catch (err) {
    mostrarToast(err.message, true);
  }
}
