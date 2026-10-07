// frontend/js/vistas/sistema.js
// Herramientas del administrador de plataforma (solo ADMIN): certificados
// ARCA de todas las empresas, registros del servidor y respaldos de la base.
// Las empresas y los usuarios están en admin.js. Las funciones son globales
// a propósito: las usan los onclick="..." del HTML generado y los demás
// archivos. El orden de carga está en index.html.

const fmtFechaHoraCompleta = f => {
  if (!f) return '—';
  const d = new Date(f);
  return isNaN(d) ? esc(f) : d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const fmtTamano = bytes => {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${fmtNum(bytes / 1024, 1)} KB`;
  return `${fmtNum(bytes / 1024 / 1024, 1)} MB`;
};

// ============================================================
// Certificados ARCA de todas las empresas
// ============================================================
let _certificadosEmpresas = [];

function insigniaCertificado(cert) {
  if (!cert) return insignia('Sin certificado', 'sin-punto');
  if (cert.estado === 'CSR_GENERADO') return insignia('Falta subir el .crt', 'aviso');
  const vencido = cert.fecha_vencimiento && new Date(cert.fecha_vencimiento) < new Date();
  if (vencido || cert.estado === 'VENCIDO') return insignia('Vencido', 'peligro');
  return insignia('Activo', 'ok');
}

async function renderAdminCertificados() {
  contenido.innerHTML = `
    <div class="vista-cab">
      <div>
        <h1>Certificados ARCA</h1>
        <p>Certificado de facturación electrónica de cada empresa. Tocá una fila para generarlo, subirlo o renovarlo.</p>
      </div>
      <div class="acciones"><button class="btn" id="btn-recargar-certs">Actualizar</button></div>
    </div>
    <section class="hoja" id="tabla-certificados"><div class="vacio">Cargando…</div></section>`;
  $('#btn-recargar-certs').addEventListener('click', renderAdminCertificados);
  try {
    const empresas = await API.listarEmpresas();
    const estados = await Promise.all(empresas.map(e => API.certificadoEstado(e.id_empresa).catch(() => ({ certificado: null }))));
    _certificadosEmpresas = empresas;
    if (!empresas.length) {
      $('#tabla-certificados').innerHTML = '<div class="vacio">Sin empresas. Creá la primera desde «Empresas».</div>';
      return;
    }
    const activos = estados.filter(s => s.certificado && s.certificado.estado === 'ACTIVO').length;
    $('#tabla-certificados').innerHTML = cabeceraTablaAdmin(`${empresas.length} empresa${empresas.length === 1 ? '' : 's'}`, `${activos} con certificado activo`) + tablaSimple(
      ['Empresa', 'Estado', 'Vence'],
      empresas.map((e, i) => {
        const cert = estados[i].certificado;
        return [
          `<div class="empresa-celda"><span class="avatar">${esc(e.iniciales || derivarIniciales(e.nombre))}</span><div class="celda-doble"><b>${esc(e.nombre)}</b><span class="mono">${esc(e.cuit || 'sin CUIT')}</span></div></div>`,
          insigniaCertificado(cert),
          `<td class="nowrap">${cert && cert.fecha_vencimiento ? fmtFecha(cert.fecha_vencimiento) : '—'}</td>`
        ];
      }),
      { clic: i => `abrirCertificadoDeLista(${i})` }
    );
  } catch (err) {
    $('#tabla-certificados').innerHTML = `<div class="vacio">Error: ${esc(err.message)}</div>`;
  }
}

function abrirCertificadoDeLista(i) {
  const e = _certificadosEmpresas[i];
  abrirModalCertificado(e.id_empresa, e.nombre, e.cuit || '');
}

// ============================================================
// Registros del servidor
// ============================================================
const INSIGNIA_NIVEL = { info: 'info', aviso: 'aviso', error: 'peligro' };

async function renderAdminLogs() {
  contenido.innerHTML = `
    <div class="vista-cab">
      <div>
        <h1>Registros del servidor</h1>
        <p>Lo que el servidor fue registrando desde que arrancó: errores, avisos y actividad.</p>
      </div>
      <div class="acciones"><button class="btn" id="btn-recargar-logs">Actualizar</button></div>
    </div>
    <div class="filtros">
      <select class="entrada" id="logs-origen" aria-label="Origen">
        <option value="memoria">Desde el último arranque</option>
        <option value="salida">Archivo de salida (PM2)</option>
        <option value="errores">Archivo de errores (PM2)</option>
      </select>
      <select class="entrada" id="logs-nivel" aria-label="Nivel">
        <option value="">Todos los niveles</option>
        <option value="error">Solo errores</option>
        <option value="aviso">Solo avisos</option>
        <option value="info">Solo información</option>
      </select>
      <input class="entrada" id="logs-q" placeholder="Buscar en los mensajes…" aria-label="Buscar">
    </div>
    <section class="hoja" id="logs-lista"><div class="vacio">Cargando…</div></section>`;

  const cargar = async () => {
    const origen = $('#logs-origen').value;
    // El nivel solo se filtra en los registros de memoria; los archivos ya son de un solo tipo
    $('#logs-nivel').disabled = origen !== 'memoria';
    try {
      const r = await API.adminLogs({ origen, nivel: origen === 'memoria' ? $('#logs-nivel').value : '', q: $('#logs-q').value.trim(), limite: 300 });
      if (!r.entradas.length) {
        $('#logs-lista').innerHTML = `<div class="vacio">${esc(r.aviso || 'No hay registros para ese filtro.')}</div>`;
        return;
      }
      $('#logs-lista').innerHTML = cabeceraTablaAdmin(`${r.entradas.length} registro${r.entradas.length === 1 ? '' : 's'}`, 'Los más nuevos primero') + `
        <div class="registros">${r.entradas.map(e => `
          <div class="registro ${esc(e.nivel)}">
            <div class="registro-meta">${insignia(e.nivel === 'aviso' ? 'Aviso' : e.nivel === 'error' ? 'Error' : 'Info', INSIGNIA_NIVEL[e.nivel] || '')}<span class="tenue">${fmtFechaHoraCompleta(e.fecha)}</span></div>
            <pre class="registro-texto">${esc(e.mensaje)}</pre>
          </div>`).join('')}</div>`;
    } catch (err) {
      $('#logs-lista').innerHTML = `<div class="vacio">Error: ${esc(err.message)}</div>`;
    }
  };

  let temporizador;
  $('#logs-q').addEventListener('input', () => { clearTimeout(temporizador); temporizador = setTimeout(cargar, 350); });
  ['logs-origen', 'logs-nivel'].forEach(id => $('#' + id).addEventListener('change', cargar));
  $('#btn-recargar-logs').addEventListener('click', cargar);
  cargar();
}

// ============================================================
// Respaldos de la base
// ============================================================
let _respaldos = [];

async function renderAdminRespaldos() {
  contenido.innerHTML = `
    <div class="vista-cab">
      <div>
        <h1>Respaldos</h1>
        <p>Copias de la base de datos que el servidor genera cada día. Los archivos son una copia completa: descargalos solo si los necesitás y guardalos en un lugar seguro.</p>
      </div>
      <div class="acciones"><button class="btn" id="btn-recargar-respaldos">Actualizar</button></div>
    </div>
    <div id="respaldos-estado"></div>
    <section class="hoja" id="tabla-respaldos"><div class="vacio">Cargando…</div></section>`;
  $('#btn-recargar-respaldos').addEventListener('click', renderAdminRespaldos);
  try {
    const r = await API.adminRespaldos();
    if (!r.disponible) {
      $('#tabla-respaldos').innerHTML = `<div class="vacio">Este servidor no tiene acceso a la carpeta de respaldos (<span class="mono">${esc(r.directorio)}</span>).<br>Indicá su ubicación con la variable <span class="mono">RESPALDOS_DIR</span> del .env${' '}(con Docker, se monta en <span class="mono">docker-compose.yml</span>).</div>`;
      return;
    }
    _respaldos = r.respaldos;
    const ultimo = r.respaldos[0];
    const horas = ultimo ? (Date.now() - new Date(ultimo.fecha).getTime()) / 36e5 : null;
    $('#respaldos-estado').innerHTML = `
      <section class="hoja"><div class="hoja-cuerpo"><div class="ficha-datos">
        <div class="ficha-dato"><span class="rotulo">Último respaldo</span><b>${ultimo ? fmtFechaHoraCompleta(ultimo.fecha) : '—'}</b></div>
        <div class="ficha-dato"><span class="rotulo">Estado</span><b>${ultimo ? (horas <= 36 ? insignia('Al día', 'ok') : insignia(`Hace ${Math.floor(horas / 24)} días`, 'peligro')) : insignia('Sin respaldos', 'peligro')}</b></div>
        <div class="ficha-dato"><span class="rotulo">Última copia a Drive</span><b>${r.ultimoSubido ? esc(r.ultimoSubido.split(' ').slice(0, 2).join(' ')) : '—'}</b></div>
        <div class="ficha-dato"><span class="rotulo">Guardados</span><b>${r.respaldos.length}</b></div>
      </div></div></section>`;
    $('#tabla-respaldos').innerHTML = !r.respaldos.length
      ? '<div class="vacio">Todavía no hay respaldos en la carpeta.</div>'
      : cabeceraTablaAdmin('Respaldos disponibles', 'Los más nuevos primero') + tablaSimple(
          ['Archivo', 'Fecha', 'Tamaño', ''],
          r.respaldos.map((b, i) => [
            `<div class="celda-doble"><b class="mono">${esc(b.nombre)}</b><span>${b.tablas != null ? `${b.tablas} tablas verificadas` : 'sin verificación de tablas'}</span></div>`,
            `<td class="nowrap">${fmtFechaHoraCompleta(b.fecha)}</td>`,
            `<td class="num nowrap">${fmtTamano(b.tamano)}</td>`,
            `<td class="num"><button class="btn btn-chico" onclick="descargarRespaldo(${i})">Descargar</button></td>`
          ])
        );
  } catch (err) {
    $('#tabla-respaldos').innerHTML = `<div class="vacio">Error: ${esc(err.message)}</div>`;
  }
}

async function descargarRespaldo(i) {
  const b = _respaldos[i];
  if (!b) return;
  try { await API.descargarRespaldo(b.nombre); }
  catch (err) { mostrarToast(err.message, true); }
}
