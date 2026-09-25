// backend/src/lib/seguridad/credenciales.js
// Autenticación sin dependencias externas, usando solo el módulo crypto
// nativo de Node. Incluye hashing de contraseñas con scrypt + salt y
// tokens de sesión firmados con HMAC (formato tipo JWT simplificado).
const crypto = require('crypto');

// Secreto para firmar los tokens. Viene SOLO del entorno: sin valor por
// defecto, porque uno conocido permitiría fabricar sesiones. El arranque ya
// lo exige (configuracion.js); esto es una segunda barrera.
function secreto() {
  if (!process.env.AUTH_SECRET) throw new Error('AUTH_SECRET no está configurado.');
  return process.env.AUTH_SECRET;
}
const { DURACION_TOKEN_HORAS } = require('../../config/constantes');

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

// Política mínima para una contraseña nueva. Devuelve el problema o null.
const CONTRASENAS_TRIVIALES = new Set(['admin123', 'demo123', '12345678', '123456789', 'password', 'contraseña', 'qwerty123']);
const LARGO_MINIMO_CONTRASENA = 8;

function problemaContrasenaNueva(contrasena, nombreUsuario) {
  const valor = String(contrasena || '');
  if (valor.length < LARGO_MINIMO_CONTRASENA) {
    return `La contraseña debe tener al menos ${LARGO_MINIMO_CONTRASENA} caracteres.`;
  }
  if (CONTRASENAS_TRIVIALES.has(valor.toLowerCase())) {
    return 'Esa contraseña es demasiado conocida; elegí otra.';
  }
  if (nombreUsuario && valor.toLowerCase() === String(nombreUsuario).toLowerCase()) {
    return 'La contraseña no puede ser igual al nombre de usuario.';
  }
  return null;
}

// ---------- Tokens de sesión ----------

function base64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function firmar(parteCodificada) {
  return crypto.createHmac('sha256', secreto()).update(parteCodificada).digest('base64url');
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
  // Comparación en tiempo constante (no revela cuántos caracteres coinciden).
  const esperada = Buffer.from(firmar(codificado));
  const recibida = Buffer.from(String(firma || ''));
  if (esperada.length !== recibida.length || !crypto.timingSafeEqual(esperada, recibida)) return null;
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
  problemaContrasenaNueva,
  generarToken,
  verificarToken
};
