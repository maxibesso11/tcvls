// frontend/js/vistas/crud.js
// Vistas CRUD genéricas por módulo: tabla con filtros y paginación,
// modal de alta/edición, guardado y eliminación.
// Las funciones son globales a propósito: las usan los onclick="..." del HTML
// generado y los demás archivos. El orden de carga está en index.html.

// ============================================================
// Vistas CRUD por módulo
// ============================================================
let moduloActual = null;
let registroEditando = null;
let _registroActual = null;

async function renderModulo(clave) {
  const mod = MODULOS[clave];
  moduloActual = clave;

  const campoFiltro = (etiqueta, control) =>
    `<div class="campo"><label>${etiqueta}</label>${control}</div>`;

  contenido.innerHTML = `
    <div class="vista-cab">
      <div>
        <h1>${mod.titulo}</h1>
        <p>${mod.sub}</p>
      </div>
      <div class="acciones">
        ${mod.filtroDeposito ? '<button class="btn" id="btn-mover-deposito">Mover depósito</button>' : ''}
        <button class="btn btn-primario" id="btn-nuevo">${icono('mas')}${mod.femenino ? 'Nueva' : 'Nuevo'} ${mod.singular}</button>
      </div>
    </div>
    <div class="filtros">
      ${mod.filtroEquipo ? '<select class="entrada" id="filtro-equipo" aria-label="Equipo"><option value="">Todos los equipos</option></select>' : ''}
      ${mod.filtroAmbito ? '<select class="entrada" id="filtro-ambito" aria-label="Ámbito"><option value="general">Generales de la flota</option><option value="unidad">De unidades</option><option value="">Todos</option></select>' : ''}
      ${mod.filtroDeposito ? '<select class="entrada" id="filtro-deposito" aria-label="Depósito"><option value="">Todos los depósitos</option></select>' : ''}
      <input class="entrada" id="buscador" placeholder="Buscar…" aria-label="Buscar">
    </div>
    ${mod.filtrosAvanzados ? `
    <div class="filtros" id="filtros-avanzados">
      ${campoFiltro('Desde', `<input type="date" id="fa-fecha-desde" value="${fechaISO(-30)}">`)}
      ${campoFiltro('Hasta', `<input type="date" id="fa-fecha-hasta" value="${fechaISO(0)}">`)}
      ${campoFiltro('Estado', `<select id="fa-estado">
          <option value="">Todos los estados</option>
          <option value="EN CURSO">En curso</option>
          <option value="EN DESTINO">En destino</option>
          <option value="FINALIZADO">Finalizado</option>
          <option value="FACTURADO">Facturado</option>
        </select>`)}
      ${campoFiltro('Tipo de carga', '<input type="text" id="fa-tipo-carga" placeholder="Ej: Soja…">')}
      ${campoFiltro('Ordenar por', `<select id="fa-orden">
          <option value="id_viaje">N° de viaje</option>
          <option value="fecha_origen">Fecha de origen</option>
          <option value="fecha_llegada">Fecha de llegada</option>
          <option value="tarifa">Tarifa</option>
          <option value="resultado">Resultado</option>
          <option value="estado">Estado</option>
        </select>`)}
      ${campoFiltro('Dirección', `<select id="fa-dir">
          <option value="desc">↓ Mayor primero</option>
          <option value="asc">↑ Menor primero</option>
        </select>`)}
      <button class="btn btn-chico" id="fa-limpiar">Limpiar filtros</button>
    </div>` : ''}
    <section class="hoja" id="tabla-modulo">
      <div class="vacio">Cargando…</div>
    </section>
  `;

  $('#btn-nuevo').addEventListener('click', () => abrirModal(clave, null));

  const filtrosExtra = () => {
    if (mod.filtroAmbito) return { ambito: $('#filtro-ambito')?.value || '' };
    if (!mod.filtrosAvanzados) return {};
    return {
      fecha_desde: $('#fa-fecha-desde')?.value || '',
      fecha_hasta: $('#fa-fecha-hasta')?.value || '',
      estado:      $('#fa-estado')?.value || '',
      tipo_carga:  $('#fa-tipo-carga')?.value || '',
      orden:       $('#fa-orden')?.value || '',
      dir:         $('#fa-dir')?.value || ''
    };
  };

  const filtroActual  = () => $('#filtro-equipo')?.value || '';
  const depositoActual = () => $('#filtro-deposito')?.value || '';
  const recargar = () => cargarTabla(clave, $('#buscador').value, filtroActual(), depositoActual(), filtrosExtra(), 1);

  let temporizador;
  $('#buscador').addEventListener('input', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(recargar, 350);
  });

  // Listeners de filtros avanzados
  if (mod.filtrosAvanzados) {
    ['fa-fecha-desde', 'fa-fecha-hasta', 'fa-estado', 'fa-orden', 'fa-dir'].forEach(id => {
      $('#' + id)?.addEventListener('change', recargar);
    });
    let timerCarga;
    $('#fa-tipo-carga')?.addEventListener('input', () => {
      clearTimeout(timerCarga);
      timerCarga = setTimeout(recargar, 350);
    });
    $('#fa-limpiar')?.addEventListener('click', () => {
      $('#fa-fecha-desde').value = fechaISO(-30);
      $('#fa-fecha-hasta').value = fechaISO(0);
      $('#fa-estado').value = '';
      $('#fa-tipo-carga').value = '';
      $('#fa-orden').value = 'id_viaje';
      $('#fa-dir').value = 'desc';
      recargar();
    });
  }

  if (mod.filtroAmbito) $('#filtro-ambito').addEventListener('change', recargar);

  if (mod.filtroDeposito) {
    try {
      const todoElStock = await API.listarTodo(mod.recurso);
      const depositos = [...new Set(todoElStock.map(s => s.deposito).filter(Boolean))].sort();
      $('#filtro-deposito').innerHTML = '<option value="">Todos los depósitos</option>' +
        depositos.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('');
    } catch (err) { /* sin sugerencias */ }
    $('#filtro-deposito').addEventListener('change', recargar);
    $('#btn-mover-deposito').addEventListener('click', () => abrirModalMoverDeposito(clave));
  }

  if (mod.filtroEquipo) {
    try {
      const [equipos, unidades, choferes] = await Promise.all([
        API.listarTodo('equipos'), API.listarTodo('unidades'), API.listarTodo('choferes')
      ]);
      const patente = id => (unidades.find(u => u.id_unidad === id) || {}).patente || '?';
      const chofer  = id => (choferes.find(c => c.id_chofer === id) || {}).nombre || '?';
      $('#filtro-equipo').innerHTML = '<option value="">Todos los equipos</option>' +
        equipos.map(e =>
          `<option value="${e.id_equipo}">${esc(patente(e.id_unidad_principal))} / ${esc(patente(e.id_unidad_secundaria))}, ${esc(chofer(e.id_chofer))}</option>`
        ).join('');
    } catch (err) { /* sin equipos */ }
    if (_filtroEquipoInicial) { $('#filtro-equipo').value = _filtroEquipoInicial; _filtroEquipoInicial = null; }
    $('#filtro-equipo').addEventListener('change', recargar);
  }

  // Carga inicial: incluye los filtros avanzados (rango de fecha por defecto)
  cargarTabla(clave, '', filtroActual(), depositoActual(), filtrosExtra(), 1);
}

