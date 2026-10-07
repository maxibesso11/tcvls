#!/usr/bin/env node
// backend/database/instalar.js
// Instalación limpia del sistema sobre una base VACÍA:
//   1. verifica la configuración (.env),
//   2. crea todas las tablas (esquema/esquema.sql) — sin datos de prueba,
//   3. crea el administrador de plataforma (el que da de alta a los clientes),
//   4. verifica el entorno y dice cuál es el paso siguiente.
//
// Uso (desde la raíz, con el .env de la base a instalar):
//   node backend/database/instalar.js                  guiado (pregunta lo que falta)
//   node backend/database/instalar.js --solo-admin     base ya instalada sin administrador
//   node backend/database/instalar.js --con-datos-de-prueba   SOLO desarrollo/tests
//   node backend/database/instalar.js --no-interactivo --admin-usuario=... [--admin-correo=...] [--admin-contrasena=...]
//
// En Docker:  docker compose run --rm app node backend/database/instalar.js
//
// Nunca borra nada: si la base ya tiene tablas, se niega (para actualizar una
// base existente se usa migrar.js).
'use strict';
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
const { leerArgumentos, preguntar, generarContrasena, linea } = require('./ayudasCli');

const RUTA_ESQUEMA = path.join(__dirname, 'esquema', 'esquema.sql');
const RUTA_DATOS_PRUEBA = path.join(__dirname, 'datos_prueba', 'datos_basicos.sql');

const args = leerArgumentos();
const INTERACTIVO = !args['no-interactivo'] && process.stdin.isTTY;

function terminar(mensaje) {
  console.error(`\n✗ ${mensaje}`);
  process.exit(1);
}

async function conectar() {
  const base = {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    charset: 'utf8mb4',
    multipleStatements: true
  };
  try {
    return await mysql.createConnection({ ...base, database: process.env.DB_NAME });
  } catch (err) {
    if (err.code !== 'ER_BAD_DB_ERROR') throw err;
    // La base no existe todavía: se crea (necesita permiso para eso)
    const c = await mysql.createConnection(base);
    await c.query(`CREATE DATABASE \`${process.env.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await c.end();
    return mysql.createConnection({ ...base, database: process.env.DB_NAME });
  }
}

async function crearEsquema(conexion) {
  const [[{ tablas }]] = await conexion.query(
    'SELECT COUNT(*) AS tablas FROM information_schema.tables WHERE table_schema = DATABASE()');
  if (Number(tablas) > 0) {
    terminar(`La base "${process.env.DB_NAME}" ya tiene ${tablas} tabla(s): no se instala encima. ` +
      'Para actualizarla usá migrar.js; para sumar el administrador a una base instalada, --solo-admin.');
  }
  console.log('→ Creando las tablas…');
  await conexion.query(fs.readFileSync(RUTA_ESQUEMA, 'utf8'));
  console.log('✓ Esquema creado y migraciones registradas.');
  if (args['con-datos-de-prueba']) {
    if (process.env.NODE_ENV === 'production' && !args['confirmo-datos-de-prueba']) {
      terminar('NODE_ENV=production: los datos de prueba traen contraseñas públicas (admin123, demo123). ' +
        'Si de verdad es un entorno de demostración, agregá --confirmo-datos-de-prueba.');
    }
    await conexion.query(fs.readFileSync(RUTA_DATOS_PRUEBA, 'utf8'));
    console.log('✓ Datos de prueba cargados (usuarios admin/admin123 y demo/demo123: cambian la contraseña al ingresar).');
  }
}

// Datos del administrador de plataforma: argumentos, o preguntas, o generados.
async function datosAdministrador() {
  let usuario = args['admin-usuario'];
  let correo = args['admin-correo'];
  let contrasena = args['admin-contrasena'];
  if (INTERACTIVO) {
    console.log(`\n${linea()}\nAdministrador de plataforma (da de alta empresas y usuarios)\n${linea()}`);
    if (!usuario) usuario = await preguntar('Usuario', { defecto: 'admin' });
    if (!correo) correo = await preguntar('Correo (opcional)');
    if (!contrasena) {
      contrasena = await preguntar('Contraseña (vacío = generar una temporal)', { oculto: true });
    }
  }
  if (!usuario) terminar('Falta el usuario del administrador (--admin-usuario=...).');
  let generada = false;
  if (!contrasena) { contrasena = generarContrasena(); generada = true; }
  return { usuario, correo: correo || null, contrasena, generada };
}

async function main() {
  const { revisarConfiguracion } = require('../src/lib/verificacionEntorno');
  const { errores } = revisarConfiguracion();
  if (errores.length) {
    errores.forEach(e => console.error(`  ✗ ${e}`));
    terminar('Corregí el .env antes de instalar (valores nuevos con: openssl rand -hex 48).');
  }
  for (const v of ['DB_USER', 'DB_NAME']) if (!process.env[v]) terminar(`Falta ${v} en el .env.`);

  console.log(`Base: ${process.env.DB_NAME} en ${process.env.DB_HOST || 'localhost'}`);
  let conexion;
  try { conexion = await conectar(); }
  catch (err) { terminar(`No se pudo conectar con la base (${err.code || err.message}). Revisá DB_HOST, DB_USER y DB_PASSWORD.`); }

  try {
    if (!args['solo-admin']) await crearEsquema(conexion);
    const [[{ admins }]] = await conexion.query("SELECT COUNT(*) AS admins FROM USUARIOS WHERE rol = 'ADMIN' AND activo = 1");
    if (Number(admins) > 0) {
      console.log('✓ Ya existe un administrador de plataforma: no se crea otro.');
    } else {
      const adm = await datosAdministrador();
      // El alta pasa por el mismo servicio que usa el panel: mismas reglas de contraseña.
      const usuariosServicio = require('../src/modulos/admin/usuarios.servicio');
      try {
        await usuariosServicio.crear({ nombre_usuario: adm.usuario, contrasena: adm.contrasena, correo: adm.correo, rol: 'ADMIN' }, null);
      } catch (err) {
        terminar(err.message);
      }
      console.log(`\n✓ Administrador de plataforma creado: ${adm.usuario}`);
      if (adm.generada) {
        console.log(`  Contraseña temporal: ${adm.contrasena}`);
        console.log('  ANOTALA ahora: no se vuelve a mostrar. El sistema pide cambiarla al primer ingreso.');
      } else {
        console.log('  El sistema le pedirá cambiar la contraseña al primer ingreso.');
      }
    }
  } finally {
    await conexion.end();
  }

  // Verificación final del entorno
  const pool = require('../src/config/db');
  const { verificar, informe } = require('../src/lib/verificacionEntorno');
  const resultado = await verificar({ pool });
  console.log(`\n${linea()}\nVerificación del entorno\n${linea()}`);
  console.log(informe(resultado));
  await pool.end();
  if (resultado.errores.length) process.exit(1);

  console.log(`\nSiguiente paso — dar de alta al primer cliente:\n  node backend/database/alta-cliente.js\n  (en Docker: docker compose run --rm app node backend/database/alta-cliente.js)`);
  console.log('Procedimiento completo y lista de control: docs/operacion/ALTA_DE_CLIENTE.md');
}

main().catch(err => terminar(err.message));
