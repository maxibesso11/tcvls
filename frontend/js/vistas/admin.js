// frontend/js/vistas/admin.js
// Administración global (solo ADMIN): empresas, módulos, certificados y usuarios.
// Las funciones son globales a propósito: las usan los onclick="..." del HTML
// generado y los demás archivos. El orden de carga está en index.html.

// ============================================================
// Administración global (solo ADMIN): empresas y usuarios
// ============================================================
let _empresasCache = [];

// ============================================================
// Piezas compartidas por los paneles de administración
// (admin.js se carga antes que miEmpresa.js y multiempresa.js)
// ============================================================
// Cabecera de la hoja que contiene una tabla: título + cantidad, como las
// hojas del tablero.
const cabeceraTablaAdmin = (titulo, sub = '') =>
  `<header class="hoja-cabecera"><div><h2 class="hoja-titulo">${titulo}</h2>${sub ? `<div class="hoja-sub">${sub}</div>` : ''}</div></header>`;

// Usuario en una celda: nombre de usuario + correo debajo.
const celdaUsuario = (u, extra = '') =>
  `<div class="celda-doble"><b>${esc(u.nombre_usuario)}${extra}</b><span>${esc(u.correo || 'sin correo')}</span></div>`;

const insigniaRolUsuario = rol =>
  rol === 'ADMIN' ? insignia('Administrador', 'aviso')
    : rol === 'ADMIN_MULTIEMPRESA' ? insignia('Admin. multiempresa', 'marca')
    : rol === 'ADMIN_EMPRESA' ? insignia('Admin. de empresa', 'info')
    : insignia('Usuario', 'sin-punto');

