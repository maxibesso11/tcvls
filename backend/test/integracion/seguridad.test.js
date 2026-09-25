// backend/test/integracion/seguridad.test.js
// Seguridad de la aplicación (bloque 2 del MVP) contra una base real
// (descartable): arranque con secretos obligatorios, límite de intentos de
// login, contraseña inicial obligatoria de cambiar, sesiones invalidadas,
// token fuera de la URL, cabeceras HTTP y mensajes de error sin detalles.
//
// Uso: TEST_DB_PERMITIR_BORRADO=1 TEST_DB_PORT=3307 TEST_DB_PASSWORD=... npm run test:integracion
'use strict';
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { HABILITADO, MOTIVO_OMISION, levantar } = require('./entorno');
const { problemasDeConfiguracion } = require('../../src/lib/seguridad/configuracion');

describe('configuración obligatoria al arrancar', () => {
  const bueno = 'a'.repeat(40);
  const otroBueno = 'b'.repeat(40);

  test('con secretos largos y distintos no hay problemas', () => {
    assert.deepEqual(problemasDeConfiguracion({ AUTH_SECRET: bueno, CERT_SECRET: otroBueno }), []);
  });

  test('rechaza secretos faltantes, cortos, de ejemplo o repetidos', () => {
    assert.equal(problemasDeConfiguracion({}).length, 2);
    assert.match(problemasDeConfiguracion({ AUTH_SECRET: 'corto', CERT_SECRET: otroBueno })[0], /demasiado corto/);
    assert.match(problemasDeConfiguracion({
      AUTH_SECRET: 'cambiar_por_una_cadena_larga_y_aleatoria_unica', CERT_SECRET: otroBueno
    })[0], /valor de ejemplo/);
    assert.match(problemasDeConfiguracion({ AUTH_SECRET: bueno, CERT_SECRET: bueno })[0], /distinto/);
  });
});

