// backend/test/comprobanteCompra.test.js
// Bloque 7 · IVA en compras: suma y tolerancia, letra B/C y ticket sin IVA,
// redondeo, y el caso sin datos del comprobante (NO_INFORMADO). Ejecutar con: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const comp = require('../src/modulos/gastos/comprobanteCompra');

test('calcula el IVA a partir del neto y la alícuota, redondeado a 2 decimales', () => {
  assert.equal(comp.calcularIva(1000, 21), 210);
  assert.equal(comp.calcularIva(100, 10.5), 10.5);
  assert.equal(comp.calcularIva('373.02', '21'), 78.33);
});

test('validarComprobante acepta una suma que coincide con el total', () => {
  const datos = { comprobante_tipo: 'FACTURA', comprobante_letra: 'A', neto_gravado: 1000, iva: 210, no_gravado: 0, exento: 0, percepciones: 0 };
  assert.equal(comp.validarComprobante(datos, 1210), null);
});

test('validarComprobante rechaza una suma que no coincide con el total', () => {
  const datos = { comprobante_tipo: 'FACTURA', comprobante_letra: 'A', neto_gravado: 1000, iva: 200, no_gravado: 0, exento: 0, percepciones: 0 };
  assert.match(comp.validarComprobante(datos, 1210), /no coincide con el total/);
});

test('validarComprobante tolera hasta un centavo de diferencia (decimales de litros × precio)', () => {
  const datos = { comprobante_tipo: 'FACTURA', comprobante_letra: 'A', neto_gravado: 950.409, iva: 199.585, no_gravado: 0, exento: 0, percepciones: 0 };
  assert.equal(comp.validarComprobante(datos, 1149.994), null);
});

test('con letra B o C el comprobante no puede tener IVA cargado', () => {
  const conIva = { comprobante_tipo: 'FACTURA', comprobante_letra: 'B', neto_gravado: 1000, iva: 210, no_gravado: 0, exento: 0, percepciones: 0 };
  assert.match(comp.validarComprobante(conIva, 1210), /no discrimina IVA/);

  const sinIva = { comprobante_tipo: 'FACTURA', comprobante_letra: 'C', neto_gravado: 0, iva: 0, no_gravado: 0, exento: 0, percepciones: 1210 };
  assert.equal(comp.validarComprobante(sinIva, 1210), null);
});

test('un ticket tampoco discrimina IVA aunque la letra venga vacía', () => {
  const datos = { comprobante_tipo: 'TICKET', comprobante_letra: null, neto_gravado: 0, iva: 0, no_gravado: 0, exento: 0, percepciones: 1210 };
  assert.equal(comp.validarComprobante(datos, 1210), null);
  assert.equal(comp.sinCreditoFiscal(datos), true);
});

test('NO_INFORMADO y SIN_COMPROBANTE no exigen que el desglose sume el total', () => {
  assert.equal(comp.validarComprobante({ comprobante_tipo: 'NO_INFORMADO' }, 500), null);
  assert.equal(comp.validarComprobante({ comprobante_tipo: 'SIN_COMPROBANTE' }, 500), null);
});

// ---------- prepararComprobante ----------

test('sin ningún dato del comprobante, prepararComprobante arma un NO_INFORMADO con el total', () => {
  const { datos, error } = comp.prepararComprobante({}, null, 1500.005);
  assert.equal(error, null);
  assert.equal(datos.comprobante_tipo, 'NO_INFORMADO');
  assert.equal(datos.neto_gravado, 1500.01);
  assert.equal(datos.iva, 0);
});

test('con letra B, prepararComprobante fuerza el IVA a cero aunque no se lo envíen', () => {
  const { datos, error } = comp.prepararComprobante(
    { comprobante_tipo: 'FACTURA', comprobante_letra: 'B', neto_gravado: 1210 }, null, 1210);
  assert.equal(error, null);
  assert.equal(datos.iva, 0);
});

test('con neto y alícuota pero sin IVA cargado, prepararComprobante lo calcula', () => {
  const { datos, error } = comp.prepararComprobante(
    { comprobante_tipo: 'FACTURA', comprobante_letra: 'A', neto_gravado: 1000, iva_alicuota: 21 }, null, 1210);
  assert.equal(error, null);
  assert.equal(datos.iva, 210);
});

test('prepararComprobante rechaza un desglose que no coincide con el total', () => {
  const { datos, error } = comp.prepararComprobante(
    { comprobante_tipo: 'FACTURA', comprobante_letra: 'A', neto_gravado: 1000, iva: 100 }, null, 1210);
  assert.equal(datos, null);
  assert.match(error, /no coincide con el total/);
});

test('una edición parcial completa los campos que faltan con lo que ya tenía el registro', () => {
  const anterior = {
    comprobante_tipo: 'FACTURA', comprobante_letra: 'A', comprobante_punto_venta: 1, comprobante_numero: 55,
    neto_gravado: 1000, iva_alicuota: 21, iva: 210, no_gravado: 0, exento: 0, percepciones: 0
  };
  // Solo se edita el punto de venta; el resto del comprobante se conserva.
  const { datos, error } = comp.prepararComprobante({ comprobante_punto_venta: 2 }, anterior, 1210);
  assert.equal(error, null);
  assert.equal(datos.comprobante_punto_venta, 2);
  assert.equal(datos.comprobante_numero, 55);
  assert.equal(datos.iva, 210);
});
