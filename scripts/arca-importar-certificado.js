#!/usr/bin/env node
// scripts/arca-importar-certificado.js
// Carga en una empresa un certificado de ARCA y su clave privada que ya
// existen (generados fuera del sistema). La clave se guarda cifrada con
// CERT_SECRET, igual que las que genera el sistema. Verifica que el
// certificado corresponda a la clave y al CUIT de la empresa.
//
// Uso (desde la raíz, con el .env de la base):
//   node scripts/arca-importar-certificado.js --empresa 2 --crt certificado.crt --key clave.key
// En Docker:
//   docker compose run --rm -v "$PWD/cert:/cert:ro" app \
//     node scripts/arca-importar-certificado.js --empresa 2 --crt /cert/x.crt --key /cert/x.key
'use strict';
const fs = require('fs');
const forge = require('node-forge');
const pool = require('../backend/src/config/db');
const cifrado = require('../backend/src/lib/seguridad/cifrado');
const certs = require('../backend/src/integraciones/certificados');

const arg = n => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null; };
const idEmpresa = Number(arg('empresa'));
const rutaCrt = arg('crt');
const rutaKey = arg('key');

async function main() {
  if (!idEmpresa || !rutaCrt || !rutaKey) throw new Error('Uso: --empresa N --crt certificado.crt --key clave.key');
  const crt = fs.readFileSync(rutaCrt, 'utf8').trim();
  const key = fs.readFileSync(rutaKey, 'utf8').trim();

  const analisis = certs.analizarCertificado(crt);
  if (!analisis.valido) throw new Error(analisis.error);
  if (!certs.certificadoCoincideConClave(crt, key)) throw new Error('El certificado no corresponde a la clave privada.');

  const cert = forge.pki.certificateFromPem(crt);
  const serial = (cert.subject.attributes.find(a => a.type === '2.5.4.5') || {}).value || '';
  const cuitCert = serial.replace(/\D/g, '');
  const emisor = (cert.issuer.getField('CN') || {}).value || '';
  const [[empresa]] = await pool.query('SELECT nombre, cuit FROM EMPRESAS WHERE id_empresa = ?', [idEmpresa]);
  if (!empresa) throw new Error(`No existe la empresa ${idEmpresa}.`);
  if (String(empresa.cuit || '').replace(/\D/g, '') !== cuitCert) {
    throw new Error(`El certificado es del CUIT ${cuitCert} y la empresa "${empresa.nombre}" tiene ${empresa.cuit}.`);
  }

  const vence = new Date(analisis.fecha_vencimiento).toISOString().slice(0, 10);
  await pool.query('DELETE FROM CERTIFICADOS_ARCA WHERE id_empresa = ?', [idEmpresa]);
  await pool.query(
    `INSERT INTO CERTIFICADOS_ARCA (id_empresa, estado, alias, clave_privada_cifrada, certificado_pem, fecha_vencimiento)
     VALUES (?, 'ACTIVO', ?, ?, ?, ?)`,
    [idEmpresa, `importado-${cuitCert}`, cifrado.cifrar(key), crt, vence]);
  console.log(`✓ Certificado cargado en "${empresa.nombre}" (CUIT ${cuitCert}), emitido por "${emisor}", vence ${vence}.`);
  console.log(/Test/i.test(emisor)
    ? '  Es un certificado de HOMOLOGACIÓN: sirve solo con ARCA_PRODUCCION vacío o en 0.'
    : '  Es un certificado de PRODUCCIÓN: sirve solo con ARCA_PRODUCCION=1.');
}

main().catch(err => { console.error('✗ ' + err.message); process.exitCode = 1; }).finally(() => pool.end());
