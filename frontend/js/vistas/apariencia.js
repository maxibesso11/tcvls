// frontend/js/vistas/apariencia.js
// Vista Apariencia: selección del tema de color del usuario.
// Las funciones son globales a propósito: las usan los onclick="..." del HTML
// generado y los demás archivos. El orden de carga está en index.html.

// ============================================================
// Apariencia: selección de tema de color por usuario
// ============================================================
async function renderApariencia() {
  const actual = (SESION && SESION.tema) || localStorage.getItem('erp_tema') || 'verde';
  contenido.innerHTML = `
    <div class="vista-cabecera">
      <div>
        <div class="vista-titulo">Apariencia</div>
        <div class="vista-sub">Elige el tema de color del sistema. Tu elección se guarda en tu cuenta.</div>
      </div>
    </div>
    <div class="temas-grilla" id="temas-grilla">
      ${TEMAS.map(t => `
        <button class="tema-tarjeta ${t.id === actual ? 'activo' : ''}" data-tema-id="${t.id}">
          <div class="tema-muestra" style="background:${t.sidebar}">
            <span class="tema-acento" style="background:${t.acento}"></span>
          </div>
          <div class="tema-nombre">${t.nombre}</div>
          ${t.id === actual ? '<div class="tema-check">✓ En uso</div>' : ''}
        </button>
      `).join('')}
    </div>
  `;

  document.querySelectorAll('.tema-tarjeta').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.temaId;
      aplicarTema(id);           // aplica al instante
      // Re-render para reflejar la selección
      renderApariencia();
      try {
        await API.guardarTema(id);   // persiste en la cuenta
        mostrarToast('Apariencia actualizada.');
      } catch (err) {
        mostrarToast('No se pudo guardar la preferencia: ' + err.message, true);
      }
    });
  });
}
