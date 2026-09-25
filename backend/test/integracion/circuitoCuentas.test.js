// backend/test/integracion/circuitoCuentas.test.js
// Circuito viaje → facturación → cuenta corriente contra una base real
// (descartable). Reproduce los criterios de aceptación del MVP:
//   - Facturar un viaje genera el débito correcto en la cuenta del cliente.
//   - Anular con nota de crédito devuelve el saldo exactamente al valor previo.
//   - Un viaje facturado y luego modificado deja los saldos correctos, sin
//     movimientos duplicados, incluso si alguien editó el concepto a mano.
// Además cubre las ediciones parciales y la atomicidad de los automatismos.
//
// Uso: TEST_DB_PERMITIR_BORRADO=1 TEST_DB_PORT=3307 TEST_DB_PASSWORD=... npm run test:integracion
'use strict';
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { HABILITADO, MOTIVO_OMISION, levantar } = require('./entorno');

describe('circuito de cuentas corrientes', { skip: !HABILITADO && MOTIVO_OMISION }, () => {
  let entorno;
  let secuencia = 0;

  before(async () => {
    entorno = await levantar();
    await entorno.iniciarSesion('demo', 'demo123');
  });
  after(async () => { if (entorno) await entorno.cerrar(); });

  // ---------- Ayudas ----------

  async function ok(promesa) {
    const r = await promesa;
    assert.ok(r.estado >= 200 && r.estado < 300, `HTTP ${r.estado}: ${JSON.stringify(r.datos)}`);
    return r.datos;
  }

  async function crearCuenta(tipo) {
    secuencia += 1;
    const nombre = `${tipo} TEST ${Date.now()}-${secuencia}`;
    const cuil = `30-${String(70000000 + secuencia * 7919).slice(-8)}-${secuencia % 10}`;
    return ok(entorno.api('POST', '/api/cuentas', { tipo, cuil, nombre }));
  }

  async function detalleCuenta(idCuenta) {
    return ok(entorno.api('GET', `/api/cuentas-corrientes/${idCuenta}`));
  }

  async function saldo(idCuenta) {
    return (await detalleCuenta(idCuenta)).resumen.saldo_final;
  }

  function viajeBase(pagador, extra = {}) {
    secuencia += 1;
    return {
      fecha_origen: '2026-09-01 08:00:00', tipo_carga: 'Soja', origen: 'Rosario', destino: 'Córdoba',
      id_equipo: 1, tarifa: 100000, tipo_tarifa: 'UNICA', comision: 0, estado: 'EN CURSO',
      pagador: pagador.nombre, numero_remito: `TEST-${secuencia}`, ...extra
    };
  }

  // ---------- Facturación ----------

  test('facturar un viaje desde Facturación genera el débito en la cuenta del cliente', async () => {
    const cliente = await crearCuenta('CLIENTE');
    const viaje = await ok(entorno.api('POST', '/api/viajes', viajeBase(cliente, { estado: 'FINALIZADO' })));
    assert.equal(await saldo(cliente.id_cuenta), 0);

    const { id_factura } = await ok(entorno.api('POST', `/api/facturacion/desde-viaje/${viaje.id_viaje}`));
    const [[factura]] = await entorno.pool.query('SELECT total FROM FACTURAS WHERE id_factura = ?', [id_factura]);

    assert.equal(Number(factura.total), 121000);
    assert.equal(await saldo(cliente.id_cuenta), -121000);
    assert.equal((await detalleCuenta(cliente.id_cuenta)).movimientos.length, 1);
  });

  test('la nota de crédito devuelve el saldo del cliente al valor previo a la factura', async () => {
    const cliente = await crearCuenta('CLIENTE');
    const viaje = await ok(entorno.api('POST', '/api/viajes', viajeBase(cliente, { estado: 'FINALIZADO' })));
    const saldoPrevio = await saldo(cliente.id_cuenta);

    const { id_factura } = await ok(entorno.api('POST', `/api/facturacion/desde-viaje/${viaje.id_viaje}`));
    await ok(entorno.api('POST', `/api/facturacion/${id_factura}/nota-credito`, {}));

    assert.equal(await saldo(cliente.id_cuenta), saldoPrevio);
  });

  test('facturar un viaje ya facturado como líquido producto no duplica la deuda', async () => {
    const cliente = await crearCuenta('CLIENTE');
    const viaje = await ok(entorno.api('POST', '/api/viajes', viajeBase(cliente)));
    await ok(entorno.api('PUT', `/api/viajes/${viaje.id_viaje}`, { estado: 'FACTURADO', modo_facturacion: 'LIQUIDO_PRODUCTO' }));
    assert.equal(await saldo(cliente.id_cuenta), -121000);

    await ok(entorno.api('POST', `/api/facturacion/desde-viaje/${viaje.id_viaje}`));

    assert.equal(await saldo(cliente.id_cuenta), -121000);
    assert.equal((await detalleCuenta(cliente.id_cuenta)).movimientos.length, 1);
  });

  // ---------- Vínculo movimiento ↔ viaje ----------

  test('un viaje facturado y luego modificado no duplica la deuda aunque se edite el concepto a mano', async () => {
    const cliente = await crearCuenta('CLIENTE');
    const viaje = await ok(entorno.api('POST', '/api/viajes', viajeBase(cliente)));
    await ok(entorno.api('PUT', `/api/viajes/${viaje.id_viaje}`, { estado: 'FINALIZADO' }));
    await ok(entorno.api('PUT', `/api/viajes/${viaje.id_viaje}`, { estado: 'FACTURADO', modo_facturacion: 'LIQUIDO_PRODUCTO' }));
    assert.equal(await saldo(cliente.id_cuenta), -121000);

    const [mov] = (await detalleCuenta(cliente.id_cuenta)).movimientos;
    await ok(entorno.api('PUT', `/api/movimientos/${mov.id_movimiento}`, { concepto: 'Flete corregido a mano' }));
    await ok(entorno.api('PUT', `/api/viajes/${viaje.id_viaje}`, { tarifa: 200000 }));

    const detalle = await detalleCuenta(cliente.id_cuenta);
    assert.equal(detalle.movimientos.length, 1);
    assert.equal(detalle.resumen.saldo_final, -242000);
  });

  // ---------- Ediciones parciales ----------

  test('editar un consumo sin reenviar el proveedor conserva y actualiza su movimiento', async () => {
    const proveedor = await crearCuenta('PROVEEDOR');
    const consumo = await ok(entorno.api('POST', '/api/consumos-generales', {
      proveedor: proveedor.nombre, fecha: '2026-09-02', id_unidad: 1, concepto: 'Aceite', monto: 1000
    }));
    assert.equal(await saldo(proveedor.id_cuenta), 1000);

    await ok(entorno.api('PUT', `/api/consumos-generales/${consumo.id_consumo_general}`, { monto: 2500 }));

    assert.equal(await saldo(proveedor.id_cuenta), 2500);
  });

  test('el movimiento de una carga de combustible usa los litros tal como quedan guardados', async () => {
    const proveedor = await crearCuenta('PROVEEDOR');
    // La columna guarda 2 decimales: 373.022 L queda en 373.02 L.
    await ok(entorno.api('POST', '/api/consumos-combustible', {
      proveedor: proveedor.nombre, estacion_carga: 'YPF', id_equipo: 1,
      cantidad_litros: 373.022, precio_por_litro: 2550, km_recorridos: 900, fecha: '2026-09-03'
    }));

    assert.equal(await saldo(proveedor.id_cuenta), 951201);
  });

  test('editar solo el teléfono de un chofer actualiza su cuenta sin perder el CUIL', async () => {
    secuencia += 1;
    const cuil = `20-${String(30000000 + secuencia * 104729).slice(-8)}-${secuencia % 10}`;
    const chofer = await ok(entorno.api('POST', '/api/choferes', {
      nombre: `Chofer Test ${secuencia}`, cuil, edad: 40, domicilio: 'Calle 123', vencimiento_carnet: '2027-01-01',
      remuneracion: 10, tipo_remuneracion: 'PORCENTAJE'
    }));

    await ok(entorno.api('PUT', `/api/choferes/${chofer.id_chofer}`, { telefono: '351-0000000' }));

    const [[cuenta]] = await entorno.pool.query(
      "SELECT cuil, nombre, telefono FROM CUENTA WHERE cuil = ? AND tipo = 'CHOFER'", [cuil]);
    assert.equal(cuenta.cuil, cuil);
    assert.equal(cuenta.nombre, `Chofer Test ${secuencia}`);
    assert.equal(cuenta.telefono, '351-0000000');
  });

  // ---------- Atomicidad de los automatismos ----------

  describe('si un automatismo falla, la operación completa se deshace y el error se informa', () => {
    const crudFactory = () => require('../../src/lib/crudFactory');
    let servidor, base;

    before(async () => {
      const falla = async () => { throw new Error('falla simulada del automatismo'); };
      const app = express();
      app.use(express.json());
      app.use((req, res, next) => { req.usuario = { id_empresa: 1 }; next(); });
      app.use('/stock', crudFactory()({
        table: 'STOCK', idField: 'id_stock', fields: ['elemento', 'valuacion', 'deposito'],
        hooks: { afterCreate: falla, afterUpdate: falla, afterDelete: falla }
      }));
      servidor = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
      base = `http://127.0.0.1:${servidor.address().port}/stock`;
    });
    after(() => new Promise(r => servidor.close(r)));

    const pedir = (metodo, url, cuerpo) => fetch(base + url, {
      method: metodo, headers: { 'Content-Type': 'application/json' },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined
    });

    test('alta: no queda el registro', async () => {
      const elemento = `ATOMICO-${Date.now()}`;
      const r = await pedir('POST', '/', { elemento, valuacion: 10, deposito: 'Test' });
      assert.ok(r.status >= 500);
      const [filas] = await entorno.pool.query('SELECT id_stock FROM STOCK WHERE elemento = ?', [elemento]);
      assert.equal(filas.length, 0);
    });

    test('edición y baja: el registro queda como estaba', async () => {
      const elemento = `ATOMICO-B-${Date.now()}`;
      const [res] = await entorno.pool.query(
        "INSERT INTO STOCK (id_empresa, elemento, valuacion, deposito) VALUES (1, ?, 10, 'Test')", [elemento]);

      assert.ok((await pedir('PUT', `/${res.insertId}`, { valuacion: 99 })).status >= 500);
      assert.ok((await pedir('DELETE', `/${res.insertId}`)).status >= 500);

      const [[fila]] = await entorno.pool.query('SELECT valuacion FROM STOCK WHERE id_stock = ?', [res.insertId]);
      assert.equal(Number(fila.valuacion), 10);
    });
  });
});