// Formulario de datos de la empresa (Mi empresa y Mi multiempresa): dos
// grupos — contacto y datos para facturar — y el botón en el pie de la hoja.
// prefijo: prefijo de los id de los campos (ej. 'mf' → #mf-telefono).
function formDatosEmpresaHTML(empresa, prefijo) {
  const v = x => esc(x == null ? '' : x);
  return `
    <header class="hoja-cabecera"><div><h2 class="hoja-titulo">Contacto</h2><div class="hoja-sub">Cómo te encuentran tus clientes. La razón social y el CUIT los cambia el administrador del sistema.</div></div></header>
    <div class="hoja-cuerpo"><div class="formulario">
      <div class="campo"><label for="${prefijo}-empresa">Empresa</label><input id="${prefijo}-empresa" value="${v(empresa.nombre)}" disabled></div>
      <div class="campo"><label for="${prefijo}-cuit">CUIT</label><input id="${prefijo}-cuit" class="mono" value="${v(empresa.cuit || '—')}" disabled></div>
      <div class="campo"><label for="${prefijo}-telefono">Teléfono</label><input id="${prefijo}-telefono" value="${v(empresa.telefono)}"></div>
      <div class="campo"><label for="${prefijo}-email">Email</label><input id="${prefijo}-email" type="email" value="${v(empresa.email)}"></div>
      <div class="campo ancho"><label for="${prefijo}-domicilio">Domicilio</label><input id="${prefijo}-domicilio" value="${v(empresa.domicilio)}"></div>
    </div></div>
    <header class="hoja-cabecera hoja-cabecera-intermedia"><div><h2 class="hoja-titulo">Datos para facturar</h2><div class="hoja-sub">Aparecen en el encabezado de cada factura.</div></div></header>
    <div class="hoja-cuerpo"><div class="formulario">
      <div class="campo"><label for="${prefijo}-condicion-iva">Condición frente al IVA</label>
        <select id="${prefijo}-condicion-iva">
          ${['RESPONSABLE INSCRIPTO', 'MONOTRIBUTO', 'EXENTO'].map(c =>
            `<option value="${c}"${(empresa.condicion_iva || 'RESPONSABLE INSCRIPTO') === c ? ' selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="campo"><label for="${prefijo}-ingresos-brutos">N° de Ingresos Brutos</label><input id="${prefijo}-ingresos-brutos" class="mono" placeholder="ej. 901-234567-8" value="${v(empresa.ingresos_brutos)}"></div>
      <div class="campo"><label for="${prefijo}-inicio-actividades">Inicio de actividades</label><input id="${prefijo}-inicio-actividades" type="date" value="${empresa.inicio_actividades ? String(empresa.inicio_actividades).slice(0, 10) : ''}"></div>
      <div class="campo"><label for="${prefijo}-punto-venta">Punto de venta</label><input id="${prefijo}-punto-venta" type="number" min="1" value="${empresa.punto_venta != null ? empresa.punto_venta : ''}"></div>
    </div></div>
    <footer class="hoja-pie hoja-pie-acciones"><button class="btn btn-primario" id="${prefijo}-guardar">Guardar cambios</button></footer>`;
}


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
      <div class="grupo-titulo"><div class="rotulo">${esc(grupo)}</div></div>
      ${mods.map(m => `
        <div>
          <label>
            <input type="checkbox" class="chk-modulo" value="${m.clave}" ${(m.obligatorio || activosSet.has(m.clave)) ? 'checked' : ''} ${m.obligatorio ? 'disabled' : ''}>
            ${esc(m.nombre)}
          </label>
          ${m.obligatorio ? '<span class="tenue">(siempre activo)</span>' : (m.depende.length ? `<span class="tenue">(requiere: ${m.depende.map(d => esc(nombrePorClave[d] || d)).join(', ')})</span>` : '')}
        </div>
      `).join('')}
    `).join('');

    $('#modal-titulo').textContent = `Módulos de ${nombreEmpresa}`;
    $('#modal-cuerpo').innerHTML = `
      <p class="tenue">
        Activá los módulos que esta empresa necesita. Desactivar un módulo no borra
        sus datos: solo lo oculta. Las dependencias se validan al guardar.
      </p>
      ${cuerpo}
      <p class="campo error"><span class="ayuda" id="modulos-error" hidden></span></p>`;

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

// Empresas asignadas a un usuario ADMIN_MULTIEMPRESA (modal con checkboxes).
// Solo el ADMIN global las asigna; el usuario elige después con cuál operar.
async function gestionarEmpresasUsuario(idUsuario, nombreUsuario) {
  try {
    const asignadas = await API.usuarioEmpresasAsignadas(idUsuario);
    const asignadasSet = new Set(asignadas.map(e => e.id_empresa));

    $('#modal-titulo').textContent = `Empresas de ${nombreUsuario}`;
    $('#modal-cuerpo').innerHTML = `
      <p class="tenue">
        Elegí las empresas que ${esc(nombreUsuario)} puede administrar y operar.
      </p>
      ${_empresasCache.length === 0 ? '<div class="vacio">No hay empresas creadas todavía.</div>' :
        _empresasCache.map(e => `
          <div><label>
            <input type="checkbox" class="chk-empresa-usuario" value="${e.id_empresa}" ${asignadasSet.has(e.id_empresa) ? 'checked' : ''}>
            ${esc(e.nombre)}
          </label></div>
        `).join('')}
      <p class="campo error"><span class="ayuda" id="empresas-usuario-error" hidden></span></p>`;

    configurarGuardado(async () => {
      const seleccionadas = Array.from(document.querySelectorAll('.chk-empresa-usuario:checked')).map(c => Number(c.value));
      try {
        await API.asignarEmpresasUsuario(idUsuario, seleccionadas);
        mostrarToast('Empresas actualizadas.');
        renderAdminUsuarios();
        return true;
      } catch (err) {
        const box = $('#empresas-usuario-error');
        if (box) { box.textContent = err.message; box.hidden = false; }
        return false;
      }
    });
    abrirModalGenerico();
  } catch (err) {
    mostrarToast('No se pudieron cargar las empresas: ' + err.message, true);
  }
}

async function renderAdminEmpresas() {
  contenido.innerHTML = `
    <div class="vista-cab">
      <div>
        <h1>Empresas</h1>
        <p>Firmas de transporte registradas en el sistema.</p>
      </div>
      <div class="acciones"><button class="btn btn-primario" id="btn-nueva-empresa">+ Nueva empresa</button></div>
    </div>
    <section class="hoja" id="tabla-empresas"><div class="vacio">Cargando…</div></section>
  `;
  $('#btn-nueva-empresa').addEventListener('click', () => abrirModalEmpresa());
  try {
    const empresas = await API.listarEmpresas();
    _empresasCache = empresas;
    if (empresas.length === 0) {
      $('#tabla-empresas').innerHTML = '<div class="vacio">Sin empresas. Creá la primera con «Nueva empresa».</div>';
      return;
    }
    const activas = empresas.filter(e => e.activa).length;
    $('#tabla-empresas').innerHTML = cabeceraTablaAdmin(`${empresas.length} empresa${empresas.length === 1 ? '' : 's'}`, `${activas} activa${activas === 1 ? '' : 's'} · tocá una fila para editarla, sus módulos o su certificado`) + tablaSimple(
      ['Empresa', 'Contacto', 'Usuarios', 'Estado'],
      empresas.map(e => [
        `<div class="empresa-celda"><span class="avatar">${esc(e.iniciales || derivarIniciales(e.nombre))}</span><div class="celda-doble"><b>${esc(e.nombre)}</b><span class="mono">${esc(e.cuit || 'sin CUIT')}</span></div></div>`,
        `<div class="celda-doble"><b>${esc(e.telefono || '—')}</b><span>${esc(e.email || 'sin email')}</span></div>`,
        `<td class="num">${e.cantidad_usuarios}</td>`,
        e.activa ? insignia('Activa', 'ok') : insignia('Inactiva')
      ]),
      { clic: i => `abrirModalEmpresa(_empresasCache[${i}])` }
    );
  } catch (err) {
    $('#tabla-empresas').innerHTML = `<div class="vacio">Error: ${esc(err.message)}</div>`;
  }
}

function abrirModalEmpresa(empresa = null) {
  const ed = !!empresa;
  $('#modal-titulo').textContent = ed ? 'Editar empresa' : 'Nueva empresa';
  const acciones = ed ? bloqueAcciones([
    { texto: 'Módulos', onclick: `gestionarModulos(${empresa.id_empresa}, ${jsArg(empresa.nombre)})` },
    { texto: 'Certificado ARCA', onclick: `abrirModalCertificado(${empresa.id_empresa}, ${jsArg(empresa.nombre)}, ${jsArg(empresa.cuit || '')})` }
  ]) : '';
  $('#modal-cuerpo').innerHTML = `<div class="formulario">
    <div class="campo ancho"><label for="e-nombre">Nombre *</label><input id="e-nombre" value="${ed ? esc(empresa.nombre) : ''}"></div>
    <div class="campo"><label for="e-iniciales">Iniciales del logo</label><input id="e-iniciales" maxlength="4" placeholder="ej. 3A" value="${ed && empresa.iniciales ? esc(empresa.iniciales) : ''}"></div>
    <div class="campo"><label for="e-cuit">CUIT</label><input id="e-cuit" value="${ed && empresa.cuit ? esc(empresa.cuit) : ''}"></div>
    <div class="campo"><label for="e-telefono">Teléfono</label><input id="e-telefono" value="${ed && empresa.telefono ? esc(empresa.telefono) : ''}"></div>
    <div class="campo ancho"><label for="e-domicilio">Domicilio</label><input id="e-domicilio" value="${ed && empresa.domicilio ? esc(empresa.domicilio) : ''}"></div>
    <div class="campo ancho"><label for="e-email">Email</label><input id="e-email" value="${ed && empresa.email ? esc(empresa.email) : ''}"></div>
    ${ed ? `
    <div class="grupo-titulo">
      <h3 class="hoja-titulo">Datos fiscales (para las facturas)</h3>
      <div class="hoja-sub">Estos datos aparecen en el encabezado de tus facturas. Cargalos con la información real de tu empresa en ARCA.</div>
    </div>
    <div class="campo"><label for="e-condicion-iva">Condición frente al IVA</label>
      <select id="e-condicion-iva">
        ${['RESPONSABLE INSCRIPTO', 'MONOTRIBUTO', 'EXENTO'].map(c =>
          `<option value="${c}"${(empresa.condicion_iva || 'RESPONSABLE INSCRIPTO') === c ? ' selected' : ''}>${c}</option>`).join('')}
      </select>
    </div>
    <div class="campo"><label for="e-ingresos-brutos">N° de Ingresos Brutos</label><input id="e-ingresos-brutos" placeholder="ej. 901-234567-8" value="${empresa.ingresos_brutos ? esc(empresa.ingresos_brutos) : ''}"></div>
    <div class="campo"><label for="e-inicio-actividades">Inicio de actividades</label><input id="e-inicio-actividades" type="date" value="${empresa.inicio_actividades ? String(empresa.inicio_actividades).slice(0, 10) : ''}"></div>
    <div class="campo"><label for="e-punto-venta">Punto de venta</label><input id="e-punto-venta" type="number" min="1" placeholder="ej. 1" value="${empresa.punto_venta != null ? empresa.punto_venta : ''}"></div>
    <div class="campo"><label for="e-activa">Estado</label><select id="e-activa"><option value="1" ${empresa.activa ? 'selected' : ''}>Activa</option><option value="0" ${!empresa.activa ? 'selected' : ''}>Inactiva</option></select></div>
    ` : ''}
    ${acciones}
  </div>`;
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

// Cuerpo del certificado ARCA, compartido por el modal de Administración
// global, "Mi empresa" y "Mi multiempresa". prefijo da los ids de los
// controles (<prefijo>-generar, -descargar, -archivo, -pem, -subir, -regenerar).
function htmlCertificado({ estado, prefijo, avisos = [], intro, textoActivo, puedeGenerar }) {
  const cert = estado.certificado;
  let cuerpo = '';

  if (avisos.length) {
    cuerpo += `<ul class="alertas avisos-cert">${avisos.map(a => `<li class="alerta pronto"><div class="alerta-dias">!<small>aviso</small></div><div class="alerta-texto"><span>${a}</span></div><span></span></li>`).join('')}</ul>`;
  }

  // Certificado activo (o vencido): estado + vencimiento, sin pasos.
  if (cert && cert.estado === 'ACTIVO') {
    const vence = cert.fecha_vencimiento ? fmtFecha(cert.fecha_vencimiento) : '—';
    const vencido = cert.fecha_vencimiento && new Date(cert.fecha_vencimiento) < new Date();
    return cuerpo + `
      <div class="ficha-datos cert-estado">
        <div class="ficha-dato"><span class="rotulo">Estado</span><b>${vencido ? insignia('Vencido', 'peligro') : insignia('Activo', 'ok')}</b></div>
        <div class="ficha-dato"><span class="rotulo">Vence</span><b>${vence}</b></div>
        ${cert.alias ? `<div class="ficha-dato"><span class="rotulo">Alias</span><b class="mono">${esc(cert.alias)}</b></div>` : ''}
      </div>
      <p class="${vencido ? '' : 'tenue'}">${vencido ? '<strong>El certificado venció.</strong> Regeneralo para seguir facturando.' : textoActivo}</p>
      <div class="acciones"><button class="btn btn-peligro btn-chico" id="${prefijo}-regenerar">Regenerar certificado</button></div>`;
  }

  // Sin certificado o a mitad de camino: los tres pasos, con el actual resaltado.
  const actual = !cert ? 1 : 2; // CSR_GENERADO → pasos 2 y 3 juntos
  const paso = (n, titulo, texto, contenido) => {
    const clase = n < actual ? 'hecho' : (n === actual || (actual === 2 && n === 3)) ? 'actual' : 'pendiente';
    return `<li class="paso ${clase}"><span class="paso-num">${clase === 'hecho' ? '✓' : n}</span>
      <div class="paso-cuerpo"><b>${titulo}</b><p>${texto}</p>${clase === 'actual' ? contenido : ''}</div></li>`;
  };
  cuerpo += `<p class="tenue">${intro}</p><ol class="pasos">
    ${paso(1, 'Generar clave y solicitud (CSR)', 'Crea la clave privada (se guarda cifrada) y el CSR para ARCA.',
      `<button class="btn btn-primario" id="${prefijo}-generar"${puedeGenerar ? '' : ' disabled'}>Generar clave y CSR</button>`)}
    ${paso(2, 'Descargar el CSR y subirlo a ARCA', 'Cargalo en «Administración de Certificados Digitales» de ARCA y descargá el certificado (.crt).',
      `<button class="btn" id="${prefijo}-descargar">Descargar CSR</button>`)}
    ${paso(3, 'Subir el certificado (.crt) de ARCA', 'Subí el archivo o pegá su contenido.',
      `<div class="formulario">
        <div class="campo ancho"><label for="${prefijo}-archivo">Archivo del certificado</label><input type="file" id="${prefijo}-archivo" accept=".crt,.pem,.cer"></div>
        <div class="campo ancho"><label for="${prefijo}-pem">Certificado en texto</label><textarea id="${prefijo}-pem" class="mono" rows="5" placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"></textarea></div>
      </div>
      <div class="acciones"><button class="btn btn-primario" id="${prefijo}-subir">Subir certificado</button></div>`)}
  </ol>`;
  if (cert && cert.estado === 'CSR_GENERADO') {
    cuerpo += `<div class="acciones"><span class="tenue">Clave generada con el alias <strong class="mono">${esc(cert.alias || '—')}</strong>.</span><button class="btn btn-peligro btn-chico" id="${prefijo}-regenerar">Descartar y empezar de nuevo</button></div>`;
  }
  return cuerpo;
}

async function abrirModalCertificado(idEmpresa, nombreEmpresa, cuit) {
  $('#modal-titulo').textContent = 'Certificado ARCA';
  $('#modal-cuerpo').innerHTML = '<div class="vacio">Cargando estado del certificado…</div>';
  $('#btn-guardar').hidden = true;
  abrirModalGenerico();

  let estado;
  try { estado = await API.certificadoEstado(idEmpresa); }
  catch (err) { $('#modal-cuerpo').innerHTML = `<div class="vacio">Error: ${esc(err.message)}</div>`; return; }

  const avisos = [];
  if (!estado.node_forge_disponible) {
    avisos.push('Falta la dependencia <strong>node-forge</strong> en el servidor. Ejecutá <code>npm install</code> antes de generar certificados.');
  }
  if (estado.secreto_inseguro) {
    avisos.push('No está configurado <strong>CERT_SECRET</strong> en el servidor. Configuralo en el .env antes de generar claves reales, o no podrás descifrarlas después.');
  }
  if (!cuit) {
    avisos.push('Esta empresa no tiene <strong>CUIT</strong> cargado. Cargalo en «Editar» antes de generar el certificado.');
  }

  const cert = estado.certificado;
  const cuerpo = htmlCertificado({
    estado, prefijo: 'cert', avisos,
    intro: `Generá el certificado de facturación de <strong>${esc(nombreEmpresa)}</strong> sin usar OpenSSL.
    El sistema crea la clave y la solicitud (CSR); vos la subís a ARCA y traés de vuelta el certificado.`,
    textoActivo: 'La facturación electrónica está habilitada para esta empresa.',
    puedeGenerar: estado.node_forge_disponible && cuit
  });
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
    if (!await confirmar('Esto descarta la clave y el certificado actuales. Vas a tener que generar y tramitar uno nuevo.', 'Descartar certificado', '¿Descartar el certificado?')) return;
    try { await API.certificadoEliminar(idEmpresa); mostrarToast('Certificado eliminado.'); recargar(); }
    catch (err) { mostrarToast(err.message, true); }
  });
}

