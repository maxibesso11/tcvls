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

  contenido.innerHTML = `
    <div class="vista-cabecera">
      <div>
        <div class="vista-titulo">${mod.titulo}</div>
        <div class="vista-sub">${mod.sub}</div>
      </div>
      <div class="toolbar">
        ${mod.filtroEquipo ? '<select class="buscador" id="filtro-equipo" style="min-width:170px"><option value="">Todos los equipos</option></select>' : ''}
        ${mod.filtroDeposito ? '<select class="buscador" id="filtro-deposito" style="min-width:190px"><option value="">Todos los depósitos</option></select>' : ''}
        <input class="buscador" id="buscador" placeholder="Buscar…">
        ${mod.filtroDeposito ? '<button class="btn btn-secundario" id="btn-mover-deposito">Mover depósito</button>' : ''}
        <button class="btn btn-primario" id="btn-nuevo">+ Nuevo</button>
      </div>
    </div>
    ${mod.filtrosAvanzados ? `
    <div class="filtros-avanzados" id="filtros-avanzados">
      <div class="filtro-grupo">
        <label class="filtro-label">Desde</label>
        <input type="date" class="buscador filtro-fecha" id="fa-fecha-desde" value="${fechaISO(-30)}">
      </div>
      <div class="filtro-grupo">
        <label class="filtro-label">Hasta</label>
        <input type="date" class="buscador filtro-fecha" id="fa-fecha-hasta" value="${fechaISO(0)}">
      </div>
      <div class="filtro-grupo">
        <label class="filtro-label">Estado</label>
        <select class="buscador" id="fa-estado">
          <option value="">Todos los estados</option>
          <option value="EN CURSO">En curso</option>
          <option value="EN DESTINO">En destino</option>
          <option value="FINALIZADO">Finalizado</option>
          <option value="FACTURADO">Facturado</option>
        </select>
      </div>
      <div class="filtro-grupo">
        <label class="filtro-label">Tipo de carga</label>
        <input type="text" class="buscador" id="fa-tipo-carga" placeholder="Ej: Soja…" style="min-width:120px">
      </div>
      <div class="filtro-grupo">
        <label class="filtro-label">Ordenar por</label>
        <select class="buscador" id="fa-orden">
          <option value="id_viaje">N° de viaje</option>
          <option value="fecha_origen">Fecha de origen</option>
          <option value="fecha_llegada">Fecha de llegada</option>
          <option value="tarifa">Tarifa</option>
          <option value="resultado">Resultado</option>
          <option value="estado">Estado</option>
        </select>
      </div>
      <div class="filtro-grupo">
        <label class="filtro-label">Dirección</label>
        <select class="buscador" id="fa-dir">
          <option value="desc">↓ Mayor primero</option>
          <option value="asc">↑ Menor primero</option>
        </select>
      </div>
      <button class="btn btn-secundario btn-mini" id="fa-limpiar">Limpiar filtros</button>
    </div>` : ''}
    <div class="panel">
      <div class="panel-cuerpo sin-padding">
        <div class="tabla-contenedor" id="tabla-modulo">
          <div class="estado-vacio">Cargando…</div>
        </div>
      </div>
    </div>
  `;

  $('#btn-nuevo').addEventListener('click', () => abrirModal(clave, null));

  const filtrosExtra = () => {
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

  if (mod.filtroDeposito) {
    try {
      const todoElStock = await API.listarTodo(mod.recurso);
      const depositos = [...new Set(todoElStock.map(s => s.deposito).filter(Boolean))].sort();
      $('#filtro-deposito').innerHTML = '<option value="">Todos los depósitos</option>' +
        depositos.map(d => `<option value="${d.replace(/"/g, '&quot;')}">${d}</option>`).join('');
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
          `<option value="${e.id_equipo}">${patente(e.id_unidad_principal)} / ${patente(e.id_unidad_secundaria)} · ${chofer(e.id_chofer)}</option>`
        ).join('');
    } catch (err) { /* sin equipos */ }
    $('#filtro-equipo').addEventListener('change', recargar);
  }

  // Carga inicial: incluye los filtros avanzados (rango de fecha por defecto)
  cargarTabla(clave, '', filtroActual(), depositoActual(), filtrosExtra(), 1);
}

