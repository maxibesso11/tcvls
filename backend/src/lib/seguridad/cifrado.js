// backend/src/lib/seguridad/cifrado.js
// Cifrado simétrico para material sensible en reposo (claves privadas de los
// certificados de facturación). Usa AES-256-GCM, que además de cifrar detecta
// cualquier manipulación del dato (tag de autenticación).
//
// La clave de cifrado se deriva de una variable de entorno dedicada
// (CERT_SECRET). Debe ser distinta de AUTH_SECRET y guardarse fuera de la base
// de datos: si un atacante obtuviera la base pero no el secreto, no puede
// descifrar las claves privadas.
const crypto = require('crypto');

const SECRETO = process.env.CERT_SECRET
  || process.env.AUTH_SECRET
  || 'cambiar-este-secreto-de-certificados-en-produccion';

// Deriva una clave de 32 bytes (256 bits) a partir del secreto.
function claveDerivada() {
  return crypto.createHash('sha256').update(String(SECRETO)).digest();
}

// Cifra un texto y devuelve una cadena base64 autocontenida: iv + tag + datos.
function cifrar(textoPlano) {
  const iv = crypto.randomBytes(12); // 96 bits, recomendado para GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', claveDerivada(), iv);
  const cifrado = Buffer.concat([cipher.update(String(textoPlano), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, cifrado]).toString('base64');
}

// Descifra lo producido por cifrar(). Lanza si el dato fue manipulado o el
// secreto es incorrecto (el tag GCM no valida).
function descifrar(cadenaBase64) {
  const buf = Buffer.from(String(cadenaBase64), 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const datos = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', claveDerivada(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(datos), decipher.final()]).toString('utf8');
}

// Indica si el secreto sigue siendo el valor por defecto (inseguro).
function secretoInseguro() {
  return !process.env.CERT_SECRET && !process.env.AUTH_SECRET;
}

module.exports = { cifrar, descifrar, secretoInseguro };
