// frontend/js/vistas/admin.js
// Administración global (solo ADMIN): empresas, módulos, certificados y usuarios.
// Las funciones son globales a propósito: las usan los onclick="..." del HTML
// generado y los demás archivos. El orden de carga está en index.html.

// ============================================================
// Administración global (solo ADMIN): empresas y usuarios
// ============================================================
let _empresasCache = [];

// Gestión de módulos activos de una empresa (modal con checkboxes).
async function gestionarModulos(idEmpresa, nombreEmpresa) {
  try {
    const [catalogo, activos] = await Promise.all([
      API.catalogoModulos(),
      API.modulosDeEmpresa(idEmpresa)
    ]);
    const activosSet = new Set(activos);

    // Agrupar por categoría
    const grupos = {};
    catalogo.forEach(m => { (grupos[m.grupo] = grupos[m.grupo] || []).push(m); });

    const nombrePorClave = {};
    catalogo.forEach(m => { nombrePorClave[m.clave] = m.nombre; });

    const cuerpo = Object.entries(grupos).map(([grupo, mods]) => `
      <div style="margin-bottom:14px">
        <div class="nav-group-label" style="color:var(--texto-suave);margin-bottom:6px">${esc(grupo)}</div>
        ${mods.map(m => `
          <label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:${m.obligatorio ? 'default' : 'pointer'}">
            <input type="checkbox" class="chk-modulo" value="${m.clave}" ${(m.obligatorio || activosSet.has(m.clave)) ? 'checked' : ''} ${m.obligatorio ? 'disabled' : ''}>
            <span>${esc(m.nombre)}</span>
            ${m.obligatorio ? '<span style="font-size:11px;color:var(--exito)">(siempre activo)</span>' : (m.depende.length ? `<span style="font-size:11px;color:var(--texto-suave)">(requiere: ${m.depende.map(d => esc(nombrePorClave[d] || d)).join(', ')})</span>` : '')}
          </label>
        `).join('')}
      </div>
    `).join('');

    $('#modal-titulo').textContent = `Módulos de ${nombreEmpresa}`;
    $('#modal-cuerpo').innerHTML = `
      <p style="font-size:13px;color:var(--texto-suave);margin-bottom:12px">
        Activá los módulos que esta empresa necesita. Desactivar un módulo no borra
        sus datos: solo lo oculta. Las dependencias se validan al guardar.
      </p>
      ${cuerpo}
      <div id="modulos-error" class="login-error" hidden></div>`;

    configurarGuardado(async () => {
      const seleccionados = Array.from(document.querySelectorAll('.chk-modulo:checked')).map(c => c.value);
      try {
        await API.guardarModulosEmpresa(idEmpresa, seleccionados);
        mostrarToast('Módulos actualizados.');
        return true;
      } catch (err) {
        const box = $('#modulos-error');
        if (box) { box.textContent = err.message; box.hidden = false; }
        return false;
      }
    });
    abrirModalGenerico();
  } catch (err) {
    mostrarToast('No se pudieron cargar los módulos: ' + err.message, true);
  }
}