let _usuariosCache = [];
async function renderAdminUsuarios() {
  contenido.innerHTML = `
    <div class="vista-cab">
      <div>
        <h1>Usuarios</h1>
        <p>Credenciales de acceso y empresa asignada.</p>
      </div>
      <div class="acciones"><button class="btn btn-primario" id="btn-nuevo-usuario">+ Nuevo usuario</button></div>
    </div>
    <section class="hoja" id="tabla-usuarios"><div class="vacio">Cargando…</div></section>
  `;
  $('#btn-nuevo-usuario').addEventListener('click', () => abrirModalUsuario());
  try {
    const [usuarios, empresas] = await Promise.all([API.listarUsuarios(), API.listarEmpresas()]);
    _empresasCache = empresas;
    _usuariosCache = usuarios;
    if (usuarios.length === 0) {
      $('#tabla-usuarios').innerHTML = '<div class="vacio">Sin usuarios.</div>';
      return;
    }
    const activos = usuarios.filter(u => u.activo).length;
    $('#tabla-usuarios').innerHTML = cabeceraTablaAdmin(`${usuarios.length} usuario${usuarios.length === 1 ? '' : 's'}`, `${activos} activo${activos === 1 ? '' : 's'} · tocá una fila para editarlo`) + tablaSimple(
      ['Usuario', 'Rol', 'Empresa', 'Estado'],
      usuarios.map(u => {
        const esPrincipal = u.nombre_usuario === 'admin' && u.rol === 'ADMIN';
        return [
          celdaUsuario(u, esPrincipal ? ' <span class="insignia aviso" title="Administrador principal: no se puede eliminar ni desactivar">PRINCIPAL</span>' : ''),
          insigniaRolUsuario(u.rol),
          esc(u.nombre_empresa || '—'),
          u.activo ? insignia('Activo', 'ok') : insignia('Inactivo')
        ];
      }),
      { clic: i => `abrirModalUsuario(_usuariosCache[${i}])` }
    );
  } catch (err) {
    $('#tabla-usuarios').innerHTML = `<div class="vacio">Error: ${esc(err.message)}</div>`;
  }
}

