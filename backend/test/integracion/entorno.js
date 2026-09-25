// backend/test/integracion/entorno.js
// Entorno de los tests de integración: recrea una base MySQL DESCARTABLE desde
// esquema/init_db.sql (que ejecuta DROP DATABASE erp_3_abril) y levanta la app
// en un puerto libre. Nunca apuntar a un servidor MySQL con datos reales.
//
// Variables: TEST_DB_HOST, TEST_DB_PORT, TEST_DB_USER, TEST_DB_PASSWORD y
// TEST_DB_PERMITIR_BORRADO=1 (confirmación explícita; sin ella se omiten).
'use strict';
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const HABILITADO = process.env.TEST_DB_PERMITIR_BORRADO === '1';
const MOTIVO_OMISION = 'Definí TEST_DB_PERMITIR_BORRADO=1 y TEST_DB_* apuntando a un MySQL descartable';

const RUTA_ESQUEMA = path.join(__dirname, '..', '..', 'database', 'esquema', 'init_db.sql');

// Las variables se fijan antes de cargar la app: config/db.js las lee al
// cargarse y dotenv no pisa las que ya existen.
function configurarVariables() {
  process.env.DB_HOST = process.env.TEST_DB_HOST || '127.0.0.1';
  process.env.DB_PORT = process.env.TEST_DB_PORT || '3306';
  process.env.DB_USER = process.env.TEST_DB_USER || 'root';
  process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD || '';
  process.env.DB_NAME = 'erp_3_abril';
  process.env.AUTH_SECRET = 'secreto-solo-para-tests';
  process.env.CERT_SECRET = 'cert-secreto-solo-para-tests';
  process.env.ARCA_HABILITADO = '0';
}

async function recrearBase() {
  const conexion = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    charset: 'utf8mb4',
    multipleStatements: true
  });
  try {
    await conexion.query(fs.readFileSync(RUTA_ESQUEMA, 'utf8'));
  } finally {
    await conexion.end();
  }
}

// Levanta la app sobre una base recién creada. Devuelve un cliente HTTP
// mínimo, el pool (para verificar la base directamente) y cómo cerrar todo.
async function levantar() {
  configurarVariables();
  await recrearBase();
  const app = require('../../src/app');
  const pool = require('../../src/config/db');
  const servidor = await new Promise(resolver => {
    const s = app.listen(0, '127.0.0.1', () => resolver(s));
  });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  let token = null;

  async function api(metodo, url, cuerpo) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const resp = await fetch(base + url, {
      method: metodo,
      headers,
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined
    });
    const tipo = resp.headers.get('content-type') || '';
    const datos = tipo.includes('application/json') ? await resp.json() : null;
    return { estado: resp.status, datos };
  }

  async function iniciarSesion(usuario, contrasena) {
    const r = await api('POST', '/api/auth/login', { nombre_usuario: usuario, contrasena });
    if (!r.datos || !r.datos.token) throw new Error(`No se pudo iniciar sesión como ${usuario}`);
    token = r.datos.token;
  }

  async function cerrar() {
    await new Promise(resolver => servidor.close(resolver));
    await pool.end();
  }

  return { api, iniciarSesion, pool, cerrar };
}

module.exports = { HABILITADO, MOTIVO_OMISION, levantar };