// Equipo con el que se abre filtrada la lista de viajes (desde el detalle de un equipo)
let _filtroEquipoInicial = null;

// Página actual por cada módulo (para mantenerla entre recargas)
const paginaActual = {};
// Último contexto de carga, para que los botones de paginación recarguen igual
let _ctxTabla = null;
// Filas de la página visible (id → registro), para resolver el clic en una fila
let _filasTabla = {};
// Registros relacionados (claves foráneas) de la tabla visible, para «Ver detalle»
let _dicFkTabla = {};
// Columnas que muestra una tabla como máximo (un módulo puede fijar las suyas con columnasTabla)
const MAX_COLUMNAS_TABLA = 6;

// Columnas numéricas: van alineadas a la derecha (th.num / td.num)
const CAMPOS_NUMERICOS = ['monto', 'tarifa', 'valuacion', 'precio_por_litro', 'sueldo_fijo_mensual', 'variable_valor', '_valor'];
const esColumnaNumerica = c => c.tipo === 'number' || CAMPOS_NUMERICOS.includes(c.nombre);

// Encabezado corto de columna: la etiqueta del formulario sin aclaraciones
// ("Monto ($, negativo = débito)" → "Monto"; "Plazo de pago (días) — solo
// clientes" → "Plazo de pago"). Un campo puede fijar la suya con etiquetaTabla.
const etiquetaColumna = c => c.etiquetaTabla || c.etiqueta.replace(/\s*[—–-]\s.*$/, '').replace(/\s*\(.*?\)/g, '').trim();

// Clase de cada celda: números a la derecha; códigos (CUIL/CUIT), teléfonos y
// fechas en una sola línea, para que la fila no se parta en dos o tres renglones.
const CAMPOS_CODIGO = ['cuil', 'cuit', 'numero_remito', 'identificador'];
function claseCelda(c) {
  if (esColumnaNumerica(c)) return 'num';
  if (CAMPOS_CODIGO.includes(c.nombre)) return 'mono nowrap';
  if (c.nombre === 'telefono' || c.tipo === 'date' || c.tipo === 'datetime-local' || c.tipo === 'select') return 'nowrap';
  if (c.tipo === 'fk' && (c.recurso === 'equipos' || c.recurso === 'unidades')) return 'nowrap';
  return '';
}

