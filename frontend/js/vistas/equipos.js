// frontend/js/vistas/equipos.js
// Historial de composición de un equipo: qué camión, acoplado y chofer tuvo
// y desde/hasta cuándo, con los viajes hechos en cada período. Permite
// corregir la fecha en que empezó un período (cambio cargado días después):
// el servidor recalcula los viajes y las liquidaciones afectadas.

// "2026-09-14 18:30:00" → "14/09/2026 18:30"
const fmtFechaHora = f => (f ? `${fmtFecha(f)} ${String(f).slice(11, 16)}` : '');

async function verHistorialEquipo(idEquipo) {
  $('#modal-titulo').textContent = `Historial del equipo #${idEquipo}`;
  $('#modal-cuerpo').innerHTML = '<div class="estado-vacio">Cargando historial…</div>';
  $('#btn-guardar').style.display = 'none';
  $('#modal-fondo').hidden = false;

  let periodos;
  try { periodos = await API.historialEquipo(idEquipo); }
  catch (err) { $('#modal-cuerpo').innerHTML = `<div class="estado-vacio">Error: ${esc(err.message)}</div>`; return; }

  $('#modal-cuerpo').innerHTML = `
    <div class="ancho-completo">
      <p class="campo-ayuda" style="margin:0 0 10px">
        Cada fila es un período con el mismo camión, acoplado y chofer. Si un cambio se
        cargó tarde, corregí la fecha en que empezó: los viajes y las liquidaciones de esas
        fechas se recalculan solos.
      </p>
      <div class="tabla-contenedor"><table>
        <thead><tr><th>Desde</th><th>Hasta</th><th>Camión</th><th>Acoplado</th><th>Chofer</th><th>Viajes</th><th></th></tr></thead>
        <tbody>
        ${periodos.map(p => `<tr>
          <td>${p.desde ? fmtFechaHora(p.desde) : 'Alta del equipo'}</td>
          <td>${p.hasta ? fmtFechaHora(p.hasta) : '<span class="insignia verde">Actual</span>'}</td>
          <td>${esc(p.patente_principal)}<br><span class="filtro-label">${esc(p.modelo_principal || '')}</span></td>
          <td>${esc(p.patente_secundaria)}</td>
          <td>${esc(p.chofer)}</td>
          <td class="celda-num">${Number(p.viajes)}</td>
          <td>${p.desde
            ? `<input type="datetime-local" id="desde-${p.id_historial}" value="${esc(String(p.desde).slice(0, 16).replace(' ', 'T'))}" style="max-width:190px">
               <button class="btn btn-secundario btn-mini" onclick="guardarInicioPeriodo(${p.id_historial}, ${idEquipo})">Corregir fecha</button>`
            : ''}</td>
        </tr>`).join('')}
        </tbody>
      </table></div>
    </div>`;
}

async function guardarInicioPeriodo(idHistorial, idEquipo) {
  const valor = $(`#desde-${idHistorial}`)?.value;
  if (!valor) { mostrarToast('Indicá la fecha y hora del cambio', true); return; }
  if (!confirm('¿Corregir la fecha de este cambio? Se recalculan los viajes y liquidaciones de esas fechas.')) return;
  try {
    const r = await API.moverInicioPeriodo(idHistorial, valor.replace('T', ' ') + ':00');
    mostrarToast(`Fecha corregida · ${r.viajes_actualizados} viaje(s) actualizado(s)`);
    verHistorialEquipo(idEquipo);
  } catch (err) {
    mostrarToast(err.message, true);
  }
}
