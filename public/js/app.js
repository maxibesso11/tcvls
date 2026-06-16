// public/js/app.js - Lógica de la SPA del ERP

// ============================================================
// Configuración de módulos (coincide con las tablas establecidas)
// ============================================================
const MODULOS = {
  choferes: {
    titulo: 'Choferes',
    sub: 'Personal de conducción y vencimientos de carnet',
    recurso: 'choferes',
    id: 'id_chofer',
    campos: [
      { nombre: 'nombre', etiqueta: 'Nombre completo', tipo: 'text', requerido: true, ancho: true },
      { nombre: 'cuil', etiqueta: 'CUIL', tipo: 'text', requerido: true },
      { nombre: 'edad', etiqueta: 'Edad', tipo: 'number', requerido: true },
      { nombre: 'vencimiento_carnet', etiqueta: 'Vencimiento carnet', tipo: 'date', requerido: true },
      { nombre: 'ultima_jornada_descanso', etiqueta: 'Última jornada de descanso', tipo: 'date', requerido: true },
      { nombre: 'domicilio', etiqueta: 'Domicilio', tipo: 'text', ancho: true, requerido: true },
      { nombre: 'telefono', etiqueta: 'Teléfono', tipo: 'text', requerido: true },
      { nombre: 'tipo_remuneracion', etiqueta: 'Tipo de remuneración', tipo: 'select', opciones: ['POR KM', 'PORCENTAJE', 'FIJA'], requerido: true },
      { nombre: 'remuneracion', etiqueta: 'Remuneración ($/km, % o $ fijo)', tipo: 'number', requerido: true }
    ]
  },
  unidades: {
    titulo: 'Unidades',
    sub: 'Vehículos de la flota: chasis, tractores, acoplados y bateas',
    recurso: 'unidades',
    id: 'id_unidad',
    campos: [
      { nombre: 'patente', etiqueta: 'Patente', tipo: 'text', requerido: true },
      { nombre: 'modelo', etiqueta: 'Modelo', tipo: 'text', requerido: true },
      { nombre: 'funcionalidad', etiqueta: 'Funcionalidad', tipo: 'select', requerido: true, opciones: ['PRINCIPAL', 'SECUNDARIA'] }
    ]
  },
  equipos: {
    titulo: 'Equipos',
    sub: 'Composición: unidad principal + unidad secundaria + chofer',
    recurso: 'equipos',
    id: 'id_equipo',
    campos: [
      { nombre: 'id_unidad_principal', etiqueta: 'Unidad principal', tipo: 'fk', recurso: 'unidades', mostrar: r => `${r.patente} — ${r.modelo}`, filtro: r => r.funcionalidad === 'PRINCIPAL', requerido: true },
      { nombre: 'id_unidad_secundaria', etiqueta: 'Unidad secundaria', tipo: 'fk', recurso: 'unidades', mostrar: r => `${r.patente} — ${r.modelo}`, filtro: r => r.funcionalidad === 'SECUNDARIA', requerido: true },
      { nombre: 'id_chofer', etiqueta: 'Chofer', tipo: 'fk', recurso: 'choferes', mostrar: r => r.nombre, requerido: true },
      { nombre: 'peso_tara', etiqueta: 'Peso de tara (kg)', tipo: 'number', requerido: true },
      { nombre: 'peso_bruto', etiqueta: 'Peso bruto (kg)', tipo: 'number', requerido: true }
    ],
    accionesPersonalizadas: (fila) => {
      const id = fila.id_equipo;
      return `<button class="btn btn-secundario btn-mini" onclick="copiarEquipo(${id})">Copiar 📋</button>
        <button class="btn btn-secundario btn-mini" onclick="abrirModal('equipos', ${id})">Editar</button>
        <button class="btn btn-peligro btn-mini" onclick="eliminarRegistro('equipos', ${id})">Eliminar</button>`;
    }
  },
  viajes: {
    titulo: 'Viajes',
    sub: 'Operaciones de transporte, tarifas y estado de cobro',
    filtroEquipo: true,
    recurso: 'viajes',
    id: 'id_viaje',
    campos: [
      { nombre: 'fecha_origen', etiqueta: 'Fecha de origen', tipo: 'datetime-local', requerido: true },
      { nombre: 'id_equipo', etiqueta: 'Equipo', tipo: 'fk', recurso: 'equipos', mostrar: r => `${r.patente_principal || '?'} / ${r.patente_secundaria || '?'}`, requerido: true },
      { nombre: 'tipo_carga', etiqueta: 'Tipo de carga', tipo: 'text', requerido: true },
      { nombre: 'origen', etiqueta: 'Origen', tipo: 'text', requerido: true },
      { nombre: 'destino', etiqueta: 'Destino', tipo: 'text', requerido: true },
      { nombre: 'tarifa', etiqueta: 'Tarifa ($)', tipo: 'number', requerido: true },
      { nombre: 'tipo_tarifa', etiqueta: 'Tipo de tarifa', tipo: 'select', requerido: true, opciones: ['POR KM', 'POR TONELADA', 'UNICA'] },
      { nombre: 'cantidad_cargada', etiqueta: 'Cantidad cargada', tipo: 'number' },
      { nombre: 'comision', etiqueta: 'Comisión al cliente (%)', tipo: 'number' },
      { nombre: 'resultado', etiqueta: 'Resultado (tn descargadas / km)', tipo: 'number', soloEdicion: true },
      { nombre: 'estado', etiqueta: 'Estado', tipo: 'select', requerido: true, opciones: ['EN CURSO', 'EN DESTINO', 'FINALIZADO', 'FACTURADO'], soloEdicion: true },
      { nombre: 'fecha_llegada', etiqueta: 'Fecha de llegada', tipo: 'datetime-local', soloEdicion: true },
      { nombre: 'pagador', etiqueta: 'Pagador', tipo: 'select_cuenta', tiposCuenta: ['CLIENTE', 'PROVEEDOR'], requerido: true },
      { nombre: 'numero_remito', etiqueta: 'Número de remito', tipo: 'text', maxlen: 20, requerido: true }
    ],
    filtrosAvanzados: true,
    accionesPersonalizadas: (fila) => {
      const id = fila.id_viaje;
      const editar = `<button class="btn btn-secundario btn-mini" onclick="abrirModal('viajes', ${id})">Editar</button>`;

      // FACTURADO: solo editar (no avanzar, no eliminar)
      if (fila.estado === 'FACTURADO') {
        return `${editar} <span class="insignia gris" title="Los viajes facturados no se pueden eliminar ni modificar de estado">Cerrado</span>`;
      }

      const eliminar = `<button class="btn btn-peligro btn-mini" onclick="eliminarRegistro('viajes', ${id})">Eliminar</button>`;
      const avanzar = `<button class="btn btn-primario btn-mini" onclick="avanzarEstadoViaje(${id})">Avanzar ▶</button>`;
      return `${editar} ${avanzar} ${eliminar}`;
    }
  },
  'consumos-combustible': {
    titulo: 'Consumos de combustible',
    sub: 'Cargas de gasoil por equipo y rendimiento',
    filtroEquipo: true,
    recurso: 'consumos-combustible',
    id: 'id_consumo_combustible',
    campos: [
      { nombre: 'fecha', etiqueta: 'Fecha', tipo: 'datetime-local', requerido: true },
      { nombre: 'id_equipo', etiqueta: 'Equipo', tipo: 'fk', recurso: 'equipos', mostrar: r => `${r.patente_principal || '?'} / ${r.patente_secundaria || '?'}`, requerido: true },
      { nombre: 'estacion_carga', etiqueta: 'Estación de carga', tipo: 'text', requerido: true },
      { nombre: 'proveedor', etiqueta: 'Proveedor (cuenta)', tipo: 'select_cuenta', tiposCuenta: ['PROVEEDOR', 'CLIENTE'], requerido: true },
      { nombre: 'cantidad_litros', etiqueta: 'Litros', tipo: 'number', requerido: true },
      { nombre: 'precio_por_litro', etiqueta: 'Precio por litro ($)', tipo: 'number', requerido: true },
      { nombre: 'km_recorridos', etiqueta: 'Km recorridos', tipo: 'number' }
    ]
  },
  'consumos-generales': {
    titulo: 'Consumos generales',
    sub: 'Repuestos, lubricantes y otros gastos por unidad',
    recurso: 'consumos-generales',
    id: 'id_consumo_general',
    campos: [
      { nombre: 'fecha', etiqueta: 'Fecha', tipo: 'datetime-local', requerido: true },
      { nombre: 'id_unidad', etiqueta: 'Unidad', tipo: 'fk', recurso: 'unidades', mostrar: r => `${r.patente} — ${r.modelo}`, requerido: true },
      { nombre: 'proveedor', etiqueta: 'Proveedor (cuenta)', tipo: 'select_cuenta', tiposCuenta: ['PROVEEDOR', 'CLIENTE'], requerido: true },
      { nombre: 'concepto', etiqueta: 'Concepto', tipo: 'text', requerido: true, ancho: true },
      { nombre: 'monto', etiqueta: 'Monto ($)', tipo: 'number', requerido: true }
    ]
  },
  cuentas: {
    titulo: 'Cuentas',
    sub: 'Proveedores y clientes con cuenta corriente. Los choferes se gestionan desde el módulo Choferes',
    recurso: 'cuentas',
    id: 'id_cuenta',
    campos: [
      { nombre: 'tipo', etiqueta: 'Tipo', tipo: 'select', requerido: true, opciones: ['PROVEEDOR', 'CLIENTE'] },
      { nombre: 'cuil', etiqueta: 'CUIL', tipo: 'text', requerido: true },
      { nombre: 'nombre', etiqueta: 'Nombre', tipo: 'text', requerido: true, ancho: true },
      { nombre: 'domicilio', etiqueta: 'Domicilio', tipo: 'text', ancho: true, requerido: true },
      { nombre: 'telefono', etiqueta: 'Teléfono', tipo: 'text', requerido: true }
    ],
    accionesPersonalizadas: (fila) => {
      if (fila.tipo === 'CHOFER') {
        return `<span class="insignia gris" title="Gestionar desde el módulo Choferes">Solo lectura</span>
                <a class="btn btn-secundario btn-mini" style="text-decoration:none" href="#choferes">Ir a Choferes</a>`;
      }
      return null; // null = usar los botones por defecto
    }
  },
  movimientos: {
    titulo: 'Movimientos',
    sub: 'Movimientos de cuenta corriente por titular',
    recurso: 'movimientos',
    id: 'id_movimiento',
    campos: [
      { nombre: 'id_cuenta', etiqueta: 'Titular (cuenta)', tipo: 'fk', recurso: 'cuentas', mostrar: r => `${r.nombre} (${r.tipo})`, requerido: true },
      { nombre: 'fecha', etiqueta: 'Fecha', tipo: 'datetime-local', requerido: true },
      { nombre: 'monto', etiqueta: 'Monto ($, negativo = débito)', tipo: 'number', requerido: true },
      { nombre: 'concepto', etiqueta: 'Concepto', tipo: 'text', requerido: true, ancho: true }
    ]
  },
  stock: {
    titulo: 'Stock',
    sub: 'Elementos en depósito y su valuación. Un depósito puede ser un lugar físico o un equipo',
    filtroDeposito: true,
    recurso: 'stock',
    id: 'id_stock',
    campos: [
      { nombre: 'elemento', etiqueta: 'Elemento', tipo: 'text', requerido: true, ancho: true },
      { nombre: 'valuacion', etiqueta: 'Valuación ($)', tipo: 'number', requerido: true },
      { nombre: 'deposito', etiqueta: 'Depósito (lugar físico o equipo)', tipo: 'text', requerido: true, listaDepositos: true }
    ]
  },
  mantenimientos: {
    titulo: 'Mantenimientos',
    sub: 'Mantenimientos programados por unidad y periodicidad',
    filtroEquipo: true,
    recurso: 'mantenimientos',
    id: 'id_mantenimiento',
    campos: [
      { nombre: 'id_unidad', etiqueta: 'Unidad', tipo: 'fk', recurso: 'unidades', mostrar: r => `${r.patente} — ${r.modelo}`, requerido: true },
      { nombre: 'concepto', etiqueta: 'Concepto', tipo: 'text', requerido: true, ancho: true },
      { nombre: 'periodicidad', etiqueta: 'Periodicidad', tipo: 'text', requerido: true },
      { nombre: 'fecha', etiqueta: 'Último realizado', tipo: 'date' },
      { nombre: 'fecha_vencimiento', etiqueta: 'Próximo vencimiento', tipo: 'date', requerido: true }
    ]
  },
  vencimientos: {
    titulo: 'Vencimientos',
    sub: 'Documentación y habilitaciones por unidad',
    filtroEquipo: true,
    recurso: 'vencimientos',
    id: 'id_vencimiento',
    campos: [
      { nombre: 'id_unidad', etiqueta: 'Unidad', tipo: 'fk', recurso: 'unidades', mostrar: r => `${r.patente} — ${r.modelo}`, requerido: true },
      { nombre: 'concepto', etiqueta: 'Concepto', tipo: 'text', requerido: true, ancho: true },
      { nombre: 'fecha_vencimiento', etiqueta: 'Fecha de vencimiento', tipo: 'date', requerido: true }
    ]
  },
  cubiertas: {
    titulo: 'Cubiertas',
    sub: 'Estado y ubicación de neumáticos por unidad',
    filtroEquipo: true,
    recurso: 'cubiertas',
    id: 'id_cubierta',
    campos: [
      { nombre: 'identificador', etiqueta: 'Identificador', tipo: 'text', maxlen: 50 },
      { nombre: 'id_unidad', etiqueta: 'Unidad', tipo: 'fk', recurso: 'unidades', mostrar: r => `${r.patente} — ${r.modelo}`, requerido: true },
      { nombre: 'estado', etiqueta: 'Estado', tipo: 'text', requerido: true },
      { nombre: 'ubicacion', etiqueta: 'Ubicación', tipo: 'select', requerido: true, opciones: ['COLOCADA', 'AUXILIO'] },
      { nombre: 'fecha_colocacion', etiqueta: 'Fecha de colocación', tipo: 'date' }
    ]
  },
  'gastos-administrativos': {
    titulo: 'Gastos administrativos',
    sub: 'Gastos de estructura no asociados a unidades: contabilidad, impuestos, asesorías',
    recurso: 'gastos-administrativos',
    id: 'id_gasto_administrativo',
    campos: [
      { nombre: 'fecha', etiqueta: 'Fecha', tipo: 'datetime-local', requerido: true },
      { nombre: 'proveedor', etiqueta: 'Proveedor (cuenta)', tipo: 'select_cuenta', tiposCuenta: ['PROVEEDOR', 'CLIENTE'], requerido: true },
      { nombre: 'concepto', etiqueta: 'Concepto', tipo: 'text', requerido: true, ancho: true, maxlen: 150 },
      { nombre: 'monto', etiqueta: 'Monto ($)', tipo: 'number', requerido: true }
    ]
  }
};

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

