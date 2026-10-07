#!/usr/bin/env node
// scripts/verificar-entorno.js
// Comprueba que el entorno está bien configurado SIN arrancar el servidor:
// secretos, base de datos, esquema, migraciones, administrador, respaldos…
// Es la misma verificación que hace el servidor al arrancar.
//   npm run verificar-entorno
//   docker compose run --rm app node scripts/verificar-entorno.js
// Sale con código 1 si hay errores (sirve en listas de control y en despliegues).
'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { verificar, informe } = require('../backend/src/lib/verificacionEntorno');

(async () => {
  const pool = require('../backend/src/config/db');
  const resultado = await verificar({ pool });
  console.log(`Entorno: ${process.env.NODE_ENV || 'development'} · base ${process.env.DB_NAME || '(sin DB_NAME)'}\n`);
  console.log(informe(resultado));
  console.log(resultado.errores.length
    ? `\n✗ ${resultado.errores.length} error(es): el sistema no arrancaría.`
    : `\n✓ Listo para arrancar${resultado.avisos.length ? ` (${resultado.avisos.length} aviso(s) para revisar)` : ''}.`);
  await pool.end();
  process.exit(resultado.errores.length ? 1 : 0);
})().catch(err => { console.error('✗ ' + err.message); process.exit(1); });
