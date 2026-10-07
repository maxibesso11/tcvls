// backend/database/ayudasCli.js
// Piezas comunes de los scripts de línea de comandos de instalación y alta
// (instalar.js, alta-cliente.js): argumentos, preguntas por consola y
// contraseñas generadas.
'use strict';
const readline = require('readline');
const crypto = require('crypto');

// --clave=valor  →  { clave: 'valor' }    --bandera  →  { bandera: true }
function leerArgumentos(argv = process.argv.slice(2)) {
  const args = {};
  for (const a of argv) {
    const m = /^--([a-z0-9-]+)(?:=(.*))?$/.exec(a);
    if (m) args[m[1]] = m[2] === undefined ? true : m[2];
  }
  return args;
}

// Pregunta por consola. oculto: no muestra lo que se escribe (contraseñas).
function preguntar(texto, { defecto = '', oculto = false } = {}) {
  return new Promise(resolver => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (oculto) {
      rl._writeToOutput = s => { if (s.includes(texto)) process.stdout.write(s); };
    }
    rl.question(`${texto}${defecto ? ` [${defecto}]` : ''}: `, respuesta => {
      rl.close();
      if (oculto) process.stdout.write('\n');
      resolver(respuesta.trim() || defecto);
    });
  });
}

// Contraseña temporal legible (sin caracteres ambiguos como 0/O o 1/l).
// El usuario debe cambiarla al primer ingreso.
function generarContrasena(largo = 14) {
  const alfabeto = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  const bytes = crypto.randomBytes(largo);
  for (let i = 0; i < largo; i++) c += alfabeto[bytes[i] % alfabeto.length];
  return c;
}

// CUIT/CUIL argentino: 11 dígitos con dígito verificador (módulo 11).
function cuitValido(cuit) {
  const d = String(cuit || '').replace(/\D/g, '');
  if (d.length !== 11) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((s, p, i) => s + p * Number(d[i]), 0);
  let verif = 11 - (suma % 11);
  if (verif === 11) verif = 0;
  if (verif === 10) return false;
  return verif === Number(d[10]);
}

const linea = (n = 60) => '─'.repeat(n);

module.exports = { leerArgumentos, preguntar, generarContrasena, cuitValido, linea };