// ============================================================
// Navegación
// ============================================================
function navegar() {
  const hash = location.hash.replace('#', '') || 'dashboard';
  document.querySelectorAll('.nav-link').forEach(a => {
    let vistaActiva = hash;
    if (hash.startsWith('cuenta-corriente/')) vistaActiva = 'cuentas-corrientes';
    else if (hash.startsWith('metrica/')) vistaActiva = 'dashboard';
    a.classList.toggle('activo', a.dataset.vista === vistaActiva);
  });
  if (typeof cerrarSidebar === 'function') cerrarSidebar();
  // Bloquear acceso directo (por URL) a módulos desactivados para la empresa
  const claveModulo = hash.startsWith('cuenta-corriente/') ? 'cuentas-corrientes' : hash;
  if (!esVistaAdmin(hash) && !moduloActivo(claveModulo) && (MODULOS[hash] || claveModulo === 'cuentas-corrientes')) {
    mostrarToast('Ese módulo no está habilitado para tu empresa.', true);
    location.hash = 'dashboard';
    return;
  }
  if (hash === 'apariencia') renderApariencia();
  else if (hash === 'admin-empresas') renderAdminEmpresas();
  else if (hash === 'admin-usuarios') renderAdminUsuarios();
  else if (hash === 'dashboard') renderDashboard();
  else if (hash === 'alertas') renderAlertas();
  else if (hash.startsWith('metrica/')) renderMetricaDetalle(hash.split('/')[1]);
  else if (hash === 'cuentas-corrientes') renderCuentasCorrientes();
  else if (hash.startsWith('cuenta-corriente/')) renderDetalleCuenta(hash.split('/')[1]);
  else if (MODULOS[hash]) renderModulo(hash);
  else if (SESION && SESION.rol === 'ADMIN') renderAdminEmpresas();
  else renderDashboard();
}

function esVistaAdmin(hash) {
  return hash.startsWith('admin') || hash === 'apariencia' || hash === 'dashboard' || hash === 'alertas' || hash.startsWith('metrica/');
}

window.addEventListener('hashchange', navegar);
// Controles del sidebar en móvil: abrir, cerrar con botón ✕,
// cerrar tocando el overlay y cerrar con la tecla Escape
function abrirSidebar() {
  $('#sidebar').classList.add('abierta');
  $('#sidebar-overlay').hidden = false;
}
function cerrarSidebar() {
  $('#sidebar').classList.remove('abierta');
  $('#sidebar-overlay').hidden = true;
}

$('#btn-menu').addEventListener('click', abrirSidebar);
$('#btn-cerrar-sidebar').addEventListener('click', cerrarSidebar);
$('#sidebar-overlay').addEventListener('click', cerrarSidebar);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('#sidebar').classList.contains('abierta')) cerrarSidebar();
});

// ============================================================
// Dashboard
// ============================================================
// Estado del filtro de fecha global del dashboard
const filtroDash = rango30Dias();

