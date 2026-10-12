// backend/test/integracion/facturacion.test.js
// Facturación electrónica de punta a punta contra un ARCA simulado
// (arcaSimulado.js) y una base descartable:
//   - el facturador propone el comprobante desde los viajes y se guarda como borrador;
//   - la letra sale de la condición de la empresa y del cliente (A, B o C);
//   - emitir: número de ARCA, CAE, débito en la cuenta, viajes FACTURADO;
//   - rechazo de ARCA: vuelve a borrador sin número;
//   - conexión cortada: se aclara con ARCA (emitido o no) sin duplicar números;
//   - nota de crédito: anula, compensa la cuenta y libera los viajes;
//   - el ticket de acceso se pide una sola vez.
//
// Uso: TEST_DB_PERMITIR_BORRADO=1 TEST_DB_PORT=3307 TEST_DB_PASSWORD=... npm run test:integracion
'use strict';
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const forge = require('node-forge');
const { HABILITADO, MOTIVO_OMISION, levantar } = require('./entorno');
const arcaSimulado = require('./arcaSimulado');

const CUIT_EMPRESA = '20123456786';

function certificadoDePrueba() {
  const claves = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = claves.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86400e3);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400e3);
  const sujeto = [{ name: 'commonName', value: 'tcv-test' }, { type: '2.5.4.5', value: `CUIT ${CUIT_EMPRESA}` }];
  cert.setSubject(sujeto);
  cert.setIssuer([{ name: 'commonName', value: 'Computadores Test' }]);
  cert.sign(claves.privateKey, forge.md.sha256.create());
  return { crt: forge.pki.certificateToPem(cert), key: forge.pki.privateKeyToPem(claves.privateKey) };
}