async function cargarTabla(clave, q = '', idEquipo = '', deposito = '', extras = {}, pagina = null) {
  const mod = MODULOS[clave];
  if (pagina === null) pagina = paginaActual[clave] || 1;
  _ctxTabla = { clave, q, idEquipo, deposito, extras };
  try {
    const respuesta = await API.listar(mod.recurso, q, idEquipo, deposito, extras, pagina);
    // El backend devuelve { datos, paginacion }
    const filas = respuesta.datos || [];
    const pag = respuesta.paginacion || { pagina: 1, total: filas.length, total_paginas: 1, por_pagina: 50 };
    paginaActual[clave] = pag.pagina;

    if (pag.total === 0) {
      $('#tabla-modulo').innerHTML = (idEquipo || deposito || extras.fecha_desde || extras.q)
        ? '<div class="vacio">No hay registros para el filtro seleccionado.</div>'
        : '<div class="vacio">No hay registros. Usá el botón de arriba para cargar el primero.</div>';
      return;
    }

    // Resolver claves foráneas: cargar los registros relacionados una sola vez
    const camposFk = mod.campos.filter(c => c.tipo === 'fk');
    const diccionariosFk = {};
    await Promise.all(camposFk.map(async c => {
      try {
        const lista = c.recurso === 'equipos'
          ? await listarEquiposEnriquecidos()
          : await API.listarTodo(c.recurso);
        const idForaneo = MODULOS[Object.keys(MODULOS).find(k => MODULOS[k].recurso === c.recurso)].id;
        diccionariosFk[c.nombre] = {};
        lista.forEach(r => { diccionariosFk[c.nombre][r[idForaneo]] = r; });
      } catch (err) { diccionariosFk[c.nombre] = {}; }
    }));

    // Los campos soloFormulario (ej. fecha del cambio de un equipo) no son columnas.
    // Tampoco las que vienen vacías en TODA la página (evita columnas de "—").
    const tieneValor = c => typeof c.calcular === 'function' || filas.some(f => f[c.nombre] !== null && f[c.nombre] !== undefined && f[c.nombre] !== '');
    // La tabla muestra solo las columnas principales: nunca hay scroll lateral.
    // El resto de los datos está en «Ver detalle».
    const aptas = mod.campos.filter(c => !c.soloFormulario && tieneValor(c));
    const camposTabla = mod.columnasTabla
      ? mod.columnasTabla.map(n => aptas.find(c => c.nombre === n)).filter(Boolean)
      : aptas.slice(0, MAX_COLUMNAS_TABLA);
    const columnas = camposTabla.map(c => c.nombre);
    // En pantallas angostas solo quedan las primeras columnas (ver .col-opc)
    const claseOpc = i => (i >= 3 ? ' col-opc' : '');
    _dicFkTabla = diccionariosFk;
    const mostrarId = clave === 'viajes';
    _filasTabla = {};
    filas.forEach(f => { _filasTabla[f[mod.id]] = f; });
    $('#tabla-modulo').innerHTML = `
      <div class="tabla-marco">
        <table class="tabla">
          <thead>
            <tr>
              ${mostrarId ? '<th>N°</th>' : ''}
              ${camposTabla.map((c, i) => `<th class="${(esColumnaNumerica(c) ? 'num' : '') + claseOpc(i)}">${etiquetaColumna(c)}</th>`).join('')}
              <th class="num"></th>
            </tr>
          </thead>
          <tbody>
            ${filas.map(fila => `
            <tr class="clic" tabindex="0" onclick="alHacerClicFila('${clave}', ${fila[mod.id]})" onkeydown="if (event.key === 'Enter') alHacerClicFila('${clave}', ${fila[mod.id]})">
              ${mostrarId ? `<td class="mono tenue">#${fila[mod.id]}</td>` : ''}
              ${columnas.map((col, i) => {
                const campo = mod.campos.find(c => c.nombre === col);
                return `<td class="${claseCelda(campo)}${claseOpc(i)}">${formatearCelda(fila[col], campo, diccionariosFk[col], fila)}</td>`;
              }).join('')}
              <td class="num nowrap"><span class="acciones-fila">${mod.botonesFila ? mod.botonesFila(fila) : ''}<button class="btn btn-chico" onclick="event.stopPropagation(); alHacerClicFila('${clave}', ${fila[mod.id]})">Ver detalle</button></span></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${controlesPaginacion(pag, p => cargarTabla(clave, q, idEquipo, deposito, extras, p))}`;
  } catch (err) {
    $('#tabla-modulo').innerHTML = `<div class="vacio">Error: ${esc(err.message)}</div>`;
  }
}

// La fila entera (o su botón «Ver detalle») abre la ficha: la de la unidad o
// la del chofer, o el detalle del registro con todos sus datos.
function alHacerClicFila(clave, id) {
  const mod = MODULOS[clave];
  const fila = _filasTabla[id];
  if (mod.alHacerClic) {
    const manejado = mod.alHacerClic(fila);
    if (manejado) return;
  }
  verDetalle(clave, id);
}

// Detalle de un registro: todos sus datos en lectura, con Editar y las demás
// acciones del registro (avanzar estado, eliminar…).
function verDetalle(clave, id) {
  const mod = MODULOS[clave];
  const fila = _filasTabla[id];
  if (!fila) return abrirModal(clave, id);
  moduloActual = clave;
  $('#modal-titulo').textContent = `Detalle ${mod.femenino ? 'de la' : 'del'} ${mod.singular}`;
  const campos = mod.campos.filter(c => !c.soloFormulario);
  const datos = campos.map(c => {
    const vacio = fila[c.nombre] === null || fila[c.nombre] === undefined || fila[c.nombre] === '';
    if (vacio && typeof c.calcular !== 'function' && !c.vacio) return '';
    return `<div class="ficha-dato"><span class="rotulo">${esc(etiquetaColumna(c))}</span><b>${formatearCelda(fila[c.nombre], c, _dicFkTabla[c.nombre], fila)}</b></div>`;
  }).join('');
  const acciones = accionesDelRegistro(clave, id, fila);
  $('#modal-cuerpo').innerHTML = `
    <div class="ficha-datos ficha-detalle">${datos}</div>
    <div class="grupo-titulo"><div class="rotulo">Acciones</div></div>
    <div class="acciones">
      <button type="button" class="btn btn-primario btn-chico" onclick="cerrarModal(); abrirModal('${clave}', ${id})">Editar</button>
      ${acciones.map(a => `<button type="button" class="btn btn-chico${a.peligro ? ' btn-peligro' : ''}" onclick="cerrarModal(); ${a.onclick}">${a.texto}</button>`).join('')}
    </div>`;
  $('#btn-guardar').hidden = true;
  $('#modal-fondo').hidden = false;
}

// Genera el pie de hoja con la paginación y conecta los botones a un callback.
// Devuelve el HTML; los botones se enlazan vía un registro global de handlers.
let _paginadorSeq = 0;
const _paginadorHandlers = {};
function controlesPaginacion(pag, onIr) {
  if (!pag || pag.total_paginas <= 1) {
    // Mostrar igual el total cuando hay una sola página con datos
    if (pag && pag.total > 0) {
      return `<footer class="hoja-pie">${pag.total} registro${pag.total === 1 ? '' : 's'}</footer>`;
    }
    return '';
  }
  const id = ++_paginadorSeq;
  _paginadorHandlers[id] = onIr;
  const { pagina, total_paginas, total, por_pagina } = pag;
  const desde = (pagina - 1) * por_pagina + 1;
  const hasta = Math.min(pagina * por_pagina, total);
  const btn = (etiqueta, destino, disabled) =>
    `<button class="btn btn-chico" ${disabled ? 'disabled' : ''} onclick="_irPagina(${id}, ${destino})">${etiqueta}</button>`;
  return `
    <footer class="hoja-pie">
      <div class="acciones">
        <span>${desde}–${hasta} de ${total}</span>
        ${btn('« Primera', 1, pagina === 1)}
        ${btn('‹ Anterior', pagina - 1, pagina === 1)}
        <span>Página ${pagina} de ${total_paginas}</span>
        ${btn('Siguiente ›', pagina + 1, pagina === total_paginas)}
        ${btn('Última »', total_paginas, pagina === total_paginas)}
      </div>
    </footer>`;
}

// Invocado desde los botones de paginación (onclick)
function _irPagina(id, pagina) {
  const fn = _paginadorHandlers[id];
  if (fn) fn(pagina);
}

function formatearCelda(valor, campo, diccionarioFk, fila) {
  // Columnas calculadas: no guardan un valor propio en el registro, se derivan
  // de la fila completa (ej. el valor facturado de un viaje).
  if (campo && typeof campo.calcular === 'function') return campo.calcular(fila);
  if ((valor === null || valor === undefined || valor === '') && campo && campo.vacio) return `<span class="tenue">${esc(campo.vacio)}</span>`;
  if (valor === null || valor === undefined || valor === '') return '—';
  if (!campo) return esc(valor);
  // Donde aparece una unidad, aparece su patente (nunca un ID)
  if (campo.nombre === 'patente') return patenteHTML(valor);
  if (campo.tipo === 'fk' && diccionarioFk) {
    const reg = diccionarioFk[valor];
    if (campo.mostrarEnTabla) {
      const texto = campo.mostrarEnTabla(fila || {}, reg);
      if (texto) return patentesEquipo({ patente_principal: texto.split(' / ')[0], patente_secundaria: texto.split(' / ')[1] });
    }
    if (!reg) return `#${esc(valor)}`;
    if (campo.recurso === 'unidades') return `<span class="con-patente">${patenteHTML(reg.patente)}<span>${esc(reg.modelo)}</span></span>`;
    if (campo.recurso === 'equipos') return patentesEquipo(reg);
    if (campo.recurso === 'cuentas') return `<div class="celda-doble"><b>${esc(reg.nombre)}</b><span>${esc(String(reg.tipo || '').toLowerCase())}</span></div>`;
    return esc(campo.mostrar(reg));
  }
  if (campo.tipo === 'date' || campo.tipo === 'datetime-local') return fmtFecha(valor);
  // Importes que pueden ser negativos (movimientos): verde o rojo según el signo
  if (campo.conSigno) return fmtDineroSigno(valor);
  if (campo.nombre === 'monto' || campo.nombre === 'tarifa' || campo.nombre === 'valuacion' || campo.nombre === 'precio_por_litro') {
    return fmtDinero(valor);
  }
  // Remuneración mixta: el valor variable se formatea según su tipo (% o $/km)
  if (campo.nombre === 'sueldo_fijo_mensual') return fmtDinero(valor);
  if (campo.nombre === 'variable_valor' && fila) {
    if (fila.variable_tipo === 'PORCENTAJE') return `${fmtNum(valor, 2)} %`;
    if (fila.variable_tipo === 'POR KM') return `${fmtDinero(valor)}/km`;
    return fmtDinero(valor);
  }
  if (campo.tipo === 'select') return insigniaEstado(String(valor));
  if (campo.tipo === 'number') return fmtNum(valor, 2);
  if (campo.tipo === 'select_cuenta') return esc(valor);
  return esc(valor);
}