async function renderAdminEmpresas() {
  contenido.innerHTML = `
    <div class="vista-cabecera">
      <div>
        <div class="vista-titulo">Empresas</div>
        <div class="vista-sub">Firmas de transporte registradas en el sistema</div>
      </div>
      <button class="btn btn-primario" id="btn-nueva-empresa">+ Nueva empresa</button>
    </div>
    <div class="tabla-contenedor" id="tabla-empresas"><div class="estado-vacio">Cargando…</div></div>
  `;
  $('#btn-nueva-empresa').addEventListener('click', () => abrirModalEmpresa());
  try {
    const empresas = await API.listarEmpresas();
    _empresasCache = empresas;
    if (empresas.length === 0) {
      $('#tabla-empresas').innerHTML = '<div class="estado-vacio">Sin empresas. Crea la primera con "+ Nueva empresa".</div>';
      return;
    }
    $('#tabla-empresas').innerHTML = tablaSimple(
      ['Logo', 'Empresa', 'CUIT', 'Teléfono', 'Email', 'Usuarios', 'Estado', 'Acciones'],
      empresas.map(e => [
        `<td><span class="insignia ambar">${esc(e.iniciales || derivarIniciales(e.nombre))}</span></td>`,
        esc(e.nombre),
        esc(e.cuit || '—'),
        esc(e.telefono || '—'),
        esc(e.email || '—'),
        `<td class="celda-num">${e.cantidad_usuarios}</td>`,
        e.activa ? '<span class="insignia verde">Activa</span>' : '<span class="insignia gris">Inactiva</span>',
        `<td>
          <button class="btn btn-secundario btn-mini" onclick='abrirModalEmpresa(${JSON.stringify(e).replace(/'/g, "&#39;")})'>Editar</button>
          <button class="btn btn-secundario btn-mini" onclick="gestionarModulos(${e.id_empresa}, '${esc(e.nombre).replace(/'/g, "\\'")}')">Módulos</button>
          <button class="btn btn-secundario btn-mini" onclick="abrirModalCertificado(${e.id_empresa}, '${esc(e.nombre).replace(/'/g, "\\'")}', '${esc(e.cuit || '').replace(/'/g, "\\'")}')">Certificado ARCA</button>
        </td>`
      ])
    );
  } catch (err) {
    $('#tabla-empresas').innerHTML = `<div class="estado-vacio">Error: ${esc(err.message)}</div>`;
  }
}

function abrirModalEmpresa(empresa = null) {
  const ed = !!empresa;
  $('#modal-titulo').textContent = ed ? 'Editar empresa' : 'Nueva empresa';
  $('#modal-cuerpo').innerHTML = `
    <div class="campo ancho-completo"><label>Nombre *</label><input id="e-nombre" value="${ed ? esc(empresa.nombre) : ''}"></div>
    <div class="campo"><label>Iniciales del logo</label><input id="e-iniciales" maxlength="4" placeholder="ej. 3A" value="${ed && empresa.iniciales ? esc(empresa.iniciales) : ''}"></div>
    <div class="campo"><label>CUIT</label><input id="e-cuit" value="${ed && empresa.cuit ? esc(empresa.cuit) : ''}"></div>
    <div class="campo"><label>Teléfono</label><input id="e-telefono" value="${ed && empresa.telefono ? esc(empresa.telefono) : ''}"></div>
    <div class="campo ancho-completo"><label>Domicilio</label><input id="e-domicilio" value="${ed && empresa.domicilio ? esc(empresa.domicilio) : ''}"></div>
    <div class="campo ancho-completo"><label>Email</label><input id="e-email" value="${ed && empresa.email ? esc(empresa.email) : ''}"></div>
    ${ed ? `
    <div class="campo ancho-completo" style="border-top:1px solid var(--borde);margin-top:8px;padding-top:12px">
      <label style="font-weight:700;color:var(--texto)">Datos fiscales (para las facturas)</label>
      <div class="filtro-label" style="margin-top:2px">Estos datos aparecen en el encabezado de tus facturas. Cargalos con la información real de tu empresa en ARCA.</div>
    </div>
    <div class="campo"><label>Condición frente al IVA</label>
      <select id="e-condicion-iva">
        ${['RESPONSABLE INSCRIPTO', 'MONOTRIBUTO', 'EXENTO'].map(c =>
          `<option value="${c}"${(empresa.condicion_iva || 'RESPONSABLE INSCRIPTO') === c ? ' selected' : ''}>${c}</option>`).join('')}
      </select>
    </div>
    <div class="campo"><label>N° de Ingresos Brutos</label><input id="e-ingresos-brutos" placeholder="ej. 901-234567-8" value="${empresa.ingresos_brutos ? esc(empresa.ingresos_brutos) : ''}"></div>
    <div class="campo"><label>Inicio de actividades</label><input id="e-inicio-actividades" type="date" value="${empresa.inicio_actividades ? String(empresa.inicio_actividades).slice(0, 10) : ''}"></div>
    <div class="campo"><label>Punto de venta</label><input id="e-punto-venta" type="number" min="1" placeholder="ej. 1" value="${empresa.punto_venta != null ? empresa.punto_venta : ''}"></div>
    <div class="campo"><label>Estado</label><select id="e-activa"><option value="1" ${empresa.activa ? 'selected' : ''}>Activa</option><option value="0" ${!empresa.activa ? 'selected' : ''}>Inactiva</option></select></div>
    ` : ''}
  `;
  configurarGuardado(async () => {
    const datos = {
      nombre: $('#e-nombre').value.trim(),
      iniciales: $('#e-iniciales').value.trim(),
      cuit: $('#e-cuit').value.trim(),
      telefono: $('#e-telefono').value.trim(),
      domicilio: $('#e-domicilio').value.trim(),
      email: $('#e-email').value.trim()
    };
    if (!datos.nombre) { mostrarToast('El nombre es obligatorio.', true); return false; }
    if (ed) {
      datos.activa = $('#e-activa').value === '1';
      datos.condicion_iva = $('#e-condicion-iva').value;
      datos.ingresos_brutos = $('#e-ingresos-brutos').value.trim();
      datos.inicio_actividades = $('#e-inicio-actividades').value || null;
      datos.punto_venta = $('#e-punto-venta').value.trim();
      await API.actualizarEmpresa(empresa.id_empresa, datos);
    } else {
      await API.crearEmpresa(datos);
    }
    mostrarToast(ed ? 'Empresa actualizada.' : 'Empresa creada.');
    renderAdminEmpresas();
    return true;
  });
  abrirModalGenerico();
}