// Página actual por cada módulo (para mantenerla entre recargas)
const paginaActual = {};
// Último contexto de carga, para que los botones de paginación recarguen igual
let _ctxTabla = null;

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
        ? '<div class="estado-vacio">No hay registros para el filtro seleccionado.</div>'
        : '<div class="estado-vacio">No hay registros. Usa "+ Nuevo" para agregar el primero.</div>';
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

    const columnas = mod.campos.map(c => c.nombre);
    $('#tabla-modulo').innerHTML = `
      <table>
        <thead>
          <tr>
            <th>#</th>
            ${mod.campos.map(c => `<th>${c.etiqueta}</th>`).join('')}
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${filas.map(fila => {
            const accionesPers = mod.accionesPersonalizadas?.(fila);
            const acciones = accionesPers !== null && accionesPers !== undefined
              ? accionesPers
              : `<button class="btn btn-secundario btn-mini" onclick="abrirModal('${clave}', ${fila[mod.id]})">Editar</button>
                 <button class="btn btn-peligro btn-mini" onclick="eliminarRegistro('${clave}', ${fila[mod.id]})">Eliminar</button>`;
            return `
            <tr>
              <td>${fila[mod.id]}</td>
              ${columnas.map(col => {
                const campo = mod.campos.find(c => c.nombre === col);
                return `<td>${formatearCelda(fila[col], campo, diccionariosFk[col], fila)}</td>`;
              }).join('')}
              <td>${acciones}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      ${controlesPaginacion(pag, p => cargarTabla(clave, q, idEquipo, deposito, extras, p))}`;
  } catch (err) {
    $('#tabla-modulo').innerHTML = `<div class="estado-vacio">Error: ${err.message}</div>`;
  }
}

// Genera la barra de paginación y conecta los botones a una función callback.
// Devuelve el HTML; los botones se enlazan vía un registro global de handlers.
let _paginadorSeq = 0;
const _paginadorHandlers = {};
function controlesPaginacion(pag, onIr) {
  if (!pag || pag.total_paginas <= 1) {
    // Mostrar igual el total cuando hay una sola página con datos
    if (pag && pag.total > 0) {
      return `<div class="paginacion"><span class="paginacion-info">${pag.total} registro${pag.total === 1 ? '' : 's'}</span></div>`;
    }
    return '';
  }
  const id = ++_paginadorSeq;
  _paginadorHandlers[id] = onIr;
  const { pagina, total_paginas, total, por_pagina } = pag;
  const desde = (pagina - 1) * por_pagina + 1;
  const hasta = Math.min(pagina * por_pagina, total);
  const btn = (etiqueta, destino, disabled) =>
    `<button class="btn btn-secundario btn-mini" ${disabled ? 'disabled' : ''} onclick="_irPagina(${id}, ${destino})">${etiqueta}</button>`;
  return `
    <div class="paginacion">
      <span class="paginacion-info">${desde}–${hasta} de ${total}</span>
      <div class="paginacion-botones">
        ${btn('« Primera', 1, pagina === 1)}
        ${btn('‹ Anterior', pagina - 1, pagina === 1)}
        <span class="paginacion-actual">Página ${pagina} de ${total_paginas}</span>
        ${btn('Siguiente ›', pagina + 1, pagina === total_paginas)}
        ${btn('Última »', total_paginas, pagina === total_paginas)}
      </div>
    </div>`;
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
  if (valor === null || valor === undefined || valor === '') return '—';
  if (!campo) return esc(valor);
  if (campo.tipo === 'fk' && diccionarioFk) {
    const reg = diccionarioFk[valor];
    return reg ? esc(campo.mostrar(reg)) : `#${esc(valor)}`;
  }
  if (campo.tipo === 'date' || campo.tipo === 'datetime-local') return fmtFecha(valor);
  if (campo.nombre === 'monto' || campo.nombre === 'tarifa' || campo.nombre === 'valuacion' || campo.nombre === 'precio_por_litro') {
    return fmtDinero(valor);
  }
  // Remuneración: se formatea según el tipo de remuneración del chofer
  if (campo.nombre === 'remuneracion' && fila) {
    if (fila.tipo_remuneracion === 'PORCENTAJE') return `${fmtNum(valor, 2)}%`;
    if (fila.tipo_remuneracion === 'POR KM') return `${fmtDinero(valor)}/km`;
    if (fila.tipo_remuneracion === 'FIJA') return fmtDinero(valor);
    return fmtDinero(valor);
  }
  if (campo.tipo === 'select') return insigniaEstado(String(valor));
  if (campo.tipo === 'select_cuenta') return esc(valor);
  return esc(valor);
}

