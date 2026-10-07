// backend/test/dashboard.calculos.test.js
// Prorrateo del sueldo fijo por días asignados (EQUIPO_HISTORIAL), usado en
// la rentabilidad por equipo. Ejecutar con: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sueldoFijoProrrateado } = require('../src/modulos/dashboard/dashboard.calculos');

test('un solo período vigente cubre todo el rango: sueldo/30 × días', () => {
  const periodos = [{ sueldo_fijo_mensual: 300000, desde: null, hasta: null }];
  // Enero 2026 completo: 31 días
  const total = sueldoFijoProrrateado(periodos, '2026-01-01', '2026-01-31');
  assert.equal(total, (300000 / 30) * 31);
});

test('cambio de chofer a mitad del período: cada uno aporta solo sus días, sin superponerse', () => {
  const periodos = [
    { sueldo_fijo_mensual: 300000, desde: null, hasta: '2026-01-16T00:00:00' },
    { sueldo_fijo_mensual: 450000, desde: '2026-01-16T00:00:00', hasta: null }
  ];
  // 1 al 30 de enero: 30 días. El corte cae el día 16 (exclusivo para el
  // primero, inclusive para el segundo): 15 días cada uno.
  const total = sueldoFijoProrrateado(periodos, '2026-01-01', '2026-01-30');
  assert.equal(total, (300000 / 30) * 15 + (450000 / 30) * 15);
});

test('un período fuera del rango no aporta nada', () => {
  const periodos = [{ sueldo_fijo_mensual: 300000, desde: '2026-02-01', hasta: null }];
  const total = sueldoFijoProrrateado(periodos, '2026-01-01', '2026-01-31');
  assert.equal(total, 0);
});

test('un período que empieza antes y termina después del rango cubre el rango completo', () => {
  const periodos = [{ sueldo_fijo_mensual: 300000, desde: '2025-12-01', hasta: '2026-03-01' }];
  const total = sueldoFijoProrrateado(periodos, '2026-01-01', '2026-01-31');
  assert.equal(total, (300000 / 30) * 31);
});

test('sin choferes con sueldo fijo, el total es 0', () => {
  assert.equal(sueldoFijoProrrateado([], '2026-01-01', '2026-01-31'), 0);
  assert.equal(sueldoFijoProrrateado([{ sueldo_fijo_mensual: null, desde: null, hasta: null }], '2026-01-01', '2026-01-31'), 0);
});

test('varios choferes distintos con sueldo fijo en el mismo equipo se suman', () => {
  const periodos = [
    { sueldo_fijo_mensual: 100000, desde: null, hasta: '2026-01-11T00:00:00' },
    { sueldo_fijo_mensual: 200000, desde: '2026-01-11T00:00:00', hasta: '2026-01-21T00:00:00' },
    { sueldo_fijo_mensual: 300000, desde: '2026-01-21T00:00:00', hasta: null }
  ];
  // 1 al 31 de enero: 31 días, repartidos 10 + 10 + 11
  const total = sueldoFijoProrrateado(periodos, '2026-01-01', '2026-01-31');
  const esperado = (100000 / 30) * 10 + (200000 / 30) * 10 + (300000 / 30) * 11;
  assert.ok(Math.abs(total - esperado) < 1e-9);
});
