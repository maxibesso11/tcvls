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
    singular: 'chofer',
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
      { nombre: 'sueldo_fijo_mensual', etiqueta: 'Sueldo fijo mensual ($)', tipo: 'number', ayuda: 'Opcional. Se liquida con "Liquidar sueldos fijos del mes" en Cuentas corrientes.' },
      { nombre: 'variable_tipo', etiqueta: 'Variable por viaje', tipo: 'select', opciones: ['POR KM', 'PORCENTAJE'] },
      { nombre: 'variable_valor', etiqueta: 'Valor variable ($/km o %)', tipo: 'number', ayuda: 'Cargá al menos el sueldo fijo o la variable (o las dos, para un mixto).' }
    ],
    columnasTabla: ['nombre', 'cuil', 'telefono', 'vencimiento_carnet', 'ultima_jornada_descanso'],
    // La fila abre la ficha del chofer (desde ahí se edita y se elimina)
    alHacerClic: (fila) => { location.hash = 'chofer-detalle/' + fila.id_chofer; return true; }
  },
  unidades: {
    titulo: 'Unidades',
    singular: 'unidad',
    femenino: true,
    sub: 'Vehículos de la flota: chasis, tractores, acoplados y bateas',
    recurso: 'unidades',
    id: 'id_unidad',
    campos: [
      { nombre: 'patente', etiqueta: 'Patente', tipo: 'text', requerido: true },
      { nombre: 'modelo', etiqueta: 'Modelo', tipo: 'text', requerido: true },
      { nombre: 'funcionalidad', etiqueta: 'Funcionalidad', tipo: 'select', requerido: true, opciones: ['PRINCIPAL', 'SECUNDARIA'] }
    ],
    // La fila abre la ficha de la unidad (ahí viven Editar y Eliminar)
    alHacerClic: (fila) => { location.hash = 'unidad-detalle/' + fila.id_unidad; return true; }
  },
  equipos: {
    titulo: 'Equipos',
    singular: 'equipo',
    sub: 'Composición: unidad principal + unidad secundaria + chofer',
    recurso: 'equipos',
    id: 'id_equipo',
    campos: [
      { nombre: 'id_unidad_principal', etiqueta: 'Unidad principal', tipo: 'fk', recurso: 'unidades', mostrar: r => `${r.patente} — ${r.modelo}`, filtro: r => r.funcionalidad === 'PRINCIPAL', requerido: true },
      { nombre: 'id_unidad_secundaria', etiqueta: 'Unidad secundaria', tipo: 'fk', recurso: 'unidades', mostrar: r => `${r.patente} — ${r.modelo}`, filtro: r => r.funcionalidad === 'SECUNDARIA', requerido: true },
      { nombre: 'id_chofer', etiqueta: 'Chofer', tipo: 'fk', recurso: 'choferes', mostrar: r => r.nombre, requerido: true },
      { nombre: 'peso_tara', etiqueta: 'Peso de tara (kg)', tipo: 'number', requerido: true },
      { nombre: 'peso_bruto', etiqueta: 'Peso bruto (kg)', tipo: 'number', requerido: true },
      { nombre: '_estado', etiqueta: 'Estado', soloTabla: true,
        calcular: fila => fila.activo === 0 ? insignia(`Baja ${fmtFecha(fila.fecha_baja)}`, 'aviso') : insignia('Activo', 'ok') },
      // No es una columna: si cambia el camión, el acoplado o el chofer, la
      // fecha real del cambio para el historial del equipo (vacía = ahora).
      { nombre: 'fecha_cambio', etiqueta: 'Fecha del cambio de camión/acoplado/chofer', tipo: 'datetime-local', soloEdicion: true, soloFormulario: true, ancho: true,
        ayuda: 'Solo si cambiás el camión, el acoplado o el chofer. Vacía = ahora. Los viajes desde esa fecha quedan con la composición nueva; los anteriores no cambian.' }
    ],
    acciones: (fila) => [
      { texto: 'Ver historial', onclick: `verHistorialEquipo(${fila.id_equipo})` },
      fila.activo === 0
        ? { texto: 'Reactivar', onclick: `reactivarEquipo(${fila.id_equipo})` }
        : { texto: 'Dar de baja', peligro: true, onclick: `darDeBajaEquipo(${fila.id_equipo})` },
      { texto: 'Copiar equipo', onclick: `copiarEquipo(${fila.id_equipo})` },
      { texto: 'Eliminar', peligro: true, onclick: `eliminarRegistro('equipos', ${fila.id_equipo})` }
    ]
  },
  viajes: {
    titulo: 'Viajes',
    singular: 'viaje',
    sub: 'Operaciones de transporte, tarifas y estado de cobro',
    filtroEquipo: true,
    recurso: 'viajes',
    id: 'id_viaje',
    campos: [
      { nombre: 'fecha_origen', etiqueta: 'Fecha de origen', tipo: 'datetime-local', requerido: true },
      { nombre: 'id_equipo', etiqueta: 'Equipo', tipo: 'fk', recurso: 'equipos', mostrar: r => `${r.patente_principal || '?'} / ${r.patente_secundaria || '?'}${r.activo === 0 ? ' (dado de baja)' : ''}`, requerido: true, soloActivos: true,
        // En la tabla: el camión y el acoplado que HICIERON el viaje (foto del
        // viaje), aunque el equipo se haya editado después.
        mostrarEnTabla: (fila, equipo) => fila.id_unidad_principal
          ? `${patenteDeUnidad(fila.id_unidad_principal)} / ${patenteDeUnidad(fila.id_unidad_secundaria)}`
          : (equipo ? `${equipo.patente_principal || '?'} / ${equipo.patente_secundaria || '?'}` : null) },
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
    columnasTabla: ['fecha_origen', 'id_equipo', 'origen', 'destino', 'estado', '_valor'],
    acciones: (fila) => fila.estado === 'FACTURADO' ? [] : [
      { texto: 'Avanzar estado', onclick: `avanzarEstadoViaje(${fila.id_viaje})` },
      { texto: 'Eliminar', peligro: true, onclick: `eliminarRegistro('viajes', ${fila.id_viaje})` }
    ]
  },
  'consumos-combustible': {
    titulo: 'Consumos de combustible',
    singular: 'carga de combustible',
    femenino: true,
    sub: 'Cargas de gasoil por equipo y rendimiento',
    filtroEquipo: true,
    recurso: 'consumos-combustible',
    id: 'id_consumo_combustible',
    // Bloque 7 · IVA en compras: agrega el grupo "Comprobante del proveedor"
    // (vistas/crud.js), calculado sobre este total (litros × precio).
    grupoFiscal: true,
    totalRegistro: () => (Number($('#f-cantidad_litros')?.value) || 0) * (Number($('#f-precio_por_litro')?.value) || 0),
    campos: [
      { nombre: 'fecha', etiqueta: 'Fecha', tipo: 'datetime-local', requerido: true },
      { nombre: 'id_equipo', etiqueta: 'Equipo', tipo: 'fk', recurso: 'equipos', mostrar: r => `${r.patente_principal || '?'} / ${r.patente_secundaria || '?'}${r.activo === 0 ? ' (dado de baja)' : ''}`, requerido: true, soloActivos: true },
      { nombre: 'estacion_carga', etiqueta: 'Estación de carga', tipo: 'text', requerido: true },
      { nombre: 'proveedor', etiqueta: 'Proveedor (cuenta)', tipo: 'select_cuenta', tiposCuenta: ['PROVEEDOR', 'CLIENTE'], requerido: true },
      { nombre: 'cantidad_litros', etiqueta: 'Litros', tipo: 'number', requerido: true },
      { nombre: 'precio_por_litro', etiqueta: 'Precio por litro ($)', tipo: 'number', requerido: true },
      { nombre: 'km_recorridos', etiqueta: 'Km recorridos', tipo: 'number' }
    ]
  },
  'consumos-generales': {
    titulo: 'Consumos generales',
    singular: 'consumo general',
    sub: 'Repuestos, lubricantes y otros gastos por unidad',
    recurso: 'consumos-generales',
    id: 'id_consumo_general',
    grupoFiscal: true,
    totalRegistro: () => Number($('#f-monto')?.value) || 0,
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
    singular: 'cuenta',
    femenino: true,
    sub: 'Proveedores y clientes con cuenta corriente. Los choferes se gestionan desde el módulo Choferes',
    recurso: 'cuentas',
    id: 'id_cuenta',
    campos: [
      { nombre: 'tipo', etiqueta: 'Tipo', tipo: 'select', requerido: true, opciones: ['PROVEEDOR', 'CLIENTE'] },
      { nombre: 'cuil', etiqueta: 'CUIT / CUIL (DNI si es consumidor final)', tipo: 'text', requerido: true },
      { nombre: 'nombre', etiqueta: 'Nombre', tipo: 'text', requerido: true, ancho: true },
      { nombre: 'domicilio', etiqueta: 'Domicilio', tipo: 'text', ancho: true, requerido: true },
      { nombre: 'telefono', etiqueta: 'Teléfono', tipo: 'text', requerido: true },
      { nombre: 'plazo_pago_dias', etiqueta: 'Plazo de pago (días) — solo clientes', tipo: 'number', ayuda: 'Días que el cliente puede adeudar antes de que aparezca una alerta de cobro vencido. Dejar vacío si no aplica.' },
      { nombre: 'condicion_iva', etiqueta: 'Condición frente al IVA', tipo: 'select', opciones: ['RESPONSABLE INSCRIPTO', 'MONOTRIBUTO', 'EXENTO', 'CONSUMIDOR FINAL'], ayuda: 'En clientes define la letra de la factura (A, B o C); en proveedores, el Libro IVA Compras.' }
    ],
    // Los choferes se gestionan desde su módulo
    alHacerClic: (fila) => {
      if (fila.tipo !== 'CHOFER') return false;
      location.hash = 'choferes';
      return true;
    }
  },
  movimientos: {
    titulo: 'Movimientos',
    singular: 'movimiento',
    sub: 'Movimientos de cuenta corriente por titular',
    recurso: 'movimientos',
    id: 'id_movimiento',
    campos: [
      { nombre: 'id_cuenta', etiqueta: 'Titular (cuenta)', tipo: 'fk', recurso: 'cuentas', mostrar: r => `${r.nombre} (${r.tipo})`, requerido: true },
      { nombre: 'fecha', etiqueta: 'Fecha', tipo: 'datetime-local', requerido: true },
      { nombre: 'monto', etiqueta: 'Monto ($, negativo = débito)', tipo: 'number', requerido: true, conSigno: true },
      { nombre: 'concepto', etiqueta: 'Concepto', tipo: 'text', requerido: true, ancho: true }
    ]
  },
  stock: {
    titulo: 'Stock',
    singular: 'elemento de stock',
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
    singular: 'mantenimiento',
    sub: 'Mantenimientos generales de la flota. Los de cada unidad se cargan desde su ficha',
    filtroEquipo: true,
    filtroAmbito: true,
    recurso: 'mantenimientos',
    id: 'id_mantenimiento',
    campos: [
      { nombre: 'id_unidad', etiqueta: 'Unidad', tipo: 'fk', recurso: 'unidades', mostrar: r => `${r.patente} — ${r.modelo}`, vacio: 'General de la flota',
        ayuda: 'Dejalo en «General de la flota» si no es de una unidad en particular.' },
      { nombre: 'concepto', etiqueta: 'Concepto', tipo: 'text', requerido: true, ancho: true },
      { nombre: 'periodicidad', etiqueta: 'Periodicidad', tipo: 'text', requerido: true },
      { nombre: 'fecha', etiqueta: 'Último realizado', tipo: 'date' },
      { nombre: 'fecha_vencimiento', etiqueta: 'Próximo vencimiento', tipo: 'date', requerido: true }
    ]
  },
  vencimientos: {
    titulo: 'Vencimientos',
    singular: 'vencimiento',
    sub: 'Impuestos y documentación generales de la flota. Los de cada unidad se cargan desde su ficha',
    filtroEquipo: true,
    filtroAmbito: true,
    recurso: 'vencimientos',
    id: 'id_vencimiento',
    campos: [
      { nombre: 'id_unidad', etiqueta: 'Unidad', tipo: 'fk', recurso: 'unidades', mostrar: r => `${r.patente} — ${r.modelo}`, vacio: 'General de la flota',
        ayuda: 'Dejalo en «General de la flota» si no es de una unidad en particular (ej. un impuesto).' },
      { nombre: 'concepto', etiqueta: 'Concepto', tipo: 'text', requerido: true, ancho: true },
      { nombre: 'fecha_vencimiento', etiqueta: 'Fecha de vencimiento', tipo: 'date', requerido: true }
    ]
  },
  cubiertas: {
    titulo: 'Cubiertas',
    singular: 'cubierta',
    femenino: true,
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
    singular: 'gasto administrativo',
    sub: 'Gastos de estructura no asociados a unidades: contabilidad, impuestos, asesorías',
    recurso: 'gastos-administrativos',
    id: 'id_gasto_administrativo',
    grupoFiscal: true,
    totalRegistro: () => Number($('#f-monto')?.value) || 0,
    campos: [
      { nombre: 'fecha', etiqueta: 'Fecha', tipo: 'datetime-local', requerido: true },
      { nombre: 'proveedor', etiqueta: 'Proveedor (cuenta)', tipo: 'select_cuenta', tiposCuenta: ['PROVEEDOR', 'CLIENTE'], requerido: true },
      { nombre: 'concepto', etiqueta: 'Concepto', tipo: 'text', requerido: true, ancho: true, maxlen: 150 },
      { nombre: 'monto', etiqueta: 'Monto ($)', tipo: 'number', requerido: true }
    ]
  }
};
