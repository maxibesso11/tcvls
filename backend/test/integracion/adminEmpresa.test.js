// backend/test/integracion/adminEmpresa.test.js
// Rol ADMIN_EMPRESA (bloque 8): opera su empresa como un USUARIO y además
// administra sus propios usuarios, certificado ARCA y datos fiscales, sin
// tocar nunca otra empresa. Contra una base MySQL DESCARTABLE (entorno.js).
//
// Uso: TEST_DB_PERMITIR_BORRADO=1 TEST_DB_PORT=3307 TEST_DB_PASSWORD=... npm run test:integracion
'use strict';
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { HABILITADO, MOTIVO_OMISION, levantar } = require('./entorno');

describe('rol ADMIN_EMPRESA', { skip: !HABILITADO && MOTIVO_OMISION }, () => {
  let entorno;
  let tokenAdmin;
  let idEmpresa2;
  let secuencia = 0;

  before(async () => {
    entorno = await levantar();
    tokenAdmin = await entorno.iniciarSesion('admin', 'admin123');
    // El seed solo trae una empresa: se crea una segunda para probar el
    // aislamiento entre empresas.
    const r = await entorno.api('POST', '/api/admin/empresas',
      { nombre: 'Empresa 2 SRL', cuit: '30-99999999-9' }, { token: tokenAdmin });
    assert.equal(r.estado, 201, JSON.stringify(r.datos));
    idEmpresa2 = r.datos.id_empresa;
  });
  after(async () => { if (entorno) await entorno.cerrar(); });

  const login = (usuario, contrasena) =>
    entorno.api('POST', '/api/auth/login', { nombre_usuario: usuario, contrasena }, { token: null });

  // Crea un usuario desde el panel de administración de plataforma.
  async function crearUsuario(rol, idEmpresa, contrasena = 'Temporal-123') {
    secuencia += 1;
    const nombre = `ae_${rol.toLowerCase()}_${Date.now()}_${secuencia}`;
    const r = await entorno.api('POST', '/api/admin/usuarios',
      { nombre_usuario: nombre, contrasena, id_empresa: idEmpresa, rol }, { token: tokenAdmin });
    assert.equal(r.estado, 201, JSON.stringify(r.datos));
    return { nombre, contrasena, id: r.datos.id_usuario, id_empresa: idEmpresa, rol };
  }

  // Crea un usuario y completa el cambio obligatorio de contraseña. Devuelve su token.
  async function usuarioListo(rol, idEmpresa) {
    const u = await crearUsuario(rol, idEmpresa);
    const { datos } = await login(u.nombre, u.contrasena);
    const cambio = await entorno.api('PUT', '/api/auth/contrasena',
      { actual: u.contrasena, nueva: 'Definitiva-456' }, { token: datos.token });
    assert.equal(cambio.estado, 200, JSON.stringify(cambio.datos));
    return { ...u, contrasena: 'Definitiva-456', token: cambio.datos.token };
  }

  // ---------- Usuarios: alcance y aislamiento ----------

  test('un ADMIN_EMPRESA lista y crea usuarios solo de su empresa', async () => {
    const adminE = await usuarioListo('ADMIN_EMPRESA', idEmpresa2);
    const otroDeSuEmpresa = await crearUsuario('USUARIO', idEmpresa2);

    const lista = await entorno.api('GET', '/api/empresa/usuarios', undefined, { token: adminE.token });
    assert.equal(lista.estado, 200);
    assert.ok(lista.datos.some(u => u.id_usuario === otroDeSuEmpresa.id));
    // Ningún usuario de la empresa 1 (seed) aparece en el listado
    assert.ok(!lista.datos.some(u => u.nombre_usuario === 'demo'));

    const creado = await entorno.api('POST', '/api/empresa/usuarios',
      { nombre_usuario: `nuevo_${Date.now()}`, contrasena: 'Temporal-123', rol: 'USUARIO' },
      { token: adminE.token });
    assert.equal(creado.estado, 201, JSON.stringify(creado.datos));
    assert.equal(creado.datos.id_empresa, idEmpresa2);
  });

  test('editar, eliminar o reasignar contraseña a un usuario de otra empresa da 404', async () => {
    const adminE = await usuarioListo('ADMIN_EMPRESA', idEmpresa2);
    const deOtraEmpresa = await crearUsuario('USUARIO', 1);

    const editar = await entorno.api('PUT', `/api/empresa/usuarios/${deOtraEmpresa.id}`,
      { correo: 'x@x.com' }, { token: adminE.token });
    assert.equal(editar.estado, 404);

    const clave = await entorno.api('PUT', `/api/empresa/usuarios/${deOtraEmpresa.id}`,
      { contrasena: 'OtraClave-789' }, { token: adminE.token });
    assert.equal(clave.estado, 404);

    const eliminar = await entorno.api('DELETE', `/api/empresa/usuarios/${deOtraEmpresa.id}`,
      undefined, { token: adminE.token });
    assert.equal(eliminar.estado, 404);
  });

  test('crear o promover a ADMIN se rechaza; el id_empresa del cuerpo se ignora', async () => {
    const adminE = await usuarioListo('ADMIN_EMPRESA', idEmpresa2);

    const crearAdmin = await entorno.api('POST', '/api/empresa/usuarios',
      { nombre_usuario: `intento_admin_${Date.now()}`, contrasena: 'Temporal-123', rol: 'ADMIN' },
      { token: adminE.token });
    assert.equal(crearAdmin.estado, 403);

    const otro = await crearUsuario('USUARIO', idEmpresa2);
    const promover = await entorno.api('PUT', `/api/empresa/usuarios/${otro.id}`,
      { rol: 'ADMIN' }, { token: adminE.token });
    assert.equal(promover.estado, 403);

    // id_empresa distinto en el cuerpo: se ignora, el usuario sigue en idEmpresa2
    const mover = await entorno.api('PUT', `/api/empresa/usuarios/${otro.id}`,
      { id_empresa: 1, correo: 'sigue@empresa2.com' }, { token: adminE.token });
    assert.equal(mover.estado, 200, JSON.stringify(mover.datos));
    const [[fila]] = await entorno.pool.query('SELECT id_empresa FROM USUARIOS WHERE id_usuario = ?', [otro.id]);
    assert.equal(fila.id_empresa, idEmpresa2);
  });

  // ---------- Fuera de su alcance ----------

  test('/api/admin/* y /api/certificados/:otraEmpresa dan 403 a un ADMIN_EMPRESA', async () => {
    const adminE = await usuarioListo('ADMIN_EMPRESA', idEmpresa2);
    assert.equal((await entorno.api('GET', '/api/admin/empresas', undefined, { token: adminE.token })).estado, 403);
    assert.equal((await entorno.api('GET', '/api/admin/usuarios', undefined, { token: adminE.token })).estado, 403);
    assert.equal((await entorno.api('GET', '/api/certificados/1', undefined, { token: adminE.token })).estado, 403);
  });

  test('un USUARIO común recibe 403 en todo /api/empresa/*', async () => {
    const usuario = await usuarioListo('USUARIO', idEmpresa2);
    assert.equal((await entorno.api('GET', '/api/empresa/usuarios', undefined, { token: usuario.token })).estado, 403);
    assert.equal((await entorno.api('GET', '/api/empresa/certificado', undefined, { token: usuario.token })).estado, 403);
    assert.equal((await entorno.api('GET', '/api/empresa/datos-fiscales', undefined, { token: usuario.token })).estado, 403);
  });

  // ---------- Certificado ARCA ----------

  test('gestiona su certificado y la clave privada nunca aparece en ninguna respuesta', async () => {
    const adminE = await usuarioListo('ADMIN_EMPRESA', idEmpresa2);

    const estadoInicial = await entorno.api('GET', '/api/empresa/certificado', undefined, { token: adminE.token });
    assert.equal(estadoInicial.estado, 200);
    assert.equal(estadoInicial.datos.existe, false);

    const generado = await entorno.api('POST', '/api/empresa/certificado/generar', undefined, { token: adminE.token });
    // Sin node-forge en el entorno de test, el servicio responde 503, lo cual
    // también confirma que la ruta pertenece al ADMIN_EMPRESA (no 403).
    assert.ok([200, 503].includes(generado.estado), JSON.stringify(generado.datos));
    const cuerpo = JSON.stringify(generado.datos);
    assert.ok(!cuerpo.includes('clave_privada'));

    if (generado.estado === 200) {
      const estado = await entorno.api('GET', '/api/empresa/certificado', undefined, { token: adminE.token });
      assert.ok(!JSON.stringify(estado.datos).toLowerCase().includes('clave_privada'));
    }
  });

  // ---------- Sigue operando como un USUARIO ----------

  test('un ADMIN_EMPRESA sigue operando viajes y cuentas de su empresa', async () => {
    const adminE = await usuarioListo('ADMIN_EMPRESA', idEmpresa2);
    assert.equal((await entorno.api('GET', '/api/viajes', undefined, { token: adminE.token })).estado, 200);
    assert.equal((await entorno.api('GET', '/api/cuentas', undefined, { token: adminE.token })).estado, 200);
    assert.equal((await entorno.api('GET', '/api/cuentas-corrientes', undefined, { token: adminE.token })).estado, 200);
  });

  // ---------- Sesión ----------

  test('desactivar a un ADMIN_EMPRESA corta su sesión en el acto', async () => {
    // Se crean dos para no violar la regla de "al menos uno activo por empresa".
    const adminE1 = await usuarioListo('ADMIN_EMPRESA', idEmpresa2);
    await usuarioListo('ADMIN_EMPRESA', idEmpresa2);
    assert.equal((await entorno.api('GET', '/api/viajes', undefined, { token: adminE1.token })).estado, 200);
    await entorno.api('PUT', `/api/admin/usuarios/${adminE1.id}`, { activo: 0 }, { token: tokenAdmin });
    assert.equal((await entorno.api('GET', '/api/viajes', undefined, { token: adminE1.token })).estado, 401);
  });

  test('no se puede desactivar ni degradar al último ADMIN_EMPRESA activo de una empresa', async () => {
    const r = await entorno.api('POST', '/api/admin/empresas', { nombre: 'Empresa 3 SA' }, { token: tokenAdmin });
    assert.equal(r.estado, 201);
    const idEmpresa3 = r.datos.id_empresa;
    const unico = await crearUsuario('ADMIN_EMPRESA', idEmpresa3);

    const desactivar = await entorno.api('PUT', `/api/admin/usuarios/${unico.id}`, { activo: 0 }, { token: tokenAdmin });
    assert.equal(desactivar.estado, 409, JSON.stringify(desactivar.datos));

    const degradar = await entorno.api('PUT', `/api/admin/usuarios/${unico.id}`, { rol: 'USUARIO' }, { token: tokenAdmin });
    assert.equal(degradar.estado, 409, JSON.stringify(degradar.datos));

    const eliminar = await entorno.api('DELETE', `/api/admin/usuarios/${unico.id}`, undefined, { token: tokenAdmin });
    assert.equal(eliminar.estado, 409, JSON.stringify(eliminar.datos));
  });

  // ---------- Métricas financieras (reunión del 2/10) ----------

  test('ingresos y rentabilidad: los ve el ADMIN_EMPRESA, no un USUARIO común', async () => {
    const usuario = await usuarioListo('USUARIO', 1);
    const adminE = await usuarioListo('ADMIN_EMPRESA', 1);
    for (const ruta of ['ingresos-por-viaje', 'rentabilidad-equipos', 'clientes-top', 'ingresos-mensuales']) {
      const r = await entorno.api('GET', `/api/dashboard/${ruta}`, undefined, { token: usuario.token });
      assert.equal(r.estado, 403, ruta);
      const a = await entorno.api('GET', `/api/dashboard/${ruta}`, undefined, { token: adminE.token });
      assert.equal(a.estado, 200, ruta);
    }
    const kU = await entorno.api('GET', '/api/dashboard/kpis', undefined, { token: usuario.token });
    assert.equal(kU.datos.ingresos, null);
    assert.ok(Number.isFinite(kU.datos.costos_totales));
    const kA = await entorno.api('GET', '/api/dashboard/kpis', undefined, { token: adminE.token });
    assert.ok(Number.isFinite(kA.datos.ingresos.ganancia_neta));
    const ch = await entorno.api('GET', '/api/dashboard/rendimiento-choferes', undefined, { token: usuario.token });
    assert.equal(ch.estado, 200);
    assert.ok(ch.datos.every(c => !('ingresos' in c)));
  });
});
