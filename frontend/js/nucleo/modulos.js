// frontend/js/nucleo/modulos.js
// Catálogo de módulos del frontend: campos, etiquetas y columnas de cada vista CRUD.
// Replica config/modulos.js del backend para mostrar u ocultar la navegación.
// Las funciones son globales a propósito: las usan los onclick="..." del HTML
// generado y los demás archivos. El orden de carga está en index.html.

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
      { nombre: 'numero_remito', etiqueta: 'Número de remito', tipo: 'text', maxlen: 20, requerido: true },
      { nombre: '_valor', etiqueta: 'Valor facturado', soloTabla: true, calcular: fila => valorViajeFacturado(fila) }
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
      { nombre: 'telefono', etiqueta: 'Teléfono', tipo: 'text', requerido: true },
      { nombre: 'plazo_pago_dias', etiqueta: 'Plazo de pago (días) — solo clientes', tipo: 'number', ayuda: 'Días que el cliente puede adeudar antes de que aparezca una alerta de cobro vencido. Dejar vacío si no aplica.' }
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
