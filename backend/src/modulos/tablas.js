// backend/src/modulos/tablas.js
// Definición de las tablas del esquema establecido.
const sync = require('./cuentas/cuentas.hooks');
const syncConsumos = require('./gastos/consumos.hooks');
const syncViajes = require('./viajes/viajes.hooks');
const syncGastos = require('./gastos/gastosAdministrativos.hooks');
const syncEquipos = require('./equipos/equipos.hooks');
const choferesHooks = require('./choferes/choferes.hooks');

// Bloque 7 · IVA en compras: grupo de campos del comprobante del proveedor,
// compartido por los tres registros de compra (combustible, generales y
// gastos administrativos). `monto` (o litros × precio) sigue siendo el total
// que se le debe al proveedor.
const CAMPOS_COMPROBANTE = [
  'comprobante_tipo', 'comprobante_letra', 'comprobante_punto_venta', 'comprobante_numero',
  'neto_gravado', 'iva_alicuota', 'iva', 'no_gravado', 'exento', 'percepciones'
];

module.exports = [
  {
    ruta: 'choferes',
    table: 'CHOFERES',
    idField: 'id_chofer',
    fields: ['nombre', 'cuil', 'edad', 'ultima_jornada_descanso', 'vencimiento_carnet', 'domicilio', 'telefono', 'sueldo_fijo_mensual', 'variable_tipo', 'variable_valor'],
    hooks: {
      beforeCreate: choferesHooks.antesDeCrearChofer,
      beforeUpdate: choferesHooks.antesDeActualizarChofer,
      afterCreate: sync.alCrearChofer,
      afterUpdate: sync.alActualizarChofer,
      afterDelete: sync.alEliminarChofer
    }
  },
  {
    ruta: 'unidades',
    table: 'UNIDADES',
    idField: 'id_unidad',
    fields: ['patente', 'modelo', 'funcionalidad']
  },
  {
    ruta: 'equipos',
    table: 'EQUIPO',
    idField: 'id_equipo',
    fields: ['id_unidad_principal', 'id_unidad_secundaria', 'id_chofer', 'peso_tara', 'peso_bruto'],
    hooks: {
      beforeUpdate: syncEquipos.antesDeActualizarEquipo,
      afterCreate: syncEquipos.alCrearEquipo,
      afterUpdate: syncEquipos.alActualizarEquipo
    }
  },
  {
    ruta: 'viajes',
    table: 'VIAJES',
    idField: 'id_viaje',
    filtroEquipo: 'directo',
    filtrosExactos: ['estado'],
    filtrosLike: ['tipo_carga'],
    filtroFecha: { columna: 'fecha_origen' },
    ordenable: ['fecha_origen', 'fecha_llegada', 'tarifa', 'resultado', 'estado', 'id_viaje'],
    fields: ['fecha_origen', 'tipo_carga', 'origen', 'destino', 'id_equipo', 'tarifa', 'tipo_tarifa', 'cantidad_cargada', 'resultado', 'comision', 'estado', 'modo_facturacion', 'fecha_llegada', 'pagador', 'numero_remito'],
    hooks: {
      beforeCreate: syncViajes.antesDeCrearViaje,
      beforeUpdate: syncViajes.antesDeActualizarViaje,
      beforeDelete: syncViajes.antesDeEliminarViaje,
      afterCreate: syncViajes.alCrearViaje,
      afterUpdate: syncViajes.alActualizarViaje,
      afterDelete: syncViajes.alEliminarViaje
    }
  },
  {
    ruta: 'consumos-combustible',
    table: 'CONSUMOS_COMBUSTIBLE',
    idField: 'id_consumo_combustible',
    filtroEquipo: 'directo',
    grupoFiscal: true,
    fields: ['estacion_carga', 'proveedor', 'id_equipo', 'cantidad_litros', 'km_recorridos', 'precio_por_litro', 'fecha', ...CAMPOS_COMPROBANTE],
    hooks: {
      beforeCreate: syncConsumos.antesDeCrearConsumoCombustible,
      beforeUpdate: syncConsumos.antesDeActualizarConsumoCombustible,
      afterCreate: syncConsumos.alCrearConsumoCombustible,
      afterUpdate: syncConsumos.alActualizarConsumoCombustible,
      afterDelete: syncConsumos.alEliminarConsumoCombustible
    }
  },
  {
    ruta: 'consumos-generales',
    table: 'CONSUMOS_GENERALES',
    idField: 'id_consumo_general',
    grupoFiscal: true,
    fields: ['proveedor', 'fecha', 'id_unidad', 'concepto', 'monto', ...CAMPOS_COMPROBANTE],
    hooks: {
      beforeCreate: syncConsumos.antesDeCrearConsumoGeneral,
      beforeUpdate: syncConsumos.antesDeActualizarConsumoGeneral,
      afterCreate: syncConsumos.alCrearConsumoGeneral,
      afterUpdate: syncConsumos.alActualizarConsumoGeneral,
      afterDelete: syncConsumos.alEliminarConsumoGeneral
    }
  },
  {
    ruta: 'cuentas',
    table: 'CUENTA',
    idField: 'id_cuenta',
    fields: ['tipo', 'cuil', 'nombre', 'domicilio', 'telefono', 'plazo_pago_dias', 'condicion_iva'],
    hooks: {
      beforeCreate: sync.antesDeCrearCuenta,
      beforeUpdate: sync.antesDeActualizarCuenta,
      beforeDelete: sync.antesDeEliminarCuenta
    }
  },
  {
    ruta: 'movimientos',
    table: 'MOVIMIENTOS',
    idField: 'id_movimiento',
    fields: ['id_cuenta', 'monto', 'fecha', 'concepto']
  },
  {
    ruta: 'stock',
    table: 'STOCK',
    idField: 'id_stock',
    filtrosExactos: ['deposito'],
    fields: ['elemento', 'valuacion', 'deposito']
  },
  {
    ruta: 'mantenimientos',
    table: 'MANTENIMIENTOS',
    idField: 'id_mantenimiento',
    filtroEquipo: 'por_unidad',
    ambitoUnidad: true,
    fields: ['id_unidad', 'periodicidad', 'fecha', 'fecha_vencimiento', 'concepto']
  },
  {
    ruta: 'vencimientos',
    table: 'VENCIMIENTOS',
    idField: 'id_vencimiento',
    filtroEquipo: 'por_unidad',
    ambitoUnidad: true,
    fields: ['concepto', 'fecha_vencimiento', 'id_unidad']
  },
  {
    ruta: 'cubiertas',
    table: 'CUBIERTAS',
    idField: 'id_cubierta',
    filtroEquipo: 'por_unidad',
    fields: ['identificador', 'estado', 'id_unidad', 'ubicacion', 'fecha_colocacion']
  },
  {
    ruta: 'gastos-administrativos',
    table: 'GASTOS_ADMINISTRATIVOS',
    idField: 'id_gasto_administrativo',
    filtrosLike: ['concepto'],
    filtroFecha: { columna: 'fecha' },
    ordenable: ['fecha', 'monto', 'id_gasto_administrativo'],
    grupoFiscal: true,
    fields: ['proveedor', 'concepto', 'fecha', 'monto', ...CAMPOS_COMPROBANTE],
    hooks: {
      beforeCreate: syncGastos.antesDeCrearGasto,
      beforeUpdate: syncGastos.antesDeActualizarGasto,
      afterCreate: syncGastos.alCrearGasto,
      afterUpdate: syncGastos.alActualizarGasto,
      afterDelete: syncGastos.alEliminarGasto
    }
  }
];