describe('seguridad de la API', { skip: !HABILITADO && MOTIVO_OMISION }, () => {
  let entorno;
  let tokenAdmin;
  let secuencia = 0;

  before(async () => {
    entorno = await levantar();
    tokenAdmin = await entorno.iniciarSesion('admin', 'admin123');
  });
  after(async () => { if (entorno) await entorno.cerrar(); });

  const login = (usuario, contrasena) =>
    entorno.api('POST', '/api/auth/login', { nombre_usuario: usuario, contrasena }, { token: null });

  // Crea un usuario operativo de la empresa 1 desde el panel de administración.
  async function crearUsuario(contrasena = 'Temporal-123') {
    secuencia += 1;
    const nombre = `usuario_test_${Date.now()}_${secuencia}`;
    const r = await entorno.api('POST', '/api/admin/usuarios',
      { nombre_usuario: nombre, contrasena, id_empresa: 1, rol: 'USUARIO' }, { token: tokenAdmin });
    assert.equal(r.estado, 201, JSON.stringify(r.datos));
    return { nombre, contrasena, id: r.datos.id_usuario };
  }

  // Crea un usuario y le hace el cambio obligatorio de contraseña. Devuelve su token.
  async function usuarioListo() {
    const u = await crearUsuario();
    const { datos } = await login(u.nombre, u.contrasena);
    const cambio = await entorno.api('PUT', '/api/auth/contrasena',
      { actual: u.contrasena, nueva: 'Definitiva-456' }, { token: datos.token });
    assert.equal(cambio.estado, 200, JSON.stringify(cambio.datos));
    return { ...u, contrasena: 'Definitiva-456', token: cambio.datos.token };
  }

  // ---------- Límite de intentos ----------

  test('tras 5 intentos fallidos se bloquea el usuario, aun con la contraseña correcta', async () => {
    const u = await usuarioListo();
    for (let i = 0; i < 5; i++) {
      assert.equal((await login(u.nombre, 'incorrecta')).estado, 401);
    }
    const bloqueado = await login(u.nombre, u.contrasena);
    assert.equal(bloqueado.estado, 429);
    assert.ok(Number(bloqueado.cabeceras.get('retry-after')) > 0);

    // Otro usuario desde la misma IP no queda bloqueado
    const otro = await usuarioListo();
    assert.equal((await login(otro.nombre, otro.contrasena)).estado, 200);
  });

  // ---------- Contraseña inicial / asignada por el administrador ----------

  test('un usuario con contraseña asignada debe cambiarla antes de operar', async () => {
    const u = await crearUsuario();
    const { datos } = await login(u.nombre, u.contrasena);
    assert.equal(datos.usuario.debe_cambiar_contrasena, true);

    const bloqueado = await entorno.api('GET', '/api/viajes', undefined, { token: datos.token });
    assert.equal(bloqueado.estado, 403);
    assert.equal(bloqueado.datos.codigo, 'CAMBIO_CONTRASENA_REQUERIDO');
    assert.equal((await entorno.api('GET', '/api/auth/yo', undefined, { token: datos.token })).estado, 200);

    const debil = await entorno.api('PUT', '/api/auth/contrasena',
      { actual: u.contrasena, nueva: 'corta' }, { token: datos.token });
    assert.equal(debil.estado, 400);

    const cambio = await entorno.api('PUT', '/api/auth/contrasena',
      { actual: u.contrasena, nueva: 'Definitiva-456' }, { token: datos.token });
    assert.equal(cambio.estado, 200);

    // La sesión anterior al cambio deja de valer; la nueva opera normalmente
    assert.equal((await entorno.api('GET', '/api/viajes', undefined, { token: datos.token })).estado, 401);
    assert.equal((await entorno.api('GET', '/api/viajes', undefined, { token: cambio.datos.token })).estado, 200);
  });

  test('las contraseñas iniciales de la instalación son obligatorias de cambiar', async () => {
    await entorno.pool.query("UPDATE USUARIOS SET debe_cambiar_contrasena = 1 WHERE nombre_usuario = 'demo'");
    const { datos } = await login('demo', 'demo123');
    assert.equal(datos.usuario.debe_cambiar_contrasena, true);
    assert.equal((await entorno.api('GET', '/api/viajes', undefined, { token: datos.token })).estado, 403);
    await entorno.pool.query("UPDATE USUARIOS SET debe_cambiar_contrasena = 0 WHERE nombre_usuario = 'demo'");
  });

  test('el administrador no puede asignar una contraseña trivial', async () => {
    const r = await entorno.api('POST', '/api/admin/usuarios',
      { nombre_usuario: `debil_${Date.now()}`, contrasena: 'admin123', id_empresa: 1, rol: 'USUARIO' }, { token: tokenAdmin });
    assert.equal(r.estado, 400);
  });

  // ---------- Sesiones ----------

  test('desactivar un usuario corta su sesión en el acto', async () => {
    const u = await usuarioListo();
    assert.equal((await entorno.api('GET', '/api/viajes', undefined, { token: u.token })).estado, 200);
    await entorno.api('PUT', `/api/admin/usuarios/${u.id}`, { activo: 0 }, { token: tokenAdmin });
    assert.equal((await entorno.api('GET', '/api/viajes', undefined, { token: u.token })).estado, 401);
  });

  test('el token por la URL ya no se acepta', async () => {
    const u = await usuarioListo();
    const porUrl = await entorno.api('GET', `/api/cuentas-corrientes/1/pdf?token=${u.token}`, undefined, { token: null });
    assert.equal(porUrl.estado, 401);
    const porCabecera = await fetch(`${entorno.base}/api/cuentas-corrientes/1/pdf`, {
      headers: { Authorization: `Bearer ${u.token}` }
    });
    assert.equal(porCabecera.status, 200);
    assert.equal(porCabecera.headers.get('content-type'), 'application/pdf');
  });

  // ---------- Cabeceras y errores ----------

  test('las respuestas llevan cabeceras de seguridad y no anuncian Express', async () => {
    const r = await entorno.api('GET', '/api/health', undefined, { token: null });
    assert.match(r.cabeceras.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(r.cabeceras.get('x-content-type-options'), 'nosniff');
    assert.equal(r.cabeceras.get('x-frame-options'), 'DENY');
    assert.equal(r.cabeceras.get('x-powered-by'), null);
  });

  test('un campo obligatorio faltante da un mensaje entendible, sin detalles de la base', async () => {
    const u = await usuarioListo();
    const r = await entorno.api('POST', '/api/choferes',
      { nombre: 'Sin domicilio', cuil: '20-11111111-1', edad: 30, vencimiento_carnet: '2027-01-01' }, { token: u.token });
    assert.equal(r.estado, 400);
    assert.equal(r.datos.error, 'Falta completar el campo obligatorio "domicilio".');
  });

  test('JSON inválido o demasiado grande responde un error claro', async () => {
    const u = await usuarioListo();
    const invalido = await entorno.api('POST', '/api/stock', undefined, { token: u.token, crudo: '{no es json' });
    assert.equal(invalido.estado, 400);
    const grande = await entorno.api('POST', '/api/stock', { elemento: 'x'.repeat(200 * 1024) }, { token: u.token });
    assert.equal(grande.estado, 413);
  });
});
