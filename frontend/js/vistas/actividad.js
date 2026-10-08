// frontend/js/vistas/actividad.js
// Bitácora de actividad: quién hizo qué, cuándo, desde qué IP y con qué
// resultado. La usan el ADMIN (todas las empresas), el administrador de
// empresa y el multiempresa (solo la empresa con la que operan). Es una tabla
// sin scroll lateral: el rol y la empresa van como segunda línea, y el resto
// (navegador, pedido, motivo del error) en «Ver detalle». Las funciones son
// globales a propósito: las usan los onclick="..." del HTML generado. El
// orden de carga está en index.html (después de sistema.js).

const ETIQUETA_ACCION = {
  INGRESO: 'Ingreso', CAMBIO_CONTRASENA: 'Cambio de contraseña', CREAR: 'Alta', EDITAR: 'Modificación',
  ELIMINAR: 'Baja', GENERAR: 'Generar', DESCARGAR: 'Descarga', MODULOS: 'Módulos', CERTIFICADO: 'Subir certificado',
  AVANZAR_ESTADO: 'Avanzar estado'
};
const ETIQUETA_ENTIDAD = {
  auth: 'Sesión', usuarios: 'Usuario', empresas: 'Empresa', certificados: 'Certificado ARCA', certificado: 'Certificado ARCA',
  'datos-fiscales': 'Datos de la empresa', choferes: 'Chofer', unidades: 'Unidad', equipos: 'Equipo', viajes: 'Viaje',
  'consumos-combustible': 'Combustible', 'consumos-generales': 'Consumo general', cuentas: 'Cuenta', movimientos: 'Movimiento',
  stock: 'Stock', mantenimientos: 'Mantenimiento', vencimientos: 'Vencimiento', cubiertas: 'Cubierta',
  'gastos-administrativos': 'Gasto administrativo', facturacion: 'Facturación', 'cuentas-corrientes': 'Cuenta corriente',
  respaldos: 'Respaldo'
};
const ROL_CORTO = { ADMIN: 'Administrador', ADMIN_EMPRESA: 'Admin. de empresa', ADMIN_MULTIEMPRESA: 'Admin. multiempresa', USUARIO: 'Usuario' };
const etiquetaAccion = a => ETIQUETA_ACCION[a] || String(a || '').replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase());
const etiquetaEntidad = e => ETIQUETA_ENTIDAD[e] || e || '—';

let _filasAuditoria = [];

// cargar(params) → { datos, paginacion, filtros }. global: muestra la empresa (ADMIN).
async function renderActividad({ titulo, sub, cargar, global = false, empresas = [] }) {
  contenido.innerHTML = `
    <div class="vista-cab">
      <div><h1>${titulo}</h1><p>${sub}</p></div>
      <div class="acciones"><button class="btn" id="aud-recargar">Actualizar</button></div>
    </div>
    <div class="filtros">
      ${global ? `<select class="entrada" id="aud-empresa" aria-label="Empresa"><option value="">Todas las empresas</option>${empresas.map(e => `<option value="${e.id_empresa}">${esc(e.nombre)}</option>`).join('')}</select>` : ''}
      <select class="entrada" id="aud-accion" aria-label="Acción"><option value="">Todas las acciones</option></select>
      <select class="entrada" id="aud-entidad" aria-label="Entidad"><option value="">Todas las entidades</option></select>
      <select class="entrada" id="aud-estado" aria-label="Estado">
        <option value="">Todos los estados</option><option value="OK">Correctas</option><option value="ERROR">Con error</option>
      </select>
      <input class="entrada" id="aud-q" placeholder="Usuario, IP o N°…" aria-label="Buscar">
    </div>
    <div class="filtros">
      <div class="campo"><label for="aud-desde">Desde</label><input type="date" id="aud-desde" value="${fechaISO(-7)}"></div>
      <div class="campo"><label for="aud-hasta">Hasta</label><input type="date" id="aud-hasta" value="${fechaISO(0)}"></div>
    </div>
    <section class="hoja" id="aud-tabla"><div class="vacio">Cargando…</div></section>`;

  let llenoFiltros = false;
  const params = pagina => ({
    pagina, por_pagina: 50,
    id_empresa: $('#aud-empresa')?.value || '',
    accion: $('#aud-accion').value, entidad: $('#aud-entidad').value, estado: $('#aud-estado').value,
    q: $('#aud-q').value.trim(), desde: $('#aud-desde').value, hasta: $('#aud-hasta').value
  });
  const pintar = async (pagina = 1) => {
    try {
      const r = await cargar(params(pagina));
      if (!llenoFiltros) {
        $('#aud-accion').innerHTML += r.filtros.acciones.map(a => `<option value="${esc(a)}">${esc(etiquetaAccion(a))}</option>`).join('');
        $('#aud-entidad').innerHTML += r.filtros.entidades.map(e => `<option value="${esc(e)}">${esc(etiquetaEntidad(e))}</option>`).join('');
        llenoFiltros = true;
      }
      _filasAuditoria = r.datos;
      if (!r.datos.length) { $('#aud-tabla').innerHTML = '<div class="vacio">No hay actividad para ese filtro.</div>'; return; }
      $('#aud-tabla').innerHTML = tablaSimple(
        ['Fecha y hora', 'Usuario', 'Acción', 'Entidad afectada', 'IP', 'Estado', ''],
        r.datos.map(a => [
          `<td class="nowrap"><div class="celda-doble"><b>${fmtFecha(a.fecha)}</b><span>${new Date(a.fecha).toLocaleTimeString('es-AR')}</span></div></td>`,
          `<div class="celda-doble"><b>${esc(a.nombre_usuario || '—')}</b><span>${esc(ROL_CORTO[a.rol] || a.rol || 'sin sesión')}${global && a.nombre_empresa ? ', ' + esc(a.nombre_empresa) : ''}</span></div>`,
          esc(etiquetaAccion(a.accion)),
          `<div class="celda-doble"><b>${esc(etiquetaEntidad(a.entidad))}</b><span>${a.id_entidad ? '#' + esc(a.id_entidad) : '&nbsp;'}</span></div>`,
          `<td class="mono nowrap">${esc(a.ip || '—')}</td>`,
          `<td class="nowrap">${a.estado === 'OK' ? insignia('Correcto', 'ok') : insignia('Error', 'peligro')}</td>`,
          `<td class="num nowrap"><button class="btn btn-chico" onclick="event.stopPropagation(); verDetalleAuditoria(${a.id_auditoria})">Ver detalle</button></td>`
        ]),
        { clic: i => `verDetalleAuditoria(${r.datos[i].id_auditoria})` }
      ) + controlesPaginacion(r.paginacion, pintar);
    } catch (err) {
      $('#aud-tabla').innerHTML = `<div class="vacio">Error: ${esc(err.message)}</div>`;
    }
  };

  let temporizador;
  $('#aud-q').addEventListener('input', () => { clearTimeout(temporizador); temporizador = setTimeout(() => pintar(1), 350); });
  ['aud-empresa', 'aud-accion', 'aud-entidad', 'aud-estado', 'aud-desde', 'aud-hasta'].forEach(id => $('#' + id)?.addEventListener('change', () => pintar(1)));
  $('#aud-recargar').addEventListener('click', () => pintar(1));
  pintar(1);
}

