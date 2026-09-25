// frontend/js/nucleo/sesion.js
// Sesión: temas, login, cierre de sesión y módulos visibles según la empresa.
// Las funciones son globales a propósito: las usan los onclick="..." del HTML
// generado y los demás archivos. El orden de carga está en index.html.

// ============================================================
// Sesión y autenticación
// ============================================================
let SESION = null;

// Catálogo de temas disponibles (debe coincidir con el CSS y el backend)
const TEMAS = [
  { id: 'verde',    nombre: 'Verde pizarra', sidebar: '#1d2f29', acento: '#e8a13c' },
  { id: 'azul',     nombre: 'Azul noche',    sidebar: '#1a2940', acento: '#4f9dde' },
  { id: 'violeta',  nombre: 'Violeta',       sidebar: '#2f2046', acento: '#a779e0' },
  { id: 'borgona',  nombre: 'Borgoña',       sidebar: '#3c1d22', acento: '#d98f6b' },
  { id: 'grafito',  nombre: 'Grafito',       sidebar: '#292a2d', acento: '#d6a85c' },
  { id: 'oceano',   nombre: 'Océano',        sidebar: '#163b3f', acento: '#3bb3a8' },
  { id: 'indigo',   nombre: 'Índigo',        sidebar: '#25264f', acento: '#7c83f8' },
  { id: 'esmeralda',nombre: 'Esmeralda',     sidebar: '#133d2e', acento: '#2ecc8f' },
  { id: 'cobre',    nombre: 'Cobre',         sidebar: '#3d271b', acento: '#e08a4b' },
  { id: 'rosa',     nombre: 'Rosa',          sidebar: '#421d33', acento: '#e06b9e' },
  { id: 'slate',    nombre: 'Pizarra azul',  sidebar: '#21282f', acento: '#6aa0c8' },
  { id: 'bosque',   nombre: 'Bosque',        sidebar: '#1f3324', acento: '#9bc24a' }
];

// Aplica un tema al documento y lo cachea localmente (para evitar parpadeo
// en la próxima carga, antes de revalidar la sesión con el servidor).
function aplicarTema(tema) {
  const valido = TEMAS.some(t => t.id === tema) ? tema : 'verde';
  document.documentElement.dataset.tema = valido;
  localStorage.setItem('erp_tema', valido);
  if (SESION) SESION.tema = valido;
}

function mostrarLogin() {
  $('#login-pantalla').hidden = false;
  $('#app-contenedor').hidden = true;
}

function mostrarApp() {
  $('#login-pantalla').hidden = true;
  $('#app-contenedor').hidden = false;
}

// Devuelve true si el módulo está activo para la empresa del usuario actual.
// El dashboard y la apariencia siempre están disponibles.
function moduloActivo(clave) {
  if (clave === 'dashboard' || clave === 'apariencia' || clave === 'alertas') return true;
  if (!SESION || SESION.rol === 'ADMIN') return true;
  const activos = SESION.modulos || [];
  return activos.includes(clave);
}

// Oculta del menú lateral los enlaces de módulos no activos, y las etiquetas
// de grupo (nav-group-label) que queden sin ningún enlace visible debajo.
function aplicarModulosVisibles(modulos) {
  const activos = new Set(modulos);
  // Mostrar/ocultar cada enlace con data-vista según corresponda
  document.querySelectorAll('#nav-datos .nav-link[data-vista]').forEach(a => {
    const vista = a.dataset.vista;
    const visible = vista === 'dashboard' || activos.has(vista);
    a.style.display = visible ? '' : 'none';
  });
  // Ocultar etiquetas de grupo que no tengan enlaces visibles a continuación
  document.querySelectorAll('#nav-datos .nav-group-label').forEach(label => {
    let hayVisible = false;
    let el = label.nextElementSibling;
    while (el && !el.classList.contains('nav-group-label')) {
      if (el.classList.contains('nav-link') && el.style.display !== 'none') {
        hayVisible = true; break;
      }
      el = el.nextElementSibling;
    }
    label.style.display = hayVisible ? '' : 'none';
  });
}