// ============================================================
// Modal de alta / edición
// ============================================================
// opciones.valores: valores iniciales al crear (ej. { id_unidad: 5 }).
// opciones.fijos: campos que se muestran pero no se pueden cambiar (ej. la
// unidad, cuando el registro se carga desde su ficha).
async function abrirModal(clave, id, opciones = {}) {
  const mod = MODULOS[clave];
  moduloActual = clave; // guardarRegistro usa el módulo del formulario abierto, no el de la vista
  registroEditando = id;
  $('#modal-titulo').textContent = id
    ? `Editar ${mod.singular}`
    : `${mod.femenino ? 'Nueva' : 'Nuevo'} ${mod.singular}`;

  let datos = {};
  if (id) {
    try { datos = await API.obtener(mod.recurso, id); }
    catch (err) { mostrarToast(err.message, true); return; }
  } else if (opciones.valores) {
    datos = { ...opciones.valores };
  }
  _registroActual = datos;

  // Al crear, excluir campos marcados como soloEdicion
  // (ej. resultado, estado, fechas en viajes). Las columnas calculadas
  // (soloTabla) nunca se editan: no forman parte del formulario.
  const camposVisibles = (id
    ? mod.campos
    : mod.campos.filter(c => !c.soloEdicion)).filter(c => !c.soloTabla);

  // Cargar opciones de claves foráneas (solo para campos visibles)
  const camposFk = camposVisibles.filter(c => c.tipo === 'fk');
  const opcionesFk = {};
  await Promise.all(camposFk.map(async c => {
    let lista = c.recurso === 'equipos'
      ? await listarEquiposEnriquecidos()
      : await API.listarTodo(c.recurso);
    if (c.filtro) lista = lista.filter(c.filtro);
    // Equipos dados de baja: no se ofrecen para cargar, salvo el que el
    // registro ya tiene (para poder editarlo sin perder el dato).
    if (c.soloActivos) lista = lista.filter(r => r.activo !== 0 || String(r.id_equipo) === String(datos[c.nombre]));
    opcionesFk[c.nombre] = lista;
  }));

  // Cargar sugerencias de depósito (depósitos existentes + equipos)
  let sugerenciasDeposito = [];
  if (camposVisibles.some(c => c.listaDepositos)) {
    try {
      const [stockActual, equipos, unidades] = await Promise.all([
        API.listarTodo('stock'), API.listarTodo('equipos'), API.listarTodo('unidades')
      ]);
      const patente = idU => (unidades.find(u => u.id_unidad === idU) || {}).patente || '?';
      const existentes = [...new Set(stockActual.map(s => s.deposito).filter(Boolean))];
      const comoEquipos = equipos.map(e => `Equipo #${e.id_equipo} (${patente(e.id_unidad_principal)})`);
      sugerenciasDeposito = [...new Set([...existentes, ...comoEquipos])].sort();
    } catch (err) { /* sin sugerencias */ }
  }

  // Cargar cuentas para campos tipo select_cuenta (ej. pagador en viajes)
  let cuentasParaSelector = [];
  if (camposVisibles.some(c => c.tipo === 'select_cuenta')) {
    try { cuentasParaSelector = await API.listarTodo('cuentas'); }
    catch (err) { cuentasParaSelector = []; }
  }

  const html = camposVisibles.map(c => {
    const valor = datos[c.nombre] ?? '';
    const claseAncho = c.ancho ? ' ancho' : '';
    const req = c.requerido ? 'required' : '';

    if (c.tipo === 'select_cuenta') {
      const cuentasFiltradas = cuentasParaSelector
        .filter(cu => c.tiposCuenta.includes(cu.tipo))
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
      return `
        <div class="campo${claseAncho}">
          <label for="f-${c.nombre}">${c.etiqueta}${c.requerido ? ' *' : ''}</label>
          <select id="f-${c.nombre}" name="${c.nombre}" ${req}>
            <option value="">${c.requerido ? 'Seleccionar…' : 'Sin asignar'}</option>
            ${cuentasFiltradas.map(cu =>
              `<option value="${esc(cu.nombre)}" ${valor === cu.nombre ? 'selected' : ''}>${esc(cu.nombre)} (${esc(cu.tipo)})</option>`
            ).join('')}
          </select>
        </div>`;
    }

    if (c.tipo === 'select') {
      return `
        <div class="campo${claseAncho}">
          <label for="f-${c.nombre}">${c.etiqueta}${c.requerido ? ' *' : ''}</label>
          <select id="f-${c.nombre}" name="${c.nombre}" ${req}>
            <option value="">Seleccionar…</option>
            ${c.opciones.map(o => `<option value="${o}" ${valor === o ? 'selected' : ''}>${o}</option>`).join('')}
          </select>
        </div>`;
    }

    if (c.tipo === 'fk') {
      const idCampo = MODULOS[Object.keys(MODULOS).find(k => MODULOS[k].recurso === c.recurso)].id;
      return `
        <div class="campo${claseAncho}">
          <label for="f-${c.nombre}">${c.etiqueta}${c.requerido ? ' *' : ''}</label>
          <select id="f-${c.nombre}" name="${c.nombre}" ${req}>
            <option value="">${esc(c.vacio || 'Seleccionar…')}</option>
            ${opcionesFk[c.nombre].map(r =>
              `<option value="${esc(r[idCampo])}" ${String(valor) === String(r[idCampo]) ? 'selected' : ''}>${esc(c.mostrar(r))}</option>`
            ).join('')}
          </select>
        </div>`;
    }

    let valorInput = valor;
    if (c.tipo === 'date' && valor) valorInput = String(valor).slice(0, 10);
    if (c.tipo === 'datetime-local' && valor) valorInput = String(valor).slice(0, 16).replace(' ', 'T');

    return `
      <div class="campo${claseAncho}">
        <label for="f-${c.nombre}">${c.etiqueta}${c.requerido ? ' *' : ''}</label>
        <input id="f-${c.nombre}" name="${c.nombre}" type="${c.tipo}" value="${valorInput}" ${req} ${c.tipo === 'number' ? 'step="any"' : ''} ${c.maxlen ? `maxlength="${c.maxlen}"` : ''} ${c.listaDepositos ? 'list="lista-depositos"' : ''}>
        ${c.listaDepositos ? `<datalist id="lista-depositos">${sugerenciasDeposito.map(d => `<option value="${esc(d)}"></option>`).join('')}</datalist>` : ''}
        ${c.ayuda ? `<span class="ayuda">${c.ayuda}</span>` : ''}
      </div>`;
  }).join('');

  // Otras acciones del registro (sin menú "…"): avanzar estado, historial, eliminar…
  const acciones = id ? accionesDelRegistro(clave, id, datos) : [];
  $('#modal-cuerpo').innerHTML = `<div class="formulario">${html}${mod.grupoFiscal ? htmlGrupoFiscal(datos) : ''}${bloqueAcciones(acciones)}</div>`;

  if (mod.grupoFiscal) {
    const cuerpo = $('#modal-cuerpo');
    if (_handlerGrupoFiscal) cuerpo.removeEventListener('input', _handlerGrupoFiscal);
    _handlerGrupoFiscal = () => sincronizarGrupoFiscal(mod);
    cuerpo.addEventListener('input', _handlerGrupoFiscal);
    sincronizarGrupoFiscal(mod);
  }

  (opciones.fijos || []).forEach(nombre => { const el = $(`#f-${nombre}`); if (el) el.disabled = true; });

  $('#modal-fondo').hidden = false;
}

