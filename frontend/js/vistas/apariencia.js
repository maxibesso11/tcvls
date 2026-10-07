// frontend/js/vistas/apariencia.js
// Apariencia: selección del tema de color del usuario, en un modal que se abre
// desde el menú del avatar. Las funciones son globales a propósito: las usan
// los onclick="..." del HTML generado. El orden de carga está en index.html.

function abrirApariencia() {
  const actual = (SESION && SESION.tema) || localStorage.getItem('erp_tema') || 'tcv';
  $('#modal-titulo').textContent = 'Apariencia';
  $('#modal-cuerpo').innerHTML = `
    <p class="tenue">Elegí el tema de color del sistema. Tu elección se guarda en tu cuenta y solo cambia el rail y el acento.</p>
    <div class="temas" id="temas-grilla">
      ${TEMAS.map(t => `
        <button class="tema" aria-pressed="${t.id === actual}" data-tema-id="${t.id}">
          <div class="tema-muestra" style="background:${t.rail}">
            <i style="background:${t.acento}"></i><i style="background:${t.rail2}"></i>
          </div>
          <b>${t.nombre}</b>
          ${t.id === actual ? '<span class="insignia ok">EN USO</span>' : ''}
        </button>
      `).join('')}
    </div>
  `;
  $('#btn-guardar').hidden = true; // los cambios se aplican al elegir
  $('#modal-fondo').hidden = false;

  document.querySelectorAll('#temas-grilla .tema').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.temaId;
      aplicarTema(id); // aplica al instante
      abrirApariencia(); // refleja la selección
      try {
        await API.guardarTema(id); // persiste en la cuenta
        mostrarToast('Apariencia actualizada.');
      } catch (err) {
        mostrarToast('No se pudo guardar la preferencia: ' + err.message, true);
      }
    });
  });
}