async function renderDashboard() {
  contenido.innerHTML = `
    <div class="vista-cabecera">
      <div>
        <div class="vista-titulo">Dashboard</div>
        <div class="vista-sub">Resumen operativo y financiero de la empresa</div>
      </div>
      <button class="btn btn-secundario" onclick="renderDashboard()">Actualizar</button>
    </div>
    <div class="filtros-avanzados" id="dash-filtros">
      <div class="filtro-grupo">
        <label class="filtro-label">Desde</label>
        <input type="date" class="buscador filtro-fecha" id="dash-desde" value="${filtroDash.fecha_desde}">
      </div>
      <div class="filtro-grupo">
        <label class="filtro-label">Hasta</label>
        <input type="date" class="buscador filtro-fecha" id="dash-hasta" value="${filtroDash.fecha_hasta}">
      </div>
      <button class="btn btn-secundario btn-mini" id="dash-aplicar">Aplicar período</button>
      <button class="btn btn-secundario btn-mini" id="dash-limpiar">Últimos 30 días</button>
      <span class="filtro-label" id="dash-periodo-activo" style="align-self:center"></span>
    </div>
    <div id="dash-kpis" class="kpi-grid"><div class="estado-vacio">Cargando métricas…</div></div>
    <div class="panel-grid" id="dash-paneles"></div>
  `;

  $('#dash-aplicar').addEventListener('click', () => {
    filtroDash.fecha_desde = $('#dash-desde').value;
    filtroDash.fecha_hasta = $('#dash-hasta').value;
    renderDashboard();
  });
  $('#dash-limpiar').addEventListener('click', () => {
    const r = rango30Dias();
    filtroDash.fecha_desde = r.fecha_desde;
    filtroDash.fecha_hasta = r.fecha_hasta;
    renderDashboard();
  });
  if (filtroDash.fecha_desde || filtroDash.fecha_hasta) {
    $('#dash-periodo-activo').textContent =
      `Período: ${filtroDash.fecha_desde || '…'} a ${filtroDash.fecha_hasta || '…'}`;
  }

  const periodo = { fecha_desde: filtroDash.fecha_desde, fecha_hasta: filtroDash.fecha_hasta };

  try {
    const [kpis, alertas, rendEquipos, rendChoferes, clientes, consumosEq, ingresosViaje, rentabilidad, gastosAdmin] = await Promise.all([
      API.kpis(periodo), API.alertas(), API.rendimientoEquipos(),
      API.rendimientoChoferes(), API.clientesTop(),
      API.consumosPorEquipo(periodo), API.ingresosPorViaje(periodo), API.rentabilidadEquipos(periodo),
      API.gastosAdministrativos(periodo)
    ]);

    // --- KPIs ---
    $('#dash-kpis').innerHTML = `
      <div class="kpi">
        <div class="kpi-etiqueta">Viajes activos</div>
        <div class="kpi-valor info">${kpis.viajes.viajes_activos || 0}</div>
        <div class="kpi-detalle">${kpis.viajes.total_viajes} viajes totales registrados</div>
      </div>
      <div class="kpi">
        <div class="kpi-etiqueta">Ingresos totales</div>
        <div class="kpi-valor exito">${fmtDinero(kpis.ingresos.ingresos_totales)}</div>
        <div class="kpi-detalle">Pendiente de cobro: ${fmtDinero(kpis.ingresos.pendiente_cobro)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-etiqueta">Ganancia neta</div>
        <div class="kpi-valor ${kpis.ingresos.ganancia_neta >= 0 ? 'exito' : 'peligro'}">${fmtDinero(kpis.ingresos.ganancia_neta)}</div>
        <div class="kpi-detalle">Margen: ${fmtNum(kpis.ingresos.margen, 1)}% · Costos: ${fmtDinero(kpis.ingresos.costos_totales)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-etiqueta">Rendimiento de combustible</div>
        <div class="kpi-valor aviso">${fmtNum(kpis.combustible.rendimiento_global)} km/L</div>
        <div class="kpi-detalle">${fmtNum(kpis.combustible.litros_totales, 0)} L · ${fmtDinero(kpis.combustible.gasto_combustible)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-etiqueta">Flota</div>
        <div class="kpi-valor">${kpis.flota.total_equipos}</div>
        <div class="kpi-detalle">${kpis.flota.total_unidades} unidades · ${kpis.flota.total_choferes} choferes</div>
      </div>
    `;

    // --- Paneles ---
    // Totales reales (vienen del backend sin límite); fallback a length
    const tot = alertas.totales || {
      carnets: alertas.carnets.length,
      vencimientos: alertas.vencimientos.length,
      mantenimientos: alertas.mantenimientos.length,
      descansos: alertas.descansos.length
    };
    const totalAlertas = tot.carnets + tot.vencimientos + tot.mantenimientos + tot.descansos;

    // Unificar y ordenar por urgencia; mostrar solo las 7 más urgentes
    const alertasOrdenadas = unificarAlertas(alertas);
    const TOPE_ALERTAS = 7;
    const alertasMostradas = alertasOrdenadas.slice(0, TOPE_ALERTAS);
    const restantesAlertas = totalAlertas - alertasMostradas.length;

    const htmlAlertas = totalAlertas === 0
      ? '<div class="estado-vacio">Sin alertas. Todo en orden.</div>'
      : [
          ...alertasMostradas.map(filaAlertaUnificada),
          restantesAlertas > 0
            ? `<div style="padding:8px 14px;border-top:1px solid var(--borde);font-size:12px;color:var(--texto-suave)">
                y ${restantesAlertas} alerta${restantesAlertas === 1 ? '' : 's'} más — <a href="#alertas" style="color:var(--info)">ver todas</a>
              </div>`
            : ''
        ].join('');

    // Limita una lista a 7 elementos en el dashboard; el resto se ve en la
    // vista ampliada de cada métrica.
    const TOPE_DASH = 7;
    const top7 = arr => (arr || []).slice(0, TOPE_DASH);
    const notaResto = (arr, claveMetrica) => {
      const restantes = (arr || []).length - TOPE_DASH;
      if (restantes <= 0) return '';
      return `<div style="padding:8px 14px;border-top:1px solid var(--borde);font-size:12px;color:var(--texto-suave)">
        y ${restantes} más — <a href="#metrica/${claveMetrica}" style="color:var(--info)">ver vista ampliada</a>
      </div>`;
    };

    const htmlEquipos = rendEquipos.length === 0
      ? '<div class="estado-vacio">Sin datos de consumo todavía.</div>'
      : tablaSimple(
          ['Equipo', 'Chofer', 'Km/L', 'Costo/km'],
          top7(rendEquipos).map(r => [
            `${esc(r.patente_principal)} / ${esc(r.patente_secundaria || '?')}`,
            esc(r.chofer),
            `<td class="celda-num">${fmtNum(r.km_por_litro)}</td>`,
            `<td class="celda-num">${fmtDinero(r.costo_por_km)}</td>`
          ])
        ) + notaResto(rendEquipos, 'rendimiento-equipos');

    const htmlChoferes = rendChoferes.length === 0
      ? '<div class="estado-vacio">Sin choferes registrados.</div>'
      : tablaSimple(
          ['Chofer', 'Viajes', 'Ingresos'],
          top7(rendChoferes).map(r => [
            esc(r.nombre),
            `<td class="celda-num">${r.viajes}</td>`,
            `<td class="celda-num">${fmtDinero(r.ingresos)}</td>`
          ])
        ) + (rendChoferes.length > 7 ? `<div style="padding:8px 14px;border-top:1px solid var(--borde);font-size:12px;color:var(--texto-suave)">Mostrando los 7 con más ingresos de ${rendChoferes.length}.</div>` : '');

    const htmlClientes = clientes.length === 0
      ? '<div class="estado-vacio">Sin viajes con pagador registrado.</div>'
      : tablaSimple(
          ['Cliente', 'Viajes', 'Ingresos'],
          top7(clientes).map(r => [
            esc(r.pagador),
            `<td class="celda-num">${r.viajes}</td>`,
            `<td class="celda-num">${fmtDinero(r.ingresos)}</td>`
          ])
        ) + (clientes.length > 7 ? `<div style="padding:8px 14px;border-top:1px solid var(--borde);font-size:12px;color:var(--texto-suave)">Mostrando los 7 con más ingresos de ${clientes.length}.</div>` : '');

    // --- Métrica: consumos generales por equipo ---
    const htmlConsumosEq = consumosEq.length === 0
      ? '<div class="estado-vacio">Sin consumos generales en el período.</div>'
      : tablaSimple(
          ['Equipo', 'Consumos', 'Total'],
          top7(consumosEq).map(r => [
            `${esc(r.patente_principal)} / ${esc(r.patente_secundaria || '?')}`,
            `<td class="celda-num">${r.cantidad}</td>`,
            `<td class="celda-num">${fmtDinero(r.total)}</td>`
          ])
        ) + notaResto(consumosEq, 'consumos-por-equipo');

    // --- Métrica: rentabilidad por equipo ---
    const rentEquipos = rentabilidad.equipos || [];
    const htmlRentabilidad = rentEquipos.length === 0
      ? '<div class="estado-vacio">Sin equipos para calcular rentabilidad.</div>'
      : tablaSimple(
          ['Equipo', 'Ingresos', 'Costos', 'Rentabilidad'],
          top7(rentEquipos).map(r => [
            `${esc(r.patente_principal)} / ${esc(r.patente_secundaria || '?')}`,
            `<td class="celda-num">${fmtDinero(r.ingresos)}</td>`,
            `<td class="celda-num">${fmtDinero(r.costos)}</td>`,
            `<td class="celda-num" style="font-weight:600;color:${r.rentabilidad >= 0 ? 'var(--exito)' : 'var(--peligro)'}">${fmtDinero(r.rentabilidad)}</td>`
          ])
        ) + notaResto(rentEquipos, 'rentabilidad-equipos') + `
        <div style="padding:10px 14px;border-top:1px solid var(--borde);font-size:13px">
          <div style="display:flex;justify-content:space-between"><span>Rentabilidad de equipos</span><strong>${fmtDinero(rentabilidad.rentabilidad_equipos || 0)}</strong></div>
          <div style="display:flex;justify-content:space-between;color:var(--peligro)"><span>− Gastos administrativos</span><strong>${fmtDinero(rentabilidad.gastos_administrativos || 0)}</strong></div>
          <div style="display:flex;justify-content:space-between;margin-top:4px;padding-top:4px;border-top:1px dashed var(--borde);font-size:15px">
            <span><strong>Rentabilidad neta</strong></span>
            <strong style="color:${(rentabilidad.rentabilidad_neta || 0) >= 0 ? 'var(--exito)' : 'var(--peligro)'}">${fmtDinero(rentabilidad.rentabilidad_neta || 0)}</strong>
          </div>
        </div>`;

    // --- Métrica: gastos administrativos ---
    const htmlGastosAdmin = (gastosAdmin.cantidad || 0) === 0
      ? '<div class="estado-vacio">Sin gastos administrativos en el período.</div>'
      : `<div style="padding:8px 14px"><div class="kpi-etiqueta">Total del período</div>
         <div style="font-size:20px;font-weight:600;color:var(--peligro)">${fmtDinero(gastosAdmin.total)}</div>
         <div class="kpi-detalle">${gastosAdmin.cantidad} gasto(s) registrado(s)</div></div>` +
        tablaSimple(
          ['Proveedor', 'Gastos', 'Total'],
          top7(gastosAdmin.por_proveedor).map(r => [
            esc(r.proveedor),
            `<td class="celda-num">${r.cantidad}</td>`,
            `<td class="celda-num">${fmtDinero(r.total)}</td>`
          ])
        ) + notaResto(gastosAdmin.por_proveedor, 'gastos-administrativos');

    // --- Métrica: ingresos por viaje ---
    const ipv = ingresosViaje.resumen;
    const topViajes = ingresosViaje.top_viajes || [];
    const htmlIngresosViaje = ipv.cantidad_viajes === 0
      ? '<div class="estado-vacio">Sin viajes en el período.</div>'
      : `
        <div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:12px">
          <div><div class="kpi-etiqueta">Viajes</div><div style="font-size:18px;font-weight:600">${ipv.cantidad_viajes}</div></div>
          <div><div class="kpi-etiqueta">Ingreso total</div><div style="font-size:18px;font-weight:600;color:var(--exito)">${fmtDinero(ipv.ingreso_total)}</div></div>
          <div><div class="kpi-etiqueta">Promedio por viaje</div><div style="font-size:18px;font-weight:600;color:var(--info)">${fmtDinero(ipv.ingreso_promedio)}</div></div>
        </div>
        <div class="kpi-etiqueta" style="margin-bottom:6px">Viajes con más ingresos</div>
        ${tablaSimple(
          ['Viaje', 'Ruta', 'Pagador', 'Ingreso'],
          topViajes.map(v => [
            `#${v.id_viaje}`,
            `${esc(v.origen)} → ${esc(v.destino)}`,
            esc(v.pagador || '—'),
            `<td class="celda-num">${fmtDinero(v.ingreso)}</td>`
          ])
        )}
        ${ipv.cantidad_viajes > topViajes.length
          ? `<div style="padding:8px 0 0;font-size:12px;color:var(--texto-suave)">
              Mostrando los ${topViajes.length} de mayor ingreso —
              <a href="#metrica/ingresos-por-viaje" style="color:var(--info)">ver todos los ${ipv.cantidad_viajes}</a>
            </div>`
          : ''}`;

    // Cada panel se muestra solo si su módulo está activo. Las alertas
    // dependen de los módulos de flota; ingresos/rentabilidad de viajes;
    // consumos y gastos de sus respectivos módulos.
    const hayFlota = moduloActivo('mantenimientos') || moduloActivo('vencimientos') || moduloActivo('choferes');
    const paneles = [];

    if (hayFlota) paneles.push(`
      <div class="panel">
        <div class="panel-cabecera">
          <span>Alertas <span class="insignia ${totalAlertas ? 'rojo' : 'verde'}">${totalAlertas}</span></span>
          ${totalAlertas > 0 ? `<button class="btn btn-secundario btn-mini" onclick="location.hash='alertas'">Ampliar ↗</button>` : ''}
        </div>
        <div class="panel-cuerpo">${htmlAlertas}</div>
      </div>`);

    if (moduloActivo('viajes')) paneles.push(`
      <div class="panel">
        <div class="panel-cabecera">
          <span>Ingresos por viaje</span>
          <button class="btn btn-secundario btn-mini" onclick="location.hash='metrica/ingresos-por-viaje'">Ampliar ↗</button>
        </div>
        <div class="panel-cuerpo">${htmlIngresosViaje}</div>
      </div>`);

    if (moduloActivo('viajes')) paneles.push(`
      <div class="panel">
        <div class="panel-cabecera">
          <span>Rentabilidad por equipo</span>
          <button class="btn btn-secundario btn-mini" onclick="location.hash='metrica/rentabilidad-equipos'">Ampliar ↗</button>
        </div>
        <div class="panel-cuerpo sin-padding"><div class="tabla-contenedor">${htmlRentabilidad}</div></div>
      </div>`);

    if (moduloActivo('gastos-administrativos')) paneles.push(`
      <div class="panel">
        <div class="panel-cabecera">
          <span>Gastos administrativos</span>
          <button class="btn btn-secundario btn-mini" onclick="location.hash='metrica/gastos-administrativos'">Ampliar ↗</button>
        </div>
        <div class="panel-cuerpo sin-padding"><div class="tabla-contenedor">${htmlGastosAdmin}</div></div>
      </div>`);

    if (moduloActivo('consumos-generales')) paneles.push(`
      <div class="panel">
        <div class="panel-cabecera">
          <span>Consumos generales por equipo</span>
          <button class="btn btn-secundario btn-mini" onclick="location.hash='metrica/consumos-por-equipo'">Ampliar ↗</button>
        </div>
        <div class="panel-cuerpo sin-padding"><div class="tabla-contenedor">${htmlConsumosEq}</div></div>
      </div>`);

    if (moduloActivo('consumos-combustible')) paneles.push(`
      <div class="panel">
        <div class="panel-cabecera">
          <span>Rendimiento por equipo</span>
          <button class="btn btn-secundario btn-mini" onclick="location.hash='metrica/rendimiento-equipos'">Ampliar ↗</button>
        </div>
        <div class="panel-cuerpo sin-padding"><div class="tabla-contenedor">${htmlEquipos}</div></div>
      </div>`);

    if (moduloActivo('viajes')) paneles.push(`
      <div class="panel">
        <div class="panel-cabecera">Rendimiento por chofer</div>
        <div class="panel-cuerpo sin-padding"><div class="tabla-contenedor">${htmlChoferes}</div></div>
      </div>`);

    if (moduloActivo('viajes')) paneles.push(`
      <div class="panel">
        <div class="panel-cabecera">Principales clientes</div>
        <div class="panel-cuerpo sin-padding"><div class="tabla-contenedor">${htmlClientes}</div></div>
      </div>`);

    $('#dash-paneles').innerHTML = paneles.join('');
  } catch (err) {
    $('#dash-kpis').innerHTML = `<div class="estado-vacio">No se pudo conectar con la base de datos.<br>${err.message}</div>`;
  }
}

// Unifica todas las categorías de alertas en una sola lista normalizada y
// la ordena según la prioridad de negocio:
//   1º vencimientos, 2º mantenimientos, 3º licencias de choferes (carnets),
//   y por último los descansos.
// Dentro de cada categoría se ordena por la cantidad de días en alerta:
// lo más urgente primero (los ya vencidos, con días negativos, van arriba).
function unificarAlertas(alertas) {
  // Orden de prioridad por tipo (menor = más prioritario)
  const PRIORIDAD = { vencimiento: 1, mantenimiento: 2, carnet: 3, descanso: 4 };

  const items = [];
  (alertas.vencimientos || []).forEach(a => items.push({
    texto: `${a.concepto} · ${a.patente}`, dias: a.dias_restantes, tipo: 'vencimiento'
  }));
  (alertas.mantenimientos || []).forEach(a => items.push({
    texto: `${a.concepto} · ${a.patente}`, dias: a.dias_restantes, tipo: 'mantenimiento'
  }));
  (alertas.carnets || []).forEach(a => items.push({
    texto: `Carnet de ${a.nombre}`, dias: a.dias_restantes, tipo: 'carnet'
  }));
  (alertas.descansos || []).forEach(a => items.push({
    texto: `Descanso de ${a.nombre}`, diasSinDescanso: a.dias_sin_descanso, tipo: 'descanso'
  }));

  return items.sort((a, b) => {
    // 1) por categoría
    if (PRIORIDAD[a.tipo] !== PRIORIDAD[b.tipo]) return PRIORIDAD[a.tipo] - PRIORIDAD[b.tipo];
    // 2) dentro de la categoría, por días en alerta (más urgente primero)
    if (a.tipo === 'descanso') {
      // Más días sin descanso = más urgente
      return (b.diasSinDescanso || 0) - (a.diasSinDescanso || 0);
    }
    // Menos días restantes (o más vencido) = más urgente
    return a.dias - b.dias;
  });
}

// Renderiza una fila de alerta unificada (incluye el caso de descanso).
function filaAlertaUnificada(it) {
  if (it.tipo === 'descanso') {
    return `
      <div class="alerta-item">
        <span>${esc(it.texto)}</span>
        <span class="insignia rojo">${it.diasSinDescanso} días sin descanso</span>
      </div>`;
  }
  return filaAlerta(esc(it.texto), it.dias);
}

function filaAlerta(texto, dias) {
  const vencido = dias < 0;
  return `
    <div class="alerta-item">
      <span>${texto}</span>
      <span class="insignia ${vencido ? 'rojo' : 'ambar'}">
        ${vencido ? `Vencido hace ${Math.abs(dias)} días` : `Vence en ${dias} días`}
      </span>
    </div>`;
}

// Vista ampliada: todas las alertas ordenadas por urgencia.
async function renderAlertas() {
  contenido.innerHTML = '<div class="estado-vacio">Cargando alertas…</div>';
  try {
    const alertas = await API.alertas();
    const ordenadas = unificarAlertas(alertas);
    const tot = alertas.totales || {
      carnets: (alertas.carnets || []).length,
      vencimientos: (alertas.vencimientos || []).length,
      mantenimientos: (alertas.mantenimientos || []).length,
      descansos: (alertas.descansos || []).length
    };
    const total = tot.carnets + tot.vencimientos + tot.mantenimientos + tot.descansos;

    contenido.innerHTML = `
      <div class="vista-cabecera">
        <div>
          <div class="vista-titulo">Alertas</div>
          <div class="vista-sub">Vencimientos y avisos ordenados por urgencia</div>
        </div>
        <button class="btn btn-secundario" onclick="location.hash='dashboard'">← Volver al panel</button>
      </div>

      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-etiqueta">Total de alertas</div><div class="kpi-valor ${total ? 'peligro' : 'exito'}">${total}</div></div>
        <div class="kpi"><div class="kpi-etiqueta">Carnets</div><div class="kpi-valor">${tot.carnets}</div></div>
        <div class="kpi"><div class="kpi-etiqueta">Vencimientos</div><div class="kpi-valor">${tot.vencimientos}</div></div>
        <div class="kpi"><div class="kpi-etiqueta">Mantenimientos</div><div class="kpi-valor">${tot.mantenimientos}</div></div>
        <div class="kpi"><div class="kpi-etiqueta">Descansos</div><div class="kpi-valor">${tot.descansos}</div></div>
      </div>

      <div class="panel">
        <div class="panel-cabecera">Detalle (${ordenadas.length})</div>
        <div class="panel-cuerpo">
          ${total === 0
            ? '<div class="estado-vacio">Sin alertas. Todo en orden.</div>'
            : ordenadas.map(filaAlertaUnificada).join('')}
        </div>
      </div>`;
  } catch (err) {
    contenido.innerHTML = `<div class="estado-vacio">Error al cargar alertas: ${esc(err.message)}</div>`;
  }
}

// ============================================================
// Vista de detalle de una métrica (pestaña individual)
// ============================================================
const METRICAS = {
  'ingresos-por-viaje': {
    titulo: 'Ingresos por viaje',
    sub: 'Detalle de cada viaje y su valor de flete (sin IVA)',
    conEquipo: true
  },
  'consumos-por-equipo': {
    titulo: 'Consumos generales por equipo',
    sub: 'Gastos generales atribuidos a cada equipo a través de sus unidades',
    conEquipo: true
  },
  'rendimiento-equipos': {
    titulo: 'Rendimiento de combustible por equipo',
    sub: 'Km por litro y costo por km de cada equipo',
    conEquipo: false
  },
  'rentabilidad-equipos': {
    titulo: 'Rentabilidad general por equipo',
    sub: 'Ingresos menos costos (combustible, generales y sueldo del chofer) por período',
    conEquipo: true
  },
  'gastos-administrativos': {
    titulo: 'Gastos administrativos',
    sub: 'Gastos de estructura no asociados a unidades: contabilidad, impuestos, asesorías',
    conEquipo: false
  }
};

const filtroMetrica = { ...rango30Dias(), id_equipo: '' };

async function renderMetricaDetalle(clave) {
  const def = METRICAS[clave];
  if (!def) { location.hash = 'dashboard'; return; }

  contenido.innerHTML = `
    <div class="vista-cabecera">
      <div>
        <div class="vista-titulo">${def.titulo}</div>
        <div class="vista-sub">${def.sub}</div>
      </div>
      <button class="btn btn-secundario" onclick="location.hash='dashboard'">← Volver al dashboard</button>
    </div>
    <div class="filtros-avanzados">
      <div class="filtro-grupo">
        <label class="filtro-label">Desde</label>
        <input type="date" class="buscador filtro-fecha" id="m-desde" value="${filtroMetrica.fecha_desde}">
      </div>
      <div class="filtro-grupo">
        <label class="filtro-label">Hasta</label>
        <input type="date" class="buscador filtro-fecha" id="m-hasta" value="${filtroMetrica.fecha_hasta}">
      </div>
      ${def.conEquipo ? `
      <div class="filtro-grupo">
        <label class="filtro-label">Equipo</label>
        <select class="buscador" id="m-equipo" style="min-width:180px"><option value="">Todos los equipos</option></select>
      </div>` : ''}
      <button class="btn btn-secundario btn-mini" id="m-limpiar">Últimos 30 días</button>
    </div>
    <div id="m-contenido"><div class="estado-vacio">Cargando…</div></div>
  `;

  // Poblar selector de equipos si aplica
  if (def.conEquipo) {
    try {
      const [equipos, unidades] = await Promise.all([API.listarTodo('equipos'), API.listarTodo('unidades')]);
      const pat = id => (unidades.find(u => u.id_unidad === id) || {}).patente || '?';
      $('#m-equipo').innerHTML = '<option value="">Todos los equipos</option>' +
        equipos.map(e => `<option value="${e.id_equipo}" ${filtroMetrica.id_equipo == e.id_equipo ? 'selected' : ''}>${pat(e.id_unidad_principal)} / ${pat(e.id_unidad_secundaria)}</option>`).join('');
    } catch {}
    $('#m-equipo').addEventListener('change', () => { filtroMetrica.id_equipo = $('#m-equipo').value; cargarMetrica(clave); });
  }

  const recargarM = () => {
    filtroMetrica.fecha_desde = $('#m-desde').value;
    filtroMetrica.fecha_hasta = $('#m-hasta').value;
    cargarMetrica(clave);
  };
  $('#m-desde').addEventListener('change', recargarM);
  $('#m-hasta').addEventListener('change', recargarM);
  $('#m-limpiar').addEventListener('click', () => {
    const r = rango30Dias();
    filtroMetrica.fecha_desde = r.fecha_desde;
    filtroMetrica.fecha_hasta = r.fecha_hasta;
    filtroMetrica.id_equipo = '';
    renderMetricaDetalle(clave);
  });

  cargarMetrica(clave);
}

async function cargarMetrica(clave) {
  const params = {
    fecha_desde: filtroMetrica.fecha_desde,
    fecha_hasta: filtroMetrica.fecha_hasta,
    id_equipo: filtroMetrica.id_equipo,
    detalle: '1'
  };
  const cont = $('#m-contenido');
  try {
    if (clave === 'ingresos-por-viaje') {
      const filas = await API.ingresosPorViaje(params);
      const total = filas.reduce((s, v) => s + Number(v.ingreso), 0);
      cont.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-etiqueta">Viajes en el período</div><div class="kpi-valor">${filas.length}</div></div>
          <div class="kpi"><div class="kpi-etiqueta">Ingreso total (sin IVA)</div><div class="kpi-valor exito">${fmtDinero(total)}</div></div>
          <div class="kpi"><div class="kpi-etiqueta">Promedio por viaje</div><div class="kpi-valor info">${fmtDinero(filas.length ? total / filas.length : 0)}</div></div>
        </div>
        <div class="panel"><div class="panel-cuerpo sin-padding"><div class="tabla-contenedor">
        ${filas.length === 0 ? '<div class="estado-vacio">Sin viajes para los filtros seleccionados.</div>' : `
          <table><thead><tr>
            <th>Fecha</th><th>Ruta</th><th>Carga</th><th>Equipo</th><th>Tipo</th><th>Estado</th><th>Ingreso</th>
          </tr></thead><tbody>
          ${filas.map(v => `<tr>
            <td>${fmtFecha(v.fecha_origen)}</td>
            <td>${esc(v.origen)} → ${esc(v.destino)}</td>
            <td>${esc(v.tipo_carga)}</td>
            <td>${esc(v.patente_principal)}/${esc(v.patente_secundaria)}</td>
            <td>${esc(v.tipo_tarifa)}</td>
            <td>${insigniaEstado(v.estado)}</td>
            <td class="celda-num">${fmtDinero(v.ingreso)}</td>
          </tr>`).join('')}
          </tbody></table>`}
        </div></div></div>`;

    } else if (clave === 'consumos-por-equipo') {
      const filas = await API.consumosPorEquipo(params);
      const total = filas.reduce((s, c) => s + Number(c.monto), 0);
      cont.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-etiqueta">Consumos en el período</div><div class="kpi-valor">${filas.length}</div></div>
          <div class="kpi"><div class="kpi-etiqueta">Total gastado</div><div class="kpi-valor peligro">${fmtDinero(total)}</div></div>
        </div>
        <div class="panel"><div class="panel-cuerpo sin-padding"><div class="tabla-contenedor">
        ${filas.length === 0 ? '<div class="estado-vacio">Sin consumos para los filtros seleccionados.</div>' : `
          <table><thead><tr>
            <th>Fecha</th><th>Unidad</th><th>Proveedor</th><th>Concepto</th><th>Monto</th>
          </tr></thead><tbody>
          ${filas.map(c => `<tr>
            <td>${fmtFecha(c.fecha)}</td>
            <td>${esc(c.patente)}</td>
            <td>${esc(c.proveedor)}</td>
            <td style="white-space:normal">${esc(c.concepto)}</td>
            <td class="celda-num">${fmtDinero(c.monto)}</td>
          </tr>`).join('')}
          </tbody></table>`}
        </div></div></div>`;

    } else if (clave === 'rentabilidad-equipos') {
      const data = await API.rentabilidadEquipos(params);
      const filas = data.equipos || [];
      const totalIngresos = filas.reduce((s, r) => s + Number(r.ingresos), 0);
      const totalCostos = filas.reduce((s, r) => s + Number(r.costos), 0);
      const rentEquipos = data.rentabilidad_equipos || 0;
      const gAdmin = data.gastos_administrativos || 0;
      const rentNeta = data.rentabilidad_neta || 0;
      cont.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-etiqueta">Ingresos totales</div><div class="kpi-valor exito">${fmtDinero(totalIngresos)}</div></div>
          <div class="kpi"><div class="kpi-etiqueta">Costos de equipos</div><div class="kpi-valor peligro">${fmtDinero(totalCostos)}</div></div>
          <div class="kpi"><div class="kpi-etiqueta">Gastos administrativos</div><div class="kpi-valor peligro">${fmtDinero(gAdmin)}</div></div>
          <div class="kpi"><div class="kpi-etiqueta">Rentabilidad neta</div><div class="kpi-valor ${rentNeta >= 0 ? 'exito' : 'peligro'}">${fmtDinero(rentNeta)}</div></div>
        </div>
        <div class="panel"><div class="panel-cuerpo sin-padding"><div class="tabla-contenedor">
        ${filas.length === 0 ? '<div class="estado-vacio">Sin equipos para los filtros seleccionados.</div>' : `
          <table><thead><tr>
            <th>Equipo</th><th>Chofer</th><th>Ingresos</th><th>Combustible</th><th>Generales</th><th>Sueldo</th><th>Rentabilidad</th><th>Margen</th>
          </tr></thead><tbody>
          ${filas.map(r => `<tr>
            <td>${esc(r.patente_principal)} / ${esc(r.patente_secundaria || '?')}</td>
            <td>${esc(r.chofer)}<br><span class="filtro-label">${esc(r.tipo_remuneracion || '—')}</span></td>
            <td class="celda-num">${fmtDinero(r.ingresos)}</td>
            <td class="celda-num">${fmtDinero(r.costo_combustible)}</td>
            <td class="celda-num">${fmtDinero(r.costo_generales)}</td>
            <td class="celda-num">${fmtDinero(r.sueldo)}</td>
            <td class="celda-num" style="font-weight:600;color:${r.rentabilidad >= 0 ? 'var(--exito)' : 'var(--peligro)'}">${fmtDinero(r.rentabilidad)}</td>
            <td class="celda-num">${fmtNum(r.margen)}%</td>
          </tr>`).join('')}
          <tr style="border-top:2px solid var(--borde);font-weight:600">
            <td colspan="6">Subtotal rentabilidad de equipos</td>
            <td class="celda-num" style="color:${rentEquipos >= 0 ? 'var(--exito)' : 'var(--peligro)'}">${fmtDinero(rentEquipos)}</td>
            <td></td>
          </tr>
          <tr style="color:var(--peligro)">
            <td colspan="6">− Gastos administrativos del período</td>
            <td class="celda-num">${fmtDinero(gAdmin)}</td>
            <td></td>
          </tr>
          <tr style="font-weight:700;font-size:15px;border-top:1px dashed var(--borde)">
            <td colspan="6">RENTABILIDAD NETA</td>
            <td class="celda-num" style="color:${rentNeta >= 0 ? 'var(--exito)' : 'var(--peligro)'}">${fmtDinero(rentNeta)}</td>
            <td></td>
          </tr>
          </tbody></table>`}
        </div></div></div>
        ${filas.some(r => r.tipo_remuneracion === 'FIJA') ? `<div class="estado-vacio">Para choferes con sueldo FIJO, el costo se prorratea: (remuneración ÷ 30) × ${data.dias_periodo} días del período.</div>` : ''}`;

    } else if (clave === 'gastos-administrativos') {
      const filas = await API.gastosAdministrativos({ ...params, detalle: '1' });
      const total = filas.reduce((s, g) => s + Number(g.monto), 0);
      cont.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-etiqueta">Gastos en el período</div><div class="kpi-valor">${filas.length}</div></div>
          <div class="kpi"><div class="kpi-etiqueta">Total</div><div class="kpi-valor peligro">${fmtDinero(total)}</div></div>
        </div>
        <div class="panel"><div class="panel-cuerpo sin-padding"><div class="tabla-contenedor">
        ${filas.length === 0 ? '<div class="estado-vacio">Sin gastos para los filtros seleccionados.</div>' : `
          <table><thead><tr>
            <th>Fecha</th><th>Proveedor</th><th>Concepto</th><th>Monto</th>
          </tr></thead><tbody>
          ${filas.map(g => `<tr>
            <td>${fmtFecha(g.fecha)}</td>
            <td>${esc(g.proveedor)}</td>
            <td style="white-space:normal">${esc(g.concepto)}</td>
            <td class="celda-num">${fmtDinero(g.monto)}</td>
          </tr>`).join('')}
          </tbody></table>`}
        </div></div></div>`;

    } else if (clave === 'rendimiento-equipos') {
      const filas = await API.rendimientoEquipos();
      cont.innerHTML = `
        <div class="panel"><div class="panel-cuerpo sin-padding"><div class="tabla-contenedor">
        ${filas.length === 0 ? '<div class="estado-vacio">Sin datos de consumo.</div>' : `
          <table><thead><tr>
            <th>Equipo</th><th>Chofer</th><th>Litros</th><th>Km</th><th>Km/L</th><th>Gasto</th><th>Costo/km</th>
          </tr></thead><tbody>
          ${filas.map(r => `<tr>
            <td>${esc(r.patente_principal)} / ${esc(r.patente_secundaria || '?')}</td>
            <td>${esc(r.chofer)}</td>
            <td class="celda-num">${fmtNum(r.litros, 0)}</td>
            <td class="celda-num">${fmtNum(r.km, 0)}</td>
            <td class="celda-num">${fmtNum(r.km_por_litro)}</td>
            <td class="celda-num">${fmtDinero(r.gasto)}</td>
            <td class="celda-num">${fmtDinero(r.costo_por_km)}</td>
          </tr>`).join('')}
          </tbody></table>`}
        </div></div></div>
        <div class="estado-vacio">El rendimiento de combustible no se filtra por fecha porque agrega el histórico de cada equipo.</div>`;
    }
  } catch (err) {
    cont.innerHTML = `<div class="estado-vacio">Error: ${esc(err.message)}</div>`;
  }
}

function tablaSimple(cabeceras, filas) {
  return `
    <table>
      <thead><tr>${cabeceras.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${filas.map(f => `<tr>${f.map(c => c.startsWith('<td') ? c : `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;
}

// ============================================================
// Cuentas corrientes: resumen, buscador y detalle con PDF
// ============================================================
async function renderCuentasCorrientes() {
  contenido.innerHTML = `
    <div class="vista-cabecera">
      <div>
        <div class="vista-titulo">Cuentas corrientes</div>
        <div class="vista-sub">Movimientos agrupados por cuenta y saldo final (deudor o acreedor)</div>
      </div>
      <div class="toolbar">
        <input class="buscador" id="buscador-cc" placeholder="Buscar por nombre, CUIL o tipo…">
      </div>
    </div>
    <div class="kpi-grid" id="cc-totales"></div>
    <div class="panel">
      <div class="panel-cuerpo sin-padding">
        <div class="tabla-contenedor" id="cc-tabla">
          <div class="estado-vacio">Cargando cuentas…</div>
        </div>
      </div>
    </div>
  `;

  let temporizador;
  $('#buscador-cc').addEventListener('input', e => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => cargarCuentasCorrientes(e.target.value), 350);
  });

  cargarCuentasCorrientes();
}

async function cargarCuentasCorrientes(q = '', pagina = 1) {
  try {
    const { totales, cuentas, paginacion } = await API.resumenCuentasCorrientes(q, pagina);

    $('#cc-totales').innerHTML = `
      <div class="kpi">
        <div class="kpi-etiqueta">Cuentas con movimientos</div>
        <div class="kpi-valor">${totales.cuentas}</div>
        <div class="kpi-detalle">${totales.saldadas} saldadas</div>
      </div>
      <div class="kpi">
        <div class="kpi-etiqueta">Total a cobrar</div>
        <div class="kpi-valor exito">${fmtDinero(totales.total_deudor)}</div>
        <div class="kpi-detalle">${totales.deudoras} cuentas que adeudan a la empresa</div>
      </div>
      <div class="kpi">
        <div class="kpi-etiqueta">Total a pagar</div>
        <div class="kpi-valor peligro">${fmtDinero(totales.total_acreedor)}</div>
        <div class="kpi-detalle">${totales.acreedoras} cuentas a las que la empresa adeuda</div>
      </div>
      <div class="kpi">
        <div class="kpi-etiqueta">Posición neta</div>
        <div class="kpi-valor" style="color:${(totales.total_deudor - totales.total_acreedor) > 0 ? 'var(--exito)' : (totales.total_deudor - totales.total_acreedor) < 0 ? 'var(--peligro)' : 'var(--texto-suave)'}">${fmtDinero(totales.total_deudor - totales.total_acreedor)}</div>
        <div class="kpi-detalle">${(totales.total_deudor - totales.total_acreedor) >= 0 ? 'A favor de la empresa' : 'En contra de la empresa'}</div>
      </div>
    `;

    if (cuentas.length === 0) {
      $('#cc-tabla').innerHTML = '<div class="estado-vacio">No se encontraron cuentas con ese criterio.</div>';
      return;
    }

    $('#cc-tabla').innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Titular</th><th>Tipo</th><th>CUIL</th><th>Movs.</th>
            <th>Créditos</th><th>Débitos</th><th>Saldo final</th>
            <th>Condición</th><th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${cuentas.map(c => `
            <tr>
              <td>${esc(c.nombre)}</td>
              <td>${insigniaEstado(c.tipo)}</td>
              <td>${esc(c.cuil)}</td>
              <td class="celda-num">${c.cantidad_movimientos}</td>
              <td class="celda-num">${fmtDinero(c.total_creditos)}</td>
              <td class="celda-num">${fmtDinero(c.total_debitos)}</td>
              <td class="celda-num" style="font-weight:600;color:${colorSaldo(c.condicion)}">${fmtDinero(Math.abs(c.saldo))}</td>
              <td>${insigniaCondicion(c.condicion)}</td>
              <td>
                <button class="btn btn-secundario btn-mini" onclick="location.hash='cuenta-corriente/${c.id_cuenta}'">Ver detalle</button>
                <a class="btn btn-primario btn-mini" style="text-decoration:none" href="${API.urlPdfCuenta(c.id_cuenta)}" target="_blank">PDF</a>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
      ${controlesPaginacion(paginacion, p => cargarCuentasCorrientes(q, p))}`;
  } catch (err) {
    $('#cc-tabla').innerHTML = `<div class="estado-vacio">Error: ${err.message}</div>`;
  }
}

// Color del saldo según la condición, desde la perspectiva de la empresa:
//  DEUDOR   = el titular adeuda a la empresa → saldo a favor → verde
//  ACREEDOR = la empresa adeuda al titular   → pasivo        → rojo
//  SALDADA  = sin saldo                                       → gris
function colorSaldo(condicion) {
  if (condicion === 'DEUDOR') return 'var(--exito)';
  if (condicion === 'ACREEDOR') return 'var(--peligro)';
  return 'var(--texto-suave)';
}

function insigniaCondicion(condicion) {
  const color = condicion === 'DEUDOR' ? 'verde' : condicion === 'ACREEDOR' ? 'rojo' : 'gris';
  // Texto más claro sobre quién debe a quién
  const texto = condicion === 'DEUDOR' ? 'A favor (le deben)'
              : condicion === 'ACREEDOR' ? 'En contra (se debe)'
              : 'Saldada';
  return `<span class="insignia ${color}" title="${condicion}">${texto}</span>`;
}

async function renderDetalleCuenta(id) {
  contenido.innerHTML = '<div class="estado-vacio">Cargando resumen de cuenta…</div>';

  try {
    const { cuenta, movimientos, resumen } = await API.detalleCuentaCorriente(id);

    contenido.innerHTML = `
      <div class="vista-cabecera">
        <div>
          <div class="vista-titulo">${esc(cuenta.nombre)}</div>
          <div class="vista-sub">${esc(cuenta.tipo)} · CUIL ${esc(cuenta.cuil)}${cuenta.telefono ? ' · Tel. ' + esc(cuenta.telefono) : ''}</div>
        </div>
        <div class="toolbar">
          <button class="btn btn-secundario" onclick="location.hash='cuentas-corrientes'">← Volver</button>
          <button class="btn btn-primario" onclick="abrirModalRecibo(${cuenta.id_cuenta})">+ Nuevo recibo</button>
          <a class="btn btn-primario" style="text-decoration:none" href="${API.urlPdfCuenta(cuenta.id_cuenta)}" target="_blank">Descargar resumen PDF</a>
        </div>
      </div>

      <div class="kpi-grid">
        <div class="kpi">
          <div class="kpi-etiqueta">Total créditos</div>
          <div class="kpi-valor exito">${fmtDinero(resumen.total_creditos)}</div>
        </div>
        <div class="kpi">
          <div class="kpi-etiqueta">Total débitos</div>
          <div class="kpi-valor peligro">${fmtDinero(resumen.total_debitos)}</div>
        </div>
        <div class="kpi">
          <div class="kpi-etiqueta">Saldo final</div>
          <div class="kpi-valor" style="color:${colorSaldo(resumen.condicion)}">${fmtDinero(Math.abs(resumen.saldo_final))}</div>
          <div class="kpi-detalle">${insigniaCondicion(resumen.condicion)}</div>
        </div>
        <div class="kpi">
          <div class="kpi-etiqueta">Movimientos</div>
          <div class="kpi-valor">${resumen.cantidad_movimientos}</div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-cabecera">Detalle de movimientos</div>
        <div class="panel-cuerpo sin-padding">
          <div class="tabla-contenedor">
            ${movimientos.length === 0
              ? '<div class="estado-vacio">La cuenta no registra movimientos todavía.</div>'
              : `<table>
                  <thead>
                    <tr><th>Fecha</th><th>Concepto</th><th>Débito</th><th>Crédito</th><th>Saldo parcial</th><th>Acciones</th></tr>
                  </thead>
                  <tbody>
                    ${movimientos.map(m => `
                      <tr>
                        <td>${fmtFecha(m.fecha)}</td>
                        <td style="white-space:normal">${m.concepto.startsWith('RECIBO') ? '<span class="insignia azul">RECIBO</span> ' + esc(m.concepto.replace(/^RECIBO\s*/, '')) : esc(m.concepto)}</td>
                        <td class="celda-num" style="color:var(--peligro)">${m.debito ? fmtDinero(m.debito) : '—'}</td>
                        <td class="celda-num" style="color:var(--exito)">${m.credito ? fmtDinero(m.credito) : '—'}</td>
                        <td class="celda-num" style="font-weight:600">${fmtDinero(m.saldo_parcial)}</td>
                        <td>
                          <button class="btn btn-secundario btn-mini" onclick='abrirModalRecibo(${cuenta.id_cuenta}, ${JSON.stringify(m).replace(/'/g, "&#39;")})'>Editar</button>
                          <button class="btn btn-peligro btn-mini" onclick="eliminarMovimientoCuenta(${cuenta.id_cuenta}, ${m.id_movimiento})">Eliminar</button>
                        </td>
                      </tr>`).join('')}
                  </tbody>
                </table>`}
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    contenido.innerHTML = `<div class="estado-vacio">Error: ${err.message}</div>`;
  }
}

// ============================================================
// Avance secuencial de estado de viajes
// Si pasa a FINALIZADO con tarifa POR KM/POR TONELADA sin resultado,
// se pide en un modal. Luego el backend genera liquidación al chofer
// y, al pasar a FACTURADO, imputa al pagador.
// ============================================================
const SECUENCIA_VIAJE = ['EN CURSO', 'EN DESTINO', 'FINALIZADO', 'FACTURADO'];

let modoAvanzarConResultado = null;

async function avanzarEstadoViaje(idViaje) {
  let viaje;
  try { viaje = await API.obtener('viajes', idViaje); }
  catch (err) { mostrarToast(err.message, true); return; }

  const idx = SECUENCIA_VIAJE.indexOf(viaje.estado);
  if (idx === -1 || idx === SECUENCIA_VIAJE.length - 1) {
    mostrarToast('El viaje ya está en el último estado', true);
    return;
  }
  const siguiente = SECUENCIA_VIAJE[idx + 1];

  // Para FINALIZADO con tarifa POR KM/POR TONELADA, pedir resultado si falta
  const necesitaResultado = (viaje.tipo_tarifa === 'POR KM' || viaje.tipo_tarifa === 'POR TONELADA');
  const sinResultado = viaje.resultado === null || viaje.resultado === undefined || viaje.resultado === '';
  if (siguiente === 'FINALIZADO' && necesitaResultado && sinResultado) {
    abrirModalResultado(viaje, siguiente);
    return;
  }

  // Auto-completar fecha_llegada al transicionar a FINALIZADO
  const datos = { estado: siguiente };
  if (siguiente === 'FINALIZADO' && !viaje.fecha_llegada) {
    datos.fecha_llegada = new Date().toISOString().slice(0, 19).replace('T', ' ');
  }

  try {
    await API.actualizar('viajes', idViaje, datos);
    mostrarToast(`Viaje #${idViaje} avanzado a ${siguiente}`);
    cargarTabla('viajes', $('#buscador')?.value || '', $('#filtro-equipo')?.value || '', $('#filtro-deposito')?.value || '', recogerExtras(), 1);
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

function abrirModalResultado(viaje, siguienteEstado) {
  modoAvanzarConResultado = { idViaje: viaje.id_viaje, estado: siguienteEstado, viaje };

  const unidad = viaje.tipo_tarifa === 'POR KM' ? 'Kilómetros recorridos' : 'Toneladas descargadas';

  $('#modal-titulo').textContent = `Finalizar viaje · ${unidad}`;
  $('#modal-cuerpo').innerHTML = `
    <div class="campo ancho-completo" style="font-size:13px;color:var(--texto-suave); padding:10px 12px; background:#faf9f5; border-radius:6px">
      <div><strong>${esc(viaje.origen)}</strong> → <strong>${esc(viaje.destino)}</strong></div>
      <div>Tarifa: ${fmtDinero(viaje.tarifa)} · ${viaje.tipo_tarifa}</div>
      ${viaje.cantidad_cargada ? `<div>Cantidad cargada: ${viaje.cantidad_cargada}</div>` : ''}
    </div>
    <div class="campo ancho-completo">
      <label for="res-valor">${unidad} *</label>
      <input id="res-valor" type="number" step="any" min="0" required autofocus>
    </div>
  `;
  $('#modal-fondo').hidden = false;
  setTimeout(() => $('#res-valor')?.focus(), 50);
}

async function guardarResultadoYAvanzar() {
  const { idViaje, estado, viaje } = modoAvanzarConResultado;
  const valor = parseFloat($('#res-valor').value);
  if (!Number.isFinite(valor) || valor <= 0) {
    mostrarToast('Ingresa un valor mayor a cero', true);
    return;
  }

  const datos = { estado, resultado: valor };
  if (!viaje.fecha_llegada) {
    datos.fecha_llegada = new Date().toISOString().slice(0, 19).replace('T', ' ');
  }

  try {
    await API.actualizar('viajes', idViaje, datos);
    mostrarToast(`Viaje #${idViaje} finalizado`);
    cerrarModal();
    cargarTabla('viajes', $('#buscador')?.value || '', $('#filtro-equipo')?.value || '', $('#filtro-deposito')?.value || '', recogerExtras(), 1);
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

// ============================================================
// Mover depósito: reasigna todo el stock de un depósito a otro
// ============================================================
let modoMoverDeposito = null; // clave del módulo activo o null

async function abrirModalMoverDeposito(clave) {
  modoMoverDeposito = clave;
  $('#modal-titulo').textContent = 'Mover depósito';

  let depositos = [];
  try { depositos = await API.depositos(); }
  catch (err) { mostrarToast(err.message, true); return; }

  if (depositos.length === 0) {
    mostrarToast('No hay depósitos con elementos para mover', true);
    modoMoverDeposito = null;
    return;
  }

  const opciones = depositos.map(d =>
    `<option value="${String(d.deposito).replace(/"/g, '&quot;')}">${d.deposito} (${d.elementos} elem. · ${fmtDinero(d.valuacion_total)})</option>`
  ).join('');

  $('#modal-cuerpo').innerHTML = `
    <div class="campo ancho-completo">
      <label for="md-origen">Depósito de origen *</label>
      <select id="md-origen">${opciones}</select>
    </div>
    <div class="campo ancho-completo">
      <label for="md-destino">Depósito de destino *</label>
      <input id="md-destino" type="text" maxlength="100" list="md-lista-destinos" placeholder="Existente o nuevo (ej: Equipo #2 · AD789GH)">
      <datalist id="md-lista-destinos">
        ${depositos.map(d => `<option value="${String(d.deposito).replace(/"/g, '&quot;')}"></option>`).join('')}
      </datalist>
    </div>
    <div class="campo ancho-completo" style="font-size:13px;color:var(--texto-suave)">
      Se moverán <strong>todos</strong> los elementos del depósito de origen al de destino en una sola operación.
    </div>
  `;

  $('#modal-fondo').hidden = false;
}

async function guardarMoverDeposito() {
  const origen = $('#md-origen').value;
  const destino = $('#md-destino').value.trim();

  if (!destino) { mostrarToast('Indica el depósito de destino', true); return; }
  if (origen === destino) { mostrarToast('El origen y el destino no pueden ser iguales', true); return; }

  try {
    const resp = await API.moverDeposito(origen, destino);
    mostrarToast(resp.mensaje);
    const clave = modoMoverDeposito;
    cerrarModal();
    renderModulo(clave); // recarga vista y repuebla el selector de depósitos
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

// ============================================================
// Recibos dentro de la cuenta corriente
// Un recibo es un MOVIMIENTO cuyo concepto comienza con "RECIBO".
// Se crea, edita y elimina sin salir del detalle de la cuenta.
// ============================================================
let modoRecibo = null; // { idCuenta, idMovimiento } o null

function abrirModalRecibo(idCuenta, mov = null) {
  modoRecibo = { idCuenta, idMovimiento: mov ? mov.id_movimiento : null };
  $('#modal-titulo').textContent = mov ? 'Editar movimiento' : 'Nuevo recibo';

  const esRecibo = mov ? String(mov.concepto).startsWith('RECIBO') : true;
  const montoAbs = mov ? Math.abs(Number(mov.monto)) : '';
  const tipoMov = mov ? (Number(mov.monto) >= 0 ? 'CREDITO' : 'DEBITO') : 'CREDITO';
  const fechaVal = mov && mov.fecha ? String(mov.fecha).slice(0, 16).replace(' ', 'T') : '';

  // Para recibos nuevos se separa número y detalle; al editar se muestra el concepto completo
  $('#modal-cuerpo').innerHTML = mov ? `
    <div class="campo">
      <label for="r-fecha">Fecha *</label>
      <input id="r-fecha" type="datetime-local" value="${fechaVal}" required>
    </div>
    <div class="campo">
      <label for="r-tipo">Tipo *</label>
      <select id="r-tipo">
        <option value="CREDITO" ${tipoMov === 'CREDITO' ? 'selected' : ''}>Crédito (a favor del titular)</option>
        <option value="DEBITO" ${tipoMov === 'DEBITO' ? 'selected' : ''}>Débito (a cargo del titular)</option>
      </select>
    </div>
    <div class="campo">
      <label for="r-monto">Monto ($) *</label>
      <input id="r-monto" type="number" step="any" min="0" value="${montoAbs}" required>
    </div>
    <div class="campo ancho-completo">
      <label for="r-concepto">Concepto *</label>
      <input id="r-concepto" type="text" maxlength="150" value="${String(mov.concepto).replace(/"/g, '&quot;')}" required>
    </div>
  ` : `
    <div class="campo">
      <label for="r-numero">N° de recibo *</label>
      <input id="r-numero" type="text" maxlength="20" placeholder="0001-00000123" required>
    </div>
    <div class="campo">
      <label for="r-fecha">Fecha *</label>
      <input id="r-fecha" type="datetime-local" required>
    </div>
    <div class="campo">
      <label for="r-tipo">Tipo *</label>
      <select id="r-tipo">
        <option value="CREDITO">Crédito (a favor del titular)</option>
        <option value="DEBITO">Débito (a cargo del titular)</option>
      </select>
    </div>
    <div class="campo">
      <label for="r-monto">Monto ($) *</label>
      <input id="r-monto" type="number" step="any" min="0" required>
    </div>
    <div class="campo ancho-completo">
      <label for="r-detalle">Detalle</label>
      <input id="r-detalle" type="text" maxlength="100" placeholder="Pago viaje C-104, adelanto, etc.">
    </div>
  `;

  $('#modal-fondo').hidden = false;
}

async function guardarRecibo() {
  const { idCuenta, idMovimiento } = modoRecibo;
  const fecha = $('#r-fecha').value;
  const tipo = $('#r-tipo').value;
  const montoAbs = parseFloat($('#r-monto').value);

  if (!fecha || isNaN(montoAbs) || montoAbs <= 0) {
    mostrarToast('Completa fecha y monto (mayor a cero)', true);
    return;
  }

  let concepto;
  if (idMovimiento) {
    concepto = $('#r-concepto').value.trim();
    if (!concepto) { mostrarToast('El concepto es obligatorio', true); return; }
  } else {
    const numero = $('#r-numero').value.trim();
    if (!numero) { mostrarToast('Indica el número de recibo', true); return; }
    const detalle = $('#r-detalle').value.trim();
    concepto = `RECIBO N° ${numero}${detalle ? ' — ' + detalle : ''}`;
  }

  const datos = {
    id_cuenta: idCuenta,
    fecha: fecha.replace('T', ' ') + ':00',
    monto: tipo === 'DEBITO' ? -montoAbs : montoAbs,
    concepto
  };

  try {
    if (idMovimiento) {
      await API.actualizar('movimientos', idMovimiento, datos);
      mostrarToast('Movimiento actualizado');
    } else {
      await API.crear('movimientos', datos);
      mostrarToast('Recibo registrado en la cuenta');
    }
    cerrarModal();
    renderDetalleCuenta(idCuenta);
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

async function eliminarMovimientoCuenta(idCuenta, idMovimiento) {
  if (!confirm('¿Eliminar este movimiento de la cuenta? Esta acción no se puede deshacer.')) return;
  try {
    await API.eliminar('movimientos', idMovimiento);
    mostrarToast('Movimiento eliminado');
    renderDetalleCuenta(idCuenta);
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

// ============================================================
// Vistas CRUD por módulo
// ============================================================
let moduloActual = null;
let registroEditando = null;

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

  // Al crear, excluir campos marcados como soloEdicion
  // (ej. resultado, estado, fechas en viajes)
  const camposVisibles = id
    ? mod.campos
    : mod.campos.filter(c => !c.soloEdicion);

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
      </div>`;
  }).join('');

  $('#modal-fondo').hidden = false;
}

function cerrarModal() {
  $('#modal-fondo').hidden = true;
  registroEditando = null;
  modoRecibo = null;
  modoMoverDeposito = null;
  modoAvanzarConResultado = null;
  _guardadoAdmin = null;
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
  const camposActivos = registroEditando
    ? mod.campos
    : mod.campos.filter(c => !c.soloEdicion);

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

// ============================================================
// Apariencia: selección de tema de color por usuario
// ============================================================
async function renderApariencia() {
  const actual = (SESION && SESION.tema) || localStorage.getItem('erp_tema') || 'verde';
  contenido.innerHTML = `
    <div class="vista-cabecera">
      <div>
        <div class="vista-titulo">Apariencia</div>
        <div class="vista-sub">Elige el tema de color del sistema. Tu elección se guarda en tu cuenta.</div>
      </div>
    </div>
    <div class="temas-grilla" id="temas-grilla">
      ${TEMAS.map(t => `
        <button class="tema-tarjeta ${t.id === actual ? 'activo' : ''}" data-tema-id="${t.id}">
          <div class="tema-muestra" style="background:${t.sidebar}">
            <span class="tema-acento" style="background:${t.acento}"></span>
          </div>
          <div class="tema-nombre">${t.nombre}</div>
          ${t.id === actual ? '<div class="tema-check">✓ En uso</div>' : ''}
        </button>
      `).join('')}
    </div>
  `;

  document.querySelectorAll('.tema-tarjeta').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.temaId;
      aplicarTema(id);           // aplica al instante
      // Re-render para reflejar la selección
      renderApariencia();
      try {
        await API.guardarTema(id);   // persiste en la cuenta
        mostrarToast('Apariencia actualizada.');
      } catch (err) {
        mostrarToast('No se pudo guardar la preferencia: ' + err.message, true);
      }
    });
  });
}

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
          <label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer">
            <input type="checkbox" class="chk-modulo" value="${m.clave}" ${activosSet.has(m.clave) ? 'checked' : ''}>
            <span>${esc(m.nombre)}</span>
            ${m.depende.length ? `<span style="font-size:11px;color:var(--texto-suave)">(requiere: ${m.depende.map(d => esc(nombrePorClave[d] || d)).join(', ')})</span>` : ''}
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
    ${ed ? `<div class="campo"><label>Estado</label><select id="e-activa"><option value="1" ${empresa.activa ? 'selected' : ''}>Activa</option><option value="0" ${!empresa.activa ? 'selected' : ''}>Inactiva</option></select></div>` : ''}
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
function configurarGuardado(fn) { _guardadoAdmin = fn; }function abrirModalGenerico() {
  $('#modal-fondo').hidden = false;
}

