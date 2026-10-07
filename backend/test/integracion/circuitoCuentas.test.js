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

  // ---------- Historia del equipo (bug reportado en producción) ----------

  test('editar las unidades y el chofer de un equipo no reescribe sus viajes pasados', async () => {
    const cliente = await crearCuenta('CLIENTE');
    const equipo = await ok(entorno.api('POST', '/api/equipos', {
      id_unidad_principal: 3, id_unidad_secundaria: 8, id_chofer: 3
    }));
    const viaje = await ok(entorno.api('POST', '/api/viajes', viajeBase(cliente, { id_equipo: equipo.id_equipo })));

    // El equipo cambia de camión, acoplado y chofer (como pasó en producción).
    await ok(entorno.api('PUT', `/api/equipos/${equipo.id_equipo}`, {
      id_unidad_principal: 4, id_unidad_secundaria: 9, id_chofer: 4
    }));
    // Una edición posterior del viaje tampoco debe tomar la composición nueva.
    await ok(entorno.api('PUT', `/api/viajes/${viaje.id_viaje}`, { estado: 'FINALIZADO' }));

    const guardado = await ok(entorno.api('GET', `/api/viajes/${viaje.id_viaje}`));
    assert.equal(guardado.id_unidad_principal, 3);
    assert.equal(guardado.id_unidad_secundaria, 8);
    assert.equal(guardado.id_chofer, 3);

    // La liquidación va al chofer que hizo el viaje (Roberto Díaz, 18 %).
    const [[liq]] = await entorno.pool.query(
      `SELECT c.nombre, m.monto FROM MOVIMIENTOS m JOIN CUENTA c ON c.id_cuenta = m.id_cuenta
        WHERE m.origen_tipo = 'VIAJE_LIQUIDACION' AND m.origen_id = ?`, [viaje.id_viaje]);
    assert.equal(liq.nombre, 'Roberto Díaz');
    assert.equal(Number(liq.monto), 18000);
  });

  test('el historial del equipo decide la foto de cada viaje según su fecha', async () => {
    const cliente = await crearCuenta('CLIENTE');
    const equipo = await ok(entorno.api('POST', '/api/equipos', {
      id_unidad_principal: 3, id_unidad_secundaria: 8, id_chofer: 3, peso_tara: 1, peso_bruto: 2
    }));
    const antes = await ok(entorno.api('POST', '/api/viajes', viajeBase(cliente, {
      id_equipo: equipo.id_equipo, fecha_origen: '2026-08-10 08:00:00', estado: 'FINALIZADO'
    })));
    const despues = await ok(entorno.api('POST', '/api/viajes', viajeBase(cliente, {
      id_equipo: equipo.id_equipo, fecha_origen: '2026-08-20 08:00:00', estado: 'FINALIZADO'
    })));

    // El cambio de chofer y camión se carga tarde, con su fecha real (15/8).
    await ok(entorno.api('PUT', `/api/equipos/${equipo.id_equipo}`, {
      id_unidad_principal: 4, id_unidad_secundaria: 9, id_chofer: 4, fecha_cambio: '2026-08-15T00:00'
    }));
    const vAntes = await ok(entorno.api('GET', `/api/viajes/${antes.id_viaje}`));
    const vDespues = await ok(entorno.api('GET', `/api/viajes/${despues.id_viaje}`));
    assert.deepEqual([vAntes.id_unidad_principal, vAntes.id_chofer], [3, 3]);
    assert.deepEqual([vDespues.id_unidad_principal, vDespues.id_chofer], [4, 4]);

    // El viaje posterior al cambio ya no se liquida al chofer anterior (Roberto
    // Díaz, 18 %) sino al nuevo (Miguel Torres, sueldo FIJO: sin liquidación).
    const liquidacion = async id => (await entorno.pool.query(
      "SELECT COUNT(*) AS n FROM MOVIMIENTOS WHERE origen_tipo = 'VIAJE_LIQUIDACION' AND origen_id = ?", [id]))[0][0].n;
    assert.equal(Number(await liquidacion(antes.id_viaje)), 1);
    assert.equal(Number(await liquidacion(despues.id_viaje)), 0);

    // Historial: dos períodos; corregir la fecha del cambio al 25/8 devuelve
    // el segundo viaje a la composición anterior (y su liquidación).
    const periodos = await ok(entorno.api('GET', `/api/equipos/${equipo.id_equipo}/historial`));
    assert.equal(periodos.length, 2);
    assert.equal(periodos[0].desde, '2026-08-15 00:00:00');
    assert.equal(Number(periodos[0].viajes), 1);
    const r = await ok(entorno.api('PUT', `/api/equipos/historial/${periodos[0].id_historial}`, { desde: '2026-08-25 00:00:00' }));
    assert.equal(r.viajes_actualizados, 1);
    assert.equal((await ok(entorno.api('GET', `/api/viajes/${despues.id_viaje}`))).id_chofer, 3);
    assert.equal(Number(await liquidacion(despues.id_viaje)), 1);

    // Una fecha anterior al período previo o futura se rechaza con un mensaje claro.
    const futura = await entorno.api('PUT', `/api/equipos/${equipo.id_equipo}`, {
      id_unidad_principal: 5, id_unidad_secundaria: 10, id_chofer: 5, fecha_cambio: '2099-01-01T00:00'
    });
    assert.equal(futura.estado, 400);
  });

  test('los consumos generales de una unidad van al equipo que la tenía en esa fecha', async () => {
    const proveedor = await crearCuenta('PROVEEDOR');
    const unidad = await ok(entorno.api('POST', '/api/unidades', { patente: `H${Date.now() % 100000}`, modelo: 'Test', funcionalidad: 'PRINCIPAL' }));
    const equipo = await ok(entorno.api('POST', '/api/equipos', {
      id_unidad_principal: unidad.id_unidad, id_unidad_secundaria: 6, id_chofer: 2, peso_tara: 1, peso_bruto: 2
    }));
    const consumo = (fecha, monto) => ok(entorno.api('POST', '/api/consumos-generales', {
      proveedor: proveedor.nombre, fecha, id_unidad: unidad.id_unidad, concepto: 'Repuesto', monto
    }));
    await consumo('2026-07-01 10:00:00', 1000);   // con el equipo
    // El camión sale del equipo el 1/8 (queda en el taller)
    await ok(entorno.api('PUT', `/api/equipos/${equipo.id_equipo}`, {
      id_unidad_principal: 1, fecha_cambio: '2026-08-01T00:00'
    }));
    await consumo('2026-08-10 10:00:00', 500);    // en el taller: sin equipo

    const rent = await ok(entorno.api('GET', `/api/dashboard/rentabilidad-equipos?fecha_desde=2026-07-01&fecha_hasta=2026-08-31&id_equipo=${equipo.id_equipo}`));
    assert.equal(rent.equipos[0].costo_generales, 1000);
    const general = await ok(entorno.api('GET', '/api/dashboard/rentabilidad-equipos?fecha_desde=2026-08-10&fecha_hasta=2026-08-10'));
    assert.ok(general.gastos_unidades_sin_equipo >= 500);
  });

  test('un viaje POR TONELADA no se puede facturar con resultado 0', async () => {
    const cliente = await crearCuenta('CLIENTE');
    const viaje = await ok(entorno.api('POST', '/api/viajes', viajeBase(cliente, {
      tipo_tarifa: 'POR TONELADA', tarifa: 60000, cantidad_cargada: 30
    })));
    const r = await entorno.api('PUT', `/api/viajes/${viaje.id_viaje}`, {
      estado: 'FACTURADO', modo_facturacion: 'LIQUIDO_PRODUCTO', resultado: 0
    });
    assert.equal(r.estado, 400);
    assert.equal(await saldo(cliente.id_cuenta), 0);
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
      variable_valor: 10, variable_tipo: 'PORCENTAJE'
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
