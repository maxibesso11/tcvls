// frontend/js/nucleo/utilidades.js
// Utilidades comunes: selector $, formatos de dinero/fecha, rangos de fechas,
// toasts, caché de unidades y equipos, insignias.
// Las funciones son globales a propósito: las usan los onclick="..." del HTML
// generado y los demás archivos. El orden de carga está en index.html.

// ============================================================
// Utilidades
// ============================================================
const $ = sel => document.querySelector(sel);
const contenido = $('#contenido');

// Formatos es-AR: "$ 8.420.000" en tablas, "$ 18,4 M" en cifras grandes,
// negativos con el signo menos real (−).
const fmtDinero = n => {
  const v = Number(n || 0);
  return (v < 0 ? '−' : '') + '$ ' + Math.abs(v).toLocaleString('es-AR', { maximumFractionDigits: 0 });
};
// Importe con color según el signo: positivo en verde, negativo en rojo, cero
// sin color. El signo menos se mantiene, así no depende solo del color.
const fmtDineroSigno = n => {
  const v = Number(n || 0);
  return v === 0 ? fmtDinero(v) : `<span class="${v > 0 ? 'monto-pos' : 'monto-neg'}">${fmtDinero(v)}</span>`;
};
const fmtMillones = n => {
  const v = Number(n || 0);
  if (Math.abs(v) < 1e6) return fmtDinero(v); // debajo del millón no se abrevia
  return (v < 0 ? '−' : '') + '$ ' + (Math.abs(v) / 1e6).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' M';
};
const fmtNum = (n, d = 2) => {
  const v = Number(n || 0);
  return (v < 0 ? '−' : '') + Math.abs(v).toLocaleString('es-AR', { maximumFractionDigits: d });
};
const fmtFecha = f => {
  if (!f) return '—';
  return String(f).slice(0, 10).split('-').reverse().join('/');
};

// Escapa caracteres HTML para evitar que datos con < > & " rompan el
// render (o permitan inyección) al construir HTML por concatenación.
const esc = v => {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};