function aplicarSesion(usuario) {
  SESION = usuario;
  // Apariencia elegida por el usuario
  aplicarTema(usuario.tema || 'verde');
  const esAdmin = usuario.rol === 'ADMIN';
  // Iniciales del logo: las de la empresa, o derivadas del nombre, o "AD" para el admin
  let iniciales;
  if (esAdmin) {
    iniciales = 'AD';
  } else if (usuario.iniciales_empresa) {
    iniciales = usuario.iniciales_empresa;
  } else {
    iniciales = derivarIniciales(usuario.nombre_empresa);
  }
  $('#brand-iniciales').textContent = iniciales;
  // Nombre y rol en el pie del sidebar
  $('#usuario-nombre').textContent = usuario.nombre_usuario;
  $('#usuario-rol').textContent = usuario.rol === 'ADMIN' ? 'Administrador' : (usuario.nombre_empresa || 'Usuario');
  $('#brand-empresa').textContent = usuario.rol === 'ADMIN' ? 'Administración' : (usuario.nombre_empresa || 'Empresa');
  $('#topbar-title').textContent = usuario.rol === 'ADMIN' ? 'Administración global' : (usuario.nombre_empresa || 'Gestión de transporte');

  // Mostrar la navegación según el rol
  $('#nav-datos').hidden = esAdmin;
  $('#nav-admin').hidden = !esAdmin;

  // Aplicar la visibilidad de los módulos activos de la empresa
  aplicarModulosVisibles(usuario.modulos || []);

  mostrarApp();

  // Llevar a la vista inicial correspondiente al rol
  if (esAdmin) {
    if (!location.hash.startsWith('#admin')) location.hash = 'admin-empresas';
    else navegar();
  } else {
    if (location.hash.startsWith('#admin')) location.hash = 'dashboard';
    else navegar();
  }
}

async function iniciarSesion() {
  const usuario = $('#login-usuario').value.trim();
  const clave = $('#login-clave').value;
  const errorBox = $('#login-error');
  errorBox.hidden = true;
  if (!usuario || !clave) {
    errorBox.textContent = 'Ingresa usuario y contraseña.';
    errorBox.hidden = false;
    return;
  }
  try {
    const { token, usuario: datos } = await API.login(usuario, clave);
    API.setToken(token);
    $('#login-clave').value = '';
    aplicarSesion(datos);
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
  }
}

function cerrarSesion() {
  API.setToken(null);
  SESION = null;
  location.hash = '';
  mostrarLogin();
}

$('#login-btn').addEventListener('click', iniciarSesion);
$('#login-clave').addEventListener('keydown', e => { if (e.key === 'Enter') iniciarSesion(); });
$('#login-usuario').addEventListener('keydown', e => { if (e.key === 'Enter') $('#login-clave').focus(); });

// Mostrar/ocultar la contraseña en el login
$('#btn-ver-clave').addEventListener('click', () => {
  const input = $('#login-clave');
  const boton = $('#btn-ver-clave');
  const visible = input.type === 'text';
  input.type = visible ? 'password' : 'text';
  boton.setAttribute('aria-label', visible ? 'Mostrar contraseña' : 'Ocultar contraseña');
  boton.setAttribute('title', visible ? 'Mostrar contraseña' : 'Ocultar contraseña');
  // Cambiar el ícono: ojo abierto / ojo tachado
  $('#icono-ojo').innerHTML = visible
    ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>'
    : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>';
  input.focus();
});

$('#btn-salir').addEventListener('click', cerrarSesion);

// Si una petición devuelve 401, la sesión expiró
window.addEventListener('sesion-expirada', () => {
  SESION = null;
  mostrarLogin();
  mostrarToast('Tu sesión expiró. Inicia sesión nuevamente.', 'error');
});
