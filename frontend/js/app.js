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
  aplicarTema(localStorage.getItem('erp_tema') || 'verde');
  const token = API.cargarToken();
  if (!token) { mostrarLogin(); return; }
  try {
    const { usuario } = await API.yo();
    aplicarSesion(usuario);
  } catch {
    API.setToken(null);
    mostrarLogin();
  }
}

arrancar();