describe('facturación electrónica', { skip: !HABILITADO && MOTIVO_OMISION }, () => {
  let entorno, arca;
  let secuencia = 0;

  before(async () => {
    arca = arcaSimulado.crear();
    const base = await arca.escuchar();
    process.env.ARCA_WSAA_URL = `${base}/wsaa`;
    process.env.ARCA_WSFE_URL = `${base}/wsfe`;
    process.env.ARCA_PRODUCCION = '0';
    process.env.ARCA_ESPERA_PENDIENTE_MS = '0';
    process.env.ARCA_HORAS_CACHE_ACTIVIDADES = '0';
    entorno = await levantar();
    await entorno.iniciarSesion('demo', 'demo123');
    const cifrado = require('../../src/lib/seguridad/cifrado');
    const { crt, key } = certificadoDePrueba();
    await entorno.pool.query('UPDATE EMPRESAS SET cuit = ?, condicion_iva = ? WHERE id_empresa = 1', [CUIT_EMPRESA, 'RESPONSABLE INSCRIPTO']);
    await entorno.pool.query(
      `INSERT INTO CERTIFICADOS_ARCA (id_empresa, estado, alias, clave_privada_cifrada, certificado_pem, fecha_vencimiento)
       VALUES (1, 'ACTIVO', 'test', ?, ?, DATE_ADD(CURDATE(), INTERVAL 1 YEAR))`, [cifrado.cifrar(key), crt]);
  });
  after(async () => {
    if (entorno) await entorno.cerrar();
    if (arca) await arca.cerrar();
  });

  // ---------- Ayudas ----------

  async function ok(promesa) {
    const r = await promesa;
    assert.ok(r.estado >= 200 && r.estado < 300, `HTTP ${r.estado}: ${JSON.stringify(r.datos)}`);
    return r.datos;
  }

  // CUIT válido distinto para cada cliente.
  function cuitValido(n) {
    const base = `30${String(70000000 + n).padStart(8, '0')}`;
    const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    let v = 11 - (pesos.reduce((s, p, i) => s + p * Number(base[i]), 0) % 11);
    if (v === 11) v = 0;
    if (v === 10) return cuitValido(n + 1);
    return base + v;
  }

  async function cliente(condicion = 'RESPONSABLE INSCRIPTO', documento) {
    secuencia += 1;
    return ok(entorno.api('POST', '/api/cuentas', {
      tipo: 'CLIENTE', nombre: `CLIENTE FE ${secuencia}`, condicion_iva: condicion, plazo_pago_dias: 30,
      cuil: documento || cuitValido(secuencia * 101)
    }));
  }

  async function viajeFinalizado(c, extra = {}) {
    secuencia += 1;
    return ok(entorno.api('POST', '/api/viajes', {
      fecha_origen: '2026-09-01 08:00:00', tipo_carga: 'Soja', origen: 'Rosario', destino: 'Córdoba',
      id_equipo: 1, tarifa: 100000, tipo_tarifa: 'UNICA', comision: 0, estado: 'FINALIZADO',
      pagador: c.nombre, numero_remito: `FE-${secuencia}`, ...extra
    }));
  }

  async function saldo(idCuenta) {
    return (await ok(entorno.api('GET', `/api/cuentas-corrientes/${idCuenta}`))).resumen.saldo_final;
  }

  // Prepara y guarda el borrador de un cliente con esos viajes.
  async function borrador(c, viajes, cambios = {}) {
    const propuesta = await ok(entorno.api('POST', '/api/facturacion/preparar', { id_cuenta: c.id_cuenta, viajes: viajes.map(v => v.id_viaje) }));
    return ok(entorno.api('POST', '/api/facturacion', { ...propuesta, ...cambios }));
  }

  const ultimoPedidoCAE = () => {
    const p = arca.pedidosDe('FECAESolicitar').pop();
    return p.cuerpo.FeCAEReq;
  };

  // ---------- Tests ----------

  test('factura A a un responsable inscripto: borrador editable, emisión, cuenta corriente y viajes', async () => {
    const c = await cliente('RESPONSABLE INSCRIPTO');
    const v1 = await viajeFinalizado(c);
    const v2 = await viajeFinalizado(c, { fecha_origen: '2026-09-03 10:00:00', tipo_tarifa: 'POR TONELADA', tarifa: 20000, resultado: 30.5, comision: 5 });

    const disponibles = await ok(entorno.api('GET', `/api/facturacion/viajes-facturables?id_cuenta=${c.id_cuenta}`));
    assert.deepEqual(disponibles.map(v => v.id_viaje).sort(), [v1.id_viaje, v2.id_viaje].sort());

    const propuesta = await ok(entorno.api('POST', '/api/facturacion/preparar', { id_cuenta: c.id_cuenta, viajes: [v1.id_viaje, v2.id_viaje] }));
    assert.equal(propuesta.letra, 'A');
    assert.equal(propuesta.items.length, 2);
    assert.deepEqual([propuesta.fecha_servicio_desde, propuesta.fecha_servicio_hasta], ['2026-09-01', '2026-09-03']);
    const tn = propuesta.items.find(i => i.id_viaje === v2.id_viaje);
    assert.deepEqual([tn.cantidad, tn.unidad, tn.precio_unitario], [30.5, 'tn', 19000]);

    // El usuario edita la descripción antes de guardar.
    propuesta.items[0].descripcion = 'Flete Rosario → Córdoba (texto editado)';
    const b = await ok(entorno.api('POST', '/api/facturacion', { ...propuesta, observaciones: 'CTG 123' }));
    assert.equal(b.estado, 'BORRADOR');
    assert.equal(b.numero, null);
    assert.equal(b.tipo_comprobante, 'A');
    assert.equal(Number(b.neto_gravado), 679500);   // 100000 + 30,5 × 19000
    assert.equal(Number(b.iva), 142695);
    assert.equal(Number(b.total), 822195);

    // En un borrador, los viajes ya no se ofrecen para otro comprobante.
    const restantes = await ok(entorno.api('GET', `/api/facturacion/viajes-facturables?id_cuenta=${c.id_cuenta}`));
    assert.equal(restantes.length, 0);
    assert.equal(await saldo(c.id_cuenta), 0);

    const f = await ok(entorno.api('POST', `/api/facturacion/${b.id_factura}/emitir`));
    assert.equal(f.estado, 'EMITIDA');
    assert.equal(f.numero, 1);
    assert.match(f.cae, /^\d{14}$/);
    assert.equal(f.entorno, 'HOMOLOGACION');

    const pedido = ultimoPedidoCAE();
    const det = pedido.FeDetReq.FECAEDetRequest;
    assert.equal(pedido.FeCabReq.CbteTipo, '1');
    assert.equal(det.DocTipo, '80');
    assert.equal(det.CondicionIVAReceptorId, '1');
    assert.equal(det.FchServDesde, '20260901');
    assert.equal(det.ImpTotal, '822195.00');
    assert.equal(det.Iva.AlicIva.Id, '5');

    assert.equal(await saldo(c.id_cuenta), -822195);
    const [viajes] = await entorno.pool.query('SELECT estado, modo_facturacion FROM VIAJES WHERE id_viaje IN (?, ?)', [v1.id_viaje, v2.id_viaje]);
    assert.ok(viajes.every(v => v.estado === 'FACTURADO' && v.modo_facturacion === 'FACTURA'));
    const [movs] = await entorno.pool.query(
      `SELECT origen_tipo, monto FROM MOVIMIENTOS WHERE id_cuenta = ?`, [c.id_cuenta]);
    assert.deepEqual(movs.map(m => [m.origen_tipo, Number(m.monto)]), [['FACTURA', -822195]]);

    // El listado de viajes trae el comprobante que los incluye, con el neto de sus renglones.
    const lista = await ok(entorno.api('GET', `/api/viajes?por_pagina=200&fecha_desde=2026-01-01&fecha_hasta=2026-12-31`));
    const fila = lista.datos.find(x => x.id_viaje === v2.id_viaje);
    assert.equal(fila.comprobante.tipo_comprobante, 'A');
    assert.equal(fila.comprobante.numero, f.numero);
    assert.equal(Number(fila.comprobante.neto), 579500);

    const pdf = await entorno.api('GET', `/api/facturacion/${f.id_factura}/pdf`);
    assert.equal(pdf.estado, 200);
    assert.match(pdf.cabeceras.get('content-type'), /pdf/);
  });

  test('un viaje dentro de un comprobante no cambia lo facturado ni se elimina', async () => {
    const c = await cliente();
    const v = await viajeFinalizado(c);
    await borrador(c, [v]);
    const cambio = await entorno.api('PUT', `/api/viajes/${v.id_viaje}`, { tarifa: 1 });
    assert.equal(cambio.estado, 400);
    assert.match(cambio.datos.error, /borrador/);
    const baja = await entorno.api('DELETE', `/api/viajes/${v.id_viaje}`);
    assert.equal(baja.estado, 400);
    // Lo que no afecta a la factura se puede seguir editando.
    await ok(entorno.api('PUT', `/api/viajes/${v.id_viaje}`, { tipo_carga: 'Maíz' }));
  });

  test('un viaje de otro cliente o no finalizado no entra en el comprobante', async () => {
    const c = await cliente();
    const otro = await cliente();
    const ajeno = await viajeFinalizado(otro);
    const enCurso = await viajeFinalizado(c, { estado: 'EN CURSO' });
    for (const v of [ajeno, enCurso]) {
      const r = await entorno.api('POST', '/api/facturacion/preparar', { id_cuenta: c.id_cuenta, viajes: [v.id_viaje] });
      assert.equal(r.estado, 400);
    }
  });

  test('factura B a consumidor final con DNI: IVA discriminado ante ARCA, receptor 5', async () => {
    const c = await cliente('CONSUMIDOR FINAL', '28456789');
    const v = await viajeFinalizado(c);
    const b = await borrador(c, [v]);
    assert.equal(b.tipo_comprobante, 'B');
    const f = await ok(entorno.api('POST', `/api/facturacion/${b.id_factura}/emitir`));
    assert.equal(f.estado, 'EMITIDA');
    const pedido = ultimoPedidoCAE();
    assert.equal(pedido.FeCabReq.CbteTipo, '6');
    assert.equal(pedido.FeDetReq.FECAEDetRequest.DocTipo, '96');
    assert.equal(pedido.FeDetReq.FECAEDetRequest.CondicionIVAReceptorId, '5');
    assert.equal(Number(f.total), 121000);
  });

  test('una empresa monotributista emite siempre C (sin IVA), y nunca A ni B', async () => {
    const c = await cliente('RESPONSABLE INSCRIPTO');
    const v = await viajeFinalizado(c);
    const bA = await borrador(c, [v]);
    assert.equal(bA.tipo_comprobante, 'A');

    await entorno.pool.query(`UPDATE EMPRESAS SET condicion_iva = 'MONOTRIBUTO' WHERE id_empresa = 1`);
    try {
      // El borrador A quedó viejo: no se puede emitir con la condición nueva.
      const r = await entorno.api('POST', `/api/facturacion/${bA.id_factura}/emitir`);
      assert.equal(r.estado, 400);
      assert.match(r.datos.error, /corresponde comprobante C/);
      assert.equal(arca.pedidosDe('FECAESolicitar').filter(p => p.cuerpo.FeCAEReq.FeCabReq.CbteTipo === '1').length, 1);

      const actualizado = await ok(entorno.api('PUT', `/api/facturacion/${bA.id_factura}`, { ...bA, viajes: [v.id_viaje] }));
      assert.equal(actualizado.tipo_comprobante, 'C');
      assert.equal(Number(actualizado.iva), 0);
      assert.equal(Number(actualizado.total), 100000);
      const f = await ok(entorno.api('POST', `/api/facturacion/${bA.id_factura}/emitir`));
      assert.equal(f.codigo_arca, 11);
      const det = ultimoPedidoCAE().FeDetReq.FECAEDetRequest;
      assert.equal(det.Iva, undefined);
      assert.equal(det.ImpIVA, '0.00');
      assert.equal(await saldo(c.id_cuenta), -100000);
    } finally {
      await entorno.pool.query(`UPDATE EMPRESAS SET condicion_iva = 'RESPONSABLE INSCRIPTO' WHERE id_empresa = 1`);
    }
  });

  test('si ARCA rechaza, el comprobante vuelve a borrador sin número y con el motivo', async () => {
    const c = await cliente();
    const v = await viajeFinalizado(c);
    const b = await borrador(c, [v]);
    arca.programar('FECAESolicitar', 'rechazar');
    const r = await entorno.api('POST', `/api/facturacion/${b.id_factura}/emitir`);
    assert.equal(r.estado, 422);
    assert.match(r.datos.error, /Rechazo programado/);
    const despues = await ok(entorno.api('GET', `/api/facturacion/${b.id_factura}`));
    assert.equal(despues.estado, 'BORRADOR');
    assert.equal(despues.numero, null);
    assert.ok(despues.respuesta_arca.observaciones.length);
    assert.equal(await saldo(c.id_cuenta), 0);

    const f = await ok(entorno.api('POST', `/api/facturacion/${b.id_factura}/emitir`));
    assert.equal(f.estado, 'EMITIDA');
  });

  test('conexión cortada después de autorizar: se confirma con ARCA y queda emitido', async () => {
    const c = await cliente();
    const v = await viajeFinalizado(c);
    const b = await borrador(c, [v]);
    arca.programar('FECAESolicitar', 'cortar-procesado');
    const f = await ok(entorno.api('POST', `/api/facturacion/${b.id_factura}/emitir`));
    assert.equal(f.estado, 'EMITIDA');
    assert.ok(f.cae);
    assert.equal(await saldo(c.id_cuenta), -121000);
  });

  test('conexión cortada sin autorizar: queda pendiente, bloquea el número y después se libera', async () => {
    process.env.ARCA_ESPERA_PENDIENTE_MS = '600000';
    try {
      const c = await cliente();
      const v1 = await viajeFinalizado(c);
      const v2 = await viajeFinalizado(c);
      const b1 = await borrador(c, [v1]);
      const b2 = await borrador(c, [v2]);
      arca.programar('FECAESolicitar', 'cortar-sin-procesar');
      const r = await entorno.api('POST', `/api/facturacion/${b1.id_factura}/emitir`);
      assert.equal(r.estado, 502);
      assert.match(r.datos.error, /PENDIENTE/);
      const pendiente = await ok(entorno.api('GET', `/api/facturacion/${b1.id_factura}`));
      assert.equal(pendiente.estado, 'PENDIENTE');

      // Otro comprobante del mismo tipo no puede tomar el mismo número.
      const otro = await entorno.api('POST', `/api/facturacion/${b2.id_factura}/emitir`);
      assert.equal(otro.estado, 409);

      // Pasado el tiempo de espera, ARCA sigue sin tenerlo: vuelve a borrador.
      process.env.ARCA_ESPERA_PENDIENTE_MS = '0';
      const verificado = await ok(entorno.api('POST', `/api/facturacion/${b1.id_factura}/verificar`));
      assert.equal(verificado.estado, 'BORRADOR');
      const f1 = await ok(entorno.api('POST', `/api/facturacion/${b1.id_factura}/emitir`));
      const f2 = await ok(entorno.api('POST', `/api/facturacion/${b2.id_factura}/emitir`));
      assert.equal(f2.numero, f1.numero + 1);
      assert.equal(f1.numero, pendiente.numero);
    } finally {
      process.env.ARCA_ESPERA_PENDIENTE_MS = '0';
    }
  });

  test('la nota de crédito anula la factura, compensa la cuenta y libera los viajes', async () => {
    const c = await cliente();
    const v = await viajeFinalizado(c);
    const [[antes]] = await entorno.pool.query(
      `SELECT COUNT(*) AS n, COALESCE(SUM(monto), 0) AS total FROM MOVIMIENTOS WHERE origen_tipo = 'VIAJE_LIQUIDACION' AND origen_id = ?`, [v.id_viaje]);
    const b = await borrador(c, [v]);
    const f = await ok(entorno.api('POST', `/api/facturacion/${b.id_factura}/emitir`));

    const nc = await ok(entorno.api('POST', `/api/facturacion/${f.id_factura}/nota-credito`, {}));
    assert.equal(nc.estado, 'EMITIDA');
    assert.equal(nc.clase, 'NOTA_CREDITO');
    assert.equal(nc.codigo_arca, 3);
    const asoc = ultimoPedidoCAE().FeDetReq.FECAEDetRequest.CbtesAsoc.CbteAsoc;
    assert.deepEqual([asoc.Tipo, asoc.Nro, asoc.Cuit], ['1', String(f.numero), CUIT_EMPRESA]);

    const anulada = await ok(entorno.api('GET', `/api/facturacion/${f.id_factura}`));
    assert.equal(anulada.estado, 'ANULADA');
    assert.equal(await saldo(c.id_cuenta), 0);
    const [[viaje]] = await entorno.pool.query('SELECT estado FROM VIAJES WHERE id_viaje = ?', [v.id_viaje]);
    assert.equal(viaje.estado, 'FINALIZADO');
    const disponibles = await ok(entorno.api('GET', `/api/facturacion/viajes-facturables?id_cuenta=${c.id_cuenta}`));
    assert.deepEqual(disponibles.map(x => x.id_viaje), [v.id_viaje]);
    // La liquidación del chofer no cambia.
    const [[despues]] = await entorno.pool.query(
      `SELECT COUNT(*) AS n, COALESCE(SUM(monto), 0) AS total FROM MOVIMIENTOS WHERE origen_tipo = 'VIAJE_LIQUIDACION' AND origen_id = ?`, [v.id_viaje]);
    assert.deepEqual(despues, antes);

    const otraVez = await entorno.api('POST', `/api/facturacion/${f.id_factura}/nota-credito`, {});
    assert.equal(otraVez.estado, 400);
  });

  test('un borrador se elimina; un comprobante emitido no', async () => {
    const c = await cliente();
    const v = await viajeFinalizado(c);
    const b = await borrador(c, [v]);
    await ok(entorno.api('DELETE', `/api/facturacion/${b.id_factura}`));
    const b2 = await borrador(c, [v]);
    await ok(entorno.api('POST', `/api/facturacion/${b2.id_factura}/emitir`));
    const r = await entorno.api('DELETE', `/api/facturacion/${b2.id_factura}`);
    assert.equal(r.estado, 400);
  });

  test('se le factura también a un proveedor que paga viajes (otro transportista)', async () => {
    secuencia += 1;
    const p = await ok(entorno.api('POST', '/api/cuentas', {
      tipo: 'PROVEEDOR', nombre: `TRANSPORTADORA FE ${secuencia}`, condicion_iva: 'RESPONSABLE INSCRIPTO', cuil: cuitValido(secuencia * 101)
    }));
    const v = await viajeFinalizado(p);
    const cuentas = await ok(entorno.api('GET', '/api/facturacion/cuentas'));
    const fila = cuentas.find(c => c.id_cuenta === p.id_cuenta);
    assert.equal(fila.viajes_pendientes, 1);
    assert.ok(!cuentas.some(c => c.tipo === 'PROVEEDOR' && c.nombre === 'YPF'), 'un proveedor que no paga viajes no aparece');
    const f = await ok(entorno.api('POST', `/api/facturacion/${(await borrador(p, [v])).id_factura}/emitir`));
    assert.equal(f.estado, 'EMITIDA');
    assert.equal(await saldo(p.id_cuenta), -121000);
  });

  test('se factura a un cliente nuevo cargando sus datos: queda dado de alta y no se duplica', async () => {
    const cuit = cuitValido(9091);
    const datos = {
      cliente_nuevo: { nombre: 'Cliente Ocasional SA', domicilio: 'Rosario', documento: cuit },
      receptor_condicion_iva: 'RESPONSABLE INSCRIPTO',
      items: [{ descripcion: 'Estadía en planta', cantidad: 1, unidad: 'día', precio_unitario: 50000 }],
      fecha_emision: new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)
    };
    const b = await ok(entorno.api('POST', '/api/facturacion', datos));
    assert.equal(b.tipo_comprobante, 'A');
    const [[cuenta]] = await entorno.pool.query('SELECT * FROM CUENTA WHERE id_cuenta = ?', [b.id_cuenta]);
    assert.deepEqual([cuenta.tipo, cuenta.nombre, cuenta.condicion_iva], ['CLIENTE', 'Cliente Ocasional SA', 'RESPONSABLE INSCRIPTO']);
    // Otro comprobante con el mismo CUIT usa la misma cuenta.
    const b2 = await ok(entorno.api('POST', '/api/facturacion', datos));
    assert.equal(b2.id_cuenta, b.id_cuenta);
    const f = await ok(entorno.api('POST', `/api/facturacion/${b.id_factura}/emitir`));
    assert.equal(f.estado, 'EMITIDA');
    assert.equal(await saldo(b.id_cuenta), -60500);
    // Un CUIT inválido no da de alta nada.
    const malo = await entorno.api('POST', '/api/facturacion', { ...datos, cliente_nuevo: { ...datos.cliente_nuevo, documento: '20111111111' } });
    assert.equal(malo.estado, 400);
  });

  test('actividad de ARCA: con varias hay que elegir una, se manda en el CAE y la NC la repite', async () => {
    arca.estado.actividades = [{ id: 492221, orden: 1, desc: 'Transporte automotor de cereales' }, { id: 522099, orden: 2, desc: 'Servicios de logística' }];
    try {
      const lista = await ok(entorno.api('GET', '/api/facturacion/actividades'));
      assert.deepEqual(lista.map(x => x.id), [492221, 522099]);
      const c = await cliente();
      const v = await viajeFinalizado(c);
      const propuesta = await ok(entorno.api('POST', '/api/facturacion/preparar', { id_cuenta: c.id_cuenta, viajes: [v.id_viaje] }));
      const sinElegir = await entorno.api('POST', '/api/facturacion', propuesta);
      assert.equal(sinElegir.estado, 400);
      assert.match(sinElegir.datos.error, /actividad/);
      const b = await ok(entorno.api('POST', '/api/facturacion', { ...propuesta, actividad_id: 522099 }));
      assert.deepEqual([b.actividad_id, b.actividad_descripcion], [522099, 'Servicios de logística']);
      const f = await ok(entorno.api('POST', `/api/facturacion/${b.id_factura}/emitir`));
      assert.equal(f.estado, 'EMITIDA');
      assert.equal(ultimoPedidoCAE().FeDetReq.FECAEDetRequest.Actividades.Actividad.Id, '522099');
      // La próxima factura a ese cliente propone la misma actividad.
      const v2 = await viajeFinalizado(c);
      const otra = await ok(entorno.api('POST', '/api/facturacion/preparar', { id_cuenta: c.id_cuenta, viajes: [v2.id_viaje] }));
      assert.equal(otra.actividad_id, 522099);
      const nc = await ok(entorno.api('POST', `/api/facturacion/${f.id_factura}/nota-credito`, {}));
      assert.equal(nc.actividad_id, 522099);
      assert.equal(ultimoPedidoCAE().FeDetReq.FECAEDetRequest.Actividades.Actividad.Id, '522099');
    } finally {
      arca.estado.actividades = [];
    }
  });

  test('el ticket de acceso de ARCA se pidió una sola vez en todos los tests', () => {
    assert.equal(arca.estado.logins, 1);
  });
});
