// backend/test/integracion/adminMultiempresa.test.js
// Rol ADMIN_MULTIEMPRESA: administra y opera un subconjunto de empresas
// asignado por el ADMIN global (USUARIOS_EMPRESAS), eligiendo con cuál
// opera en cada pedido mediante la cabecera X-Empresa-Id (validada por
// resolverEmpresaMultiempresa contra esa tabla). Contra una base MySQL
// DESCARTABLE (entorno.js).
//
// Uso: TEST_DB_PERMITIR_BORRADO=1 TEST_DB_PORT=3307 TEST_DB_PASSWORD=... npm run test:integracion
'use strict';
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { HABILITADO, MOTIVO_OMISION, levantar } = require('./entorno');

describe('rol ADMIN_MULTIEMPRESA', { skip: !HABILITADO && MOTIVO_OMISION }, () => {
  let entorno;
  let tokenAdmin;
  let idEmpresa2, idEmpresa3;
  let secuencia = 0;

  before(async () => {
    entorno = await levantar();
    tokenAdmin = await entorno.iniciarSesion('admin', 'admin123');
    // El seed solo trae la empresa 1 ("3 de Abril SAS"): se crean dos más
    // para asignarle al ADMIN_MULTIEMPRESA y probar aislamiento entre ellas,
    // dejando la 1 como "no asignada".
    const r2 = await entorno.api('POST', '/api/admin/empresas',
      { nombre: 'Empresa 2 SRL', cuit: '30-99999999-9' }, { token: tokenAdmin });
    assert.equal(r2.estado, 201, JSON.stringify(r2.datos));
    idEmpresa2 = r2.datos.id_empresa;

    const r3 = await entorno.api('POST', '/api/admin/empresas',
      { nombre: 'Empresa 3 SA', cuit: '30-88888888-8' }, { token: tokenAdmin });
    assert.equal(r3.estado, 201, JSON.stringify(r3.datos));
    idEmpresa3 = r3.datos.id_empresa;
  });
  after(async () => { if (entorno) await entorno.cerrar(); });

  const login = (usuario, contrasena) =>
    entorno.api('POST', '/api/auth/login', { nombre_usuario: usuario, contrasena }, { token: null });

  async function crearUsuario(rol, idEmpresa, contrasena = 'Temporal-123') {
    secuencia += 1;
    const nombre = `am_${rol.toLowerCase()}_${Date.now()}_${secuencia}`;
    const r = await entorno.api('POST', '/api/admin/usuarios',
      { nombre_usuario: nombre, contrasena, id_empresa: idEmpresa, rol }, { token: tokenAdmin });
    assert.equal(r.estado, 201, JSON.stringify(r.datos));
    return { nombre, contrasena, id: r.datos.id_usuario, rol };
  }

  async function usuarioListo(rol, idEmpresa) {
    const u = await crearUsuario(rol, idEmpresa);
    const { datos } = await login(u.nombre, u.contrasena);
    const cambio = await entorno.api('PUT', '/api/auth/contrasena',
      { actual: u.contrasena, nueva: 'Definitiva-456' }, { token: datos.token });
    assert.equal(cambio.estado, 200, JSON.stringify(cambio.datos));
    return { ...u, contrasena: 'Definitiva-456', token: cambio.datos.token };
  }

  // Crea un ADMIN_MULTIEMPRESA, le asigna las empresas dadas y completa el
  // cambio obligatorio de contraseña. Devuelve su token y su id.
  async function multiempresaListo(idsEmpresas) {
    const u = await crearUsuario('ADMIN_MULTIEMPRESA', null);
    const asignar = await entorno.api('PUT', `/api/admin/usuarios/${u.id}/empresas`,
      { empresas: idsEmpresas }, { token: tokenAdmin });
    assert.equal(asignar.estado, 200, JSON.stringify(asignar.datos));
    const { datos } = await login(u.nombre, u.contrasena);
    const cambio = await entorno.api('PUT', '/api/auth/contrasena',
      { actual: u.contrasena, nueva: 'Definitiva-456' }, { token: datos.token });
    assert.equal(cambio.estado, 200, JSON.stringify(cambio.datos));
    return { ...u, contrasena: 'Definitiva-456', token: cambio.datos.token };
  }

  const conEmpresa = idEmpresa => ({ headers: { 'X-Empresa-Id': String(idEmpresa) } });

  // CUIL: 13 caracteres (XX-XXXXXXXX-X). Único por secuencia, no por timestamp
  // (Date.now() no entra en la columna).
  function cuilUnico() {
    secuencia += 1;
    return `20-${String(10000000 + secuencia).padStart(8, '0')}-3`;
  }

  // ---------- Asignación de empresas ----------

  test('el ADMIN global asigna empresas y la sesión refleja solo esas', async () => {
    const mE = await multiempresaListo([idEmpresa2, idEmpresa3]);
    const yo = await entorno.api('GET', '/api/auth/yo', undefined,
      { token: mE.token, headers: { 'X-Empresa-Id': String(idEmpresa2) } });
    assert.equal(yo.estado, 200, JSON.stringify(yo.datos));
    const ids = yo.datos.usuario.empresas_asignadas.map(e => e.id_empresa).sort();
    assert.deepEqual(ids, [idEmpresa2, idEmpresa3].sort());
  });

  // ---------- Empresa en contexto: validación de la cabecera ----------

  test('sin X-Empresa-Id, las rutas operativas y /api/multiempresa/* dan 400', async () => {
    const mE = await multiempresaListo([idEmpresa2]);
    assert.equal((await entorno.api('GET', '/api/viajes', undefined, { token: mE.token })).estado, 400);
    assert.equal((await entorno.api('GET', '/api/cuentas', undefined, { token: mE.token })).estado, 400);
    assert.equal((await entorno.api('GET', '/api/multiempresa/usuarios', undefined, { token: mE.token })).estado, 400);
  });

  test('X-Empresa-Id de una empresa no asignada da 403', async () => {
    const mE = await multiempresaListo([idEmpresa2]);
    // La empresa 1 (seed) no está en su conjunto asignado
    assert.equal((await entorno.api('GET', '/api/viajes', undefined, { token: mE.token, ...conEmpresa(1) })).estado, 403);
    assert.equal((await entorno.api('GET', '/api/multiempresa/usuarios', undefined, { token: mE.token, ...conEmpresa(1) })).estado, 403);
  });

  test('X-Empresa-Id de una empresa asignada funciona y aísla los datos entre empresas', async () => {
    const mE = await multiempresaListo([idEmpresa2, idEmpresa3]);
    const cuil2 = cuilUnico();
    const cuil3 = cuilUnico();

    const crear2 = await entorno.api('POST', '/api/cuentas',
      { tipo: 'CLIENTE', cuil: cuil2, nombre: 'Cliente de empresa 2' }, { token: mE.token, ...conEmpresa(idEmpresa2) });
    assert.equal(crear2.estado, 201, JSON.stringify(crear2.datos));

    const crear3 = await entorno.api('POST', '/api/cuentas',
      { tipo: 'CLIENTE', cuil: cuil3, nombre: 'Cliente de empresa 3' }, { token: mE.token, ...conEmpresa(idEmpresa3) });
    assert.equal(crear3.estado, 201, JSON.stringify(crear3.datos));

    const listaEmpresa2 = await entorno.api('GET', '/api/cuentas', undefined, { token: mE.token, ...conEmpresa(idEmpresa2) });
    assert.equal(listaEmpresa2.estado, 200);
    assert.ok(listaEmpresa2.datos.datos.some(c => c.cuil === cuil2));
    assert.ok(!listaEmpresa2.datos.datos.some(c => c.cuil === cuil3));

    const listaEmpresa3 = await entorno.api('GET', '/api/cuentas', undefined, { token: mE.token, ...conEmpresa(idEmpresa3) });
    assert.equal(listaEmpresa3.estado, 200);
    assert.ok(listaEmpresa3.datos.datos.some(c => c.cuil === cuil3));
    assert.ok(!listaEmpresa3.datos.datos.some(c => c.cuil === cuil2));
  });

  // ---------- Regresión de seguridad: la cabecera no aplica a otros roles ----------

  test('un ADMIN_EMPRESA o USUARIO que manda X-Empresa-Id de otra empresa sigue viendo solo la suya', async () => {
    const adminE = await usuarioListo('ADMIN_EMPRESA', idEmpresa2);
    const cuil = cuilUnico();
    const crear = await entorno.api('POST', '/api/cuentas',
      { tipo: 'CLIENTE', cuil, nombre: 'Cliente propio' }, { token: adminE.token });
    assert.equal(crear.estado, 201, JSON.stringify(crear.datos));

    // Manda la cabecera apuntando a la empresa 3: el middleware la ignora
    // para este rol, así que sigue viendo (y creando) solo en la 2.
    const conCabeceraAjena = await entorno.api('GET', '/api/cuentas', undefined,
      { token: adminE.token, ...conEmpresa(idEmpresa3) });
    assert.equal(conCabeceraAjena.estado, 200);
    assert.ok(conCabeceraAjena.datos.datos.some(c => c.cuil === cuil));
  });

  // ---------- Fuera de su alcance ----------

  test('/api/admin/* y /api/certificados/:otraEmpresa dan 403 a un ADMIN_MULTIEMPRESA', async () => {
    const mE = await multiempresaListo([idEmpresa2]);
    assert.equal((await entorno.api('GET', '/api/admin/empresas', undefined, { token: mE.token })).estado, 403);
    assert.equal((await entorno.api('GET', '/api/admin/usuarios', undefined, { token: mE.token })).estado, 403);
    assert.equal((await entorno.api('GET', '/api/certificados/1', undefined, { token: mE.token })).estado, 403);
  });

  test('no puede crear ni promover a otro usuario a ADMIN ni ADMIN_MULTIEMPRESA', async () => {
    const mE = await multiempresaListo([idEmpresa2]);

    const crearAdmin = await entorno.api('POST', '/api/multiempresa/usuarios',
      { nombre_usuario: `intento_admin_${Date.now()}`, contrasena: 'Temporal-123', rol: 'ADMIN' },
      { token: mE.token, ...conEmpresa(idEmpresa2) });
    assert.equal(crearAdmin.estado, 403);

    const crearMultiempresa = await entorno.api('POST', '/api/multiempresa/usuarios',
      { nombre_usuario: `intento_multi_${Date.now()}`, contrasena: 'Temporal-123', rol: 'ADMIN_MULTIEMPRESA' },
      { token: mE.token, ...conEmpresa(idEmpresa2) });
    assert.equal(crearMultiempresa.estado, 403);

    // Pero sí puede crear ADMIN_EMPRESA y USUARIO en su empresa asignada
    const crearAdminEmpresa = await entorno.api('POST', '/api/multiempresa/usuarios',
      { nombre_usuario: `ok_admin_empresa_${Date.now()}`, contrasena: 'Temporal-123', rol: 'ADMIN_EMPRESA' },
      { token: mE.token, ...conEmpresa(idEmpresa2) });
    assert.equal(crearAdminEmpresa.estado, 201, JSON.stringify(crearAdminEmpresa.datos));
  });

  // ---------- Sesión ----------

  test('desasignar una empresa bumpea version_sesion y el token viejo da 401', async () => {
    const mE = await multiempresaListo([idEmpresa2, idEmpresa3]);
    assert.equal((await entorno.api('GET', '/api/viajes', undefined, { token: mE.token, ...conEmpresa(idEmpresa2) })).estado, 200);

    const reasignar = await entorno.api('PUT', `/api/admin/usuarios/${mE.id}/empresas`,
      { empresas: [idEmpresa3] }, { token: tokenAdmin });
    assert.equal(reasignar.estado, 200, JSON.stringify(reasignar.datos));

    assert.equal((await entorno.api('GET', '/api/viajes', undefined, { token: mE.token, ...conEmpresa(idEmpresa2) })).estado, 401);
  });
});
