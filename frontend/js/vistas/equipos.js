// frontend/js/vistas/equipos.js
// Historial de composición de un equipo: qué camión, acoplado y chofer tuvo
// y desde/hasta cuándo, con los viajes hechos en cada período. Permite
// corregir la fecha en que empezó un período (cambio cargado días después):
// el servidor recalcula los viajes y las liquidaciones afectadas.

// "2026-09-14 18:30:00" → "14/09/2026 18:30"
const fmtFechaHora = f => (f ? `${fmtFecha(f)} ${String(f).slice(11, 16)}` : '');

async function verHistorialEquipo(idEquipo) {
  $('#modal-titulo').textContent = `Historial del equipo #${idEquipo}`;
  $('#modal-cuerpo').innerHTML = '<div class="vacio">Cargando historial…</div>';
  $('#btn-guardar').hidden = true;
  $('#modal-fondo').hidden = false;

  let periodos;
  try { periodos = await API.historialEquipo(idEquipo); }
  catch (err) { $('#modal-cuerpo').innerHTML = `<div class="vacio">Error: ${esc(err.message)}</div>`; return; }

  $('#modal-cuerpo').innerHTML = `
    <p class="tenue">
      Cada fila es un período con el mismo camión, acoplado y chofer. Si un cambio se
      cargó tarde, corregí la fecha en que empezó: los viajes y las liquidaciones de esas
      fechas se recalculan solos.
    </p>
    <div class="tabla-marco"><table class="tabla">
      <thead><tr><th>Desde</th><th>Hasta</th><th>Camión</th><th>Acoplado</th><th>Chofer</th><th class="num">Viajes</th><th></th></tr></thead>
      <tbody>
      ${periodos.map(p => `<tr>
        <td>${p.desde ? fmtFechaHora(p.desde) : 'Alta del equipo'}</td>
        <td>${p.hasta ? fmtFechaHora(p.hasta) : insignia('Actual', 'ok')}</td>
        <td>${patenteHTML(p.patente_principal)}<br><span class="tenue">${esc(p.modelo_principal || '')}</span></td>
        <td>${patenteHTML(p.patente_secundaria)}</td>
        <td>${esc(p.chofer)}</td>
        <td class="num">${Number(p.viajes)}</td>
        <td>${p.desde
          ? `<div class="campo"><input type="datetime-local" id="desde-${p.id_historial}" aria-label="Fecha de inicio del período" value="${esc(String(p.desde).slice(0, 16).replace(' ', 'T'))}">
             <button class="btn btn-chico" onclick="guardarInicioPeriodo(${p.id_historial}, ${idEquipo})">Corregir fecha</button></div>`
          : ''}</td>
      </tr>`).join('')}
      </tbody>
    </table></div>`;
}

async function guardarInicioPeriodo(idHistorial, idEquipo) {
  const valor = $(`#desde-${idHistorial}`)?.value;
  if (!valor) { mostrarToast('Indicá la fecha y hora del cambio', true); return; }
  if (!await confirmar('Se recalculan los viajes y liquidaciones de esas fechas.', 'Corregir fecha', '¿Corregir la fecha de este cambio?')) return;
  try {
    const r = await API.moverInicioPeriodo(idHistorial, valor.replace('T', ' ') + ':00');
    mostrarToast(`Fecha corregida · ${r.viajes_actualizados} viaje(s) actualizado(s)`);
    verHistorialEquipo(idEquipo);
  } catch (err) {
    mostrarToast(err.message, true);
  }
}
