// frontend/js/vistas/miEmpresa.js
// Panel "Mi empresa" (solo ADMIN_EMPRESA): usuarios, certificado ARCA y datos
// fiscales de la propia empresa. Reutiliza los patrones de vistas/admin.js
// pero apunta a /api/empresa/* y no tiene selector de empresa (la fija el
// servidor a partir del token). Las funciones son globales a propósito: las
// usan los onclick="..." del HTML generado. El orden de carga está en index.html.

// ============================================================
// Mi empresa · Usuarios
// ============================================================
let _usuariosEmpresa = [];
async function renderMiEmpresaUsuarios() {
  contenido.innerHTML = `
    <div class="vista-cab">
      <div>
        <h1>Usuarios de mi empresa</h1>
        <p>Accesos operativos de tu empresa</p>
      </div>
      <div class="acciones"><button class="btn btn-primario" id="btn-nuevo-usuario-empresa">+ Nuevo usuario</button></div>
    </div>
    <section class="hoja" id="tabla-usuarios-empresa"><div class="vacio">Cargando…</div></section>
  `;
  $('#btn-nuevo-usuario-empresa').addEventListener('click', () => abrirModalUsuarioEmpresa());
  try {
    const usuarios = _usuariosEmpresa = await API.miEmpresaListarUsuarios();
    if (usuarios.length === 0) {
      $('#tabla-usuarios-empresa').innerHTML = '<div class="vacio">Sin usuarios. Creá el primero con "+ Nuevo usuario".</div>';
      return;
    }
    const activos = usuarios.filter(u => u.activo).length;
    $('#tabla-usuarios-empresa').innerHTML = cabeceraTablaAdmin(`${usuarios.length} usuario${usuarios.length === 1 ? '' : 's'}`, `${activos} activo${activos === 1 ? '' : 's'} · tocá una fila para editarlo`) + tablaSimple(
      ['Usuario', 'Rol', 'Estado'],
      usuarios.map(u => [
        celdaUsuario(u),
        insigniaRolUsuario(u.rol),
        u.activo ? insignia('Activo', 'ok') : insignia('Inactivo')
      ]),
      { clic: i => `abrirModalUsuarioEmpresa(_usuariosEmpresa[${i}])` }
    );
  } catch (err) {
    $('#tabla-usuarios-empresa').innerHTML = `<div class="vacio">Error: ${esc(err.message)}</div>`;
  }
}

function abrirModalUsuarioEmpresa(usuario = null) {
  const ed = !!usuario;
  $('#modal-titulo').textContent = ed ? 'Editar usuario' : 'Nuevo usuario';
  $('#modal-cuerpo').innerHTML = `<div class="formulario">
    <div class="campo"><label for="ue-nombre">Nombre de usuario *</label><input id="ue-nombre" value="${ed ? esc(usuario.nombre_usuario) : ''}"></div>
    <div class="campo"><label for="ue-clave">${ed ? 'Nueva contraseña (opcional)' : 'Contraseña *'}</label><input id="ue-clave" type="password" placeholder="${ed ? 'dejar vacío para no cambiar' : 'mínimo 8 caracteres'}"><span class="ayuda">Es temporal: el usuario deberá cambiarla en su próximo ingreso.</span></div>
    <div class="campo ancho"><label for="ue-correo">Correo electrónico</label><input id="ue-correo" value="${ed && usuario.correo ? esc(usuario.correo) : ''}"></div>
    <div class="campo"><label for="ue-rol">Rol</label><select id="ue-rol">
      <option value="USUARIO" ${ed && usuario.rol === 'USUARIO' ? 'selected' : ''}>Usuario</option>
      <option value="ADMIN_EMPRESA" ${ed && usuario.rol === 'ADMIN_EMPRESA' ? 'selected' : ''}>Administrador de empresa</option>
    </select></div>
    ${ed ? `<div class="campo"><label for="ue-activo">Estado</label><select id="ue-activo"><option value="1" ${usuario.activo ? 'selected' : ''}>Activo</option><option value="0" ${!usuario.activo ? 'selected' : ''}>Inactivo</option></select></div>` : ''}
    ${ed ? bloqueAcciones([{ texto: 'Eliminar usuario', peligro: true, onclick: `eliminarUsuarioEmpresa(${usuario.id_usuario}, ${jsArg(usuario.nombre_usuario)})` }]) : ''}
  </div>`;
  configurarGuardado(async () => {
    const datos = {
      nombre_usuario: $('#ue-nombre').value.trim(),
      correo: $('#ue-correo').value.trim(),
      rol: $('#ue-rol').value
    };
    const clave = $('#ue-clave').value;
    if (clave) datos.contrasena = clave;
    if (!datos.nombre_usuario) { mostrarToast('El nombre de usuario es obligatorio.', true); return false; }
    if (!ed && !clave) { mostrarToast('La contraseña es obligatoria.', true); return false; }
    try {
      if (ed) {
        datos.activo = $('#ue-activo').value === '1';
        await API.miEmpresaActualizarUsuario(usuario.id_usuario, datos);
      } else {
        await API.miEmpresaCrearUsuario(datos);
      }
    } catch (err) {
      mostrarToast(err.message, true);
      return false;
    }
    mostrarToast(ed ? 'Usuario actualizado.' : 'Usuario creado.');
    renderMiEmpresaUsuarios();
    return true;
  });
  abrirModalGenerico();
}

