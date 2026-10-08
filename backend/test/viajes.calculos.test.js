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
  'PORCENTAJE 10%': {"variable_tipo": "PORCENTAJE", "variable_valor": 10},
  'POR KM 12,5': {"variable_tipo": "POR KM", "variable_valor": "12.5"},
  'FIJA': {"sueldo_fijo_mensual": 500000, "variable_tipo": null, "variable_valor": null},
  'PORCENTAJE 0': {"variable_tipo": "PORCENTAJE", "variable_valor": 0},
  'PORCENTAJE sin valor': {"variable_tipo": "PORCENTAJE", "variable_valor": null},
  // Mixto: sueldo fijo + variable por km. La liquidación por viaje usa solo la variable.
  'MIXTO fijo + POR KM 20': {"sueldo_fijo_mensual": 300000, "variable_tipo": "POR KM", "variable_valor": 20},
};

const CASOS = [
  {
    nombre: 'UNICA sin comisión',
    viaje: {"tipo_tarifa": "UNICA", "tarifa": 50000, "comision": 0},
    esperado: { monto: 50000, facturado: 60500, neto: 50000, cuentaCliente: 60500 },
    liquidacion: { 'sin chofer': {"monto": 0, "incompleto": false}, 'PORCENTAJE 10%': {"monto": 5000, "incompleto": false}, 'POR KM 12,5': {"monto": 0, "incompleto": true}, 'FIJA': {"monto": 0, "incompleto": false}, 'PORCENTAJE 0': {"monto": 0, "incompleto": false}, 'PORCENTAJE sin valor': {"monto": 0, "incompleto": false}, 'MIXTO fijo + POR KM 20': {"monto": 0, "incompleto": true} }
  },
  {
    nombre: 'UNICA con decimales y comisión 10%',
    viaje: {"tipo_tarifa": "UNICA", "tarifa": "50000.50", "comision": "10"},
    esperado: { monto: 50000.5, facturado: 54450.5445, neto: 45000.450000000004, cuentaCliente: 54450.5445 },
    liquidacion: { 'sin chofer': {"monto": 0, "incompleto": false}, 'PORCENTAJE 10%': {"monto": 5000.05, "incompleto": false}, 'POR KM 12,5': {"monto": 0, "incompleto": true}, 'FIJA': {"monto": 0, "incompleto": false}, 'PORCENTAJE 0': {"monto": 0, "incompleto": false}, 'PORCENTAJE sin valor': {"monto": 0, "incompleto": false}, 'MIXTO fijo + POR KM 20': {"monto": 0, "incompleto": true} }
  },
  {
    nombre: 'UNICA sin tarifa',
    viaje: {"tipo_tarifa": "UNICA", "tarifa": null},
    esperado: { monto: 0, facturado: 0, neto: 0, cuentaCliente: 0 },
    liquidacion: { 'sin chofer': {"monto": 0, "incompleto": false}, 'PORCENTAJE 10%': {"monto": 0, "incompleto": false}, 'POR KM 12,5': {"monto": 0, "incompleto": true}, 'FIJA': {"monto": 0, "incompleto": false}, 'PORCENTAJE 0': {"monto": 0, "incompleto": false}, 'PORCENTAJE sin valor': {"monto": 0, "incompleto": false}, 'MIXTO fijo + POR KM 20': {"monto": 0, "incompleto": true} }
  },
  {
    nombre: 'POR TONELADA con resultado',
    viaje: {"tipo_tarifa": "POR TONELADA", "tarifa": 1000, "cantidad_cargada": 30, "resultado": 29.5, "comision": 5},
    esperado: { monto: 29500, facturado: 33910.25, neto: 28025, cuentaCliente: 33910.25 },
    liquidacion: { 'sin chofer': {"monto": 0, "incompleto": false}, 'PORCENTAJE 10%': {"monto": 2950, "incompleto": false}, 'POR KM 12,5': {"monto": 0, "incompleto": true}, 'FIJA': {"monto": 0, "incompleto": false}, 'PORCENTAJE 0': {"monto": 0, "incompleto": false}, 'PORCENTAJE sin valor': {"monto": 0, "incompleto": false}, 'MIXTO fijo + POR KM 20': {"monto": 0, "incompleto": true} }
  },
  {
    nombre: 'POR TONELADA sin resultado (usa cantidad cargada)',
    viaje: {"tipo_tarifa": "POR TONELADA", "tarifa": 1000, "cantidad_cargada": 30, "resultado": null, "comision": 5},
    esperado: { monto: 30000, facturado: 34485, neto: 28500, cuentaCliente: 34485 },
    liquidacion: { 'sin chofer': {"monto": 0, "incompleto": false}, 'PORCENTAJE 10%': {"monto": 3000, "incompleto": false}, 'POR KM 12,5': {"monto": 0, "incompleto": true}, 'FIJA': {"monto": 0, "incompleto": false}, 'PORCENTAJE 0': {"monto": 0, "incompleto": false}, 'PORCENTAJE sin valor': {"monto": 0, "incompleto": false}, 'MIXTO fijo + POR KM 20': {"monto": 0, "incompleto": true} }
  },
  {
    nombre: 'POR KM líquido producto',
    viaje: {"tipo_tarifa": "POR KM", "tarifa": 800, "resultado": 253, "comision": 3, "modo_facturacion": "LIQUIDO_PRODUCTO"},
    esperado: { monto: 202400, facturado: 237556.88, neto: 196328, cuentaCliente: 237556.88 },
    liquidacion: { 'sin chofer': {"monto": 0, "incompleto": false}, 'PORCENTAJE 10%': {"monto": 20240, "incompleto": false}, 'POR KM 12,5': {"monto": 3162.5, "incompleto": false}, 'FIJA': {"monto": 0, "incompleto": false}, 'PORCENTAJE 0': {"monto": 0, "incompleto": false}, 'PORCENTAJE sin valor': {"monto": 0, "incompleto": false}, 'MIXTO fijo + POR KM 20': {"monto": 5060, "incompleto": false} }
  },
  {
    nombre: 'POR KM con factura',
    viaje: {"tipo_tarifa": "POR KM", "tarifa": 800, "resultado": 254, "comision": 4, "modo_facturacion": "FACTURA"},
    esperado: { monto: 203200, facturado: 236037.12, neto: 195072, cuentaCliente: 236037.12 },
    liquidacion: { 'sin chofer': {"monto": 0, "incompleto": false}, 'PORCENTAJE 10%': {"monto": 20320, "incompleto": false}, 'POR KM 12,5': {"monto": 3175, "incompleto": false}, 'FIJA': {"monto": 0, "incompleto": false}, 'PORCENTAJE 0': {"monto": 0, "incompleto": false}, 'PORCENTAJE sin valor': {"monto": 0, "incompleto": false}, 'MIXTO fijo + POR KM 20': {"monto": 5080, "incompleto": false} }
  },
  {
    nombre: 'POR KM sin facturar',
    viaje: {"tipo_tarifa": "POR KM", "tarifa": 800, "resultado": 255, "comision": 0, "modo_facturacion": "SIN_FACTURAR"},
    esperado: { monto: 204000, facturado: 246840, neto: 204000, cuentaCliente: 204000 },
    liquidacion: { 'sin chofer': {"monto": 0, "incompleto": false}, 'PORCENTAJE 10%': {"monto": 20400, "incompleto": false}, 'POR KM 12,5': {"monto": 3187.5, "incompleto": false}, 'FIJA': {"monto": 0, "incompleto": false}, 'PORCENTAJE 0': {"monto": 0, "incompleto": false}, 'PORCENTAJE sin valor': {"monto": 0, "incompleto": false}, 'MIXTO fijo + POR KM 20': {"monto": 5100, "incompleto": false} }
  },
  {
    nombre: 'Valores como texto (así llegan de MySQL)',
    viaje: {"tipo_tarifa": "POR TONELADA", "tarifa": "4086.01", "cantidad_cargada": "32.75", "resultado": "31.61", "comision": "5.00", "modo_facturacion": null},
    esperado: { monto: 129158.7761, facturado: 148468.01312694998, neto: 122700.83729499999, cuentaCliente: 148468.01312694998 },
    liquidacion: { 'sin chofer': {"monto": 0, "incompleto": false}, 'PORCENTAJE 10%': {"monto": 12915.877610000001, "incompleto": false}, 'POR KM 12,5': {"monto": 0, "incompleto": true}, 'FIJA': {"monto": 0, "incompleto": false}, 'PORCENTAJE 0': {"monto": 0, "incompleto": false}, 'PORCENTAJE sin valor': {"monto": 0, "incompleto": false}, 'MIXTO fijo + POR KM 20': {"monto": 0, "incompleto": true} }
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

test('una empresa que no discrimina IVA (monotributo o exento) imputa siempre el neto', () => {
  const viaje = { tipo_tarifa: 'UNICA', tarifa: 100000, comision: 0, modo_facturacion: 'LIQUIDO_PRODUCTO' };
  assert.equal(calc.calcularMontoCuentaCliente(viaje), 121000);
  assert.equal(calc.calcularMontoCuentaCliente(viaje, { conIva: false }), 100000);
});
