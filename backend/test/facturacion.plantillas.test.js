// backend/test/facturacion.plantillas.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/modulos/facturacion/facturacion.plantillas');

const viajeTn = {
  id_viaje: 112, origen: 'San José Boquerón', destino: 'Rosario', tipo_carga: 'Soja',
  numero_remito: '10134872416', fecha_origen: '2026-09-03 21:12:00', tipo_tarifa: 'POR TONELADA',
  tarifa: 95000, resultado: 30.68, cantidad_cargada: 30, comision: 0, patente_principal: 'EDL764'
};
const viajeKm = { ...viajeTn, id_viaje: 113, tipo_tarifa: 'POR KM', tarifa: 2150, resultado: 612, comision: 5,
  numero_remito: '10134872358', tipo_carga: 'Maíz', fecha_origen: '2026-09-05 08:00:00' };

test('renglón por viaje con la plantilla por defecto', () => {
  const it = P.itemDeViaje(viajeTn);
  assert.equal(it.descripcion, 'Flete de Soja de San José Boquerón a Rosario · Remito 10134872416 · 03/09/2026');
  assert.deepEqual([it.cantidad, it.unidad, it.precio_unitario, it.id_viaje], [30.68, 'tn', 95000, 112]);
});

test('la comisión se descuenta del precio unitario; POR KM en km, ÚNICA como un viaje', () => {
  const km = P.itemDeViaje(viajeKm);
  assert.deepEqual([km.cantidad, km.unidad, km.precio_unitario], [612, 'km', 2042.5]);
  const unica = P.itemDeViaje({ ...viajeTn, tipo_tarifa: 'UNICA', tarifa: 500000 });
  assert.deepEqual([unica.cantidad, unica.unidad, unica.precio_unitario], [1, 'viaje', 500000]);
});

test('plantilla propia del cliente y marcador desconocido visible', () => {
  const it = P.itemDeViaje(viajeTn, 'CTG {remito} · {carga} · {resultado} {unidad} · {inventado}');
  assert.equal(it.descripcion, 'CTG 10134872416 · Soja · 30,68 tn · {inventado}');
});

test('observaciones del comprobante con totales de todos los viajes (formato tipo Cargill)', () => {
  const obs = P.observaciones([viajeTn, viajeKm], 'CTG: {remitos} · KM: {km_total} · TN: {toneladas_total} · Carga: {cargas} · Período: {periodo}');
  assert.equal(obs, 'CTG: 10134872416, 10134872358 · KM: 612 · TN: 30,68 · Carga: Soja, Maíz · Período: 03/09/2026 al 05/09/2026');
  assert.equal(P.observaciones([viajeTn], ''), '');
});

test('un dato vacío no deja separadores sueltos', () => {
  const it = P.itemDeViaje({ ...viajeTn, numero_remito: null }, 'Flete {origen} → {destino} · {remito}');
  assert.equal(it.descripcion, 'Flete San José Boquerón → Rosario');
});
