// backend/src/lib/seguridad/credenciales.js
// Autenticación sin dependencias externas, usando solo el módulo crypto
// nativo de Node. Incluye hashing de contraseñas con scrypt + salt y
// tokens de sesión firmados con HMAC (formato tipo JWT simplificado).
const crypto = require('crypto');

// Secreto para firmar los tokens. En producción debe venir del entorno.
const SECRETO = process.env.AUTH_SECRET || 'cambiar-este-secreto-en-produccion-3deabril';
const DURACION_TOKEN_HORAS = 12;

// ---------- Hashing de contraseñas ----------

// Genera "salt:hash" a partir de una contraseña en texto plano.
function hashearContrasena(contrasena) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivada = crypto.scryptSync(String(contrasena), salt, 64).toString('hex');
  return `${salt}:${derivada}`;
}

// Verifica una contraseña contra el "salt:hash" guardado.
function verificarContrasena(contrasena, guardado) {
  if (!guardado || !guardado.includes(':')) return false;
  const [salt, hashOriginal] = guardado.split(':');
  const derivada = crypto.scryptSync(String(contrasena), salt, 64).toString('hex');
  // Comparación en tiempo constante
  const a = Buffer.from(derivada, 'hex');
  const b = Buffer.from(hashOriginal, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- Tokens de sesión ----------

function base64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function firmar(parteCodificada) {
  return crypto.createHmac('sha256', SECRETO).update(parteCodificada).digest('base64url');
}

// Crea un token con los datos del usuario (id, rol, id_empresa) y vencimiento.
function generarToken(payload) {
  const cuerpo = {
    ...payload,
    exp: Date.now() + DURACION_TOKEN_HORAS * 3600 * 1000
  };
  const codificado = base64url(cuerpo);
  const firma = firmar(codificado);
  return `${codificado}.${firma}`;
}

// Verifica y decodifica un token. Devuelve el payload o null si es inválido/vencido.
function verificarToken(token) {
  if (!token || !token.includes('.')) return null;
  const [codificado, firma] = token.split('.');
  if (firmar(codificado) !== firma) return null;
  try {
    const cuerpo = JSON.parse(Buffer.from(codificado, 'base64url').toString());
    if (!cuerpo.exp || cuerpo.exp < Date.now()) return null;
    return cuerpo;
  } catch {
    return null;
  }
}

module.exports = {
  hashearContrasena,
  verificarContrasena,
  generarToken,
  verificarToken
};
