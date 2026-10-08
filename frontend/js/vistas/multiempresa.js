// frontend/js/vistas/multiempresa.js
// Panel "Mi multiempresa" (solo ADMIN_MULTIEMPRESA): usuarios, certificado
// ARCA y datos fiscales de la empresa que esté operando en cada momento,
// más el selector de empresa. Calco de vistas/miEmpresa.js apuntando a
// /api/multiempresa/*, con el agregado del selector (ADMIN_EMPRESA tiene una
// sola empresa fija; este rol elige entre varias). Las funciones son
// globales a propósito: las usan los onclick="..." del HTML generado y
// nucleo/sesion.js. El orden de carga está en index.html.

// ============================================================
// Selector de empresa
// ============================================================
// Se muestra en #multiempresa-selector-pantalla (ver nucleo/sesion.js,
// aplicarSesion) mientras el ADMIN_MULTIEMPRESA no eligió con cuál operar.
function renderSelectorEmpresaMultiempresa() {
  const empresas = (SESION && SESION.empresas_asignadas) || [];
  const lista = $('#multiempresa-selector-lista');
  if (empresas.length === 0) {
    lista.innerHTML = '<p class="campo error"><span class="ayuda">Todavía no tenés ninguna empresa asignada. Pedile al administrador que te asigne al menos una.</span></p>';
    return;
  }
  lista.innerHTML = `<div class="acciones">${empresas.map(e =>
    `<button class="btn btn-primario" onclick="elegirEmpresaMultiempresa(${e.id_empresa})">${esc(e.nombre)}</button>`
  ).join('')}</div>`;
}