async function eliminarUsuarioEmpresa(id, nombre) {
  if (!await confirmar('Esta acción no se puede deshacer.', 'Eliminar usuario', `¿Eliminar al usuario «${nombre}»?`)) return;
  try {
    await API.miEmpresaEliminarUsuario(id);
    mostrarToast('Usuario eliminado.');
    renderMiEmpresaUsuarios();
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

// ============================================================
// Mi empresa · Certificado ARCA
// ============================================================
async function renderMiEmpresaCertificado() {
  contenido.innerHTML = `
    <div class="vista-cab">
      <div>
        <h1>Certificado ARCA</h1>
        <p>Certificado de facturación electrónica de tu empresa</p>
      </div>
    </div>
    <section class="hoja" id="mi-empresa-cert"><div class="vacio">Cargando…</div></section>
  `;
  await cargarMiEmpresaCertificado();
}

async function cargarMiEmpresaCertificado() {
  const cont = $('#mi-empresa-cert');
  let estado;
  try { estado = await API.miEmpresaCertificadoEstado(); }
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
    estado, prefijo: 'me-cert', avisos,
    intro: `Generá el certificado de facturación sin usar OpenSSL. El sistema crea la clave y la solicitud (CSR);
    vos la subís a ARCA y traés de vuelta el certificado.`,
    textoActivo: 'La facturación electrónica está habilitada.',
    puedeGenerar: estado.node_forge_disponible
  });
  cont.innerHTML = `<div class="hoja-cuerpo">${cuerpo}</div>`;

  const btnGen = $('#me-cert-generar');
  if (btnGen) btnGen.addEventListener('click', async () => {
    btnGen.disabled = true; btnGen.textContent = 'Generando…';
    try { await API.miEmpresaCertificadoGenerar(); mostrarToast('Clave y CSR generados.'); cargarMiEmpresaCertificado(); }
    catch (err) { mostrarToast(err.message, true); btnGen.disabled = false; btnGen.textContent = 'Generar clave y CSR'; }
  });

  const btnDesc = $('#me-cert-descargar');
  if (btnDesc) btnDesc.addEventListener('click', async () => {
    try { await API.miEmpresaDescargarCSR(); }
    catch (err) { mostrarToast(err.message, true); }
  });

  const inputArchivo = $('#me-cert-archivo');
  if (inputArchivo) inputArchivo.addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    const lector = new FileReader();
    lector.onload = ev => { $('#me-cert-pem').value = ev.target.result; };
    lector.readAsText(f);
  });

  const btnSubir = $('#me-cert-subir');
  if (btnSubir) btnSubir.addEventListener('click', async () => {
    const pem = $('#me-cert-pem').value.trim();
    if (!pem) { mostrarToast('Pegá o subí el certificado.', true); return; }
    btnSubir.disabled = true; btnSubir.textContent = 'Subiendo…';
    try {
      const r = await API.miEmpresaCertificadoSubir(pem);
      mostrarToast(r.mensaje || 'Certificado cargado.');
      cargarMiEmpresaCertificado();
    } catch (err) { mostrarToast(err.message, true); btnSubir.disabled = false; btnSubir.textContent = 'Subir certificado'; }
  });

  const btnRegen = $('#me-cert-regenerar');
  if (btnRegen) btnRegen.addEventListener('click', async () => {
    if (!await confirmar('Esto descarta la clave y el certificado actuales. Vas a tener que generar y tramitar uno nuevo.', 'Descartar certificado', '¿Descartar el certificado?')) return;
    try { await API.miEmpresaCertificadoEliminar(); mostrarToast('Certificado eliminado.'); cargarMiEmpresaCertificado(); }
    catch (err) { mostrarToast(err.message, true); }
  });
}

// ============================================================
// Mi empresa · Datos fiscales
// ============================================================
async function renderMiEmpresaDatosFiscales() {
  contenido.innerHTML = `
    <div class="vista-cab">
      <div>
        <h1>Datos de la empresa</h1>
        <p>Contacto y datos fiscales que aparecen en el encabezado de tus facturas</p>
      </div>
    </div>
    <section class="hoja" id="mi-empresa-fiscal"><div class="vacio">Cargando…</div></section>
  `;
  const cont = $('#mi-empresa-fiscal');
  let empresa;
  try { empresa = await API.miEmpresaDatosFiscales(); }
  catch (err) { cont.innerHTML = `<div class="vacio">Error: ${esc(err.message)}</div>`; return; }

  cont.innerHTML = formDatosEmpresaHTML(empresa, 'mf');
  $('#mf-guardar').addEventListener('click', async () => {
    const datos = {
      telefono: $('#mf-telefono').value.trim(),
      email: $('#mf-email').value.trim(),
      domicilio: $('#mf-domicilio').value.trim(),
      condicion_iva: $('#mf-condicion-iva').value,
      ingresos_brutos: $('#mf-ingresos-brutos').value.trim(),
      inicio_actividades: $('#mf-inicio-actividades').value || null,
      punto_venta: $('#mf-punto-venta').value.trim()
    };
    try {
      await API.miEmpresaGuardarDatosFiscales(datos);
      mostrarToast('Datos de la empresa actualizados.');
    } catch (err) {
      mostrarToast(err.message, true);
    }
  });
}