// Eventos del modal
$('#btn-cerrar-modal').addEventListener('click', cerrarModal);
$('#btn-cancelar').addEventListener('click', cerrarModal);
$('#btn-guardar').addEventListener('click', guardarRegistro);
$('#modal-fondo').addEventListener('click', e => {
  if (e.target === $('#modal-fondo')) cerrarModal();
});

// ============================================================
// Sesión y autenticación
// ============================================================
let SESION = null;

// Catálogo de temas disponibles (debe coincidir con el CSS y el backend)
const TEMAS = [
  { id: 'verde',    nombre: 'Verde pizarra', sidebar: '#1d2f29', acento: '#e8a13c' },
  { id: 'azul',     nombre: 'Azul noche',    sidebar: '#1a2940', acento: '#4f9dde' },
  { id: 'violeta',  nombre: 'Violeta',       sidebar: '#2f2046', acento: '#a779e0' },
  { id: 'borgona',  nombre: 'Borgoña',       sidebar: '#3c1d22', acento: '#d98f6b' },
  { id: 'grafito',  nombre: 'Grafito',       sidebar: '#292a2d', acento: '#d6a85c' },
  { id: 'oceano',   nombre: 'Océano',        sidebar: '#163b3f', acento: '#3bb3a8' },
  { id: 'indigo',   nombre: 'Índigo',        sidebar: '#25264f', acento: '#7c83f8' },
  { id: 'esmeralda',nombre: 'Esmeralda',     sidebar: '#133d2e', acento: '#2ecc8f' },
  { id: 'cobre',    nombre: 'Cobre',         sidebar: '#3d271b', acento: '#e08a4b' },
  { id: 'rosa',     nombre: 'Rosa',          sidebar: '#421d33', acento: '#e06b9e' },
  { id: 'slate',    nombre: 'Pizarra azul',  sidebar: '#21282f', acento: '#6aa0c8' },
  { id: 'bosque',   nombre: 'Bosque',        sidebar: '#1f3324', acento: '#9bc24a' }
];

