// backend/test/viajes.calculos.test.js
// Tests de caracterización: fijan los resultados ACTUALES de los cálculos de
// viajes (tomados del sistema antes de la reorganización). Si alguno falla,
// cambió una regla de negocio. Ejecutar con: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../src/modulos/viajes/viajes.calculos');

const CHOFERES = {
  'sin chofer': null,
  'PORCENTAJE 10%': {"tipo_remuneracion": "PORCENTAJE", "remuneracion": 10},
  'POR KM 12,5': {"tipo_remuneracion": "POR KM", "remuneracion": "12.5"},
  'FIJA': {"tipo_remuneracion": "FIJA", "remuneracion": 500000},
  'PORCENTAJE 0': {"tipo_remuneracion": "PORCENTAJE", "remuneracion": 0},
  'PORCENTAJE sin valor': {"tipo_remuneracion": "PORCENTAJE", "remuneracion": null},
};

const CASOS = [
  {
    nombre: 'UNICA sin comisión',
    viaje: {"tipo_tarifa": "UNICA", "tarifa": 50000, "comision": 0},
    esperado: { monto: 50000, facturado: 60500, neto: 50000, cuentaCliente: 60500 },
    liquidacion: { 'sin chofer': {"monto": 0, "incompleto": false}, 'PORCENTAJE 10%': {"monto": 5000, "incompleto": false}, 'POR KM 12,5': {"monto": 0, "incompleto": true}, 'FIJA': {"monto": 0, "incompleto": false}, 'PORCENTAJE 0': {"monto": 0, "incompleto": false}, 'PORCENTAJE sin valor': {"monto": 0, "incompleto": false} }
  },
  {
    nombre: 'UNICA con decimales y comisión 10%',
    viaje: {"tipo_tarifa": "UNICA", "tarifa": "50000.50", "comision": "10"},
    esperado: { monto: 50000.5, facturado: 54450.5445, neto: 45000.450000000004, cuentaCliente: 54450.5445 },
    liquidacion: { 'sin chofer': {"monto": 0, "incompleto": false}, 'PORCENTAJE 10%': {"monto": 5000.05, "incompleto": false}, 'POR KM 12,5': {"monto": 0, "incompleto": true}, 'FIJA': {"monto": 0, "incompleto": false}, 'PORCENTAJE 0': {"monto": 0, "incompleto": false}, 'PORCENTAJE sin valor': {"monto": 0, "incompleto": false} }
  },
  {
    nombre: 'UNICA sin tarifa',
    viaje: {"tipo_tarifa": "UNICA", "tarifa": null},
    esperado: { monto: 0, facturado: 0, neto: 0, cuentaCliente: 0 },
    liquidacion: { 'sin chofer': {"monto": 0, "incompleto": false}, 'PORCENTAJE 10%': {"monto": 0, "incompleto": false}, 'POR KM 12,5': {"monto": 0, "incompleto": true}, 'FIJA': {"monto": 0, "incompleto": false}, 'PORCENTAJE 0': {"monto": 0, "incompleto": false}, 'PORCENTAJE sin valor': {"monto": 0, "incompleto": false} }
  },
  {
    nombre: 'POR TONELADA con resultado',
    viaje: {"tipo_tarifa": "POR TONELADA", "tarifa": 1000, "cantidad_cargada": 30, "resultado": 29.5, "comision": 5},
    esperado: { monto: 29500, facturado: 33910.25, neto: 28025, cuentaCliente: 33910.25 },
    liquidacion: { 'sin chofer': {"monto": 0, "incompleto": false}, 'PORCENTAJE 10%': {"monto": 2950, "incompleto": false}, 'POR KM 12,5': {"monto": 0, "incompleto": true}, 'FIJA': {"monto": 0, "incompleto": false}, 'PORCENTAJE 0': {"monto": 0, "incompleto": false}, 'PORCENTAJE sin valor': {"monto": 0, "incompleto": false} }
  },
  {
    nombre: 'POR TONELADA sin resultado (usa cantidad cargada)',
    viaje: {"tipo_tarifa": "POR TONELADA", "tarifa": 1000, "cantidad_cargada": 30, "resultado": null, "comision": 5},
    esperado: { monto: 30000, facturado: 34485, neto: 28500, cuentaCliente: 34485 },
    liquidacion: { 'sin chofer': {"monto": 0, "incompleto": false}, 'PORCENTAJE 10%': {"monto": 3000, "incompleto": false}, 'POR KM 12,5': {"monto": 0, "incompleto": true}, 'FIJA': {"monto": 0, "incompleto": false}, 'PORCENTAJE 0': {"monto": 0, "incompleto": false}, 'PORCENTAJE sin valor': {"monto": 0, "incompleto": false} }
  },
  {
    nombre: 'POR KM líquido producto',
    viaje: {"tipo_tarifa": "POR KM", "tarifa": 800, "resultado": 253, "comision": 3, "modo_facturacion": "LIQUIDO_PRODUCTO"},
    esperado: { monto: 202400, facturado: 237556.88, neto: 196328, cuentaCliente: 237556.88 },
    liquidacion: { 'sin chofer': {"monto": 0, "incompleto": false}, 'PORCENTAJE 10%': {"monto": 20240, "incompleto": false}, 'POR KM 12,5': {"monto": 3162.5, "incompleto": false}, 'FIJA': {"monto": 0, "incompleto": false}, 'PORCENTAJE 0': {"monto": 0, "incompleto": false}, 'PORCENTAJE sin valor': {"monto": 0, "incompleto": false} }
  },
  {
    nombre: 'POR KM con factura',
    viaje: {"tipo_tarifa": "POR KM", "tarifa": 800, "resultado": 254, "comision": 4, "modo_facturacion": "FACTURA"},
    esperado: { monto: 203200, facturado: 236037.12, neto: 195072, cuentaCliente: 236037.12 },
    liquidacion: { 'sin chofer': {"monto": 0, "incompleto": false}, 'PORCENTAJE 10%': {"monto": 20320, "incompleto": false}, 'POR KM 12,5': {"monto": 3175, "incompleto": false}, 'FIJA': {"monto": 0, "incompleto": false}, 'PORCENTAJE 0': {"monto": 0, "incompleto": false}, 'PORCENTAJE sin valor': {"monto": 0, "incompleto": false} }
  },
  {
    nombre: 'POR KM sin facturar',
    viaje: {"tipo_tarifa": "POR KM", "tarifa": 800, "resultado": 255, "comision": 0, "modo_facturacion": "SIN_FACTURAR"},
    esperado: { monto: 204000, facturado: 246840, neto: 204000, cuentaCliente: 204000 },
    liquidacion: { 'sin chofer': {"monto": 0, "incompleto": false}, 'PORCENTAJE 10%': {"monto": 20400, "incompleto": false}, 'POR KM 12,5': {"monto": 3187.5, "incompleto": false}, 'FIJA': {"monto": 0, "incompleto": false}, 'PORCENTAJE 0': {"monto": 0, "incompleto": false}, 'PORCENTAJE sin valor': {"monto": 0, "incompleto": false} }
  },
  {
    nombre: 'Valores como texto (así llegan de MySQL)',
    viaje: {"tipo_tarifa": "POR TONELADA", "tarifa": "4086.01", "cantidad_cargada": "32.75", "resultado": "31.61", "comision": "5.00", "modo_facturacion": null},
    esperado: { monto: 129158.7761, facturado: 148468.01312694998, neto: 122700.83729499999, cuentaCliente: 148468.01312694998 },
    liquidacion: { 'sin chofer': {"monto": 0, "incompleto": false}, 'PORCENTAJE 10%': {"monto": 12915.877610000001, "incompleto": false}, 'POR KM 12,5': {"monto": 0, "incompleto": true}, 'FIJA': {"monto": 0, "incompleto": false}, 'PORCENTAJE 0': {"monto": 0, "incompleto": false}, 'PORCENTAJE sin valor': {"monto": 0, "incompleto": false} }
  },
];

for (const caso of CASOS) {
  test(`importes del viaje: ${caso.nombre}`, () => {
    assert.equal(calc.calcularMontoViaje(caso.viaje), caso.esperado.monto);
    assert.equal(calc.calcularMontoFacturado(caso.viaje), caso.esperado.facturado);
    assert.equal(calc.calcularNetoConComision(caso.viaje), caso.esperado.neto);
    assert.equal(calc.calcularMontoCuentaCliente(caso.viaje), caso.esperado.cuentaCliente);
  });
  test(`liquidación al chofer: ${caso.nombre}`, () => {
    for (const [nombreChofer, chofer] of Object.entries(CHOFERES)) {
      assert.deepEqual(calc.calcularLiquidacionChofer(caso.viaje, chofer), caso.liquidacion[nombreChofer], nombreChofer);
    }
  });
}