async function abrirModalCertificado(idEmpresa, nombreEmpresa, cuit) {
  $('#modal-titulo').textContent = 'Certificado ARCA';
  $('#modal-cuerpo').innerHTML = '<div class="estado-vacio">Cargando estado del certificado…</div>';
  $('#btn-guardar').style.display = 'none';
  abrirModalGenerico();

  let estado;
  try { estado = await API.certificadoEstado(idEmpresa); }
  catch (err) { $('#modal-cuerpo').innerHTML = `<div class="estado-vacio">Error: ${esc(err.message)}</div>`; return; }

  const avisos = [];
  if (!estado.node_forge_disponible) {
    avisos.push('⚠️ Falta la dependencia <strong>node-forge</strong> en el servidor. Ejecutá <code>npm install</code> antes de generar certificados.');
  }
  if (estado.secreto_inseguro) {
    avisos.push('⚠️ No está configurado <strong>CERT_SECRET</strong> en el servidor. Configuralo en el .env antes de generar claves reales, o no podrás descifrarlas después.');
  }
  if (!cuit) {
    avisos.push('⚠️ Esta empresa no tiene <strong>CUIT</strong> cargado. Cargalo en "Editar" antes de generar el certificado.');
  }

  const cert = estado.certificado;
  let cuerpo = '';

  if (avisos.length) {
    cuerpo += `<div style="background:#fff8e6;border:1px solid #f0d488;border-radius:8px;padding:12px 14px;margin-bottom:16px;font-size:13px;line-height:1.6">${avisos.join('<br>')}</div>`;
  }

  cuerpo += `<p style="color:var(--texto-suave);font-size:14px;margin-bottom:16px">
    Generá el certificado de facturación de <strong>${esc(nombreEmpresa)}</strong> sin usar OpenSSL.
    El sistema crea la clave y la solicitud (CSR); vos la subís a ARCA y traés de vuelta el certificado.
  </p>`;

  // Estado actual
  if (!cert) {
    cuerpo += `
      <div class="paso-cert">
        <strong>Paso 1 — Generar clave y solicitud (CSR)</strong>
        <p style="color:var(--texto-suave);font-size:13px;margin:4px 0 10px">Crea la clave privada (se guarda cifrada) y el CSR para ARCA.</p>
        <button class="btn btn-primario" id="cert-generar"${(!estado.node_forge_disponible || !cuit) ? ' disabled' : ''}>Generar clave y CSR</button>
      </div>`;
  } else if (cert.estado === 'CSR_GENERADO') {
    cuerpo += `
      <div style="background:var(--fondo-suave,#f5f5f5);border-radius:8px;padding:12px 14px;margin-bottom:16px;font-size:13px">
        ✅ Clave y CSR generados (alias <strong>${esc(cert.alias || '—')}</strong>).
      </div>
      <div class="paso-cert" style="margin-bottom:16px">
        <strong>Paso 2 — Descargar el CSR y subirlo a ARCA</strong>
        <p style="color:var(--texto-suave);font-size:13px;margin:4px 0 10px">Descargá el CSR y cargalo en "Administración de Certificados Digitales" de ARCA. Después descargá el certificado (.crt).</p>
        <button class="btn btn-secundario" id="cert-descargar">Descargar CSR</button>
      </div>
      <div class="paso-cert">
        <strong>Paso 3 — Subir el certificado (.crt) de ARCA</strong>
        <p style="color:var(--texto-suave);font-size:13px;margin:4px 0 8px">Pegá el contenido del .crt o subí el archivo.</p>
        <input type="file" id="cert-archivo" accept=".crt,.pem,.cer" style="margin-bottom:8px;font-size:13px">
        <textarea id="cert-pem" rows="5" placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----" style="width:100%;box-sizing:border-box;font-family:monospace;font-size:11px;padding:8px;border:1px solid var(--borde);border-radius:8px"></textarea>
        <button class="btn btn-primario" id="cert-subir" style="margin-top:10px">Subir certificado</button>
      </div>
      <button class="btn btn-peligro btn-mini" id="cert-regenerar" style="margin-top:16px">Descartar y regenerar</button>`;
  } else if (cert.estado === 'ACTIVO') {
    const vence = cert.fecha_vencimiento ? String(cert.fecha_vencimiento).slice(0, 10).split('-').reverse().join('/') : '—';
    const vencido = cert.fecha_vencimiento && new Date(cert.fecha_vencimiento) < new Date();
    cuerpo += `
      <div style="background:${vencido ? '#fdecea' : '#e3f4e9'};border:1px solid ${vencido ? '#e6a49b' : '#a3d9b8'};border-radius:8px;padding:14px 16px;margin-bottom:16px;font-size:14px">
        ${vencido ? '⚠️ <strong>Certificado vencido.</strong> Regeneralo para seguir facturando.' : '✅ <strong>Certificado activo.</strong> La facturación electrónica está habilitada para esta empresa.'}
        <br><span style="font-size:13px;color:var(--texto-suave)">Vence: ${vence}</span>
      </div>
      <button class="btn btn-peligro btn-mini" id="cert-regenerar">Regenerar certificado</button>`;
  }

  $('#modal-cuerpo').innerHTML = cuerpo;

  // --- Acciones ---
  const recargar = () => abrirModalCertificado(idEmpresa, nombreEmpresa, cuit);

  const btnGen = $('#cert-generar');
  if (btnGen) btnGen.addEventListener('click', async () => {
    btnGen.disabled = true; btnGen.textContent = 'Generando…';
    try { await API.certificadoGenerar(idEmpresa); mostrarToast('Clave y CSR generados.'); recargar(); }
    catch (err) { mostrarToast(err.message, true); btnGen.disabled = false; btnGen.textContent = 'Generar clave y CSR'; }
  });

  const btnDesc = $('#cert-descargar');
  if (btnDesc) btnDesc.addEventListener('click', async () => {
    try { await API.descargarCSR(idEmpresa, `${cert.alias || 'solicitud'}.csr`); }
    catch (err) { mostrarToast(err.message, true); }
  });

  const inputArchivo = $('#cert-archivo');
  if (inputArchivo) inputArchivo.addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    const lector = new FileReader();
    lector.onload = ev => { $('#cert-pem').value = ev.target.result; };
    lector.readAsText(f);
  });

  const btnSubir = $('#cert-subir');
  if (btnSubir) btnSubir.addEventListener('click', async () => {
    const pem = $('#cert-pem').value.trim();
    if (!pem) { mostrarToast('Pegá o subí el certificado.', true); return; }
    btnSubir.disabled = true; btnSubir.textContent = 'Subiendo…';
    try {
      const r = await API.certificadoSubir(idEmpresa, pem);
      mostrarToast(r.mensaje || 'Certificado cargado.');
      recargar();
    } catch (err) { mostrarToast(err.message, true); btnSubir.disabled = false; btnSubir.textContent = 'Subir certificado'; }
  });

  const btnRegen = $('#cert-regenerar');
  if (btnRegen) btnRegen.addEventListener('click', async () => {
    if (!confirm('Esto descarta la clave y el certificado actuales. Vas a tener que generar y tramitar uno nuevo. ¿Continuar?')) return;
    try { await API.certificadoEliminar(idEmpresa); mostrarToast('Certificado eliminado.'); recargar(); }
    catch (err) { mostrarToast(err.message, true); }
  });
}

