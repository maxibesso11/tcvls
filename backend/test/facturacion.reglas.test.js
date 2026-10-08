// backend/test/facturacion.reglas.test.js
// Reglas fiscales de los comprobantes y armado de los pedidos a ARCA, sin red.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const forge = require('node-forge');
const R = require('../src/modulos/facturacion/facturacion.reglas');
const { xmlDetalle } = require('../src/integraciones/arca/wsfe');
const { crearTRA, firmarTRA } = require('../src/integraciones/arca/wsaa');

test('letra: un responsable inscripto emite A a inscriptos y monotributistas, B al resto', () => {
  assert.equal(R.letraComprobante('RESPONSABLE INSCRIPTO', 'RESPONSABLE INSCRIPTO'), 'A');
  assert.equal(R.letraComprobante('RESPONSABLE INSCRIPTO', 'MONOTRIBUTO'), 'A');
  assert.equal(R.letraComprobante('RESPONSABLE INSCRIPTO', 'CONSUMIDOR FINAL'), 'B');
  assert.equal(R.letraComprobante('RESPONSABLE INSCRIPTO', 'EXENTO'), 'B');
});

test('letra: un monotributista o un exento emiten siempre C, nunca A ni B', () => {
  for (const receptor of R.CONDICIONES_RECEPTOR) {
    assert.equal(R.letraComprobante('MONOTRIBUTO', receptor), 'C');
    assert.equal(R.letraComprobante('EXENTO', receptor), 'C');
  }
  // Un monotributista no necesita conocer la condición del receptor.
  assert.equal(R.letraComprobante('MONOTRIBUTO', null), 'C');
});

test('letra: sin condición del emisor o del receptor (inscripto) no se puede emitir', () => {
  assert.throws(() => R.letraComprobante(null, 'RESPONSABLE INSCRIPTO'), /condición frente al IVA de la empresa/);
  assert.throws(() => R.letraComprobante('RESPONSABLE INSCRIPTO', null), /condición frente al IVA del cliente/);
});

test('códigos de comprobante de ARCA', () => {
  assert.equal(R.codigoComprobante('A', 'FACTURA'), 1);
  assert.equal(R.codigoComprobante('A', 'NOTA_CREDITO'), 3);
  assert.equal(R.codigoComprobante('B', 'FACTURA'), 6);
  assert.equal(R.codigoComprobante('B', 'NOTA_CREDITO'), 8);
  assert.equal(R.codigoComprobante('C', 'FACTURA'), 11);
  assert.equal(R.codigoComprobante('C', 'NOTA_CREDITO'), 13);
});

test('CUIT: dígito verificador', () => {
  assert.equal(R.cuitValido('20-45090967-0'), true);     // certificado de homologación
  assert.equal(R.cuitValido('30-71122334-5'), false);
  assert.equal(R.cuitValido('3371922019'), false);         // 10 dígitos
  assert.equal(R.cuitValido('20450909671'), false);
});

test('documento del receptor', () => {
  assert.deepEqual(R.documentoReceptor('A', 'RESPONSABLE INSCRIPTO', '20-45090967-0'), { tipo: 80, numero: '20450909670' });
  assert.throws(() => R.documentoReceptor('A', 'RESPONSABLE INSCRIPTO', '12345678'), /CUIT válido/);
  assert.deepEqual(R.documentoReceptor('B', 'CONSUMIDOR FINAL', '12.345.678'), { tipo: 96, numero: '12345678' });
  assert.deepEqual(R.documentoReceptor('B', 'CONSUMIDOR FINAL', ''), { tipo: 99, numero: '0' });
  assert.throws(() => R.documentoReceptor('B', 'EXENTO', '12345678'), /CUIT válido/);
  assert.throws(() => R.documentoReceptor('A', 'RESPONSABLE INSCRIPTO', '20450909671'), /no es válido/);
});

test('importes: A y B discriminan IVA 21 % y total = neto + IVA exacto; C sin IVA', () => {
  const items = [
    { descripcion: 'Flete Rosario', cantidad: 30.68, unidad: 'tn', precio_unitario: 95000 },
    { descripcion: 'Flete Córdoba', cantidad: 1, precio_unitario: 1000.005 }
  ];
  const a = R.calcularImportes(items, 'A');
  assert.equal(a.neto, 2915600.01);   // 30,68 × 95.000 + 1.000,01 (redondeado)
  assert.equal(a.iva, R.r2(a.neto * 0.21));
  assert.equal(a.total, R.r2(a.neto + a.iva));
  assert.deepEqual(a.alicuotas, [{ id: 5, base: a.neto, importe: a.iva }]);
  const c = R.calcularImportes(items, 'C');
  assert.equal(c.iva, 0);
  assert.equal(c.total, c.neto);
  assert.deepEqual(c.alicuotas, []);
  assert.throws(() => R.calcularImportes([], 'A'), /al menos un renglón/);
  assert.throws(() => R.calcularImportes([{ descripcion: 'x', cantidad: 1, precio_unitario: 0 }], 'A'), /precio/);
});