// Aplica un tema al documento y lo cachea localmente (para evitar parpadeo
// en la próxima carga, antes de revalidar la sesión con el servidor).
function aplicarTema(tema) {
  const valido = TEMAS.some(t => t.id === tema) ? tema : 'verde';
  document.documentElement.dataset.tema = valido;
  localStorage.setItem('erp_tema', valido);
  if (SESION) SESION.tema = valido;
}

function mostrarLogin() {
  $('#login-pantalla').hidden = false;
  $('#app-contenedor').hidden = true;
}

function mostrarApp() {
  $('#login-pantalla').hidden = true;
  $('#app-contenedor').hidden = false;
}

// Devuelve true si el módulo está activo para la empresa del usuario actual.
// El dashboard y la apariencia siempre están disponibles.
function moduloActivo(clave) {
  if (clave === 'dashboard' || clave === 'apariencia' || clave === 'alertas') return true;
  if (!SESION || SESION.rol === 'ADMIN') return true;
  const activos = SESION.modulos || [];
  return activos.includes(clave);
}

// Oculta del menú lateral los enlaces de módulos no activos, y las etiquetas
// de grupo (nav-group-label) que queden sin ningún enlace visible debajo.
function aplicarModulosVisibles(modulos) {
  const activos = new Set(modulos);
  // Mostrar/ocultar cada enlace con data-vista según corresponda
  document.querySelectorAll('#nav-datos .nav-link[data-vista]').forEach(a => {
    const vista = a.dataset.vista;
    const visible = vista === 'dashboard' || activos.has(vista);
    a.style.display = visible ? '' : 'none';
  });
  // Ocultar etiquetas de grupo que no tengan enlaces visibles a continuación
  document.querySelectorAll('#nav-datos .nav-group-label').forEach(label => {
    let hayVisible = false;
    let el = label.nextElementSibling;
    while (el && !el.classList.contains('nav-group-label')) {
      if (el.classList.contains('nav-link') && el.style.display !== 'none') {
        hayVisible = true; break;
      }
      el = el.nextElementSibling;
    }
    label.style.display = hayVisible ? '' : 'none';
  });
}