// Acciones de un registro que ya no viven en un menú "…" sino dentro de su
// formulario de edición. Cada módulo puede definir acciones(fila); si no,
// solo se ofrece Eliminar.
function accionesDelRegistro(clave, id, fila) {
  const mod = MODULOS[clave];
  return mod.acciones ? mod.acciones(fila) : [
    { texto: 'Eliminar', peligro: true, onclick: `eliminarRegistro('${clave}', ${id})` }
  ];
}

// ============================================================
// Bloque 7 · IVA en compras: grupo "Comprobante del proveedor"
// Reutilizable en los módulos con grupoFiscal: true (consumos de
// combustible, consumos generales y gastos administrativos). Calcula el IVA
// al escribir el neto y la alícuota, lo deshabilita con letra B/C o un
// ticket (no discriminan IVA) y muestra la diferencia contra el total del
// registro (litros × precio, o monto) antes de guardar.
// ============================================================
let _handlerGrupoFiscal = null;

function htmlGrupoFiscal(datos) {
  const v = campo => (datos && datos[campo] != null ? datos[campo] : '');
  return `
    <div class="grupo-titulo">
      <h3 class="hoja-titulo">Comprobante del proveedor</h3>
      <div class="hoja-sub">Opcional: sin datos, queda «sin informar» con el total en el neto y sin crédito fiscal.</div>
    </div>
    <div class="campo">
      <label for="f-comprobante_tipo">Tipo de comprobante</label>
      <select id="f-comprobante_tipo">
        <option value="">Sin informar</option>
        ${['FACTURA', 'NOTA_DEBITO', 'NOTA_CREDITO', 'TICKET', 'RECIBO', 'SIN_COMPROBANTE'].map(o =>
          `<option value="${o}" ${v('comprobante_tipo') === o ? 'selected' : ''}>${o.replace(/_/g, ' ')}</option>`).join('')}
      </select>
    </div>
    <div class="campo">
      <label for="f-comprobante_letra">Letra</label>
      <select id="f-comprobante_letra">
        <option value="">—</option>
        ${['A', 'B', 'C', 'M'].map(o => `<option value="${o}" ${v('comprobante_letra') === o ? 'selected' : ''}>${o}</option>`).join('')}
      </select>
    </div>
    <div class="campo"><label for="f-comprobante_punto_venta">Punto de venta</label><input id="f-comprobante_punto_venta" type="number" step="1" min="0" value="${esc(v('comprobante_punto_venta'))}"></div>
    <div class="campo"><label for="f-comprobante_numero">Número</label><input id="f-comprobante_numero" type="number" step="1" min="0" value="${esc(v('comprobante_numero'))}"></div>
    <div class="campo"><label for="f-neto_gravado">Neto gravado ($)</label><input id="f-neto_gravado" type="number" step="any" value="${esc(v('neto_gravado'))}"></div>
    <div class="campo">
      <label for="f-iva_alicuota">Alícuota de IVA (%)</label>
      <select id="f-iva_alicuota">
        <option value="">—</option>
        ${['21', '10.5', '27', '5', '2.5', '0'].map(o => `<option value="${o}" ${String(v('iva_alicuota')) === o ? 'selected' : ''}>${o}%</option>`).join('')}
      </select>
    </div>
    <div class="campo"><label for="f-iva">IVA ($)</label><input id="f-iva" type="number" step="any" value="${esc(v('iva'))}"></div>
    <div class="campo"><label for="f-no_gravado">No gravado ($)</label><input id="f-no_gravado" type="number" step="any" value="${esc(v('no_gravado'))}"></div>
    <div class="campo"><label for="f-exento">Exento ($)</label><input id="f-exento" type="number" step="any" value="${esc(v('exento'))}"></div>
    <div class="campo"><label for="f-percepciones">Percepciones ($)</label><input id="f-percepciones" type="number" step="any" value="${esc(v('percepciones'))}"></div>
    <div class="campo ancho"><div id="fiscal-diferencia" class="ayuda"></div></div>
  `;
}

