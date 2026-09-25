#!/usr/bin/env node
// scripts/verificar-requires.js
// Verificación rápida, sin base de datos ni servidor levantado:
//   1. Revisa la sintaxis de todos los .js del proyecto (node --check).
//   2. Carga (require) cada módulo del backend para detectar rutas de
//      import rotas después de mover archivos.
// Uso: node scripts/verificar-requires.js      (desde la raíz del proyecto)
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..');
const IGNORAR = new Set(['node_modules', '.git', 'logs']);
// Puntos de entrada que levantan el servidor al cargarse: solo se revisa su sintaxis.
const SOLO_SINTAXIS = new Set(['server.js', path.join('backend', 'server.js')]);

function listarJs(dir, salida = []) {
  for (const nombre of fs.readdirSync(dir)) {
    if (IGNORAR.has(nombre)) continue;
    const ruta = path.join(dir, nombre);
    const info = fs.statSync(ruta);
    if (info.isDirectory()) listarJs(ruta, salida);
    else if (nombre.endsWith('.js')) salida.push(ruta);
  }
  return salida;
}

const archivos = listarJs(RAIZ);
const errores = [];

for (const archivo of archivos) {
  try {
    execFileSync(process.execPath, ['--check', archivo], { stdio: 'pipe' });
  } catch (e) {
    errores.push(`Sintaxis: ${path.relative(RAIZ, archivo)}\n${String(e.stderr || e.message).trim()}`);
  }
}

// Solo el código del servidor se carga con require (el del navegador no).
const esBackend = rel => /^(backend|config|routes)[\\/]/.test(rel);
let cargados = 0;
for (const archivo of archivos) {
  const rel = path.relative(RAIZ, archivo);
  if (!esBackend(rel) || SOLO_SINTAXIS.has(rel) || /[\\/]database[\\/]/.test(rel)) continue;
  try {
    require(archivo);
    cargados++;
  } catch (e) {
    errores.push(`require: ${rel}\n  ${e.message.split('\n')[0]}`);
  }
}

if (errores.length) {
  console.error(`✗ ${errores.length} problema(s):\n` + errores.join('\n'));
  process.exit(1);
}
console.log(`✓ ${archivos.length} archivos con sintaxis válida; ${cargados} módulos del backend cargan sin errores.`);
// El pool de MySQL no abre conexiones hasta la primera consulta; se cierra igual.
process.exit(0);
