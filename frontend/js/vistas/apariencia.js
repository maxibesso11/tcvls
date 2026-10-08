// frontend/js/vistas/apariencia.js
// Apariencia: selección del tema de color del usuario, en un modal que se abre
// desde el menú del avatar. Las funciones son globales a propósito: las usan
// los onclick="..." del HTML generado. El orden de carga está en index.html.

function abrirApariencia() {
  const actual = (SESION && SESION.tema) || localStorage.getItem('erp_tema') || 'tcv';
  $('#modal-titulo').textContent = 'Apariencia';
  $('#modal-cuerpo').innerHTML = `
    <p class="tenue">Elegí los colores del menú lateral y de los botones. Tu elección queda guardada en tu cuenta.</p>
    <div class="temas" id="temas-grilla" role="radiogroup" aria-label="Tema de color">
      ${TEMAS.map(t => `
        <button class="tema" role="radio" aria-checked="${t.id === actual}" aria-pressed="${t.id === actual}" data-tema-id="${t.id}">
          <span class="tema-muestra" aria-hidden="true">
            <span class="tema-rail" style="background:${t.rail}"><i style="background:${t.acento}"></i><i></i><i></i><i></i></span>
            <span class="tema-hoja"><i></i><i></i><b style="background:${t.acento}"></b></span>
          </span>
          <span class="tema-pie"><b>${t.nombre}</b>${t.id === 'tcv' ? '<small>Predeterminado</small>' : ''}</span>
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
