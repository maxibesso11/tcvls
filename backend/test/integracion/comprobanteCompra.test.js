// backend/test/integracion/comprobanteCompra.test.js
// Bloque 7 · IVA en compras: comprobante del proveedor en los tres registros
// de compra (consumos de combustible, generales y gastos administrativos).
// Contra una base MySQL DESCARTABLE (entorno.js).
//
// Uso: TEST_DB_PERMITIR_BORRADO=1 TEST_DB_PORT=3307 TEST_DB_PASSWORD=... npm run test:integracion
'use strict';
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { HABILITADO, MOTIVO_OMISION, levantar } = require('./entorno');

describe('Bloque 7 · IVA en compras', { skip: !HABILITADO && MOTIVO_OMISION }, () => {
  let entorno;
  let secuencia = 0;

  before(async () => {
    entorno = await levantar();
    await entorno.iniciarSesion('demo', 'demo123');
  });
  after(async () => { if (entorno) await entorno.cerrar(); });

  async function ok(promesa) {
    const r = await promesa;
    assert.ok(r.estado >= 200 && r.estado < 300, `HTTP ${r.estado}: ${JSON.stringify(r.datos)}`);
    return r.datos;
  }

  async function crearProveedor() {
    secuencia += 1;
    const nombre = `Proveedor Test ${Date.now()}-${secuencia}`;
    const cuil = `30-${String(70000000 + secuencia * 7919).slice(-8)}-${secuencia % 10}`;
    return ok(entorno.api('POST', '/api/cuentas', { tipo: 'PROVEEDOR', cuil, nombre }));
  }

  async function movimientosDe(idCuenta) {
    return (await ok(entorno.api('GET', `/api/cuentas-corrientes/${idCuenta}`))).movimientos;
  }

  test('un consumo general con desglose completo deja el movimiento por el total, no por el neto', async () => {
    const prov = await crearProveedor();
    const consumo = await ok(entorno.api('POST', '/api/consumos-generales', {
      proveedor: prov.nombre, fecha: '2026-06-01 10:00:00', id_unidad: 1, concepto: 'Test desglose', monto: 1210,
      comprobante_tipo: 'FACTURA', comprobante_letra: 'A', comprobante_punto_venta: 1, comprobante_numero: 555,
      neto_gravado: 1000, iva: 210
    }));
    assert.equal(consumo.neto_gravado, 1000);
    assert.equal(Number(consumo.iva), 210);

    const movs = await movimientosDe(prov.id_cuenta);
    assert.equal(movs.length, 1);
    assert.equal(Number(movs[0].credito), 1210);
  });

  test('rechaza un desglose que no coincide con el total', async () => {
    const prov = await crearProveedor();
    const r = await entorno.api('POST', '/api/consumos-generales', {
      proveedor: prov.nombre, fecha: '2026-06-01 10:00:00', id_unidad: 1, concepto: 'Test rechazo', monto: 1210,
      comprobante_tipo: 'FACTURA', comprobante_letra: 'A', neto_gravado: 1000, iva: 100
    });
    assert.equal(r.estado, 400);
    assert.match(r.datos.error, /no coincide con el total/);
  });

  test('con letra B el IVA queda en cero aunque se envíe un valor', async () => {
    const prov = await crearProveedor();
    const r = await entorno.api('POST', '/api/gastos-administrativos', {
      proveedor: prov.nombre, concepto: 'Test letra B', fecha: '2026-06-02 10:00:00', monto: 1210,
      comprobante_tipo: 'FACTURA', comprobante_letra: 'B', neto_gravado: 0, iva: 210, percepciones: 1000
    });
    assert.equal(r.estado, 400);
    assert.match(r.datos.error, /no discrimina IVA/);

    const gasto = await ok(entorno.api('POST', '/api/gastos-administrativos', {
      proveedor: prov.nombre, concepto: 'Test letra B ok', fecha: '2026-06-02 10:00:00', monto: 1210,
      comprobante_tipo: 'FACTURA', comprobante_letra: 'B', percepciones: 1210
    }));
    assert.equal(Number(gasto.iva), 0);
  });

  test('el mismo comprobante de un proveedor no se puede cargar dos veces, ni en otra tabla', async () => {
    const prov = await crearProveedor();
    await ok(entorno.api('POST', '/api/gastos-administrativos', {
      proveedor: prov.nombre, concepto: 'Original', fecha: '2026-06-03 10:00:00', monto: 5000,
      comprobante_tipo: 'FACTURA', comprobante_letra: 'A', comprobante_punto_venta: 3, comprobante_numero: 777,
      neto_gravado: 4132.23, iva: 867.77
    }));

    const duplicado = await entorno.api('POST', '/api/consumos-generales', {
      proveedor: prov.nombre, fecha: '2026-06-03 10:00:00', id_unidad: 1, concepto: 'Duplicado en otra tabla', monto: 5000,
      comprobante_tipo: 'FACTURA', comprobante_letra: 'A', comprobante_punto_venta: 3, comprobante_numero: 777,
      neto_gravado: 4132.23, iva: 867.77
    });
    assert.equal(duplicado.estado, 400);
    assert.match(duplicado.datos.error, /Ya existe un comprobante/);
  });

  test('un registro migrado (sin comprobante) queda NO_INFORMADO con los totales intactos', async () => {
    const [[gasto]] = await entorno.pool.query(
      "SELECT id_consumo_general, monto FROM CONSUMOS_GENERALES WHERE proveedor = 'Lubricentro Central'"
    );
    assert.ok(gasto, 'no se encontró el registro sembrado de prueba');

    const registro = await ok(entorno.api('GET', `/api/consumos-generales/${gasto.id_consumo_general}`));
    assert.equal(registro.comprobante_tipo, 'NO_INFORMADO');
    assert.equal(Number(registro.neto_gravado), Number(gasto.monto));
    assert.equal(Number(registro.iva), 0);
  });

  test('editar un consumo sin tocar el comprobante conserva sus datos fiscales', async () => {
    const prov = await crearProveedor();
    const consumo = await ok(entorno.api('POST', '/api/consumos-generales', {
      proveedor: prov.nombre, fecha: '2026-06-04 10:00:00', id_unidad: 1, concepto: 'Original', monto: 1210,
      comprobante_tipo: 'FACTURA', comprobante_letra: 'A', comprobante_punto_venta: 2, comprobante_numero: 900,
      neto_gravado: 1000, iva: 210
    }));

    const editado = await ok(entorno.api('PUT', `/api/consumos-generales/${consumo.id_consumo_general}`,
      { concepto: 'Editado, sin tocar el comprobante' }));
    assert.equal(editado.concepto, 'Editado, sin tocar el comprobante');

    const releido = await ok(entorno.api('GET', `/api/consumos-generales/${consumo.id_consumo_general}`));
    assert.equal(releido.comprobante_tipo, 'FACTURA');
    assert.equal(releido.comprobante_numero, 900);
    assert.equal(Number(releido.neto_gravado), 1000);
    assert.equal(Number(releido.iva), 210);
  });
});
