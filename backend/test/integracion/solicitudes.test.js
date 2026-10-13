// backend/test/integracion/solicitudes.test.js
// Formulario de contacto de la landing: cada solicitud se guarda (con o sin
// correo configurado) y solo la ve el administrador de plataforma.
'use strict';
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { HABILITADO, MOTIVO_OMISION, levantar } = require('./entorno');

describe('solicitudes de contacto', { skip: !HABILITADO && MOTIVO_OMISION }, () => {
  let entorno, tokenAdmin, tokenUsuario;

  before(async () => {
    delete process.env.SMTP_HOST; delete process.env.ASESORIA_DESTINO;
    entorno = await levantar();
    tokenUsuario = await entorno.iniciarSesion('demo', 'demo123');
    tokenAdmin = await entorno.iniciarSesion('admin', 'admin123');
  });
  after(async () => { if (entorno) await entorno.cerrar(); });

  test('sin correo configurado, la solicitud se guarda y la persona recibe la confirmación', async () => {
    const r = await entorno.api('POST', '/api/asesoria',
      { nombre: 'Juan Pérez', empresa: 'Transportes Sur', email: 'juan@sur.com.ar', telefono: '351 555 1234', mensaje: 'Quiero una demo' }, { token: null });
    assert.equal(r.estado, 200, JSON.stringify(r.datos));
    const lista = await entorno.api('GET', '/api/admin/solicitudes', undefined, { token: tokenAdmin });
    assert.equal(lista.estado, 200);
    const s = lista.datos.datos.find(x => x.email === 'juan@sur.com.ar');
    assert.ok(s);
    assert.deepEqual([s.estado, s.avisada_por_correo, s.mensaje], ['NUEVA', 0, 'Quiero una demo']);
    assert.equal(lista.datos.nuevas, 1);
  });

  test('los datos obligatorios se validan y no se guarda nada incompleto', async () => {
    const r = await entorno.api('POST', '/api/asesoria', { nombre: 'Sin email', empresa: 'X', telefono: '1' }, { token: null });
    assert.equal(r.estado, 400);
    const [[{ n }]] = await entorno.pool.query("SELECT COUNT(*) AS n FROM SOLICITUDES_CONTACTO WHERE nombre = 'Sin email'");
    assert.equal(Number(n), 0);
  });

  test('el administrador cambia el estado y elimina; un usuario común no ve las solicitudes', async () => {
    const lista = await entorno.api('GET', '/api/admin/solicitudes', undefined, { token: tokenAdmin });
    const id = lista.datos.datos[0].id_solicitud;
    assert.equal((await entorno.api('PUT', `/api/admin/solicitudes/${id}`, { estado: 'CONTACTADA' }, { token: tokenAdmin })).estado, 200);
    const nuevas = await entorno.api('GET', '/api/admin/solicitudes?estado=NUEVA', undefined, { token: tokenAdmin });
    assert.equal(nuevas.datos.paginacion.total, 0);
    assert.equal((await entorno.api('GET', '/api/admin/solicitudes', undefined, { token: tokenUsuario })).estado, 403);
    assert.equal((await entorno.api('DELETE', `/api/admin/solicitudes/${id}`, undefined, { token: tokenAdmin })).estado, 200);
    const [[{ n }]] = await entorno.pool.query('SELECT COUNT(*) AS n FROM SOLICITUDES_CONTACTO WHERE id_solicitud = ?', [id]);
    assert.equal(Number(n), 0);
  });
});
