// frontend/js/app.js - Arranque de la SPA del ERP.
// El resto de la lógica está repartido en nucleo/ y vistas/ (ver index.html
// para el orden de carga). Este archivo va último: aplica el tema y revalida
// la sesión guardada o muestra el login.

// ============================================================
// Arranque: revalidar token guardado o pedir login
// ============================================================
async function arrancar() {
  // Aplicar el último tema usado de inmediato (evita parpadeo antes de
  // revalidar la sesión); luego se confirma con el del usuario.
  aplicarTema(localStorage.getItem('erp_tema') || 'tcv');
  const token = API.cargarToken();
  if (!token) { mostrarLogin(); return; }
  // Empresa elegida por un ADMIN_MULTIEMPRESA en esta pestaña: tiene que
  // cargarse antes de API.yo() para que la cabecera viaje en ese primer pedido.
  API.cargarEmpresaContexto();
  try {
    const { usuario } = await API.yo();
    aplicarSesion(usuario);
  } catch {
    API.setToken(null);
    mostrarLogin();
  }
}

arrancar();
