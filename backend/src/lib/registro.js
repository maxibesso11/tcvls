// backend/src/lib/registro.js
// Memoria de los mensajes del servidor (console.log / info / warn / error)
// para que el administrador los consulte desde el panel (Administración →
// Registros) sin entrar al servidor. Guarda solo los últimos LIMITE y sigue
// imprimiendo por consola como siempre. Se reinicia con cada arranque: el
// historial completo sigue en los logs de Docker o de PM2.
const util = require('util');

const LIMITE = 2000;
const entradas = [];
let siguiente = 1;
let instalado = false;

const NIVELES = { log: 'info', info: 'info', warn: 'aviso', error: 'error' };

function instalar() {
  if (instalado) return;
  instalado = true;
  Object.keys(NIVELES).forEach(metodo => {
    const original = console[metodo].bind(console);
    console[metodo] = (...args) => {
      original(...args);
      try {
        entradas.push({ id: siguiente++, fecha: new Date().toISOString(), nivel: NIVELES[metodo], mensaje: util.format(...args) });
        if (entradas.length > LIMITE) entradas.splice(0, entradas.length - LIMITE);
      } catch (e) { /* el registro nunca debe romper al servidor */ }
    };
  });
}

// Más nuevas primero. nivel: 'info' | 'aviso' | 'error' | vacío (todos).
function consultar({ nivel = '', q = '', limite = 300 } = {}) {
  const texto = String(q || '').trim().toLowerCase();
  const tope = Math.min(Math.max(parseInt(limite, 10) || 300, 1), LIMITE);
  const salida = [];
  for (let i = entradas.length - 1; i >= 0 && salida.length < tope; i--) {
    const e = entradas[i];
    if (nivel && e.nivel !== nivel) continue;
    if (texto && !e.mensaje.toLowerCase().includes(texto)) continue;
    salida.push(e);
  }
  return salida;
}

module.exports = { instalar, consultar, LIMITE };
