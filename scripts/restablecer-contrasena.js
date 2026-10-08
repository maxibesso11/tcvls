#!/usr/bin/env node
// scripts/restablecer-contrasena.js
// Restablece la contraseña de un usuario cuando nadie la recuerda (por
// ejemplo, el administrador de plataforma). Genera una contraseña temporal,
// la muestra UNA vez y obliga a cambiarla en el próximo ingreso. Cierra las
// sesiones abiertas de ese usuario.
//
// Uso (en el servidor):
//   sudo docker compose --project-directory /opt/tcvls run --rm app \
//     node scripts/restablecer-contrasena.js --usuario=admin
'use strict';
const pool = require('../backend/src/config/db');
const { hashearContrasena } = require('../backend/src/lib/seguridad/credenciales');
const { leerArgumentos, generarContrasena } = require('../backend/database/ayudasCli');

async function main() {
  const { usuario } = leerArgumentos();
  if (!usuario || usuario === true) throw new Error('Uso: node scripts/restablecer-contrasena.js --usuario=<nombre de usuario>');
  const [[u]] = await pool.query('SELECT id_usuario, nombre_usuario, rol, activo, version_sesion FROM USUARIOS WHERE nombre_usuario = ?', [usuario]);
  if (!u) throw new Error(`No existe el usuario "${usuario}".`);

  const temporal = generarContrasena();
  await pool.query(
    `UPDATE USUARIOS SET contrasena_hash = ?, debe_cambiar_contrasena = 1, activo = 1, version_sesion = ?
      WHERE id_usuario = ?`,
    [hashearContrasena(temporal), (Number(u.version_sesion) || 0) + 1, u.id_usuario]);

  console.log(`✓ Contraseña de "${u.nombre_usuario}" (${u.rol}) restablecida.`);
  console.log(`  Contraseña temporal: ${temporal}`);
  console.log('  Al ingresar, el sistema pide elegir una nueva. Esta no se vuelve a mostrar.');
}

main().catch(err => { console.error('✗ ' + err.message); process.exitCode = 1; }).finally(() => pool.end());
