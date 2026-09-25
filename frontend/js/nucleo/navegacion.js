// frontend/js/nucleo/navegacion.js
// Navegación por hash (#vista) y menú lateral en móvil.
// Las funciones son globales a propósito: las usan los onclick="..." del HTML
// generado y los demás archivos. El orden de carga está en index.html.

// ============================================================
// Navegación
// ============================================================
function navegar() {
  const hash = location.hash.replace('#', '') || 'dashboard';
  document.querySelectorAll('.nav-link').forEach(a => {
    let vistaActiva = hash;
    if (hash.startsWith('cuenta-corriente/')) vistaActiva = 'cuentas-corrientes';
    else if (hash.startsWith('metrica/')) vistaActiva = 'dashboard';
    a.classList.toggle('activo', a.dataset.vista === vistaActiva);
  });
  if (typeof cerrarSidebar === 'function') cerrarSidebar();
  // Bloquear acceso directo (por URL) a módulos desactivados para la empresa
  const claveModulo = hash.startsWith('cuenta-corriente/') ? 'cuentas-corrientes' : hash;
  if (!esVistaAdmin(hash) && !moduloActivo(claveModulo) && (MODULOS[hash] || claveModulo === 'cuentas-corrientes' || claveModulo === 'facturacion')) {
    mostrarToast('Ese módulo no está habilitado para tu empresa.', true);
    location.hash = 'dashboard';
    return;
  }
  if (hash === 'apariencia') renderApariencia();
  else if (hash === 'admin-empresas') renderAdminEmpresas();
  else if (hash === 'admin-usuarios') renderAdminUsuarios();
  else if (hash === 'dashboard') renderDashboard();
  else if (hash === 'alertas') renderAlertas();
  else if (hash.startsWith('metrica/')) renderMetricaDetalle(hash.split('/')[1]);
  else if (hash === 'cuentas-corrientes') renderCuentasCorrientes();
  else if (hash === 'facturacion') renderFacturacion();
  else if (hash.startsWith('cuenta-corriente/')) renderDetalleCuenta(hash.split('/')[1]);
  else if (MODULOS[hash]) renderModulo(hash);
  else if (SESION && SESION.rol === 'ADMIN') renderAdminEmpresas();
  else renderDashboard();
}

function esVistaAdmin(hash) {
  return hash.startsWith('admin') || hash === 'apariencia' || hash === 'dashboard' || hash === 'alertas' || hash.startsWith('metrica/');
}

window.addEventListener('hashchange', navegar);
// Controles del sidebar en móvil: abrir, cerrar con botón ✕,
// cerrar tocando el overlay y cerrar con la tecla Escape
function abrirSidebar() {
  $('#sidebar').classList.add('abierta');
  $('#sidebar-overlay').hidden = false;
}
function cerrarSidebar() {
  $('#sidebar').classList.remove('abierta');
  $('#sidebar-overlay').hidden = true;
}

$('#btn-menu').addEventListener('click', abrirSidebar);
$('#btn-cerrar-sidebar').addEventListener('click', cerrarSidebar);
$('#sidebar-overlay').addEventListener('click', cerrarSidebar);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('#sidebar').classList.contains('abierta')) cerrarSidebar();
});