function sincronizarGrupoFiscal(mod) {
  const tipo = $('#f-comprobante_tipo')?.value;
  const letra = $('#f-comprobante_letra')?.value;
  const inputIva = $('#f-iva');
  const sinCredito = tipo === 'TICKET' || letra === 'B' || letra === 'C';
  if (inputIva) {
    inputIva.disabled = sinCredito;
    if (sinCredito) {
      inputIva.value = 0;
    } else if (document.activeElement !== inputIva) {
      const neto = Number($('#f-neto_gravado')?.value) || 0;
      const alicuota = Number($('#f-iva_alicuota')?.value) || 0;
      if (neto && alicuota) inputIva.value = Math.round(neto * alicuota) / 100;
    }
  }

  const total = mod.totalRegistro ? mod.totalRegistro() : 0;
  const suma = ['neto_gravado', 'iva', 'no_gravado', 'exento', 'percepciones']
    .reduce((s, id) => s + (Number($(`#f-${id}`)?.value) || 0), 0);
  const diferencia = Math.round((suma - total) * 100) / 100;
  const cont = $('#fiscal-diferencia');
  if (cont) {
    const cuadra = Math.abs(diferencia) <= 0.01;
    cont.innerHTML = `Desglose ${fmtDinero(suma)}, total del registro ${fmtDinero(total)}, diferencia ${fmtDinero(diferencia)}. ` +
      insignia(cuadra ? 'Cuadra' : 'No cuadra', cuadra ? 'ok' : 'peligro');
  }
}