// Devuelve una fecha en formato YYYY-MM-DD (hora local) desplazada los días
// indicados respecto de hoy (días negativos = en el pasado). Se usa hora
// local para que el rango sea correcto en cualquier huso (ej. Argentina).
function fechaISO(desplazamientoDias = 0) {
  const d = new Date();
  d.setDate(d.getDate() + desplazamientoDias);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dia}`;
}
// Rango por defecto: últimos 30 días (desde hace 30 días hasta hoy).
function rango30Dias() {
  return { fecha_desde: fechaISO(-30), fecha_hasta: fechaISO(0) };
}

// Formatea una fecha local como YYYY-MM-DD (sin pasar por UTC, que podría
// correr el día en husos negativos como el de Argentina).
function isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Rango de un mes calendario. mes va de 1 a 12.
// El día 0 del mes siguiente es el último día del mes pedido.
function rangoMes(anio, mes) {
  return {
    fecha_desde: isoLocal(new Date(anio, mes - 1, 1)),
    fecha_hasta: isoLocal(new Date(anio, mes, 0))
  };
}

// Rango de un trimestre. trimestre va de 1 a 4.
function rangoTrimestre(anio, trimestre) {
  const mesInicio = (trimestre - 1) * 3 + 1;
  return {
    fecha_desde: isoLocal(new Date(anio, mesInicio - 1, 1)),
    fecha_hasta: isoLocal(new Date(anio, mesInicio + 2, 0))
  };
}

// Rango de un año completo.
function rangoAnio(anio) {
  return { fecha_desde: `${anio}-01-01`, fecha_hasta: `${anio}-12-31` };
}

const NOMBRES_MES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// Años ofrecidos en los selectores: desde 4 atrás hasta el actual.
function aniosDisponibles() {
  const actual = new Date().getFullYear();
  const lista = [];
  for (let a = actual; a >= actual - 4; a--) lista.push(a);
  return lista;
}

// Describe un rango en lenguaje natural para mostrarlo como período activo.
function describirPeriodo(desde, hasta) {
  if (!desde && !hasta) return '';
  if (!desde || !hasta) return `Período: ${desde ? fmtFecha(desde) : '…'} a ${hasta ? fmtFecha(hasta) : '…'}`;
  const d = new Date(desde + 'T00:00:00'), h = new Date(hasta + 'T00:00:00');
  const anio = d.getFullYear();
  // Año completo
  if (anio === h.getFullYear() && d.getMonth() === 0 && d.getDate() === 1
      && h.getMonth() === 11 && h.getDate() === 31) {
    return `Período: año ${anio}`;
  }
  // Mes completo
  const finMes = new Date(anio, d.getMonth() + 1, 0);
  if (anio === h.getFullYear() && d.getMonth() === h.getMonth()
      && d.getDate() === 1 && h.getDate() === finMes.getDate()) {
    return `Período: ${NOMBRES_MES[d.getMonth()]} ${anio}`;
  }
  // Trimestre completo
  if (anio === h.getFullYear() && d.getDate() === 1 && d.getMonth() % 3 === 0
      && h.getMonth() === d.getMonth() + 2
      && h.getDate() === new Date(anio, h.getMonth() + 1, 0).getDate()) {
    return `Período: ${d.getMonth() / 3 + 1}° trimestre ${anio}`;
  }
  return `Período: ${fmtFecha(desde)} a ${fmtFecha(hasta)}`;
}

// Deriva iniciales (hasta 3 letras) a partir del nombre de una empresa,
// como respaldo cuando la empresa no definió las suyas.
function derivarIniciales(nombre) {
  if (!nombre) return '—';
  const palabras = String(nombre).trim().split(/\s+/).filter(p => /[a-zA-Z0-9]/.test(p));
  if (palabras.length === 0) return '—';
  if (palabras.length === 1) return palabras[0].slice(0, 2).toUpperCase();
  return palabras.slice(0, 3).map(p => p[0]).join('').toUpperCase();
}


const recogerExtras = () => ({
  fecha_desde: $('#fa-fecha-desde')?.value || '',
  fecha_hasta: $('#fa-fecha-hasta')?.value || '',
  estado:      $('#fa-estado')?.value || '',
  tipo_carga:  $('#fa-tipo-carga')?.value || '',
  orden:       $('#fa-orden')?.value || '',
  dir:         $('#fa-dir')?.value || '',
  ambito:      $('#filtro-ambito')?.value || ''
});

function mostrarToast(mensaje, esError = false) {
  const toast = $('#toast');
  toast.textContent = mensaje;
  toast.hidden = false;
  clearTimeout(mostrarToast.t);
  mostrarToast.t = setTimeout(() => { toast.hidden = true; }, esError ? 5000 : 3000);
}

// Diccionario en caché de unidades (id → registro completo) para
// poder enriquecer los equipos con sus patentes sin múltiples requests.
let _cacheUnidades = null;
async function obtenerCacheUnidades(forzar = false) {
  if (forzar || !_cacheUnidades) {
    try {
      const lista = await API.listarTodo('unidades');
      _cacheUnidades = {};
      lista.forEach(u => { _cacheUnidades[u.id_unidad] = u; });
    } catch { _cacheUnidades = {}; }
  }
  return _cacheUnidades;
}

// Patente de una unidad desde la caché (ya cargada al listar los equipos).
function patenteDeUnidad(idUnidad) {
  if (idUnidad == null) return '?';
  const unidad = _cacheUnidades && _cacheUnidades[idUnidad];
  return unidad ? unidad.patente : `#${idUnidad}`;
}

// Carga equipos enriquecidos con patente_principal y patente_secundaria
// resueltas desde el diccionario de unidades.
async function listarEquiposEnriquecidos() {
  const [equipos, unidades] = await Promise.all([
    API.listarTodo('equipos'),
    obtenerCacheUnidades(true) // refrescar por si hay cambios
  ]);
  return equipos.map(e => ({
    ...e,
    patente_principal: unidades[e.id_unidad_principal]?.patente,
    patente_secundaria: unidades[e.id_unidad_secundaria]?.patente
  }));
}

// Copia los datos completos de un equipo al portapapeles en formato legible,
// para poder enviarlos fácilmente (por WhatsApp, email, etc.).
async function copiarEquipo(idEquipo) {
  try {
    const [equipo, unidades, choferes] = await Promise.all([
      API.obtener('equipos', idEquipo),
      obtenerCacheUnidades(true),
      API.listarTodo('choferes')
    ]);
    const up = unidades[equipo.id_unidad_principal] || {};
    const us = unidades[equipo.id_unidad_secundaria] || {};
    const chofer = choferes.find(c => c.id_chofer === equipo.id_chofer) || {};

    const tara = equipo.peso_tara != null ? `${fmtNum(equipo.peso_tara, 0)} kg` : '—';
    const bruto = equipo.peso_bruto != null ? `${fmtNum(equipo.peso_bruto, 0)} kg` : '—';
    // Capacidad de carga = bruto − tara (si ambos están cargados)
    let capacidad = '—';
    if (equipo.peso_tara != null && equipo.peso_bruto != null) {
      capacidad = `${fmtNum(Number(equipo.peso_bruto) - Number(equipo.peso_tara), 0)} kg`;
    }

    // Encabezado con los datos de la empresa del usuario
    const empNombre = SESION?.nombre_empresa || '';
    const empCuit = SESION?.cuit_empresa || '';
    let encabezado = '';
    if (empNombre) encabezado += `${empNombre}\n`;
    if (empCuit) encabezado += `CUIT: ${empCuit}\n`;
    if (encabezado) encabezado += '\n';

    const texto = encabezado +
`Equipo #${equipo.id_equipo}
Unidad principal: ${up.patente || '?'}${up.modelo ? ' (' + up.modelo + ')' : ''}
Unidad secundaria: ${us.patente || '?'}${us.modelo ? ' (' + us.modelo + ')' : ''}
Chofer: ${chofer.nombre || '?'}${chofer.cuil ? ' — CUIL ' + chofer.cuil : ''}${chofer.telefono ? ' — Tel ' + chofer.telefono : ''}
Peso de tara: ${tara}
Peso bruto: ${bruto}
Capacidad de carga: ${capacidad}`;

    await copiarAlPortapapeles(texto);
    mostrarToast('Datos del equipo copiados al portapapeles.');
  } catch (err) {
    mostrarToast('No se pudieron copiar los datos: ' + err.message, true);
  }
}