async function elegirEmpresaMultiempresa(idEmpresa) {
  API.setEmpresaContexto(idEmpresa);
  try {
    const { usuario } = await API.yo();
    aplicarSesion(usuario);
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

// Vuelve al selector sin cerrar sesión (ej. desde "Cambiar empresa" del menú).
function cambiarEmpresaMultiempresa() {
  API.setEmpresaContexto(null);
  aplicarSesion({ ...SESION, id_empresa: null });
}

$('#nav-cambiar-empresa').addEventListener('click', e => {
  e.preventDefault();
  cambiarEmpresaMultiempresa();
});

// ============================================================
// Mi multiempresa · Usuarios
// ============================================================
let _usuariosMultiempresa = [];
async function renderMultiempresaUsuarios() {
  contenido.innerHTML = `
    <div class="vista-cab">
      <div>
        <h1>Usuarios</h1>
        <p>Accesos operativos de ${esc(SESION.nombre_empresa || 'esta empresa')}</p>
      </div>
      <div class="acciones"><button class="btn btn-primario" id="btn-nuevo-usuario-multiempresa">+ Nuevo usuario</button></div>
    </div>
    <section class="hoja" id="tabla-usuarios-multiempresa"><div class="vacio">Cargando…</div></section>
  `;
  $('#btn-nuevo-usuario-multiempresa').addEventListener('click', () => abrirModalUsuarioMultiempresa());
  try {
    const usuarios = _usuariosMultiempresa = await API.multiempresaListarUsuarios();
    if (usuarios.length === 0) {
      $('#tabla-usuarios-multiempresa').innerHTML = '<div class="vacio">Sin usuarios. Creá el primero con "+ Nuevo usuario".</div>';
      return;
    }
    const activos = usuarios.filter(u => u.activo).length;
    $('#tabla-usuarios-multiempresa').innerHTML = cabeceraTablaAdmin(`${usuarios.length} usuario${usuarios.length === 1 ? '' : 's'}`, `${activos} activo${activos === 1 ? '' : 's'}. Tocá una fila para editarlo`) + tablaSimple(
      ['Usuario', 'Rol', 'Estado'],
      usuarios.map(u => [
        celdaUsuario(u),
        insigniaRolUsuario(u.rol),
        u.activo ? insignia('Activo', 'ok') : insignia('Inactivo')
      ]),
      { clic: i => `abrirModalUsuarioMultiempresa(_usuariosMultiempresa[${i}])` }
    );
  } catch (err) {
    $('#tabla-usuarios-multiempresa').innerHTML = `<div class="vacio">Error: ${esc(err.message)}</div>`;
  }
}

function abrirModalUsuarioMultiempresa(usuario = null) {
  const ed = !!usuario;
  $('#modal-titulo').textContent = ed ? 'Editar usuario' : 'Nuevo usuario';
  $('#modal-cuerpo').innerHTML = `<div class="formulario">
    <div class="campo"><label for="um-nombre">Nombre de usuario *</label><input id="um-nombre" value="${ed ? esc(usuario.nombre_usuario) : ''}"></div>
    <div class="campo"><label for="um-clave">${ed ? 'Nueva contraseña (opcional)' : 'Contraseña *'}</label><input id="um-clave" type="password" placeholder="${ed ? 'dejar vacío para no cambiar' : 'mínimo 8 caracteres'}"><span class="ayuda">Es temporal: el usuario deberá cambiarla en su próximo ingreso.</span></div>
    <div class="campo ancho"><label for="um-correo">Correo electrónico</label><input id="um-correo" value="${ed && usuario.correo ? esc(usuario.correo) : ''}"></div>
    <div class="campo"><label for="um-rol">Rol</label><select id="um-rol">
      <option value="USUARIO" ${ed && usuario.rol === 'USUARIO' ? 'selected' : ''}>Usuario</option>
      <option value="ADMIN_EMPRESA" ${ed && usuario.rol === 'ADMIN_EMPRESA' ? 'selected' : ''}>Administrador de empresa</option>
    </select></div>
    ${ed ? `<div class="campo"><label for="um-activo">Estado</label><select id="um-activo"><option value="1" ${usuario.activo ? 'selected' : ''}>Activo</option><option value="0" ${!usuario.activo ? 'selected' : ''}>Inactivo</option></select></div>` : ''}
    ${ed ? bloqueAcciones([{ texto: 'Eliminar usuario', peligro: true, onclick: `eliminarUsuarioMultiempresa(${usuario.id_usuario}, ${jsArg(usuario.nombre_usuario)})` }]) : ''}
  </div>`;
  configurarGuardado(async () => {
    const datos = {
      nombre_usuario: $('#um-nombre').value.trim(),
      correo: $('#um-correo').value.trim(),
      rol: $('#um-rol').value
    };
    const clave = $('#um-clave').value;
    if (clave) datos.contrasena = clave;
    if (!datos.nombre_usuario) { mostrarToast('El nombre de usuario es obligatorio.', true); return false; }
    if (!ed && !clave) { mostrarToast('La contraseña es obligatoria.', true); return false; }
    try {
      if (ed) {
        datos.activo = $('#um-activo').value === '1';
        await API.multiempresaActualizarUsuario(usuario.id_usuario, datos);
      } else {
        await API.multiempresaCrearUsuario(datos);
      }
    } catch (err) {
      mostrarToast(err.message, true);
      return false;
    }
    mostrarToast(ed ? 'Usuario actualizado.' : 'Usuario creado.');
    renderMultiempresaUsuarios();
    return true;
  });
  abrirModalGenerico();
}

async function eliminarUsuarioMultiempresa(id, nombre) {
  if (!await confirmar('Esta acción no se puede deshacer.', 'Eliminar usuario', `¿Eliminar al usuario «${nombre}»?`)) return;
  try {
    await API.multiempresaEliminarUsuario(id);
    mostrarToast('Usuario eliminado.');
    renderMultiempresaUsuarios();
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

// ============================================================
// Mi multiempresa · Certificado ARCA
// ============================================================
async function renderMultiempresaCertificado() {
  contenido.innerHTML = `
    <div class="vista-cab">
      <div>
        <h1>Certificado ARCA</h1>
        <p>Certificado de facturación electrónica de ${esc(SESION.nombre_empresa || 'esta empresa')}</p>
      </div>
    </div>
    <section class="hoja" id="multiempresa-cert"><div class="vacio">Cargando…</div></section>
  `;
  await cargarMultiempresaCertificado();
}

async function cargarMultiempresaCertificado() {
  const cont = $('#multiempresa-cert');
  let estado;
  try { estado = await API.multiempresaCertificadoEstado(); }
  catch (err) { cont.innerHTML = `<div class="vacio">Error: ${esc(err.message)}</div>`; return; }

  const avisos = [];
  if (!estado.node_forge_disponible) {
    avisos.push('Falta la dependencia <strong>node-forge</strong> en el servidor. Contactá a tu proveedor del sistema.');
  }
  if (estado.secreto_inseguro) {
    avisos.push('El cifrado de certificados no está configurado en el servidor. Contactá a tu proveedor antes de generar uno real.');
  }

  const cert = estado.certificado;
  const cuerpo = htmlCertificado({
    estado, prefijo: 'mm-cert', avisos,
    intro: `Generá el certificado de facturación sin usar OpenSSL. El sistema crea la clave y la solicitud (CSR);
    vos la subís a ARCA y traés de vuelta el certificado.`,
    textoActivo: 'La facturación electrónica está habilitada.',
    puedeGenerar: estado.node_forge_disponible
  });
  cont.innerHTML = `<div class="hoja-cuerpo">${cuerpo}</div>`;

  const btnGen = $('#mm-cert-generar');
  if (btnGen) btnGen.addEventListener('click', async () => {
    btnGen.disabled = true; btnGen.textContent = 'Generando…';
    try { await API.multiempresaCertificadoGenerar(); mostrarToast('Clave y CSR generados.'); cargarMultiempresaCertificado(); }
    catch (err) { mostrarToast(err.message, true); btnGen.disabled = false; btnGen.textContent = 'Generar clave y CSR'; }
  });

  const btnDesc = $('#mm-cert-descargar');
  if (btnDesc) btnDesc.addEventListener('click', async () => {
    try { await API.multiempresaDescargarCSR(); }
    catch (err) { mostrarToast(err.message, true); }
  });

  const inputArchivo = $('#mm-cert-archivo');
  if (inputArchivo) inputArchivo.addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    const lector = new FileReader();
    lector.onload = ev => { $('#mm-cert-pem').value = ev.target.result; };
    lector.readAsText(f);
  });

  const btnSubir = $('#mm-cert-subir');
  if (btnSubir) btnSubir.addEventListener('click', async () => {
    const pem = $('#mm-cert-pem').value.trim();
    if (!pem) { mostrarToast('Pegá o subí el certificado.', true); return; }
    btnSubir.disabled = true; btnSubir.textContent = 'Subiendo…';
    try {
      const r = await API.multiempresaCertificadoSubir(pem);
      mostrarToast(r.mensaje || 'Certificado cargado.');
      cargarMultiempresaCertificado();
    } catch (err) { mostrarToast(err.message, true); btnSubir.disabled = false; btnSubir.textContent = 'Subir certificado'; }
  });

  const btnRegen = $('#mm-cert-regenerar');
  if (btnRegen) btnRegen.addEventListener('click', async () => {
    if (!await confirmar('Esto descarta la clave y el certificado actuales. Vas a tener que generar y tramitar uno nuevo.', 'Descartar certificado', '¿Descartar el certificado?')) return;
    try { await API.multiempresaCertificadoEliminar(); mostrarToast('Certificado eliminado.'); cargarMultiempresaCertificado(); }
    catch (err) { mostrarToast(err.message, true); }
  });
}

// ============================================================
// Mi multiempresa · Datos fiscales
// ============================================================
async function renderMultiempresaDatosFiscales() {
  contenido.innerHTML = `
    <div class="vista-cab">
      <div>
        <h1>Datos de la empresa</h1>
        <p>Información que aparece en el encabezado de las facturas de ${esc(SESION.nombre_empresa || 'esta empresa')}</p>
      </div>
    </div>
    <section class="hoja" id="multiempresa-fiscal"><div class="vacio">Cargando…</div></section>
  `;
  const cont = $('#multiempresa-fiscal');
  let empresa;
  try { empresa = await API.multiempresaDatosFiscales(); }
  catch (err) { cont.innerHTML = `<div class="vacio">Error: ${esc(err.message)}</div>`; return; }

  cont.innerHTML = formDatosEmpresaHTML(empresa, 'mmf');
  $('#mmf-guardar').addEventListener('click', async () => {
    const datos = {
      telefono: $('#mmf-telefono').value.trim(),
      email: $('#mmf-email').value.trim(),
      domicilio: $('#mmf-domicilio').value.trim(),
      condicion_iva: $('#mmf-condicion-iva').value,
      ingresos_brutos: $('#mmf-ingresos-brutos').value.trim(),
      inicio_actividades: $('#mmf-inicio-actividades').value || null,
      punto_venta: $('#mmf-punto-venta').value.trim()
    };
    try {
      await API.multiempresaGuardarDatosFiscales(datos);
      mostrarToast('Datos de la empresa actualizados.');
    } catch (err) {
      mostrarToast(err.message, true);
    }
  });
}