// ============================================================
// Modal de alta / edición
// ============================================================
async function abrirModal(clave, id) {
  const mod = MODULOS[clave];
  registroEditando = id;
  $('#modal-titulo').textContent = id
    ? `Editar ${mod.titulo.toLowerCase()}`
    : `Nuevo registro de ${mod.titulo.toLowerCase()}`;

  let datos = {};
  if (id) {
    try { datos = await API.obtener(mod.recurso, id); }
    catch (err) { mostrarToast(err.message, true); return; }
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
      const comoEquipos = equipos.map(e => `Equipo #${e.id_equipo} · ${patente(e.id_unidad_principal)}`);
      sugerenciasDeposito = [...new Set([...existentes, ...comoEquipos])].sort();
    } catch (err) { /* sin sugerencias */ }
  }

  // Cargar cuentas para campos tipo select_cuenta (ej. pagador en viajes)
  let cuentasParaSelector = [];
  if (camposVisibles.some(c => c.tipo === 'select_cuenta')) {
    try { cuentasParaSelector = await API.listarTodo('cuentas'); }
    catch (err) { cuentasParaSelector = []; }
  }

  $('#modal-cuerpo').innerHTML = camposVisibles.map(c => {
    const valor = datos[c.nombre] ?? '';
    const claseAncho = c.ancho ? ' ancho-completo' : '';
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
              `<option value="${cu.nombre.replace(/"/g, '&quot;')}" ${valor === cu.nombre ? 'selected' : ''}>${cu.nombre} (${cu.tipo})</option>`
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
            <option value="">Seleccionar…</option>
            ${opcionesFk[c.nombre].map(r =>
              `<option value="${r[idCampo]}" ${String(valor) === String(r[idCampo]) ? 'selected' : ''}>${c.mostrar(r)}</option>`
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
        ${c.listaDepositos ? `<datalist id="lista-depositos">${sugerenciasDeposito.map(d => `<option value="${d.replace(/"/g, '&quot;')}"></option>`).join('')}</datalist>` : ''}
        ${c.ayuda ? `<small class="campo-ayuda">${c.ayuda}</small>` : ''}
      </div>`;
  }).join('');

  $('#modal-fondo').hidden = false;
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
  // Restaurar el botón Guardar por si algún modal lo ocultó
  const btnGuardar = $('#btn-guardar');
  if (btnGuardar) btnGuardar.style.display = '';
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
    if (c.requerido && !valor) {
      input.style.borderColor = 'var(--peligro)';
      valido = false;
    } else {
      input.style.borderColor = '';
    }
    if (c.tipo === 'datetime-local' && valor) valor = valor.replace('T', ' ') + ':00';
    datos[c.nombre] = valor;
  });

  // Al crear un viaje, el estado siempre arranca en EN CURSO
  if (!registroEditando && mod.campos.some(c => c.nombre === 'estado' && c.soloEdicion)) {
    datos.estado = 'EN CURSO';
  }

  if (!valido) {
    mostrarToast('Completa los campos obligatorios marcados con *', true);
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
    cargarTabla(moduloActual, $('#buscador')?.value || '', $('#filtro-equipo')?.value || '', $('#filtro-deposito')?.value || '', recogerExtras(), 1);
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

async function eliminarRegistro(clave, id) {
  if (!confirm('¿Eliminar este registro? Esta acción no se puede deshacer.')) return;
  const mod = MODULOS[clave];
  try {
    await API.eliminar(mod.recurso, id);
    mostrarToast('Registro eliminado');
    cargarTabla(clave, $('#buscador')?.value || '', $('#filtro-equipo')?.value || '', $('#filtro-deposito')?.value || '', recogerExtras(), 1);
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
