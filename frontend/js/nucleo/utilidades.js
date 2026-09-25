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

const fmtDinero = n => '$' + Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });
const fmtNum = (n, d = 2) => Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: d });
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
  if (!desde || !hasta) return `Período: ${desde || '…'} a ${hasta || '…'}`;
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
  return `Período: ${desde} a ${hasta}`;
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
  dir:         $('#fa-dir')?.value || ''
});

function mostrarToast(mensaje, esError = false) {
  const toast = $('#toast');
  toast.textContent = mensaje;
  toast.className = 'toast' + (esError ? ' error' : '');
  toast.hidden = false;
  setTimeout(() => { toast.hidden = true; }, 3000);
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
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
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

function insigniaEstado(valor) {
  const mapa = {
    'EN CURSO': 'azul', 'EN DESTINO': 'ambar', 'FINALIZADO': 'verde', 'FACTURADO': 'gris',
    'PAGADO': 'verde', 'PENDIENTE': 'rojo', 'PARCIAL': 'ambar',
    'PRINCIPAL': 'azul', 'SECUNDARIA': 'gris',
    'COLOCADA': 'verde', 'AUXILIO': 'ambar',
    'CHOFER': 'azul', 'PROVEEDOR': 'ambar', 'CLIENTE': 'verde'
  };
  const color = mapa[valor] || 'gris';
  return `<span class="insignia ${color}">${valor}</span>`;
}
