// backend/src/lib/seguridad/limiteIntentos.js
// Límite de intentos fallidos de inicio de sesión, en memoria.
//   - Por usuario + IP: tras 5 fallos en 15 minutos se bloquea ese usuario
//     desde esa IP durante 15 minutos.
//   - Por IP: tras 20 fallos en 15 minutos (probando usuarios distintos) se
//     bloquea la IP.
// Un ingreso correcto limpia el contador de ese usuario en esa IP.
// Vive en memoria: alcanza porque la app corre en un solo proceso (PM2 fork);
// si se reinicia, los contadores vuelven a cero.

const VENTANA_MS = 15 * 60 * 1000;
const MAX_POR_USUARIO = 5;
const MAX_POR_IP = 20;

const fallos = new Map(); // clave → { cantidad, desde }

function registroVigente(clave, ahora) {
  const r = fallos.get(clave);
  if (!r) return null;
  if (ahora - r.desde > VENTANA_MS) { fallos.delete(clave); return null; }
  return r;
}

function claves(ip, usuario) {
  return {
    porUsuario: `u:${ip}|${String(usuario || '').toLowerCase()}`,
    porIp: `ip:${ip}`
  };
}

// Devuelve los segundos que faltan para poder reintentar, o 0 si está permitido.
function segundosDeBloqueo(ip, usuario, ahora = Date.now()) {
  const { porUsuario, porIp } = claves(ip, usuario);
  let espera = 0;
  for (const [clave, maximo] of [[porUsuario, MAX_POR_USUARIO], [porIp, MAX_POR_IP]]) {
    const r = registroVigente(clave, ahora);
    if (r && r.cantidad >= maximo) {
      espera = Math.max(espera, Math.ceil((r.desde + VENTANA_MS - ahora) / 1000));
    }
  }
  return espera;
}

function registrarFallo(ip, usuario, ahora = Date.now()) {
  const { porUsuario, porIp } = claves(ip, usuario);
  for (const clave of [porUsuario, porIp]) {
    const r = registroVigente(clave, ahora);
    if (r) r.cantidad += 1;
    else fallos.set(clave, { cantidad: 1, desde: ahora });
  }
}

function registrarExito(ip, usuario) {
  fallos.delete(claves(ip, usuario).porUsuario);
}

// Limpieza periódica de registros vencidos (no mantiene vivo el proceso).
setInterval(() => {
  const ahora = Date.now();
  for (const [clave, r] of fallos) if (ahora - r.desde > VENTANA_MS) fallos.delete(clave);
}, VENTANA_MS).unref();

module.exports = { segundosDeBloqueo, registrarFallo, registrarExito, MAX_POR_USUARIO, MAX_POR_IP };