function verDetalleAuditoria(id) {
  const a = _filasAuditoria.find(x => x.id_auditoria === id);
  if (!a) return;
  const dato = (rot, valor) => `<div class="ficha-dato"><span class="rotulo">${rot}</span><b>${valor}</b></div>`;
  $('#modal-titulo').textContent = 'Detalle de la actividad';
  $('#modal-cuerpo').innerHTML = `<div class="ficha-datos ficha-detalle">
    ${dato('Fecha y hora', fmtFechaHoraCompleta(a.fecha))}
    ${dato('Estado', a.estado === 'OK' ? insignia('Correcto', 'ok') : insignia('Error', 'peligro'))}
    ${dato('Usuario', esc(a.nombre_usuario || '—'))}
    ${dato('Rol', esc(ROL_CORTO[a.rol] || a.rol || '—'))}
    ${dato('Empresa', esc(a.nombre_empresa || '—'))}
    ${dato('IP', `<span class="mono">${esc(a.ip || '—')}</span>`)}
    ${dato('Acción', esc(etiquetaAccion(a.accion)))}
    ${dato('Entidad afectada', `${esc(etiquetaEntidad(a.entidad))}${a.id_entidad ? ' #' + esc(a.id_entidad) : ''}`)}
    ${dato('Pedido', `<span class="mono">${esc(a.metodo)} ${esc(a.ruta)}</span>`)}
    ${dato('Código de respuesta', esc(a.codigo_http))}
    ${a.detalle ? dato('Motivo del error', esc(a.detalle)) : ''}
    ${dato('Navegador', esc(a.navegador || '—'))}
  </div>`;
  $('#btn-guardar').hidden = true;
  $('#modal-fondo').hidden = false;
}

async function renderAdminActividad() {
  const empresas = await API.listarEmpresas().catch(() => []);
  renderActividad({
    titulo: 'Actividad', global: true, empresas,
    sub: 'Ingresos y cambios en el sistema, de todas las empresas. Se conserva un año.',
    cargar: p => API.adminAuditoria(p)
  });
}
function renderMiEmpresaActividad() {
  renderActividad({
    titulo: 'Actividad', sub: 'Ingresos y cambios hechos por los usuarios de tu empresa. Se conserva un año.',
    cargar: p => API.miEmpresaAuditoria(p)
  });
}
function renderMultiempresaActividad() {
  renderActividad({
    titulo: 'Actividad', sub: 'Ingresos y cambios de la empresa con la que estás operando. Se conserva un año.',
    cargar: p => API.multiempresaAuditoria(p)
  });
}
