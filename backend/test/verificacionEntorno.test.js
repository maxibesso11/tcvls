'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { revisarConfiguracion } = require('../src/lib/verificacionEntorno');
const { cuitValido, generarContrasena } = require('../database/ayudasCli');
const { problemaContrasenaNueva } = require('../src/lib/seguridad/credenciales');

const SECRETO_A = 'a'.repeat(40);
const SECRETO_B = 'b'.repeat(40);
const entornoBueno = {
  NODE_ENV: 'production', AUTH_SECRET: SECRETO_A, CERT_SECRET: SECRETO_B, CORS_ORIGIN: 'https://erp.ejemplo.com.ar',
  ASESORIA_DESTINO: 'a@b.com', SMTP_HOST: 'smtp.b.com', SMTP_USER: 'u@b.com', SMTP_PASS: 'clave-real'
};

test('un entorno de producción bien configurado no tiene errores ni avisos', () => {
  const r = revisarConfiguracion(entornoBueno);
  assert.deepEqual(r.errores, []);
  assert.deepEqual(r.avisos, []);
});

test('faltan los secretos: es un error que impide arrancar', () => {
  const r = revisarConfiguracion({ ...entornoBueno, AUTH_SECRET: '', CERT_SECRET: 'cambiar_por_una_cadena_larga_y_aleatoria_unica' });
  assert.equal(r.errores.length, 2);
});

test('CORS abierto en producción es un aviso, no un error', () => {
  const r = revisarConfiguracion({ ...entornoBueno, CORS_ORIGIN: '*' });
  assert.deepEqual(r.errores, []);
  assert.equal(r.avisos.length, 1);
  assert.match(r.avisos[0], /CORS_ORIGIN/);
});

test('ARCA habilitado sin token y correo sin configurar generan avisos', () => {
  const r = revisarConfiguracion({ ...entornoBueno, ARCA_HABILITADO: '1', SMTP_PASS: 'tu_contraseña_de_aplicacion' });
  assert.equal(r.errores.length, 0);
  assert.equal(r.avisos.length, 2);
});

test('CUIT: valida el dígito verificador', () => {
  assert.equal(cuitValido('30-71122334-5'), false);
  assert.equal(cuitValido('20-12345678-6'), true);
  assert.equal(cuitValido('20123456786'), true);
  assert.equal(cuitValido('123'), false);
});

test('la contraseña temporal generada cumple la política de contraseñas', () => {
  for (let i = 0; i < 50; i++) {
    const c = generarContrasena();
    assert.equal(c.length, 14);
    assert.equal(problemaContrasenaNueva(c, 'usuario'), null);
  }
});
