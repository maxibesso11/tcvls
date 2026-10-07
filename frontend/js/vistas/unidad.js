// frontend/js/vistas/unidad.js
// Unidades: grilla de fichas (la patente es la identidad de cada unidad) y la
// ficha de una unidad con sus pestañas. Las funciones son globales a propósito:
// las usan los onclick="..." del HTML generado y los demás archivos. El orden
// de carga está en index.html.

// Siluetas SVG del equipo: tractor (caja, cabina, 2 ruedas) y acoplado (3 ruedas)
function siluetaTractor() {
  return '<svg class="comp-silueta" viewBox="0 0 92 46" width="92" height="46" aria-hidden="true"><rect class="caja" x="2" y="8" width="44" height="26" rx="2"/><path class="cabina" d="M48 12h22l14 12v10H48z"/><circle class="rueda" cx="16" cy="38" r="7"/><circle class="llanta" cx="16" cy="38" r="2.5"/><circle class="rueda" cx="70" cy="38" r="7"/><circle class="llanta" cx="70" cy="38" r="2.5"/></svg>';
}
function siluetaAcoplado() {
  return '<svg class="comp-silueta" viewBox="0 0 120 46" width="120" height="46" aria-hidden="true"><rect class="caja" x="2" y="6" width="116" height="28" rx="2"/><circle class="rueda" cx="74" cy="38" r="7"/><circle class="llanta" cx="74" cy="38" r="2.5"/><circle class="rueda" cx="92" cy="38" r="7"/><circle class="llanta" cx="92" cy="38" r="2.5"/><circle class="rueda" cx="110" cy="38" r="7"/><circle class="llanta" cx="110" cy="38" r="2.5"/></svg>';
}

// Marcas de una unidad: lo vencido o por vencer, siempre con palabra.
function marcasUnidad(vencimientos, mantenimientos) {
  const marcas = [];
  const d = lista => lista.map(x => diasHasta(x.fecha_vencimiento)).filter(n => n !== null);
  const venc = d(vencimientos), mant = d(mantenimientos);
  const vencidos = venc.filter(n => n < 0).length;
  const pronto = venc.filter(n => n >= 0 && n <= 15).length;
  const mantPronto = mant.filter(n => n <= 7).length;
  if (vencidos) marcas.push(`<span class="insignia peligro">${vencidos} VENCIDO${vencidos === 1 ? '' : 'S'}</span>`);
  if (pronto) marcas.push(`<span class="insignia aviso">${pronto} POR VENCER</span>`);
  if (mantPronto) marcas.push(`<span class="insignia aviso">MANTENIMIENTO PRÓXIMO</span>`);
  return marcas.join('');
}

// ============================================================
// Lista de unidades
// ============================================================
let _unidadesLista = [];
let _unidadesExtra = null;

async function renderUnidades() {
  moduloActual = 'unidades';
  contenido.innerHTML = `
    <div class="vista-cab">
      <div>
        <h1>Unidades</h1>
        <p>Vehículos de la flota: chasis, tractores, acoplados y bateas.</p>
      </div>
      <div class="acciones"><button class="btn btn-primario" id="btn-nueva-unidad">${icono('mas')}Nueva unidad</button></div>
    </div>
    <div class="filtros">
      <input class="entrada" id="buscador-unidades" placeholder="Buscar patente o modelo…" aria-label="Buscar unidad">
      <select class="entrada" id="filtro-funcionalidad" aria-label="Funcionalidad">
        <option value="">Todas</option>
        <option value="PRINCIPAL">Principales</option>
        <option value="SECUNDARIA">Secundarias</option>
      </select>
    </div>
    <div id="unidades-grilla"><div class="vacio">Cargando…</div></div>`;
  $('#btn-nueva-unidad').addEventListener('click', () => abrirModal('unidades', null));

  try {
    const [unidades, equipos, vencimientos, mantenimientos] = await Promise.all([
      API.listarTodo('unidades'), API.listarTodo('equipos'),
      API.listarTodo('vencimientos'), API.listarTodo('mantenimientos')
    ]);
    _unidadesLista = unidades;
    _unidadesExtra = { equipos, vencimientos, mantenimientos };
    pintarUnidades();
    $('#buscador-unidades').addEventListener('input', pintarUnidades);
    $('#filtro-funcionalidad').addEventListener('change', pintarUnidades);
  } catch (err) {
    $('#unidades-grilla').innerHTML = `<div class="vacio">Error: ${esc(err.message)}</div>`;
  }
}

