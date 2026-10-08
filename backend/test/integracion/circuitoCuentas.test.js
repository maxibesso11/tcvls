// backend/test/integracion/circuitoCuentas.test.js
// Circuito viaje → facturación → cuenta corriente contra una base real
// (descartable). Reproduce los criterios de aceptación del MVP:
//   - Facturar un viaje genera el débito correcto en la cuenta del cliente
//     (con comprobante electrónico: ver facturacion.test.js).
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
    // Consulta la rentabilidad: hace falta quien administra la empresa.
    await entorno.pool.query("UPDATE USUARIOS SET rol = 'ADMIN_EMPRESA' WHERE nombre_usuario = 'demo'");
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

  // La facturación electrónica (comprobantes con ARCA) se prueba en facturacion.test.js.

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

  // Unidades, choferes y equipos propios de cada test: un camión, un acoplado
  // o un chofer no puede estar en dos equipos activos a la vez.
  async function crearUnidad(funcionalidad) {
    secuencia += 1;
    return ok(entorno.api('POST', '/api/unidades', {
      patente: `T${String(Date.now()).slice(-5)}${secuencia}`, modelo: 'Test', funcionalidad
    }));
  }

  async function crearChofer(remuneracion = { variable_tipo: 'PORCENTAJE', variable_valor: 18 }) {
    secuencia += 1;
    const n = String(Date.now()).slice(-6) + String(secuencia).padStart(2, '0');
    return ok(entorno.api('POST', '/api/choferes', {
      nombre: `CHOFER TEST ${n}`, cuil: `20-${n}-1`, edad: 40,
      ultima_jornada_descanso: '2026-09-01', vencimiento_carnet: '2030-01-01',
      domicilio: 'Test', telefono: '000', ...remuneracion
    }));
  }

  async function armarComposicion(remuneracion = { variable_tipo: 'PORCENTAJE', variable_valor: 18 }) {
    const [camion, acoplado, chofer] = await Promise.all([
      crearUnidad('PRINCIPAL'), crearUnidad('SECUNDARIA'), crearChofer(remuneracion)]);
    return {
      id_unidad_principal: camion.id_unidad, id_unidad_secundaria: acoplado.id_unidad,
      id_chofer: chofer.id_chofer, chofer
    };
  }

  async function crearEquipo(composicion) {
    const { chofer, ...datos } = composicion;
    return ok(entorno.api('POST', '/api/equipos', { ...datos, peso_tara: 1, peso_bruto: 2 }));
  }

  const liquidacionDe = async idViaje => (await entorno.pool.query(
    `SELECT c.nombre, m.monto FROM MOVIMIENTOS m JOIN CUENTA c ON c.id_cuenta = m.id_cuenta
      WHERE m.origen_tipo = 'VIAJE_LIQUIDACION' AND m.origen_id = ?`, [idViaje]))[0];

  test('editar las unidades y el chofer de un equipo no reescribe sus viajes pasados', async () => {
    const cliente = await crearCuenta('CLIENTE');
    const a = await armarComposicion();
    const b = await armarComposicion({ sueldo_fijo_mensual: 900000 });
    const equipo = await crearEquipo(a);
    const viaje = await ok(entorno.api('POST', '/api/viajes', viajeBase(cliente, { id_equipo: equipo.id_equipo })));

    // El equipo cambia de camión, acoplado y chofer (como pasó en producción).
    await ok(entorno.api('PUT', `/api/equipos/${equipo.id_equipo}`, {
      id_unidad_principal: b.id_unidad_principal, id_unidad_secundaria: b.id_unidad_secundaria, id_chofer: b.id_chofer
    }));
    // Una edición posterior del viaje tampoco debe tomar la composición nueva.
    await ok(entorno.api('PUT', `/api/viajes/${viaje.id_viaje}`, { estado: 'FINALIZADO' }));

    const guardado = await ok(entorno.api('GET', `/api/viajes/${viaje.id_viaje}`));
    assert.equal(guardado.id_unidad_principal, a.id_unidad_principal);
    assert.equal(guardado.id_unidad_secundaria, a.id_unidad_secundaria);
    assert.equal(guardado.id_chofer, a.id_chofer);

    // La liquidación va al chofer que hizo el viaje (18 % de $100.000).
    const [liq] = await liquidacionDe(viaje.id_viaje);
    assert.equal(liq.nombre, a.chofer.nombre);
    assert.equal(Number(liq.monto), 18000);
  });

  test('el historial del equipo decide la foto de cada viaje según su fecha', async () => {
    const cliente = await crearCuenta('CLIENTE');
    const a = await armarComposicion();
    const b = await armarComposicion({ sueldo_fijo_mensual: 900000 });  // sin parte variable
    const equipo = await crearEquipo(a);
    const antes = await ok(entorno.api('POST', '/api/viajes', viajeBase(cliente, {
      id_equipo: equipo.id_equipo, fecha_origen: '2026-08-10 08:00:00', estado: 'FINALIZADO'
    })));
    const despues = await ok(entorno.api('POST', '/api/viajes', viajeBase(cliente, {
      id_equipo: equipo.id_equipo, fecha_origen: '2026-08-20 08:00:00', estado: 'FINALIZADO'
    })));

    // El cambio de chofer y camión se carga tarde, con su fecha real (15/8).
    await ok(entorno.api('PUT', `/api/equipos/${equipo.id_equipo}`, {
      id_unidad_principal: b.id_unidad_principal, id_unidad_secundaria: b.id_unidad_secundaria,
      id_chofer: b.id_chofer, fecha_cambio: '2026-08-15T00:00'
    }));
    const vAntes = await ok(entorno.api('GET', `/api/viajes/${antes.id_viaje}`));
    const vDespues = await ok(entorno.api('GET', `/api/viajes/${despues.id_viaje}`));
    assert.deepEqual([vAntes.id_unidad_principal, vAntes.id_chofer], [a.id_unidad_principal, a.id_chofer]);
    assert.deepEqual([vDespues.id_unidad_principal, vDespues.id_chofer], [b.id_unidad_principal, b.id_chofer]);

    // El viaje posterior al cambio ya no se liquida al chofer anterior (18 %)
    // sino al nuevo (solo sueldo fijo: sin liquidación por viaje).
    assert.equal((await liquidacionDe(antes.id_viaje)).length, 1);
    assert.equal((await liquidacionDe(despues.id_viaje)).length, 0);

    // Historial: dos períodos; corregir la fecha del cambio al 25/8 devuelve
    // el segundo viaje a la composición anterior (y su liquidación).
    const periodos = await ok(entorno.api('GET', `/api/equipos/${equipo.id_equipo}/historial`));
    assert.equal(periodos.length, 2);
    assert.equal(periodos[0].desde, '2026-08-15 00:00:00');
    assert.equal(Number(periodos[0].viajes), 1);
    const r = await ok(entorno.api('PUT', `/api/equipos/historial/${periodos[0].id_historial}`, { desde: '2026-08-25 00:00:00' }));
    assert.equal(r.viajes_actualizados, 1);
    assert.equal((await ok(entorno.api('GET', `/api/viajes/${despues.id_viaje}`))).id_chofer, a.id_chofer);
    assert.equal((await liquidacionDe(despues.id_viaje)).length, 1);

    // Una fecha de cambio futura se rechaza con un mensaje claro.
    const c = await armarComposicion();
    const futura = await entorno.api('PUT', `/api/equipos/${equipo.id_equipo}`, {
      id_unidad_principal: c.id_unidad_principal, id_unidad_secundaria: c.id_unidad_secundaria,
      id_chofer: c.id_chofer, fecha_cambio: '2099-01-01T00:00'
    });
    assert.equal(futura.estado, 400);
  });

  test('los consumos generales de una unidad van al equipo que la tenía en esa fecha', async () => {
    const proveedor = await crearCuenta('PROVEEDOR');
    const a = await armarComposicion();
    const otroCamion = await crearUnidad('PRINCIPAL');
    const equipo = await crearEquipo(a);
    const consumo = (fecha, monto) => ok(entorno.api('POST', '/api/consumos-generales', {
      proveedor: proveedor.nombre, fecha, id_unidad: a.id_unidad_principal, concepto: 'Repuesto', monto
    }));
    await consumo('2026-07-01 10:00:00', 1000);   // con el equipo
    // El camión sale del equipo el 1/8 (queda en el taller)
    await ok(entorno.api('PUT', `/api/equipos/${equipo.id_equipo}`, {
      id_unidad_principal: otroCamion.id_unidad, fecha_cambio: '2026-08-01T00:00'
    }));
    await consumo('2026-08-10 10:00:00', 500);    // en el taller: sin equipo

    const rent = await ok(entorno.api('GET', `/api/dashboard/rentabilidad-equipos?fecha_desde=2026-07-01&fecha_hasta=2026-08-31&id_equipo=${equipo.id_equipo}`));
    assert.equal(rent.equipos[0].costo_generales, 1000);
    const general = await ok(entorno.api('GET', '/api/dashboard/rentabilidad-equipos?fecha_desde=2026-08-10&fecha_hasta=2026-08-10'));
    assert.ok(general.gastos_unidades_sin_equipo >= 500);
  });

  test('baja de equipo: conserva la historia, libera las unidades y no acepta viajes posteriores', async () => {
    const cliente = await crearCuenta('CLIENTE');
    const a = await armarComposicion();
    const viejo = await crearEquipo(a);

    // El mismo camión no puede estar en dos equipos activos (lo que obligaba
    // a inventar patentes para "liberarlo").
    const duplicado = await entorno.api('POST', '/api/equipos', {
      id_unidad_principal: a.id_unidad_principal, id_unidad_secundaria: (await crearUnidad('SECUNDARIA')).id_unidad,
      id_chofer: (await crearChofer()).id_chofer, peso_tara: 1, peso_bruto: 2
    });
    assert.equal(duplicado.estado, 400);
    assert.match(duplicado.datos.error, /ya está en el equipo/);

    const viaje = await ok(entorno.api('POST', '/api/viajes', viajeBase(cliente, {
      id_equipo: viejo.id_equipo, fecha_origen: '2026-08-10 08:00:00', estado: 'FINALIZADO'
    })));

    // No se puede dar de baja antes de su último viaje.
    const temprana = await entorno.api('POST', `/api/equipos/${viejo.id_equipo}/baja`, { fecha: '2026-08-01 00:00:00' });
    assert.equal(temprana.estado, 400);
    await ok(entorno.api('POST', `/api/equipos/${viejo.id_equipo}/baja`, { fecha: '2026-08-20 00:00:00' }));

    // Dado de baja: no acepta viajes nuevos posteriores a la baja.
    const posterior = await entorno.api('POST', '/api/viajes', viajeBase(cliente, {
      id_equipo: viejo.id_equipo, fecha_origen: '2026-08-25 08:00:00'
    }));
    assert.equal(posterior.estado, 400);

    // El camión y el chofer quedan libres para otro equipo.
    const nuevo = await crearEquipo({ ...a, chofer: undefined });
    assert.ok(nuevo.id_equipo);

    // La historia del viejo queda: su viaje conserva la foto y su liquidación.
    assert.equal((await ok(entorno.api('GET', `/api/viajes/${viaje.id_viaje}`))).id_chofer, a.id_chofer);
    assert.equal((await liquidacionDe(viaje.id_viaje)).length, 1);

    // Rentabilidad: el equipo dado de baja aparece en el período en que trabajó
    // (marcado como baja) y no en uno posterior.
    const agosto = await ok(entorno.api('GET', '/api/dashboard/rentabilidad-equipos?fecha_desde=2026-08-01&fecha_hasta=2026-08-31'));
    const fila = agosto.equipos.find(e => e.id_equipo === viejo.id_equipo);
    assert.ok(fila && fila.activo === false && fila.ingresos === 100000);
    const octubre = await ok(entorno.api('GET', '/api/dashboard/rentabilidad-equipos?fecha_desde=2026-10-01&fecha_hasta=2026-10-31'));
    assert.ok(!octubre.equipos.some(e => e.id_equipo === viejo.id_equipo));

    // No se puede reactivar mientras sus unidades estén en otro equipo activo.
    const reactivar = await entorno.api('POST', `/api/equipos/${viejo.id_equipo}/reactivar`);
    assert.equal(reactivar.estado, 400);
    await ok(entorno.api('POST', `/api/equipos/${nuevo.id_equipo}/baja`, {}));
    await ok(entorno.api('POST', `/api/equipos/${viejo.id_equipo}/reactivar`));
  });

  test('con la facturación apagada no se emiten comprobantes ni se factura "con factura A"', async () => {
    process.env.FACTURACION_HABILITADA = '0';
    try {
      const yo = await ok(entorno.api('GET', '/api/auth/yo'));
      assert.ok(!yo.usuario.modulos.includes('facturacion'));

      const cliente = await crearCuenta('CLIENTE');
      const manual = await entorno.api('POST', '/api/facturacion', {
        id_cuenta: cliente.id_cuenta, items: [{ descripcion: 'Flete', cantidad: 1, precio_unitario: 1000 }]
      });
      assert.equal(manual.estado, 403);

      const viaje = await ok(entorno.api('POST', '/api/viajes', viajeBase(cliente, { estado: 'FINALIZADO' })));
      const conFactura = await entorno.api('PUT', `/api/viajes/${viaje.id_viaje}`, { estado: 'FACTURADO', modo_facturacion: 'FACTURA' });
      assert.equal(conFactura.estado, 400);
      // Lo de siempre sigue andando: facturado líquido producto (con IVA).
      await ok(entorno.api('PUT', `/api/viajes/${viaje.id_viaje}`, { estado: 'FACTURADO', modo_facturacion: 'LIQUIDO_PRODUCTO' }));
      assert.equal(await saldo(cliente.id_cuenta), -121000);
      const [[{ n }]] = await entorno.pool.query('SELECT COUNT(*) AS n FROM FACTURAS WHERE id_cuenta = ?', [cliente.id_cuenta]);
      assert.equal(Number(n), 0);
    } finally {
      process.env.FACTURACION_HABILITADA = '1';
    }
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

  test('el rendimiento de combustible solo usa las cargas con los km cargados', async () => {
    const proveedor = await crearCuenta('PROVEEDOR');
    const equipo = await crearEquipo(await armarComposicion());
    const carga = extra => ok(entorno.api('POST', '/api/consumos-combustible', {
      proveedor: proveedor.nombre, estacion_carga: 'YPF', id_equipo: equipo.id_equipo,
      cantidad_litros: 300, precio_por_litro: 1000, fecha: '2026-09-05', ...extra }));
    await carga({ km_recorridos: 900 });   // 3 km/L: la única carga con km reales
    await carga({});                       // sin km
    await carga({ km_recorridos: 1 });     // km de relleno
    const filas = await ok(entorno.api('GET', '/api/dashboard/rendimiento-equipos'));
    const r = filas.find(f => f.id_equipo === equipo.id_equipo);
    assert.equal(Number(r.km_por_litro), 3);
    assert.equal(Number(r.cargas), 3);
    assert.equal(Number(r.cargas_con_km), 1);
    assert.ok(Math.abs(Number(r.costo_por_km) - 1000 / 3) < 0.01);
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
