// backend/src/integraciones/certificados.js
// Generación del par de claves y la solicitud de certificado (CSR) para la
// facturación electrónica de ARCA, sin depender de OpenSSL en la máquina del
// cliente. Usa node-forge (JavaScript puro).
//
// Flujo por empresa:
//   1. generarClaveYCSR()  → crea la clave privada y el CSR.
//   2. La clave privada se guarda CIFRADA (lib/seguridad/cifrado.js) en la base.
//   3. El cliente descarga el CSR, lo sube a ARCA y obtiene su certificado.
//   4. El certificado (.crt) se guarda asociado a la empresa.
//
// La clave privada nunca sale del servidor ni se expone por la API.
let forge = null;
try { forge = require('node-forge'); } catch (e) { /* se avisa al usarse */ }
const { ErrorNegocio } = require('../lib/errores');

function disponible() { return forge !== null; }

// Genera un par de claves RSA 2048 y un CSR firmado con los datos de la empresa.
// datos: { nombre, cuit } — el CUIT puede venir con guiones, se normaliza.
// Devuelve { clavePrivadaPem, csrPem }.
function generarClaveYCSR(datos) {
  if (!forge) {
    throw new ErrorNegocio('Falta la dependencia node-forge. Instalá con: npm install node-forge', 503);
  }
  const cuitLimpio = String(datos.cuit || '').replace(/\D/g, '');
  if (cuitLimpio.length !== 11) {
    throw new ErrorNegocio('La empresa debe tener un CUIT válido (11 dígitos) antes de generar el certificado.');
  }

  // Par de claves RSA 2048 (el mínimo que acepta ARCA).
  const par = forge.pki.rsa.generateKeyPair(2048);

  // Armar el CSR (PKCS#10) con el subject que espera ARCA.
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = par.publicKey;
  csr.setSubject([
    { name: 'countryName', value: 'AR' },
    { name: 'organizationName', value: (datos.nombre || 'EMPRESA').slice(0, 64) },
    { name: 'commonName', value: `tcv-logisuite-${cuitLimpio}`.slice(0, 64) },
    // serialNumber lleva el CUIT (requisito de ARCA). Se especifica el OID
    // explícito (2.5.4.5) en vez del nombre corto, porque node-forge no siempre
    // reconoce 'serialNumber' por shortName y falla con "Attribute type not
    // specified.". El OID funciona en todas las versiones.
    { type: '2.5.4.5', value: `CUIT ${cuitLimpio}` }
  ]);
  csr.sign(par.privateKey, forge.md.sha256.create());

  return {
    clavePrivadaPem: forge.pki.privateKeyToPem(par.privateKey),
    csrPem: forge.pki.certificationRequestToPem(csr)
  };
}

// Valida que un texto sea un certificado X.509 en formato PEM y extrae su
// fecha de vencimiento. Se usa al subir el .crt devuelto por ARCA.
// Devuelve { valido, fecha_vencimiento, error }.
function analizarCertificado(pem) {
  if (!forge) return { valido: false, error: 'node-forge no está instalado.' };
  try {
    const cert = forge.pki.certificateFromPem(pem);
    return { valido: true, fecha_vencimiento: cert.validity.notAfter };
  } catch (e) {
    return { valido: false, error: 'El archivo no parece un certificado válido (.crt/.pem).' };
  }
}

// Verifica que un certificado corresponda a una clave privada dada
// (comparando el módulo público), para evitar subir un .crt que no pertenece
// al CSR generado.
function certificadoCoincideConClave(certPem, clavePrivadaPem) {
  if (!forge) return false;
  try {
    const cert = forge.pki.certificateFromPem(certPem);
    const clave = forge.pki.privateKeyFromPem(clavePrivadaPem);
    return cert.publicKey.n.toString(16) === clave.n.toString(16);
  } catch (e) {
    return false;
  }
}

module.exports = { disponible, generarClaveYCSR, analizarCertificado, certificadoCoincideConClave };
