#!/usr/bin/env node
// backend/database/migrar.js
// Aplica las migraciones pendientes de backend/database/migraciones/, en orden.
// Registra cada una en la tabla MIGRACIONES, así un deploy corre solo lo que
// falta y nunca repite una migración ya aplicada.
//
// Uso (desde la raíz, con el .env de la base a migrar):
//   node backend/database/migrar.js --estado            qué hay aplicado y qué falta
//   node backend/database/migrar.js                     aplica las pendientes
//   node backend/database/migrar.js --registrar-hasta 016
//        Base que ya tenía migraciones aplicadas A MANO antes de existir este
//        registro: marca de la 001 a la 016 como aplicadas, sin ejecutarlas.
//
// ⚠ Hacer un respaldo antes. MySQL confirma cada ALTER TABLE al instante:
// si una migración falla a la mitad, lo ya ejecutado no se deshace solo.
// El proceso se detiene en la primera que falla y no registra esa ni las
// siguientes; la base queda como estaba después de la última correcta.
'use strict';
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
const mysql = require('mysql2/promise');

const CARPETA = path.join(__dirname, 'migraciones');
const PATRON = /^migracion_(\d{3})_.+\.sql$/;

const args = process.argv.slice(2);
const SOLO_ESTADO = args.includes('--estado');
const iRegistrar = args.indexOf('--registrar-hasta');
const REGISTRAR_HASTA = iRegistrar >= 0 ? String(args[iRegistrar + 1] || '').padStart(3, '0') : null;

function listarMigraciones() {
  return fs.readdirSync(CARPETA)
    .map(nombre => ({ nombre, m: PATRON.exec(nombre) }))
    .filter(x => x.m)
    .map(x => ({ nombre: x.nombre, numero: x.m[1] }))
    .sort((a, b) => a.numero.localeCompare(b.numero));
}

// Imprime el resultado de los SELECT de verificación que traen las migraciones.
// Con varias sentencias, mysql2 devuelve un elemento por sentencia: filas
// (array) para un SELECT y un resumen (objeto) para ALTER/UPDATE/INSERT.
function mostrarResultados(resultados) {
  const esFilas = r => Array.isArray(r) && (r.length === 0 || !Array.isArray(r[0]));
  const varias = Array.isArray(resultados) && resultados.some(r => r && (Array.isArray(r) || r.affectedRows !== undefined));
  const lista = varias ? resultados : [resultados];
  for (const r of lista) {
    if (esFilas(r) && r.length) console.table(r);
  }
}

async function main() {
  const conexion = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    multipleStatements: true,
    dateStrings: true
  });
  try {
    const [[{ existe }]] = await conexion.query(
      `SELECT COUNT(*) AS existe FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name = 'MIGRACIONES'`);
    const [[{ tablas }]] = await conexion.query(
      `SELECT COUNT(*) AS tablas FROM information_schema.tables WHERE table_schema = DATABASE()`);

    const migraciones = listarMigraciones();

    if (!Number(existe)) {
      if (Number(tablas) === 0) {
        throw new Error(`La base "${process.env.DB_NAME}" está vacía: para una instalación nueva se usa instalar.js (node backend/database/instalar.js), no las migraciones.`);
      }
      if (!REGISTRAR_HASTA) {
        throw new Error('La base no tiene el registro de migraciones (tabla MIGRACIONES). ' +
          'Averiguá cuál fue la última aplicada a mano (ver docs/operacion/ACTUALIZAR_SIN_PERDER_DATOS.md) ' +
          'y corré: node backend/database/migrar.js --registrar-hasta NNN');
      }
      await conexion.query(`CREATE TABLE MIGRACIONES (
        nombre VARCHAR(100) NOT NULL PRIMARY KEY,
        aplicada_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    } else if (REGISTRAR_HASTA) {
      throw new Error('El registro de migraciones ya existe: --registrar-hasta solo sirve la primera vez.');
    }

    if (REGISTRAR_HASTA) {
      const previas = migraciones.filter(m => m.numero <= REGISTRAR_HASTA);
      for (const m of previas) {
        await conexion.query('INSERT INTO MIGRACIONES (nombre) VALUES (?)', [m.nombre]);
      }
      console.log(`Registradas como ya aplicadas: ${previas.length} (de la ${previas[0].numero} a la ${REGISTRAR_HASTA}).`);
    }

    const [filas] = await conexion.query('SELECT nombre FROM MIGRACIONES');
    const aplicadas = new Set(filas.map(f => f.nombre));
    const pendientes = migraciones.filter(m => !aplicadas.has(m.nombre));

    if (SOLO_ESTADO) {
      console.log(`Base: ${process.env.DB_NAME} — ${aplicadas.size} aplicadas, ${pendientes.length} pendientes.`);
      pendientes.forEach(m => console.log(`  pendiente: ${m.nombre}`));
      return;
    }
    if (pendientes.length === 0) {
      console.log(`Base ${process.env.DB_NAME} al día: no hay migraciones pendientes.`);
      return;
    }

    for (const m of pendientes) {
      console.log(`\n→ Aplicando ${m.nombre}`);
      const sql = fs.readFileSync(path.join(CARPETA, m.nombre), 'utf8');
      try {
        const [resultados] = await conexion.query(sql);
        mostrarResultados(resultados);
      } catch (err) {
        console.error(`✗ Falló ${m.nombre}: ${err.message}`);
        console.error('  No se registró esta migración ni se aplicaron las siguientes.');
        console.error('  Revisá el error; si quedó aplicada a medias, restaurá el respaldo previo.');
        process.exitCode = 1;
        return;
      }
      await conexion.query('INSERT INTO MIGRACIONES (nombre) VALUES (?)', [m.nombre]);
      console.log(`✓ ${m.nombre}`);
    }
    console.log(`\nListo: ${pendientes.length} migración(es) aplicada(s).`);
  } finally {
    await conexion.end();
  }
}

main().catch(err => { console.error('✗ ' + err.message); process.exitCode = 1; });
