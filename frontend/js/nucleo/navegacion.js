// frontend/js/nucleo/navegacion.js
// Navegación por hash (#vista) y menú lateral en móvil.
// Las funciones son globales a propósito: las usan los onclick="..." del HTML
// generado y los demás archivos. El orden de carga está en index.html.

// ============================================================
// Navegación
// ============================================================
function navegar() {
  const hash = location.hash.replace('#', '') || 'dashboard';
  // Las cubiertas (ruedas) se gestionan desde la ficha de cada unidad
  if (hash === 'cubiertas') { location.hash = 'unidades'; return; }
  document.querySelectorAll('.rail a[data-vista]').forEach(a => {
    let vistaActiva = hash;
    if (hash.startsWith('cuenta-corriente/')) vistaActiva = 'cuentas-corrientes';
    else if (hash.startsWith('metrica/')) vistaActiva = 'dashboard';
    else if (hash.startsWith('unidad-detalle/')) vistaActiva = 'unidades';
    else if (hash.startsWith('chofer-detalle/')) vistaActiva = 'choferes';
    else if (hash.startsWith('facturador')) vistaActiva = 'facturacion';
    if (a.dataset.vista === vistaActiva) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (typeof cerrarMenu === 'function') cerrarMenu();
  // Bloquear acceso directo (por URL) a módulos desactivados para la empresa
  let claveModulo = hash;
  if (hash.startsWith('cuenta-corriente/')) claveModulo = 'cuentas-corrientes';
  else if (hash.startsWith('unidad-detalle/')) claveModulo = 'unidades';
  else if (hash.startsWith('chofer-detalle/')) claveModulo = 'choferes';
  else if (hash.startsWith('facturador')) claveModulo = 'facturacion';

  if (!esVistaAdmin(hash) && !moduloActivo(claveModulo) && (MODULOS[hash] || claveModulo === 'cuentas-corrientes' || claveModulo === 'unidades' || claveModulo === 'choferes' || claveModulo === 'facturacion')) {
    mostrarToast('Ese módulo no está habilitado para tu empresa.', true);
    location.hash = 'dashboard';
    return;
  }
  // El panel de administración global es solo del ADMIN (acceso directo por URL)
  if (hash.startsWith('admin') && (!SESION || SESION.rol !== 'ADMIN')) {
    location.hash = 'dashboard';
    return;
  }
  // "Mi empresa" es exclusivo del ADMIN_EMPRESA (acceso directo por URL)
  if (hash.startsWith('mi-empresa') && (!SESION || SESION.rol !== 'ADMIN_EMPRESA')) {
    location.hash = 'dashboard';
    return;
  }
  // "Mi multiempresa" es exclusivo del ADMIN_MULTIEMPRESA (acceso directo por URL)
  if (hash.startsWith('multiempresa') && (!SESION || SESION.rol !== 'ADMIN_MULTIEMPRESA')) {
    location.hash = 'dashboard';
    return;
  }
  if (hash === 'mi-perfil') renderMiPerfil();
  else if (hash.startsWith('chofer-detalle/')) renderChoferDetalle(hash.split('/')[1]);
  else if (hash === 'admin-empresas') renderAdminEmpresas();
  else if (hash === 'admin-usuarios') renderAdminUsuarios();
  else if (hash === 'admin-certificados') renderAdminCertificados();
  else if (hash === 'admin-logs') renderAdminLogs();
  else if (hash === 'admin-actividad') renderAdminActividad();
  else if (hash === 'mi-empresa-actividad') renderMiEmpresaActividad();
  else if (hash === 'multiempresa-actividad') renderMultiempresaActividad();
  else if (hash === 'admin-respaldos') renderAdminRespaldos();
  else if (hash === 'mi-empresa-usuarios') renderMiEmpresaUsuarios();
  else if (hash === 'mi-empresa-certificado') renderMiEmpresaCertificado();
  else if (hash === 'mi-empresa-datos-fiscales') renderMiEmpresaDatosFiscales();
  else if (hash === 'multiempresa-usuarios') renderMultiempresaUsuarios();
  else if (hash === 'multiempresa-certificado') renderMultiempresaCertificado();
  else if (hash === 'multiempresa-datos-fiscales') renderMultiempresaDatosFiscales();
  else if (hash === 'dashboard') renderDashboard();
  else if (hash === 'alertas') renderAlertas();
  else if (hash === 'unidades') renderUnidades();
  else if (hash.startsWith('unidad-detalle/')) renderUnidadDetalle(hash.split('/')[1]);
  else if (hash.startsWith('metrica/')) renderMetricaDetalle(hash.split('/')[1]);
  else if (hash === 'cuentas-corrientes') renderCuentasCorrientes();
  else if (hash === 'facturacion') renderFacturacion();
  else if (hash === 'facturador') renderFacturador(null);
  else if (hash.startsWith('facturador/')) renderFacturador(hash.split('/')[1]);
  else if (hash.startsWith('cuenta-corriente/')) renderDetalleCuenta(hash.split('/')[1]);
  else if (MODULOS[hash]) renderModulo(hash);
  else if (SESION && SESION.rol === 'ADMIN') renderAdminEmpresas();
  else renderDashboard();
}

function esVistaAdmin(hash) {
  return hash.startsWith('admin') || hash.startsWith('mi-empresa') || hash.startsWith('multiempresa') || hash === 'apariencia' || hash === 'mi-perfil' || hash === 'dashboard' || hash === 'alertas' || hash.startsWith('metrica/');
}

window.addEventListener('hashchange', navegar);
// Controles del rail:
//   · escritorio (>900px): la pestaña del borde del menú (#btn-colapsar) lo
//     colapsa a una franja de íconos (64px) y lo vuelve a expandir; la
//     elección se recuerda en este navegador.
//   · móvil (≤900px): el rail es un cajón que abre el botón ☰ de la barra
//     superior; se cierra tocando fuera del rail o con la tecla Escape.
const appEl = $('#app-contenedor');
function abrirMenu() { appEl.classList.add('menu-abierto'); }
function cerrarMenu() { appEl.classList.remove('menu-abierto'); }
function aplicarRailCompacto(compacto, guardar = true) {
  appEl.classList.toggle('rail-compacto', compacto);
  const btn = $('#btn-colapsar');
  btn.setAttribute('aria-expanded', String(!compacto));
  btn.setAttribute('title', compacto ? 'Expandir menú' : 'Colapsar menú');
  btn.setAttribute('aria-label', compacto ? 'Expandir menú' : 'Colapsar menú');
  if (guardar) { try { localStorage.setItem('erp_rail_compacto', compacto ? '1' : '0'); } catch (e) {} }
}
// Con el rail colapsado solo se ven los íconos: el nombre aparece al pasar el mouse.
document.querySelectorAll('#rail a').forEach(a => { if (!a.title) a.title = a.textContent.trim(); });
try { aplicarRailCompacto(localStorage.getItem('erp_rail_compacto') === '1', false); } catch (e) {}

$('#btn-menu').addEventListener('click', () => {
  if (appEl.classList.contains('menu-abierto')) cerrarMenu(); else abrirMenu();
});
$('#btn-colapsar').addEventListener('click', () => {
  aplicarRailCompacto(!appEl.classList.contains('rail-compacto'));
});
document.querySelector('.principal').addEventListener('click', e => {
  if (appEl.classList.contains('menu-abierto') && !e.target.closest('#btn-menu')) cerrarMenu();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && appEl.classList.contains('menu-abierto')) cerrarMenu();
});