async function renderAdminUsuarios() {
  contenido.innerHTML = `
    <div class="vista-cabecera">
      <div>
        <div class="vista-titulo">Usuarios</div>
        <div class="vista-sub">Credenciales de acceso y empresa asignada</div>
      </div>
      <button class="btn btn-primario" id="btn-nuevo-usuario">+ Nuevo usuario</button>
    </div>
    <div class="tabla-contenedor" id="tabla-usuarios"><div class="estado-vacio">Cargando…</div></div>
  `;
  $('#btn-nuevo-usuario').addEventListener('click', () => abrirModalUsuario());
  try {
    const [usuarios, empresas] = await Promise.all([API.listarUsuarios(), API.listarEmpresas()]);
    _empresasCache = empresas;
    if (usuarios.length === 0) {
      $('#tabla-usuarios').innerHTML = '<div class="estado-vacio">Sin usuarios.</div>';
      return;
    }
    $('#tabla-usuarios').innerHTML = tablaSimple(
      ['Usuario', 'Correo', 'Rol', 'Empresa', 'Estado', 'Acciones'],
      usuarios.map(u => {
        const esPrincipal = u.nombre_usuario === 'admin' && u.rol === 'ADMIN';
        return [
          esc(u.nombre_usuario) + (esPrincipal ? ' <span class="insignia ambar" title="Administrador principal: no se puede eliminar ni desactivar">★ principal</span>' : ''),
          esc(u.correo || '—'),
          u.rol === 'ADMIN' ? '<span class="insignia ambar">Administrador</span>' : '<span class="insignia">Usuario</span>',
          esc(u.nombre_empresa || '—'),
          u.activo ? '<span class="insignia verde">Activo</span>' : '<span class="insignia gris">Inactivo</span>',
          `<td><button class="btn btn-secundario btn-mini" onclick='abrirModalUsuario(${JSON.stringify(u).replace(/'/g, "&#39;")})'>Editar</button>${
            esPrincipal ? '' : ` <button class="btn btn-peligro btn-mini" onclick="eliminarUsuario(${u.id_usuario}, '${esc(u.nombre_usuario).replace(/'/g, "\\'")}')">Eliminar</button>`
          }</td>`
        ];
      })
    );
  } catch (err) {
    $('#tabla-usuarios').innerHTML = `<div class="estado-vacio">Error: ${esc(err.message)}</div>`;
  }
}

function abrirModalUsuario(usuario = null) {
  const ed = !!usuario;
  // El admin original (seed) solo admite cambio de contraseña/correo
  const esAdminOriginal = ed && usuario.nombre_usuario === 'admin' && usuario.rol === 'ADMIN';
  $('#modal-titulo').textContent = ed ? 'Editar usuario' : 'Nuevo usuario';

  if (esAdminOriginal) {
    $('#modal-cuerpo').innerHTML = `
      <div class="estado-vacio" style="text-align:left;padding:12px;margin-bottom:12px">
        Este es el <strong>administrador principal</strong> del sistema. Por seguridad,
        solo se puede cambiar su contraseña; no puede desactivarse, renombrarse ni eliminarse.
      </div>
      <div class="campo"><label>Nombre de usuario</label><input value="admin" disabled></div>
      <div class="campo"><label>Nueva contraseña (opcional)</label><input id="u-clave" type="password" placeholder="dejar vacío para no cambiar"></div>
      <div class="campo ancho-completo"><label>Correo electrónico</label><input id="u-correo" value="${usuario.correo ? esc(usuario.correo) : ''}"></div>
    `;
    configurarGuardado(async () => {
      const datos = { correo: $('#u-correo').value.trim() };
      const clave = $('#u-clave').value;
      if (clave) datos.contrasena = clave;
      await API.actualizarUsuario(usuario.id_usuario, datos);
      mostrarToast('Administrador principal actualizado.');
      renderAdminUsuarios();
      return true;
    });
    abrirModalGenerico();
    return;
  }

  const opcionesEmpresa = _empresasCache.map(e =>
    `<option value="${e.id_empresa}" ${ed && usuario.id_empresa === e.id_empresa ? 'selected' : ''}>${esc(e.nombre)}</option>`
  ).join('');
  $('#modal-cuerpo').innerHTML = `
    <div class="campo"><label>Nombre de usuario *</label><input id="u-nombre" value="${ed ? esc(usuario.nombre_usuario) : ''}"></div>
    <div class="campo"><label>${ed ? 'Nueva contraseña (opcional)' : 'Contraseña *'}</label><input id="u-clave" type="password" placeholder="${ed ? 'dejar vacío para no cambiar' : ''}"></div>
    <div class="campo ancho-completo"><label>Correo electrónico</label><input id="u-correo" value="${ed && usuario.correo ? esc(usuario.correo) : ''}"></div>
    <div class="campo"><label>Rol</label><select id="u-rol">
      <option value="USUARIO" ${ed && usuario.rol === 'USUARIO' ? 'selected' : ''}>Usuario</option>
      <option value="ADMIN" ${ed && usuario.rol === 'ADMIN' ? 'selected' : ''}>Administrador</option>
    </select></div>
    <div class="campo" id="campo-empresa"><label>Empresa</label><select id="u-empresa"><option value="">— Seleccionar —</option>${opcionesEmpresa}</select></div>
    ${ed ? `<div class="campo"><label>Estado</label><select id="u-activo"><option value="1" ${usuario.activo ? 'selected' : ''}>Activo</option><option value="0" ${!usuario.activo ? 'selected' : ''}>Inactivo</option></select></div>` : ''}
  `;
  // El selector de empresa solo aplica a rol USUARIO
  const sincronizarEmpresa = () => {
    $('#campo-empresa').style.display = $('#u-rol').value === 'ADMIN' ? 'none' : '';
  };
  $('#u-rol').addEventListener('change', sincronizarEmpresa);
  sincronizarEmpresa();

  configurarGuardado(async () => {
    const rol = $('#u-rol').value;
    const datos = {
      nombre_usuario: $('#u-nombre').value.trim(),
      correo: $('#u-correo').value.trim(),
      rol,
      id_empresa: rol === 'ADMIN' ? null : ($('#u-empresa').value || null)
    };
    const clave = $('#u-clave').value;
    if (clave) datos.contrasena = clave;
    if (!datos.nombre_usuario) { mostrarToast('El nombre de usuario es obligatorio.', true); return false; }
    if (!ed && !clave) { mostrarToast('La contraseña es obligatoria.', true); return false; }
    if (rol === 'USUARIO' && !datos.id_empresa) { mostrarToast('Un usuario operativo debe tener empresa.', true); return false; }
    if (ed) {
      datos.activo = $('#u-activo').value === '1';
      await API.actualizarUsuario(usuario.id_usuario, datos);
    } else {
      await API.crearUsuario(datos);
    }
    mostrarToast(ed ? 'Usuario actualizado.' : 'Usuario creado.');
    renderAdminUsuarios();
    return true;
  });
  abrirModalGenerico();
}

// Eliminar un usuario (con confirmación). El backend rechaza eliminar al
// administrador principal o a uno mismo.
async function eliminarUsuario(id, nombre) {
  if (!confirm(`¿Eliminar al usuario "${nombre}"? Esta acción no se puede deshacer.`)) return;
  try {
    await API.eliminarUsuario(id);
    mostrarToast('Usuario eliminado.');
    renderAdminUsuarios();
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

// Helpers de modal reutilizables para las vistas admin
let _guardadoAdmin = null;
function configurarGuardado(fn) { _guardadoAdmin = fn; }
function abrirModalGenerico() {
  $('#modal-fondo').hidden = false;
}