function aplicarSesion(usuario) {
  SESION = usuario;
  // Apariencia elegida por el usuario
  aplicarTema(usuario.tema || 'verde');
  const esAdmin = usuario.rol === 'ADMIN';
  // Iniciales del logo: las de la empresa, o derivadas del nombre, o "AD" para el admin
  let iniciales;
  if (esAdmin) {
    iniciales = 'AD';
  } else if (usuario.iniciales_empresa) {
    iniciales = usuario.iniciales_empresa;
  } else {
    iniciales = derivarIniciales(usuario.nombre_empresa);
  }
  $('#brand-iniciales').textContent = iniciales;
  // Nombre y rol en el pie del sidebar
  $('#usuario-nombre').textContent = usuario.nombre_usuario;
  $('#usuario-rol').textContent = usuario.rol === 'ADMIN' ? 'Administrador' : (usuario.nombre_empresa || 'Usuario');
  $('#brand-empresa').textContent = usuario.rol === 'ADMIN' ? 'Administración' : (usuario.nombre_empresa || 'Empresa');
  $('#topbar-title').textContent = usuario.rol === 'ADMIN' ? 'Administración global' : (usuario.nombre_empresa || 'Gestión de transporte');

  // Mostrar la navegación según el rol
  $('#nav-datos').hidden = esAdmin;
  $('#nav-admin').hidden = !esAdmin;

  // Aplicar la visibilidad de los módulos activos de la empresa
  aplicarModulosVisibles(usuario.modulos || []);

  mostrarApp();

  // Llevar a la vista inicial correspondiente al rol
  if (esAdmin) {
    if (!location.hash.startsWith('#admin')) location.hash = 'admin-empresas';
    else navegar();
  } else {
    if (location.hash.startsWith('#admin')) location.hash = 'dashboard';
    else navegar();
  }
}