// Copia texto al portapapeles con respaldo para navegadores sin la API moderna.
async function copiarAlPortapapeles(texto) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(texto);
  }
  // Respaldo: textarea temporal + execCommand
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.setAttribute('aria-hidden', 'true');
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
      document.body.removeChild(ta);
      resolve();
    } catch (e) {
      document.body.removeChild(ta);
      reject(e);
    }
  });
}

// Insignia de estado: siempre lleva la palabra (el color nunca va solo).
// EN CURSO info · EN DESTINO aviso · FINALIZADO ok · FACTURADO marca ·
// vencido peligro · categorías sin punto.
const ESTADOS_INSIGNIA = {
  'EN CURSO': 'info', 'EN DESTINO': 'aviso', 'FINALIZADO': 'ok', 'FACTURADO': 'marca',
  'PAGADO': 'ok', 'PENDIENTE': 'peligro', 'PARCIAL': 'aviso',
  // Categorías: neutras y sin punto (no son un estado)
  'PRINCIPAL': 'sin-punto', 'SECUNDARIA': 'sin-punto',
  'COLOCADA': 'ok', 'AUXILIO': 'aviso',
  'CHOFER': 'sin-punto', 'PROVEEDOR': 'sin-punto', 'CLIENTE': 'sin-punto'
};
function insigniaEstado(valor) {
  const clase = ESTADOS_INSIGNIA[valor] || 'sin-punto';
  return `<span class="insignia ${clase}">${esc(valor)}</span>`;
}
// Insignia suelta con la variante elegida (ok | aviso | peligro | info | marca | '').
// Insignia "baja" para un equipo dado de baja en listados y métricas.
const marcaBaja = r => (r && (r.activo === false || r.activo === 0) ? ' ' + insignia('baja', 'aviso') : '');

const insignia = (texto, variante = '') => `<span class="insignia ${variante}">${esc(String(texto).toUpperCase())}</span>`;

// Patente Mercosur: la identidad de cada unidad. tam: 'chica' | '' | 'grande'.
function patenteHTML(patente, tam = 'chica') {
  const clase = tam ? ` patente-${tam}` : '';
  return `<span class="patente${clase}"><b>${esc(patente || '?')}</b></span>`;
}

// Equipo = dos patentes juntas (camión + acoplado)
// (juntas en una línea, separadas 4px)
const patentesEquipo = r => `<span style="display:inline-flex;gap:4px;white-space:nowrap">${patenteHTML(r.patente_principal)}${patenteHTML(r.patente_secundaria || '?')}</span>`;

// Ícono SVG de línea 24×24, trazo 2.
const ICONOS = {
  mas: '<path d="M12 5v14M5 12h14"/>',
  editar: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  borrar: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  volver: '<path d="M15 5l-7 7 7 7"/>',
  descargar: '<path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14"/>'
};
const icono = (nombre, tam = 16) =>
  `<svg viewBox="0 0 24 24" width="${tam}" height="${tam}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[nombre] || ''}</svg>`;

// Reemplaza a confirm(): modal con botón destructivo. Devuelve una promesa
// que resuelve true si el usuario confirma. Uso: if (!await confirmar('…')) return;
function confirmar(texto, boton = 'Confirmar', titulo = 'Confirmar acción') {
  return new Promise(resolve => {
    const fondo = $('#confirmar-fondo');
    $('#confirmar-titulo').textContent = titulo;
    $('#confirmar-texto').innerHTML = String(texto).split(/\n\n/).map(p => `<p>${esc(p)}</p>`).join('');
    $('#confirmar-si').textContent = boton;
    fondo.hidden = false;
    $('#confirmar-no').focus();
    const cerrar = valor => {
      fondo.hidden = true;
      $('#confirmar-si').removeEventListener('click', si);
      $('#confirmar-no').removeEventListener('click', no);
      fondo.removeEventListener('click', fuera);
      document.removeEventListener('keydown', tecla);
      resolve(valor);
    };
    const si = () => cerrar(true);
    const no = () => cerrar(false);
    const fuera = e => { if (e.target === fondo) cerrar(false); };
    const tecla = e => { if (e.key === 'Escape') cerrar(false); };
    $('#confirmar-si').addEventListener('click', si);
    $('#confirmar-no').addEventListener('click', no);
    fondo.addEventListener('click', fuera);
    document.addEventListener('keydown', tecla);
  });
}