// Valores del grupo fiscal para incluir en el guardado (ver guardarRegistro).
function valoresGrupoFiscal() {
  const ids = ['comprobante_tipo', 'comprobante_letra', 'comprobante_punto_venta', 'comprobante_numero',
    'neto_gravado', 'iva_alicuota', 'iva', 'no_gravado', 'exento', 'percepciones'];
  const datos = {};
  ids.forEach(id => {
    const input = $(`#f-${id}`);
    if (input) datos[id] = input.value;
  });
  return datos;
}

function cerrarModal() {
  $('#modal-fondo').hidden = true;
  registroEditando = null;
  _registroActual = null;
  modoRecibo = null;
  modoMoverDeposito = null;
  modoAvanzarConResultado = null;
  _guardadoAdmin = null;
  _datosViajeFacturar = null;
  // Restaurar el botón Guardar por si algún modal lo ocultó o le cambió el texto
  const btnGuardar = $('#btn-guardar');
  if (btnGuardar) { btnGuardar.hidden = false; btnGuardar.textContent = 'Guardar'; }
}

async function guardarRegistro() {
  // Vistas de administración (empresas/usuarios) usan su propio handler
  if (_guardadoAdmin) {
    const btn = $('#btn-guardar');
    btn.disabled = true;
    try {
      const ok = await _guardadoAdmin();
      if (ok) cerrarModal();
    } catch (err) {
      mostrarToast(err.message, true);
    } finally {
      btn.disabled = false;
    }
    return;
  }
  if (modoAvanzarConResultado) return guardarResultadoYAvanzar();
  if (modoMoverDeposito) return guardarMoverDeposito();
  if (modoRecibo) return guardarRecibo();
  const mod = MODULOS[moduloActual];
  const datos = {};
  let valido = true;

  // Solo iterar sobre los campos visibles en el formulario actual
  // (las columnas calculadas no tienen input y no se envían)
  const camposActivos = (registroEditando
    ? mod.campos
    : mod.campos.filter(c => !c.soloEdicion)).filter(c => !c.soloTabla);

  camposActivos.forEach(c => {
    const input = $(`#f-${c.nombre}`);
    if (!input) return;
    let valor = input.value;
    const falta = Boolean(c.requerido && !valor);
    input.closest('.campo')?.classList.toggle('error', falta);
    if (falta) valido = false;
    if (c.tipo === 'datetime-local' && valor) valor = valor.replace('T', ' ') + ':00';
    datos[c.nombre] = valor;
  });

  if (mod.grupoFiscal) Object.assign(datos, valoresGrupoFiscal());

  // Al crear un viaje, el estado siempre arranca en EN CURSO
  if (!registroEditando && mod.campos.some(c => c.nombre === 'estado' && c.soloEdicion)) {
    datos.estado = 'EN CURSO';
  }

  if (!valido) {
    mostrarToast('Completá los campos obligatorios marcados con *', true);
    return;
  }

  // Al marcar un viaje como FACTURADO, abrir el modal de facturación para
  // elegir cómo imputarlo en la cuenta del cliente (sin IVA, líquido producto
  // con IVA, o emitir factura). Solo si el estado cambió a FACTURADO ahora.
  if (moduloActual === 'viajes' && datos.estado === 'FACTURADO') {
    const estadoPrevio = registroEditando ? (_registroActual?.estado) : null;
    if (estadoPrevio !== 'FACTURADO') {
      return abrirModalFacturarViaje(datos);
    }
  }

  try {
    if (registroEditando) {
      await API.actualizar(mod.recurso, registroEditando, datos);
      mostrarToast('Registro actualizado');
    } else {
      await API.crear(mod.recurso, datos);
      mostrarToast('Registro creado');
    }
    cerrarModal();
    recargarVistaModulo(moduloActual);
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

// Vuelve a pintar la pantalla que está abierta después de guardar o eliminar:
// la ficha de la unidad, la grilla de unidades o la tabla del módulo.
function recargarVistaModulo(clave, { eliminado = false } = {}) {
  if (eliminado && /^#(viaje|equipo)-detalle\//.test(location.hash)) { location.hash = clave; return; }
  if (location.hash.startsWith('#unidad-detalle/')) {
    if (eliminado && clave === 'unidades') { location.hash = 'unidades'; return; }
    return renderUnidadDetalle(location.hash.split('/')[1]);
  }
  if (clave === 'unidades') return renderUnidades();
  // Desde el tablero, las alertas o una vista de detalle: se redibuja la vista actual.
  const vista = location.hash.replace('#', '') || 'dashboard';
  if (vista !== clave) return navegar();
  cargarTabla(clave, $('#buscador')?.value || '', $('#filtro-equipo')?.value || '', $('#filtro-deposito')?.value || '', recogerExtras(), 1);
}

async function eliminarRegistro(clave, id) {
  if (!await confirmar('Esta acción no se puede deshacer.', 'Eliminar registro', '¿Eliminar este registro?')) return;
  const mod = MODULOS[clave];
  try {
    await API.eliminar(mod.recurso, id);
    mostrarToast('Registro eliminado');
    recargarVistaModulo(clave, { eliminado: true });
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

// Eventos del modal
$('#btn-cerrar-modal').addEventListener('click', cerrarModal);
$('#btn-cancelar').addEventListener('click', cerrarModal);
$('#btn-guardar').addEventListener('click', guardarRegistro);
$('#modal-fondo').addEventListener('click', e => {
  if (e.target === $('#modal-fondo')) cerrarModal();
});