function abrirModalUsuario(usuario = null) {
  const ed = !!usuario;
  // El admin original (seed) solo admite cambio de contraseña/correo
  const esAdminOriginal = ed && usuario.nombre_usuario === 'admin' && usuario.rol === 'ADMIN';
  $('#modal-titulo').textContent = ed ? 'Editar usuario' : 'Nuevo usuario';

  if (esAdminOriginal) {
    $('#modal-cuerpo').innerHTML = `<div class="formulario">
      <p class="campo ancho tenue">
        Este es el <strong>administrador principal</strong> del sistema. Por seguridad,
        solo se puede cambiar su contraseña; no puede desactivarse, renombrarse ni eliminarse.
      </p>
      <div class="campo"><label for="u-fijo">Nombre de usuario</label><input id="u-fijo" value="admin" disabled></div>
      <div class="campo"><label for="u-clave">Nueva contraseña (opcional)</label><input id="u-clave" type="password" placeholder="dejar vacío para no cambiar"></div>
      <div class="campo ancho"><label for="u-correo">Correo electrónico</label><input id="u-correo" value="${usuario.correo ? esc(usuario.correo) : ''}"></div>
    </div>`;
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
  const acciones = ed ? bloqueAcciones([
    ...(usuario.rol === 'ADMIN_MULTIEMPRESA' ? [{ texto: 'Empresas asignadas', onclick: `gestionarEmpresasUsuario(${usuario.id_usuario}, ${jsArg(usuario.nombre_usuario)})` }] : []),
    { texto: 'Eliminar usuario', peligro: true, onclick: `eliminarUsuario(${usuario.id_usuario}, ${jsArg(usuario.nombre_usuario)})` }
  ]) : '';
  $('#modal-cuerpo').innerHTML = `<div class="formulario">
    <div class="campo"><label for="u-nombre">Nombre de usuario *</label><input id="u-nombre" value="${ed ? esc(usuario.nombre_usuario) : ''}"></div>
    <div class="campo"><label for="u-clave">${ed ? 'Nueva contraseña (opcional)' : 'Contraseña *'}</label><input id="u-clave" type="password" placeholder="${ed ? 'dejar vacío para no cambiar' : 'mínimo 8 caracteres'}"><span class="ayuda">Es temporal: el usuario deberá cambiarla en su próximo ingreso.</span></div>
    <div class="campo ancho"><label for="u-correo">Correo electrónico</label><input id="u-correo" value="${ed && usuario.correo ? esc(usuario.correo) : ''}"></div>
    <div class="campo"><label for="u-rol">Rol</label><select id="u-rol">
      <option value="USUARIO" ${ed && usuario.rol === 'USUARIO' ? 'selected' : ''}>Usuario</option>
      <option value="ADMIN_EMPRESA" ${ed && usuario.rol === 'ADMIN_EMPRESA' ? 'selected' : ''}>Administrador de empresa</option>
      <option value="ADMIN_MULTIEMPRESA" ${ed && usuario.rol === 'ADMIN_MULTIEMPRESA' ? 'selected' : ''}>Administrador multiempresa</option>
      <option value="ADMIN" ${ed && usuario.rol === 'ADMIN' ? 'selected' : ''}>Administrador de plataforma</option>
    </select></div>
    <div class="campo" id="campo-empresa"><label for="u-empresa">Empresa</label><select id="u-empresa"><option value="">— Seleccionar —</option>${opcionesEmpresa}</select></div>
    <div class="campo ancho" id="aviso-multiempresa">
      <span class="ayuda">Guardá el usuario y asignale empresas con «Empresas asignadas».</span>
    </div>
    ${ed ? `<div class="campo"><label for="u-activo">Estado</label><select id="u-activo"><option value="1" ${usuario.activo ? 'selected' : ''}>Activo</option><option value="0" ${!usuario.activo ? 'selected' : ''}>Inactivo</option></select></div>` : ''}
    ${acciones}
  </div>`;
  // El selector de empresa única no aplica a ADMIN ni a ADMIN_MULTIEMPRESA
  // (este último recibe sus empresas aparte, con el botón "Empresas").
  const sincronizarEmpresa = () => {
    const rol = $('#u-rol').value;
    $('#campo-empresa').hidden = (rol === 'ADMIN' || rol === 'ADMIN_MULTIEMPRESA');
    $('#aviso-multiempresa').hidden = rol !== 'ADMIN_MULTIEMPRESA';
  };
  $('#u-rol').addEventListener('change', sincronizarEmpresa);
  sincronizarEmpresa();

  configurarGuardado(async () => {
    const rol = $('#u-rol').value;
    const sinEmpresa = rol === 'ADMIN' || rol === 'ADMIN_MULTIEMPRESA';
    const datos = {
      nombre_usuario: $('#u-nombre').value.trim(),
      correo: $('#u-correo').value.trim(),
      rol,
      id_empresa: sinEmpresa ? null : ($('#u-empresa').value || null)
    };
    const clave = $('#u-clave').value;
    if (clave) datos.contrasena = clave;
    if (!datos.nombre_usuario) { mostrarToast('El nombre de usuario es obligatorio.', true); return false; }
    if (!ed && !clave) { mostrarToast('La contraseña es obligatoria.', true); return false; }
    if (!sinEmpresa && !datos.id_empresa) { mostrarToast('Un usuario operativo debe tener empresa.', true); return false; }
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
  if (!await confirmar('Esta acción no se puede deshacer.', 'Eliminar usuario', `¿Eliminar al usuario «${nombre}»?`)) return;
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
