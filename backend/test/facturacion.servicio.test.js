// backend/test/facturacion.servicio.test.js
// Tests de caracterización del importe facturable de un viaje (base − comisión),
// con los resultados que daba el sistema antes de la reorganización.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { importeFacturableDeViaje, r2 } = require('../src/modulos/facturacion/facturacion.servicio');

test('viaje UNICA: la base es la tarifa', () => {
  assert.deepEqual(importeFacturableDeViaje({ tipo_tarifa: 'UNICA', tarifa: '50000.00', comision: '0.00' }), { base: 50000, neto: 50000 });
});

test('viaje por tonelada con resultado y comisión 5%', () => {
  assert.deepEqual(
    importeFacturableDeViaje({ tipo_tarifa: 'POR TONELADA', tarifa: '4086.01', cantidad_cargada: '32.75', resultado: '31.61', comision: '5.00' }),
    { base: 4086.01 * 31.61, neto: r2(4086.01 * 31.61 * 0.95) }
  );
});

test('sin resultado usa la cantidad cargada; sin ninguna, cero', () => {
  assert.equal(importeFacturableDeViaje({ tipo_tarifa: 'POR TONELADA', tarifa: 1000, cantidad_cargada: 30, resultado: null, comision: 0 }).neto, 30000);
  assert.equal(importeFacturableDeViaje({ tipo_tarifa: 'POR KM', tarifa: 1000, cantidad_cargada: null, resultado: null }).neto, 0);
});

test('r2 redondea a 2 decimales', () => {
  assert.equal(r2(10.005), 10.01);
  assert.equal(r2('3.14159'), 3.14);
});