// Tabla densa dentro de su marco (scrollea adentro, nunca el body).
// filas: arreglo de arreglos; una celda que ya empieza con "<td" se usa tal
// cual (ej. '<td class="num">12</td>'). Las columnas cuyas celdas son
// numéricas (clase "num") alinean también su encabezado a la derecha.
// opciones.clic(i) devuelve el JS que abre la ficha de la fila i (tr.clic).
function tablaSimple(cabeceras, filas, opciones = {}) {
  const esNum = i => filas.length > 0 && /^<td[^>]*class="[^"]*\bnum\b/.test(String(filas[0][i]));
  const fila = (f, i) => {
    const js = opciones.clic ? opciones.clic(i) : null;
    const attrs = js ? ` class="clic" tabindex="0" onclick="${js}" onkeydown="if (event.key === 'Enter') { ${js} }"` : '';
    return `<tr${attrs}>${f.map(c => String(c).startsWith('<td') ? c : `<td>${c}</td>`).join('')}</tr>`;
  };
  return `
    <div class="tabla-marco"><table class="tabla">
      <thead><tr>${cabeceras.map((h, i) => `<th${esNum(i) ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead>
      <tbody>${filas.map(fila).join('')}</tbody>
    </table></div>`;
}

// Bloque "Otras acciones" para el pie de un formulario dentro de .formulario:
// reemplaza al menú "…" de las filas. Cada acción cierra el modal y ejecuta
// su JS. lista: [{ texto, onclick, peligro }].
function bloqueAcciones(lista) {
  if (!lista.length) return '';
  return `
    <div class="grupo-titulo"><div class="rotulo">Otras acciones</div></div>
    <div class="campo ancho"><div class="acciones">${lista.map(a =>
      `<button type="button" class="btn btn-chico${a.peligro ? ' btn-peligro' : ''}" onclick="cerrarModal(); ${a.onclick}">${a.texto}</button>`).join('')}</div></div>`;
}

// Argumento literal seguro para un onclick="…" generado: jsArg('a"b') → &quot;a\&quot;b&quot;
const jsArg = v => esc(JSON.stringify(v ?? ''));

// Hoja (reemplaza al panel): cabecera con título y subtítulo, cuerpo y pie.
// cuerpo puede ser una tabla directa (a sangre) o un .hoja-cuerpo.
function hojaHTML(titulo, sub, cuerpo, extra = '', pie = '') {
  return `<section class="hoja"><header class="hoja-cabecera"><div><h2 class="hoja-titulo">${titulo}</h2>${sub ? `<div class="hoja-sub">${sub}</div>` : ''}</div>${extra}</header>${cuerpo}${pie ? `<footer class="hoja-pie">${pie}</footer>` : ''}</section>`;
}

// Fila de alerta con cuenta regresiva: .vencida si días < 0, .pronto si ≤ 7.
// dias: número (negativo = vencido) o null cuando no aplica; sinDias: texto
// alternativo para la columna de días (ej. "28" sin descanso).
function alertaHTML({ dias, titulo, detalle, accion = '', sinDias = null, urgente = false }) {
  let clase = '';
  let numero;
  if (dias === null || dias === undefined) {
    clase = urgente ? 'vencida' : 'pronto';
    numero = `${sinDias.valor}<small>${sinDias.unidad}</small>`;
  } else {
    clase = dias < 0 ? 'vencida' : dias <= 7 ? 'pronto' : '';
    numero = `${dias < 0 ? '−' + Math.abs(dias) : dias}<small>días</small>`;
  }
  return `<li class="alerta ${clase}"><div class="alerta-dias">${numero}</div><div class="alerta-texto"><strong>${titulo}</strong><span>${detalle}</span></div>${accion || '<span></span>'}</li>`;
}

// Días de calendario entre hoy y una fecha (negativo si ya pasó).
function diasHasta(fecha) {
  if (!fecha) return null;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const f = new Date(String(fecha).slice(0, 10) + 'T00:00:00');
  return Math.round((f - hoy) / 86400000);
}

// Ingresos y rentabilidad: solo para quien administra la empresa (no para el
// rol USUARIO). El servidor aplica la misma regla.
const veFinanzas = () => !!(SESION && SESION.rol !== 'USUARIO');
