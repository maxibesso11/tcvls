// frontend/js/vistas/solicitudes.js
// Solicitudes del formulario de contacto de la landing (administrador de
// plataforma): quién pidió asesoría o una demostración, con su estado.
// Las funciones son globales a propósito: las usan los onclick="..." del HTML
// generado. El orden de carga está en index.html.

let _solFiltro = 'NUEVA';
const SOL_ESTADO = { NUEVA: ['Nueva', 'aviso'], CONTACTADA: ['Contactada', 'ok'], DESCARTADA: ['Descartada', ''] };

async function renderAdminSolicitudes() {
  contenido.innerHTML = `
    <div class="vista-cab">
      <div>
        <h1>Solicitudes de contacto</h1>
        <p>Pedidos de asesoría o de demostración que llegan desde el sitio.</p>
      </div>
      <div class="acciones"><button class="btn" onclick="renderAdminSolicitudes()">Actualizar</button></div>
    </div>
    <div class="filtros">
      <div class="segmentado" role="group" aria-label="Estado">
        ${[['NUEVA', 'Nuevas'], ['CONTACTADA', 'Contactadas'], ['DESCARTADA', 'Descartadas'], ['', 'Todas']].map(([v, t]) =>
          `<button type="button" aria-pressed="${_solFiltro === v}" onclick="_solFiltro='${v}'; renderAdminSolicitudes()">${t}</button>`).join('')}
      </div>
    </div>
    <section class="hoja" id="sol-lista"><div class="vacio">Cargando…</div></section>`;
  cargarSolicitudes(1);
}

async function cargarSolicitudes(pagina) {
  try {
    const { datos, paginacion } = await API.adminSolicitudes(pagina, _solFiltro);
    if (!datos.length) {
      $('#sol-lista').innerHTML = `<div class="vacio">${_solFiltro === 'NUEVA' ? 'No hay solicitudes nuevas.' : 'No hay solicitudes en este estado.'}</div>`;
      return;
    }
    $('#sol-lista').innerHTML = tablaSimple(['Fecha', 'Persona', 'Contacto', 'Mensaje', 'Estado', ''], datos.map(s => {
      const [texto, clase] = SOL_ESTADO[s.estado] || [s.estado, ''];
      return [
        `<td class="nowrap">${fmtFecha(s.fecha)} ${String(s.fecha).slice(11, 16)}</td>`,
        `<div class="celda-doble"><b>${esc(s.nombre)}</b><span>${esc(s.empresa)}</span></div>`,
        `<div class="celda-doble"><b><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></b><span>${esc(s.telefono)}</span></div>`,
        s.mensaje ? esc(s.mensaje) : '<span class="tenue">Sin mensaje</span>',
        `${insignia(texto, clase)}${s.avisada_por_correo ? '<br><span class="tenue">avisada por correo</span>' : ''}`,
        `<td class="num nowrap"><span class="acciones-fila">
          ${s.estado !== 'CONTACTADA' ? `<button class="btn btn-chico" onclick="marcarSolicitud(${s.id_solicitud}, 'CONTACTADA')">Contactada</button>` : ''}
          ${s.estado !== 'DESCARTADA' ? `<button class="btn btn-chico" onclick="marcarSolicitud(${s.id_solicitud}, 'DESCARTADA')">Descartar</button>` : ''}
          ${s.estado !== 'NUEVA' ? `<button class="btn btn-chico" onclick="marcarSolicitud(${s.id_solicitud}, 'NUEVA')">Volver a nueva</button>` : ''}
          <button class="btn btn-chico btn-fantasma btn-icono" title="Eliminar" aria-label="Eliminar solicitud" onclick="eliminarSolicitud(${s.id_solicitud})">${icono('borrar')}</button>
        </span></td>`
      ];
    })) + controlesPaginacion(paginacion, p => cargarSolicitudes(p));
  } catch (err) {
    $('#sol-lista').innerHTML = `<div class="vacio">Error: ${esc(err.message)}</div>`;
  }
}

async function marcarSolicitud(id, estado) {
  try {
    await API.adminMarcarSolicitud(id, estado);
    cargarSolicitudes(1);
  } catch (err) { mostrarToast(err.message, true); }
}

async function eliminarSolicitud(id) {
  if (!await confirmar('Se borran los datos de contacto de esta persona. No se puede deshacer.', 'Eliminar', '¿Eliminar la solicitud?')) return;
  try {
    await API.adminEliminarSolicitud(id);
    mostrarToast('Solicitud eliminada.');
    cargarSolicitudes(1);
  } catch (err) { mostrarToast(err.message, true); }
}