async function iniciarSesion() {
  const usuario = $('#login-usuario').value.trim();
  const clave = $('#login-clave').value;
  const errorBox = $('#login-error');
  errorBox.hidden = true;
  if (!usuario || !clave) {
    errorBox.textContent = 'Ingresa usuario y contraseña.';
    errorBox.hidden = false;
    return;
  }
  try {
    const { token, usuario: datos } = await API.login(usuario, clave);
    API.setToken(token);
    $('#login-clave').value = '';
    aplicarSesion(datos);
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
  }
}

function cerrarSesion() {
  API.setToken(null);
  SESION = null;
  location.hash = '';
  mostrarLogin();
}

$('#login-btn').addEventListener('click', iniciarSesion);
$('#login-clave').addEventListener('keydown', e => { if (e.key === 'Enter') iniciarSesion(); });
$('#login-usuario').addEventListener('keydown', e => { if (e.key === 'Enter') $('#login-clave').focus(); });

// Mostrar/ocultar la contraseña en el login
$('#btn-ver-clave').addEventListener('click', () => {
  const input = $('#login-clave');
  const boton = $('#btn-ver-clave');
  const visible = input.type === 'text';
  input.type = visible ? 'password' : 'text';
  boton.setAttribute('aria-label', visible ? 'Mostrar contraseña' : 'Ocultar contraseña');
  boton.setAttribute('title', visible ? 'Mostrar contraseña' : 'Ocultar contraseña');
  // Cambiar el ícono: ojo abierto / ojo tachado
  $('#icono-ojo').innerHTML = visible
    ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>'
    : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>';
  input.focus();
});

$('#btn-salir').addEventListener('click', cerrarSesion);

// Si una petición devuelve 401, la sesión expiró
window.addEventListener('sesion-expirada', () => {
  SESION = null;
  mostrarLogin();
  mostrarToast('Tu sesión expiró. Inicia sesión nuevamente.', 'error');
});

// ============================================================
// Arranque: revalidar token guardado o pedir login
// ============================================================
async function arrancar() {
  // Aplicar el último tema usado de inmediato (evita parpadeo antes de
  // revalidar la sesión); luego se confirma con el del usuario.
  aplicarTema(localStorage.getItem('erp_tema') || 'verde');
  const token = API.cargarToken();
  if (!token) { mostrarLogin(); return; }
  try {
    const { usuario } = await API.yo();
    aplicarSesion(usuario);
  } catch {
    API.setToken(null);
    mostrarLogin();
  }
}

arrancar();