test('fechas de un comprobante de servicios', () => {
  const ok = { fecha: '2026-10-07', servicioDesde: '2026-10-01', servicioHasta: '2026-10-05', vencimientoPago: '2026-10-30' };
  R.validarFechas(ok, '2026-10-07');
  assert.throws(() => R.validarFechas({ ...ok, fecha: '2026-09-20' }, '2026-10-07'), /10 días/);
  assert.throws(() => R.validarFechas({ ...ok, servicioDesde: '2026-10-06' }, '2026-10-07'), /al revés/);
  assert.throws(() => R.validarFechas({ ...ok, vencimientoPago: '2026-10-06' }, '2026-10-07'), /vencimiento/);
});

test('QR: URL de ARCA con los datos del comprobante en base64', () => {
  const u = R.urlQR({ fecha: '2026-10-07', cuitEmisor: '20-45090967-0', puntoVenta: 1, tipo: 1, numero: 12,
    total: 121000, docTipo: 80, docNro: '30711223345', cae: '76123456789012' });
  assert.ok(u.startsWith('https://www.afip.gob.ar/fe/qr/?p='));
  const datos = JSON.parse(Buffer.from(u.split('p=')[1], 'base64').toString());
  assert.deepEqual(datos, { ver: 1, fecha: '2026-10-07', cuit: 20450909670, ptoVta: 1, tipoCmp: 1, nroCmp: 12,
    importe: 121000, moneda: 'PES', ctz: 1, tipoDocRec: 80, nroDocRec: 30711223345, tipoCodAut: 'E', codAut: 76123456789012 });
});

test('pedido a ARCA: campos en el orden del WSDL, con IVA y comprobante asociado', () => {
  const xml = xmlDetalle({
    concepto: 2, docTipo: 80, docNro: '30711223345', numero: 13, fecha: '20261007',
    total: 121000, neto: 100000, iva: 21000, servicioDesde: '20261001', servicioHasta: '20261005',
    vencimientoPago: '20261030', condicionIvaReceptor: 1,
    asociado: { tipo: 1, puntoVenta: 2, numero: 12, cuit: '20450909670', fecha: '20261006' },
    alicuotas: [{ id: 5, base: 100000, importe: 21000 }]
  });
  const orden = ['Concepto', 'DocTipo', 'DocNro', 'CbteDesde', 'CbteHasta', 'CbteFch', 'ImpTotal', 'ImpTotConc',
    'ImpNeto', 'ImpOpEx', 'ImpTrib', 'ImpIVA', 'FchServDesde', 'FchServHasta', 'FchVtoPago', 'MonId', 'MonCotiz',
    'CondicionIVAReceptorId', 'CbtesAsoc', 'Iva'];
  const posiciones = orden.map(e => xml.indexOf(`<ar:${e}>`));
  assert.ok(posiciones.every(p => p >= 0), 'faltan elementos');
  assert.deepEqual([...posiciones].sort((a, b) => a - b), posiciones, 'elementos fuera de orden');
  assert.match(xml, /<ar:ImpTotal>121000\.00<\/ar:ImpTotal>/);
  assert.match(xml, /<ar:AlicIva><ar:Id>5<\/ar:Id><ar:BaseImp>100000\.00<\/ar:BaseImp><ar:Importe>21000\.00<\/ar:Importe><\/ar:AlicIva>/);
});

test('pedido a ARCA: una factura C no lleva bloque de IVA', () => {
  const xml = xmlDetalle({ concepto: 2, docTipo: 99, docNro: 0, numero: 1, fecha: '20261007', total: 500, neto: 500,
    iva: 0, servicioDesde: '20261001', servicioHasta: '20261001', vencimientoPago: '20261007', condicionIvaReceptor: 5 });
  assert.ok(!xml.includes('<ar:Iva>'));
  assert.match(xml, /<ar:ImpIVA>0\.00<\/ar:ImpIVA>/);
});

test('WSAA: el ticket de pedido se firma con el certificado y se puede verificar', () => {
  const claves = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = claves.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 86400000);
  cert.setSubject([{ name: 'commonName', value: 'test' }]);
  cert.setIssuer([{ name: 'commonName', value: 'test' }]);
  cert.sign(claves.privateKey, forge.md.sha256.create());
  const tra = crearTRA('wsfe');
  assert.match(tra, /<service>wsfe<\/service>/);
  assert.match(tra, /<generationTime>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00<\/generationTime>/);
  const cms = firmarTRA(tra, forge.pki.certificateToPem(cert), forge.pki.privateKeyToPem(claves.privateKey));
  const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(forge.util.decode64(cms)));
  assert.equal(p7.rawCapture.content.value[0].value, tra);
  assert.equal(p7.certificates[0].subject.getField('CN').value, 'test');
});