function pintarUnidades() {
  const q = ($('#buscador-unidades')?.value || '').trim().toLowerCase();
  const func = $('#filtro-funcionalidad')?.value || '';
  const { equipos, vencimientos, mantenimientos } = _unidadesExtra;
  const lista = _unidadesLista.filter(u =>
    (!func || u.funcionalidad === func) &&
    (!q || `${u.patente} ${u.modelo}`.toLowerCase().includes(q)));
  if (!lista.length) {
    $('#unidades-grilla').innerHTML = `<div class="vacio">${_unidadesLista.length ? 'No hay unidades para ese filtro.' : 'No hay unidades. Usá «Nueva unidad» para cargar la primera.'}</div>`;
    return;
  }
  $('#unidades-grilla').innerHTML = `<div class="unidades">${lista.map(u => {
    const misVenc = vencimientos.filter(v => v.id_unidad === u.id_unidad);
    const misMant = mantenimientos.filter(m => m.id_unidad === u.id_unidad);
    const nEquipos = equipos.filter(e => e.id_unidad_principal === u.id_unidad || e.id_unidad_secundaria === u.id_unidad).length;
    return `
      <button class="unidad-ficha" onclick="location.hash='unidad-detalle/${u.id_unidad}'">
        <div class="fila">${patenteHTML(u.patente, '')}${insigniaEstado(u.funcionalidad)}</div>
        <div class="modelo">${esc(u.modelo)}</div>
        <div class="marcas">${marcasUnidad(misVenc, misMant)}</div>
        <div class="datos">
          <div><b>${nEquipos}</b><span>Equipos</span></div>
          <div><b>${misVenc.length}</b><span>Vencim.</span></div>
          <div><b>${misMant.length}</b><span>Mant.</span></div>
        </div>
      </button>`;
  }).join('')}</div>`;
}

// ============================================================
// Ficha de una unidad
// ============================================================
let _tabUnidad = 'resumen';
let _fichaUnidad = null; // { unidad, misMant, misCub, misVenc } para las filas clicables

