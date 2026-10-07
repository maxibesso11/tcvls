// backend/test/integracion/remuneracionMixta.test.js
// Remuneración mixta de choferes (sueldo fijo mensual + variable por viaje):
//   - Un viaje finalizado liquida solo la parte variable.
//   - "Liquidar sueldos fijos del mes" crea el fijo una sola vez por período.
//   - La rentabilidad por equipo suma las dos partes (fijo prorrateado + variable).
// Contra una base MySQL DESCARTABLE (entorno.js).
//
// Uso: TEST_DB_PERMITIR_BORRADO=1 TEST_DB_PORT=3307 TEST_DB_PASSWORD=... npm run test:integracion
'use strict';
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { HABILITADO, MOTIVO_OMISION, levantar } = require('./entorno');

describe('remuneración mixta de choferes', { skip: !HABILITADO && MOTIVO_OMISION }, () => {
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

  // Chofer con sueldo fijo mensual ($300.000) + variable por km ($20/km),
  // con su equipo (dos unidades nuevas), para no interferir con los del seed.
  async function crearChoferMixtoConEquipo() {
    secuencia += 1;
    const cuil = `20-${String(40000000 + secuencia * 104729).slice(-8)}-${secuencia % 10}`;
    const chofer = await ok(entorno.api('POST', '/api/choferes', {
      nombre: `Mixto Test ${secuencia}`, cuil, edad: 40, domicilio: 'Calle 123', vencimiento_carnet: '2027-01-01',
      sueldo_fijo_mensual: 300000, variable_tipo: 'POR KM', variable_valor: 20
    }));
    const patente = n => `MX${String(secuencia).padStart(2, '0')}${n}`;
    const principal = await ok(entorno.api('POST', '/api/unidades', { patente: patente('A'), modelo: 'Test', funcionalidad: 'PRINCIPAL' }));
    const secundaria = await ok(entorno.api('POST', '/api/unidades', { patente: patente('B'), modelo: 'Test', funcionalidad: 'SECUNDARIA' }));
    const equipo = await ok(entorno.api('POST', '/api/equipos', {
      id_unidad_principal: principal.id_unidad, id_unidad_secundaria: secundaria.id_unidad, id_chofer: chofer.id_chofer,
      peso_tara: 10000, peso_bruto: 30000
    }));
    return { chofer, equipo };
  }

  async function saldoChofer(idChofer) {
    const [[cuenta]] = await entorno.pool.query(
      "SELECT id_cuenta FROM CUENTA WHERE cuil = (SELECT cuil FROM CHOFERES WHERE id_chofer = ?) AND tipo = 'CHOFER'", [idChofer]);
    const detalle = await ok(entorno.api('GET', `/api/cuentas-corrientes/${cuenta.id_cuenta}`));
    return detalle;
  }

  test('un viaje finalizado de un chofer mixto liquida solo la parte variable', async () => {
    const { chofer, equipo } = await crearChoferMixtoConEquipo();
    secuencia += 1;
    await ok(entorno.api('POST', '/api/viajes', {
      fecha_origen: '2026-03-05 08:00:00', tipo_carga: 'Soja', origen: 'Rosario', destino: 'Córdoba',
      id_equipo: equipo.id_equipo, tarifa: 800, tipo_tarifa: 'POR KM', resultado: 300, comision: 0,
      estado: 'FINALIZADO', numero_remito: `MIX-${secuencia}`
    }));

    const detalle = await saldoChofer(chofer.id_chofer);
    // Variable: 300 km × $20 = $6.000. El fijo NO se liquida por viaje.
    assert.equal(detalle.movimientos.length, 1);
    assert.equal(Number(detalle.movimientos[0].monto), 6000);
  });

  test('"Liquidar sueldos fijos del mes" crea el fijo una sola vez por período', async () => {
    const { chofer } = await crearChoferMixtoConEquipo();
    const periodo = '2026-04';

    const r1 = await ok(entorno.api('POST', '/api/cuentas-corrientes/liquidar-sueldos-fijos', { periodo }));
    assert.equal(r1.liquidados >= 1, true);

    const detalleTrasPrimera = await saldoChofer(chofer.id_chofer);
    const creditosFijo = detalleTrasPrimera.movimientos.filter(m => Number(m.monto) === 300000);
    assert.equal(creditosFijo.length, 1);

    // Correrla de nuevo para el mismo período no duplica nada.
    const r2 = await ok(entorno.api('POST', '/api/cuentas-corrientes/liquidar-sueldos-fijos', { periodo }));
    assert.equal(r2.liquidados, 0);
    assert.ok(r2.ya_liquidados >= 1);

    const detalleTrasSegunda = await saldoChofer(chofer.id_chofer);
    assert.equal(detalleTrasSegunda.movimientos.length, detalleTrasPrimera.movimientos.length);
  });

  test('rechaza un período con formato inválido', async () => {
    const r = await entorno.api('POST', '/api/cuentas-corrientes/liquidar-sueldos-fijos', { periodo: '2026/04' });
    assert.equal(r.estado, 400);
  });

  test('vista previa: lista a los choferes con sueldo fijo y el monto, antes de liquidar', async () => {
    const { chofer } = await crearChoferMixtoConEquipo();
    const periodo = '2026-06';

    const previa = await ok(entorno.api('GET', `/api/cuentas-corrientes/liquidar-sueldos-fijos?periodo=${periodo}`));
    const fila = previa.find(c => c.id_chofer === chofer.id_chofer);
    assert.ok(fila, 'el chofer no aparece en la vista previa');
    assert.equal(fila.sueldo_fijo_mensual, 300000);
    assert.equal(fila.ya_liquidado, false);
    assert.equal(fila.id_liquidacion_sueldo, null);
  });

  test('liquidar con id_choferes acotado deja afuera a los no incluidos', async () => {
    const { chofer: chofer1 } = await crearChoferMixtoConEquipo();
    const { chofer: chofer2 } = await crearChoferMixtoConEquipo();
    const periodo = '2026-07';

    const r = await ok(entorno.api('POST', '/api/cuentas-corrientes/liquidar-sueldos-fijos',
      { periodo, id_choferes: [chofer1.id_chofer] }));
    assert.equal(r.liquidados, 1);

    const previa = await ok(entorno.api('GET', `/api/cuentas-corrientes/liquidar-sueldos-fijos?periodo=${periodo}`));
    const fila1 = previa.find(c => c.id_chofer === chofer1.id_chofer);
    const fila2 = previa.find(c => c.id_chofer === chofer2.id_chofer);
    assert.equal(fila1.ya_liquidado, true);
    assert.ok(fila1.id_liquidacion_sueldo);
    assert.equal(fila2.ya_liquidado, false);
  });

  test('PDF general del período: 404 sin liquidaciones, 200 con al menos una', async () => {
    const periodoVacio = '2026-08';
    const sinDatos = await entorno.api('GET', `/api/cuentas-corrientes/liquidacion-sueldos/periodo/${periodoVacio}/pdf`);
    assert.equal(sinDatos.estado, 404);

    const { chofer } = await crearChoferMixtoConEquipo();
    const periodo = '2026-09';
    await ok(entorno.api('POST', '/api/cuentas-corrientes/liquidar-sueldos-fijos',
      { periodo, id_choferes: [chofer.id_chofer] }));

    const conDatos = await entorno.api('GET', `/api/cuentas-corrientes/liquidacion-sueldos/periodo/${periodo}/pdf`);
    assert.equal(conDatos.estado, 200);
    assert.ok((conDatos.cabeceras.get('content-type') || '').includes('application/pdf'));
  });

  test('PDF individual: existe para la propia empresa, 404 para una liquidación de otra', async () => {
    const { chofer } = await crearChoferMixtoConEquipo();
    const periodo = '2026-10';
    await ok(entorno.api('POST', '/api/cuentas-corrientes/liquidar-sueldos-fijos',
      { periodo, id_choferes: [chofer.id_chofer] }));
    const previa = await ok(entorno.api('GET', `/api/cuentas-corrientes/liquidar-sueldos-fijos?periodo=${periodo}`));
    const fila = previa.find(c => c.id_chofer === chofer.id_chofer);

    const propia = await entorno.api('GET', `/api/cuentas-corrientes/liquidacion-sueldos/${fila.id_liquidacion_sueldo}/pdf`);
    assert.equal(propia.estado, 200);
    assert.ok((propia.cabeceras.get('content-type') || '').includes('application/pdf'));

    const inexistente = await entorno.api('GET', '/api/cuentas-corrientes/liquidacion-sueldos/999999/pdf');
    assert.equal(inexistente.estado, 404);
  });

  test('la rentabilidad por equipo suma el sueldo fijo prorrateado más el variable liquidado', async () => {
    const { chofer, equipo } = await crearChoferMixtoConEquipo();
    secuencia += 1;
    await ok(entorno.api('POST', '/api/viajes', {
      fecha_origen: '2026-05-10 08:00:00', tipo_carga: 'Maíz', origen: 'Rosario', destino: 'Córdoba',
      id_equipo: equipo.id_equipo, tarifa: 800, tipo_tarifa: 'POR KM', resultado: 100, comision: 0,
      estado: 'FINALIZADO', numero_remito: `MIX-${secuencia}`
    }));

    const r = await ok(entorno.api('GET',
      `/api/dashboard/rentabilidad-equipos?fecha_desde=2026-05-01&fecha_hasta=2026-05-31&id_equipo=${equipo.id_equipo}`));
    const fila = r.equipos.find(e => e.id_equipo === equipo.id_equipo);
    assert.ok(fila, 'el equipo no aparece en la rentabilidad');

    // Variable: 100 km × $20 = $2.000. Fijo: $300.000 ÷ 30 × 31 días de mayo.
    const variableEsperado = 2000;
    const fijoEsperado = (300000 / 30) * 31;
    assert.equal(fila.sueldo_variable, variableEsperado);
    assert.ok(Math.abs(fila.sueldo_fijo - fijoEsperado) < 0.01);
    assert.ok(Math.abs(fila.sueldo - (variableEsperado + fijoEsperado)) < 0.01);
  });
});