async function renderUnidadDetalle(idStr) {
  const idUnidad = Number(idStr);
  contenido.innerHTML = '<div class="vacio">Cargando ficha de la unidad…</div>';

  try {
    const respuestaUnidades = await API.listar('unidades', '', '', '', {}, 1);
    let unidad = respuestaUnidades.datos.find(u => u.id_unidad === idUnidad);
    if (!unidad) unidad = (await API.listarTodo('unidades')).find(u => u.id_unidad === idUnidad);
    if (!unidad) throw new Error('Unidad no encontrada');

    // Datos relacionados (listarTodo por simplicidad; con muchos datos
    // convendría un endpoint propio en el backend).
    const [equipos, mantenimientos, cubiertas, vencimientos, choferes, unidades] = await Promise.all([
      API.listarTodo('equipos'),
      API.listarTodo('mantenimientos'),
      API.listarTodo('cubiertas'),
      API.listarTodo('vencimientos'),
      API.listarTodo('choferes'),
      API.listarTodo('unidades')
    ]);
    const patenteDe = id => (unidades.find(u => u.id_unidad === id) || {}).patente || '?';
    const chofer = id => choferes.find(c => c.id_chofer === id);

    const misEquipos = equipos.filter(e => e.id_unidad_principal === idUnidad || e.id_unidad_secundaria === idUnidad);
    const misMant = mantenimientos.filter(m => m.id_unidad === idUnidad)
      .sort((a, b) => String(a.fecha_vencimiento).localeCompare(String(b.fecha_vencimiento)));
    const misCub = cubiertas.filter(c => c.id_unidad === idUnidad);
    const misVenc = vencimientos.filter(v => v.id_unidad === idUnidad)
      .sort((a, b) => String(a.fecha_vencimiento).localeCompare(String(b.fecha_vencimiento)));
    _fichaUnidad = { unidad, misMant, misCub, misVenc };

    // Lo que se carga desde la ficha queda de esta unidad: la unidad no se puede cambiar
    const OPC_UNIDAD = `{ fijos: ['id_unidad'] }`;
    const OPC_NUEVO = `{ valores: { id_unidad: ${idUnidad} }, fijos: ['id_unidad'] }`;
    const botonNuevo = (clave, texto) => `<button class="btn btn-chico btn-primario" onclick="abrirModal('${clave}', null, ${OPC_NUEVO})">${icono('mas')}${texto}</button>`;

    const equipo = misEquipos[0];
    const choferActual = equipo ? chofer(equipo.id_chofer) : null;
    const vencidos = misVenc.filter(v => diasHasta(v.fecha_vencimiento) < 0).length;

    // --- Pestañas ---
    const alertasUnidad = [
      ...misVenc.map(v => ({ dias: diasHasta(v.fecha_vencimiento), titulo: esc(v.concepto), detalle: `Vencimiento documental · ${fmtFecha(v.fecha_vencimiento)}`, abrir: `abrirModal('vencimientos', ${v.id_vencimiento}, ${OPC_UNIDAD})`, accion: 'Renovar' })),
      ...misMant.map(m => ({ dias: diasHasta(m.fecha_vencimiento), titulo: esc(m.concepto), detalle: `Mantenimiento · ${esc(m.periodicidad)} · ${fmtFecha(m.fecha_vencimiento)}`, abrir: `abrirModal('mantenimientos', ${m.id_mantenimiento}, ${OPC_UNIDAD})`, accion: 'Programar' }))
    ].filter(a => a.dias !== null && a.dias <= 30).sort((a, b) => a.dias - b.dias);

    const composicion = equipo ? `
      <div class="composicion">
        <div class="comp-pieza ${equipo.id_unidad_principal === idUnidad ? 'actual' : ''}" role="link" tabindex="0" onclick="location.hash='unidad-detalle/${equipo.id_unidad_principal}'" onkeydown="if (event.key === 'Enter') location.hash='unidad-detalle/${equipo.id_unidad_principal}'">${siluetaTractor()}${patenteHTML(patenteDe(equipo.id_unidad_principal), '')}</div>
        <div class="comp-enganche"></div>
        <div class="comp-pieza ${equipo.id_unidad_secundaria === idUnidad ? 'actual' : ''}" role="link" tabindex="0" onclick="location.hash='unidad-detalle/${equipo.id_unidad_secundaria}'" onkeydown="if (event.key === 'Enter') location.hash='unidad-detalle/${equipo.id_unidad_secundaria}'">${siluetaAcoplado()}${patenteHTML(patenteDe(equipo.id_unidad_secundaria), '')}</div>
        <div class="comp-chofer"><span class="rotulo">Chofer</span><b>${choferActual ? esc(choferActual.nombre) : '—'}</b></div>
      </div>` : '<div class="vacio">Esta unidad no integra ningún equipo todavía.</div>';

    const paneles = {
      resumen: `
        <div class="grilla-2">
          ${hojaHTML('Equipo', 'Composición actual: camión, acoplado y chofer', `<div class="hoja-cuerpo">${composicion}</div>`,
            '<button class="btn btn-chico" onclick="location.hash=\'equipos\'">Gestionar equipos</button>')}
          ${hojaHTML('Alertas de la unidad', 'Vencimientos y mantenimientos de los próximos 30 días',
            alertasUnidad.length
              ? `<ul class="alertas">${alertasUnidad.map(a => alertaHTML({ dias: a.dias, titulo: a.titulo, detalle: a.detalle, accion: `<button class="btn btn-chico" onclick="${a.abrir}">${a.accion}</button>` })).join('')}</ul>`
              : '<div class="vacio">Sin alertas. Todo en orden.</div>')}
        </div>`,
      equipo: hojaHTML('Equipos y choferes', 'Equipos en los que participa la unidad y el chofer de cada uno',
        misEquipos.length === 0 ? '<div class="vacio">No hay equipos vinculados a esta unidad.</div>' : tablaSimple(
          ['Equipo', 'Chofer actual', 'Tara', 'Bruto'],
          misEquipos.map(e => [
            patentesEquipo({ patente_principal: patenteDe(e.id_unidad_principal), patente_secundaria: patenteDe(e.id_unidad_secundaria) }),
            esc((chofer(e.id_chofer) || {}).nombre || e.id_chofer),
            `<td class="num">${e.peso_tara != null ? fmtNum(e.peso_tara, 0) + ' kg' : '—'}</td>`,
            `<td class="num">${e.peso_bruto != null ? fmtNum(e.peso_bruto, 0) + ' kg' : '—'}</td>`
          ]),
          { clic: i => `abrirModal('equipos', ${misEquipos[i].id_equipo})` }
        ),
        '<button class="btn btn-chico" onclick="location.hash=\'equipos\'">Gestionar equipos</button>'),
      mantenimientos: hojaHTML('Historial de mantenimientos', '',
        misMant.length === 0 ? '<div class="vacio">No hay mantenimientos.</div>' : tablaSimple(
          ['Concepto', 'Periodicidad', 'Último realizado', 'Próximo venc.', 'Estado'],
          misMant.map(m => {
            const d = diasHasta(m.fecha_vencimiento);
            return [
              `<td class="fuerte">${esc(m.concepto)}</td>`, esc(m.periodicidad), fmtFecha(m.fecha), fmtFecha(m.fecha_vencimiento),
              d === null ? '—' : d < 0 ? insignia('Vencido', 'peligro') : d <= 7 ? insignia(`En ${d} días`, 'aviso') : insignia('Al día', 'ok')
            ];
          }),
          { clic: i => `abrirModal('mantenimientos', ${misMant[i].id_mantenimiento}, ${OPC_UNIDAD})` }
        ),
        botonNuevo('mantenimientos', 'Nuevo mantenimiento')),
      cubiertas: hojaHTML('Ruedas', 'Cubiertas de la unidad: estado y ubicación',
        misCub.length === 0 ? '<div class="vacio">No hay registros de cubiertas.</div>' : tablaSimple(
          ['Identificador', 'Estado', 'Ubicación', 'Colocada'],
          misCub.map(c => [
            `<td class="mono">${esc(c.identificador || '—')}</td>`, insigniaEstado(String(c.estado || '').toUpperCase()), insigniaEstado(c.ubicacion), fmtFecha(c.fecha_colocacion)
          ]),
          { clic: i => `abrirModal('cubiertas', ${misCub[i].id_cubierta}, ${OPC_UNIDAD})` }
        ),
        botonNuevo('cubiertas', 'Nueva cubierta')),
      vencimientos: hojaHTML('Vencimientos documentales', '',
        misVenc.length === 0 ? '<div class="vacio">No hay vencimientos cargados.</div>' :
          `<ul class="alertas">${misVenc.map(v => alertaHTML({
            dias: diasHasta(v.fecha_vencimiento), titulo: esc(v.concepto), detalle: `Vencimiento documental · ${fmtFecha(v.fecha_vencimiento)}`,
            accion: `<button class="btn btn-chico" onclick="abrirModal('vencimientos', ${v.id_vencimiento}, ${OPC_UNIDAD})">Editar</button>`
          })).join('')}</ul>`,
        botonNuevo('vencimientos', 'Nuevo vencimiento'))
    };

    const pestañas = [
      { id: 'resumen', texto: 'Resumen' },
      { id: 'equipo', texto: 'Equipos y choferes', cuenta: misEquipos.length },
      { id: 'mantenimientos', texto: 'Mantenimientos', cuenta: misMant.length },
      { id: 'cubiertas', texto: 'Ruedas', cuenta: misCub.length },
      { id: 'vencimientos', texto: 'Vencimientos', cuenta: misVenc.length, peligro: vencidos }
    ];
    if (!paneles[_tabUnidad]) _tabUnidad = 'resumen';

    contenido.innerHTML = `
      <div class="migas"><button onclick="location.hash='unidades'">Unidades</button> / ${esc(unidad.patente)}</div>
      <div class="ficha-pila">
        <header class="ficha-cabecera">
          ${patenteHTML(unidad.patente, 'grande')}
          <div>
            <h1 class="hoja-titulo">${esc(unidad.modelo)}</h1>
            <div class="marcas">${insigniaEstado(unidad.funcionalidad)}${marcasUnidad(misVenc, misMant)}</div>
          </div>
          <div class="ficha-datos">
            <div class="ficha-dato"><span class="rotulo">Equipos</span><b>${misEquipos.length}</b></div>
            <div class="ficha-dato"><span class="rotulo">Chofer</span><b>${choferActual ? esc(choferActual.nombre) : '—'}</b></div>
            <div class="ficha-dato"><span class="rotulo">Cubiertas</span><b>${misCub.length}</b></div>
          </div>
          <div class="acciones">
            <button class="btn btn-primario" onclick="abrirModal('unidades', ${idUnidad})">Editar datos de la unidad</button>
          </div>
        </header>
        <nav class="ficha-tabs"><div class="tabs" role="tablist">
          ${pestañas.map(t => `<button class="tab" role="tab" aria-selected="${t.id === _tabUnidad}" onclick="mostrarTabUnidad('${t.id}')" data-tab="${t.id}">${t.texto}${t.cuenta ? ` <span class="cuenta${t.peligro ? ' peligro' : ''}">${t.peligro || t.cuenta}</span>` : ''}</button>`).join('')}
        </div></nav>
        <div class="ficha-cuerpo">
          ${Object.entries(paneles).map(([id, html]) => `<div data-panel="${id}" ${id === _tabUnidad ? '' : 'hidden'}>${html}</div>`).join('')}
        </div>
      </div>
    `;
  } catch (err) {
    contenido.innerHTML = `<div class="vacio">Error: ${esc(err.message)}</div>`;
  }
}

function mostrarTabUnidad(id) {
  _tabUnidad = id;
  document.querySelectorAll('.ficha-tabs .tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
  document.querySelectorAll('.ficha-cuerpo [data-panel]').forEach(p => { p.hidden = p.dataset.panel !== id; });
}
