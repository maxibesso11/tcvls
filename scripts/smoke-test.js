#!/usr/bin/env node
// scripts/smoke-test.js
// Prueba de humo de la API: recorre los endpoints del ERP y guarda (o compara)
// una "foto" normalizada de cada respuesta. Sirve para demostrar que una
// reorganización del código NO cambió el comportamiento del sistema.
//
// Uso:
//   node scripts/smoke-test.js --guardar foto_antes.json
//   node scripts/smoke-test.js --comparar foto_antes.json
//
// Opciones:
//   --url http://127.0.0.1:3000   Servidor a probar (por defecto el local).
//   --con-escritura               Agrega pasos que CREAN/MODIFICAN datos
//                                 (viajes, facturas, recibos, usuarios...).
//                                 Solo contra una base de PRUEBA recién
//                                 restaurada: exige SMOKE_PERMITIR_ESCRITURA=1.
//
// Variables de entorno opcionales:
//   SMOKE_ADMIN_USUARIO / SMOKE_ADMIN_CLAVE   (por defecto admin / admin123)
//   SMOKE_USUARIO / SMOKE_CLAVE               (por defecto demo / demo123)
//
// Normalización: se enmascaran el token de sesión y cualquier fecha/hora del
// día de hoy (fechas de creación, CURDATE, NOW), que cambian entre corridas.
// Los PDF se comparan por su contenido sin fecha de creación ni ID interno.
'use strict';
const crypto = require('crypto');
const fs = require('fs');

// ---------------------------------------------------------------- argumentos
const args = process.argv.slice(2);
const opcion = nombre => {
  const i = args.indexOf(nombre);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : null;
};
const URL_BASE = String(opcion('--url') || 'http://127.0.0.1:3000').replace(/\/$/, '');
const ARCHIVO_GUARDAR = opcion('--guardar');
const ARCHIVO_COMPARAR = opcion('--comparar');
const CON_ESCRITURA = Boolean(opcion('--con-escritura'));

if (!ARCHIVO_GUARDAR && !ARCHIVO_COMPARAR) {
  console.error('Indicá --guardar <archivo> o --comparar <archivo>.');
  process.exit(2);
}
if (CON_ESCRITURA && process.env.SMOKE_PERMITIR_ESCRITURA !== '1') {
  console.error('--con-escritura modifica datos. Usalo solo contra una base de prueba y');
  console.error('definí SMOKE_PERMITIR_ESCRITURA=1 para confirmar.');
  process.exit(2);
}

// ---------------------------------------------------------------- utilidades
const hoy = new Date();
const HOY = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;

function normalizar(valor, clave) {
  if (clave === 'token') return '<TOKEN>';
  if (Array.isArray(valor)) return valor.map(v => normalizar(v));
  if (valor && typeof valor === 'object') {
    const salida = {};
    for (const k of Object.keys(valor).sort()) salida[k] = normalizar(valor[k], k);
    return salida;
  }
  if (typeof valor === 'string' && valor.startsWith(HOY)) return '<HOY>';
  return valor;
}

// Huella de un PDF sin los metadatos que cambian en cada generación.
function huellaPDF(buffer) {
  const texto = buffer.toString('latin1')
    .replace(/\(D:\d{14}Z\)/g, '(D:FECHA)')
    .replace(/\/ID\s*\[[^\]]*\]/g, '');
  return crypto.createHash('sha256').update(texto, 'latin1').digest('hex');
}

const tokens = {};

async function llamar(paso) {
  const headers = { 'Content-Type': 'application/json' };
  if (paso.como && tokens[paso.como]) headers.Authorization = `Bearer ${tokens[paso.como]}`;
  const resp = await fetch(URL_BASE + paso.url, {
    method: paso.metodo || 'GET',
    headers,
    body: paso.cuerpo !== undefined ? JSON.stringify(paso.cuerpo) : undefined
  });
  const tipo = (resp.headers.get('content-type') || '').split(';')[0];
  const buffer = Buffer.from(await resp.arrayBuffer());
  let cuerpo;
  if (tipo === 'application/json') cuerpo = normalizar(JSON.parse(buffer.toString('utf8') || 'null'));
  else if (tipo === 'application/pdf') cuerpo = { pdf: huellaPDF(buffer), disposicion: resp.headers.get('content-disposition') };
  else if (paso.soloEstado) cuerpo = { bytes: buffer.length > 0 };
  else cuerpo = { sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
  return { estado: resp.status, tipo, cuerpo, crudo: tipo === 'application/json' ? JSON.parse(buffer.toString('utf8') || 'null') : null };
}

// ---------------------------------------------------------------- pasos
// Cada paso: { nombre, metodo?, url, cuerpo?, como: 'admin'|'demo'|null }
// Algunos pasos se construyen con datos de pasos anteriores (ctx).
const TABLAS = ['choferes', 'unidades', 'equipos', 'viajes', 'consumos-combustible', 'consumos-generales',
  'cuentas', 'movimientos', 'stock', 'mantenimientos', 'vencimientos', 'cubiertas', 'gastos-administrativos'];
const RANGO = 'fecha_desde=2025-01-01&fecha_hasta=2026-12-31';

function pasosLectura() {
  const p = [];
  // Estáticos: solo estado y tipo (el HTML puede cambiar al reorganizar el frontend)
  for (const url of ['/', '/app', '/css/styles.css', '/js/api.js', '/js/app.js', '/img/logo/isotipo.svg', '/cualquier/ruta']) {
    p.push({ nombre: `estatico ${url}`, url, soloEstado: true });
  }
  p.push({ nombre: 'health', url: '/api/health' });
  p.push({ nombre: 'sin token → 401', url: '/api/viajes' });
  p.push({ nombre: 'login inválido', metodo: 'POST', url: '/api/auth/login', cuerpo: { nombre_usuario: 'demo', contrasena: 'mal' } });
  p.push({ nombre: 'auth/yo demo', url: '/api/auth/yo', como: 'demo' });
  p.push({ nombre: 'auth/yo admin', url: '/api/auth/yo', como: 'admin' });
  p.push({ nombre: 'admin bloqueado en datos', url: '/api/viajes', como: 'admin' });
  p.push({ nombre: 'demo bloqueado en admin', url: '/api/admin/empresas', como: 'demo' });

  for (const t of TABLAS) {
    p.push({ nombre: `listar ${t}`, url: `/api/${t}`, como: 'demo' });
    p.push({ nombre: `listar ${t} pág 2 x 20 asc`, url: `/api/${t}?pagina=2&por_pagina=20&dir=asc`, como: 'demo' });
    p.push({ nombre: `buscar ${t}`, url: `/api/${t}?q=a`, como: 'demo' });
    p.push({ nombre: `obtener ${t} #1`, url: `/api/${t}/1`, como: 'demo' });
  }
  p.push({ nombre: 'obtener inexistente', url: '/api/viajes/999999', como: 'demo' });
  p.push({ nombre: 'viajes filtrados', url: `/api/viajes?estado=FACTURADO&tipo_carga=ma&${RANGO}&orden=tarifa&dir=asc`, como: 'demo' });
  p.push({ nombre: 'viajes por equipo', url: '/api/viajes?id_equipo=1', como: 'demo' });
  p.push({ nombre: 'mantenimientos por equipo', url: '/api/mantenimientos?id_equipo=1', como: 'demo' });
  p.push({ nombre: 'stock por depósito', url: '/api/stock?deposito=Dep%C3%B3sito%20Sur', como: 'demo' });
  p.push({ nombre: 'stock depósitos', url: '/api/stock/depositos', como: 'demo' });

  for (const d of ['kpis', 'alertas', 'rendimiento-equipos', 'rendimiento-choferes', 'ingresos-mensuales',
    'clientes-top', 'consumos-por-equipo', 'ingresos-por-viaje', 'rentabilidad-equipos', 'gastos-administrativos']) {
    p.push({ nombre: `dashboard ${d}`, url: `/api/dashboard/${d}`, como: 'demo' });
    p.push({ nombre: `dashboard ${d} filtrado`, url: `/api/dashboard/${d}?${RANGO}&id_equipo=1&detalle=1`, como: 'demo' });
  }
  p.push({ nombre: 'dashboard saldos-cuentas (ruta inexistente)', url: '/api/dashboard/saldos-cuentas', como: 'demo', soloEstado: true });

  p.push({ nombre: 'cuentas corrientes', url: '/api/cuentas-corrientes', como: 'demo' });
  p.push({ nombre: 'cuentas corrientes buscar', url: '/api/cuentas-corrientes?q=sa&pagina=2&por_pagina=10', como: 'demo' });
  p.push({ nombre: 'cuenta corriente #1', url: '/api/cuentas-corrientes/1', como: 'demo' });
  p.push({ nombre: 'cuenta corriente #1 PDF', url: '/api/cuentas-corrientes/1/pdf', como: 'demo' });
  p.push({ nombre: 'cuenta corriente PDF token query', url: '/api/cuentas-corrientes/2/pdf?token=__DEMO__' });

  p.push({ nombre: 'facturas', url: '/api/facturacion', como: 'demo' });
  p.push({ nombre: 'viajes facturables', url: '/api/facturacion/viajes-facturables', como: 'demo' });

  p.push({ nombre: 'admin empresas', url: '/api/admin/empresas', como: 'admin' });
  p.push({ nombre: 'admin usuarios', url: '/api/admin/usuarios', como: 'admin' });
  p.push({ nombre: 'admin catálogo módulos', url: '/api/admin/modulos/catalogo', como: 'admin' });
  p.push({ nombre: 'admin módulos empresa 1', url: '/api/admin/empresas/1/modulos', como: 'admin' });
  p.push({ nombre: 'certificado empresa 1', url: '/api/certificados/1', como: 'admin' });
  return p;
}

function pasosEscritura() {
  const p = [];
  const V = { fecha_origen: '2026-03-10 08:00:00', tipo_carga: 'Soja', origen: 'Rosario', destino: 'Córdoba',
    id_equipo: 1, tarifa: 1000, tipo_tarifa: 'POR TONELADA', cantidad_cargada: 30, comision: 5, estado: 'EN CURSO',
    pagador: 'Agro del Centro SA', numero_remito: 'SMOKE-1' };
  p.push({ nombre: 'crear unidad', metodo: 'POST', url: '/api/unidades', cuerpo: { patente: 'SMK001', modelo: 'Prueba', funcionalidad: 'PRINCIPAL' }, como: 'demo', guardar: 'unidad' });
  p.push({ nombre: 'editar unidad', metodo: 'PUT', url: ctx => `/api/unidades/${ctx.unidad.id_unidad}`, cuerpo: { modelo: 'Editado' }, como: 'demo' });
  p.push({ nombre: 'eliminar unidad', metodo: 'DELETE', url: ctx => `/api/unidades/${ctx.unidad.id_unidad}`, como: 'demo' });
  p.push({ nombre: 'crear unidad vacía', metodo: 'POST', url: '/api/unidades', cuerpo: {}, como: 'demo' });
  p.push({ nombre: 'eliminar cuenta en uso', metodo: 'DELETE', url: '/api/cuentas/1', como: 'demo' });

  p.push({ nombre: 'viaje pagador inválido', metodo: 'POST', url: '/api/viajes', cuerpo: { ...V, pagador: 'No existe' }, como: 'demo' });
  p.push({ nombre: 'crear viaje', metodo: 'POST', url: '/api/viajes', cuerpo: V, como: 'demo', guardar: 'viaje' });
  p.push({ nombre: 'viaje FINALIZADO sin resultado', metodo: 'PUT', url: ctx => `/api/viajes/${ctx.viaje.id_viaje}`, cuerpo: { estado: 'FINALIZADO' }, como: 'demo' });
  p.push({ nombre: 'viaje FINALIZADO', metodo: 'PUT', url: ctx => `/api/viajes/${ctx.viaje.id_viaje}`, cuerpo: { estado: 'FINALIZADO', resultado: 29.5 }, como: 'demo' });
  p.push({ nombre: 'viaje FACTURADO sin facturar', metodo: 'PUT', url: ctx => `/api/viajes/${ctx.viaje.id_viaje}`, cuerpo: { estado: 'FACTURADO', modo_facturacion: 'SIN_FACTURAR' }, como: 'demo' });
  p.push({ nombre: 'viaje volver atrás', metodo: 'PUT', url: ctx => `/api/viajes/${ctx.viaje.id_viaje}`, cuerpo: { estado: 'EN CURSO' }, como: 'demo' });
  p.push({ nombre: 'viaje eliminar facturado', metodo: 'DELETE', url: ctx => `/api/viajes/${ctx.viaje.id_viaje}`, como: 'demo' });
  p.push({ nombre: 'movimientos del viaje', url: ctx => `/api/movimientos?q=${encodeURIComponent('VIAJE #' + ctx.viaje.id_viaje)}`, como: 'demo' });
  for (const [i, modo] of [[3, 'LIQUIDO_PRODUCTO'], [4, 'FACTURA'], [5, null]]) {
    const clave = `viaje${i}`;
    p.push({ nombre: `crear ${clave}`, metodo: 'POST', url: '/api/viajes', cuerpo: { ...V, numero_remito: `SMOKE-${i}`, tipo_tarifa: 'POR KM', tarifa: 800, comision: i }, como: 'demo', guardar: clave });
    p.push({ nombre: `${clave} FACTURADO ${modo}`, metodo: 'PUT', url: ctx => `/api/viajes/${ctx[clave].id_viaje}`, cuerpo: { estado: 'FACTURADO', resultado: 250 + i, modo_facturacion: modo, fecha_llegada: '2026-03-12 10:00:00' }, como: 'demo' });
    p.push({ nombre: `movimientos ${clave}`, url: ctx => `/api/movimientos?q=${encodeURIComponent('VIAJE #' + ctx[clave].id_viaje)}`, como: 'demo' });
  }

  p.push({ nombre: 'crear viaje 2 finalizado', metodo: 'POST', url: '/api/viajes', cuerpo: { ...V, numero_remito: 'SMOKE-2', estado: 'FINALIZADO', resultado: 31, tipo_tarifa: 'UNICA', tarifa: 50000 }, como: 'demo', guardar: 'viaje2' });
  p.push({ nombre: 'facturar viaje 2', metodo: 'POST', url: ctx => `/api/facturacion/desde-viaje/${ctx.viaje2.id_viaje}`, como: 'demo', guardar: 'factura' });
  p.push({ nombre: 'facturar viaje 2 otra vez', metodo: 'POST', url: ctx => `/api/facturacion/desde-viaje/${ctx.viaje2.id_viaje}`, como: 'demo' });
  p.push({ nombre: 'viaje 2 tras facturar', url: ctx => `/api/viajes/${ctx.viaje2.id_viaje}`, como: 'demo' });
  p.push({ nombre: 'factura PDF', url: ctx => `/api/facturacion/${ctx.factura.id_factura}/pdf`, como: 'demo' });
  p.push({ nombre: 'nota de crédito', metodo: 'POST', url: ctx => `/api/facturacion/${ctx.factura.id_factura}/nota-credito`, cuerpo: {}, como: 'demo', guardar: 'nc' });
  p.push({ nombre: 'nota de crédito PDF', url: ctx => `/api/facturacion/${ctx.nc.id_factura}/pdf`, como: 'demo' });
  p.push({ nombre: 'factura manual', metodo: 'POST', url: '/api/facturacion/manual', cuerpo: { id_cuenta: 1, observaciones: 'smoke', items: [{ descripcion: 'Servicio', cantidad: 2, unidad: 'horas', precio_unitario: 1500.5 }, { descripcion: 'Otro', cantidad: 1, precio_unitario: 300 }] }, como: 'demo', guardar: 'fm' });
  p.push({ nombre: 'factura manual PDF', url: ctx => `/api/facturacion/${ctx.fm.id_factura}/pdf`, como: 'demo' });
  p.push({ nombre: 'factura manual sin ítems', metodo: 'POST', url: '/api/facturacion/manual', cuerpo: { id_cuenta: 1, items: [] }, como: 'demo' });
  p.push({ nombre: 'facturas tras escritura', url: '/api/facturacion', como: 'demo' });

  p.push({ nombre: 'consumo proveedor inválido', metodo: 'POST', url: '/api/consumos-combustible', cuerpo: { proveedor: 'Nadie', id_equipo: 1, cantidad_litros: 100, precio_por_litro: 10, fecha: '2026-03-01' }, como: 'demo' });
  p.push({ nombre: 'gasto administrativo', metodo: 'POST', url: '/api/gastos-administrativos', cuerpo: { proveedor: 'Agro del Centro SA', concepto: 'Smoke', fecha: '2026-03-02', monto: 1234 }, como: 'demo', guardar: 'gasto' });
  p.push({ nombre: 'editar gasto', metodo: 'PUT', url: ctx => `/api/gastos-administrativos/${ctx.gasto.id_gasto_administrativo}`, cuerpo: { monto: 999 }, como: 'demo' });
  p.push({ nombre: 'crear chofer', metodo: 'POST', url: '/api/choferes', cuerpo: { nombre: 'Chofer Smoke', cuil: '20-99999999-1', edad: 40, vencimiento_carnet: '2027-01-01', domicilio: 'Calle 1', remuneracion: 10, tipo_remuneracion: 'PORCENTAJE' }, como: 'demo', guardar: 'chofer' });
  p.push({ nombre: 'cuenta del chofer', url: '/api/cuentas?q=Chofer%20Smoke', como: 'demo' });
  p.push({ nombre: 'editar chofer', metodo: 'PUT', url: ctx => `/api/choferes/${ctx.chofer.id_chofer}`, cuerpo: { nombre: 'Chofer Smoke 2' }, como: 'demo' });
  p.push({ nombre: 'eliminar chofer', metodo: 'DELETE', url: ctx => `/api/choferes/${ctx.chofer.id_chofer}`, como: 'demo' });
  p.push({ nombre: 'cuenta del chofer eliminada', url: '/api/cuentas?q=Chofer%20Smoke', como: 'demo' });
  p.push({ nombre: 'consumo combustible', metodo: 'POST', url: '/api/consumos-combustible', cuerpo: { proveedor: 'Agro del Centro SA', estacion_carga: 'YPF', id_equipo: 1, cantidad_litros: 100, km_recorridos: 400, precio_por_litro: 10, fecha: '2026-03-01' }, como: 'demo', guardar: 'consumo' });
  p.push({ nombre: 'eliminar consumo', metodo: 'DELETE', url: ctx => `/api/consumos-combustible/${ctx.consumo.id_consumo_combustible}`, como: 'demo' });
  p.push({ nombre: 'consumo general', metodo: 'POST', url: '/api/consumos-generales', cuerpo: { proveedor: 'Agro del Centro SA', id_unidad: 1, concepto: 'Aceite', monto: 800, fecha: '2026-03-01' }, como: 'demo' });
  p.push({ nombre: 'movimientos de consumos', url: '/api/movimientos?q=CONSUMO', como: 'demo' });
  p.push({ nombre: 'recibo', metodo: 'POST', url: '/api/movimientos', cuerpo: { id_cuenta: 1, monto: 5000, fecha: '2026-03-05', concepto: 'RECIBO smoke' }, como: 'demo' });
  p.push({ nombre: 'cuenta corriente #1 tras escritura', url: '/api/cuentas-corrientes/1', como: 'demo' });
  p.push({ nombre: 'mover depósito', metodo: 'POST', url: '/api/stock/mover-deposito', cuerpo: { origen: 'Depósito Sur', destino: 'Depósito Smoke' }, como: 'demo' });
  p.push({ nombre: 'dashboard kpis tras escritura', url: '/api/dashboard/kpis', como: 'demo' });
  p.push({ nombre: 'cambiar tema', metodo: 'PUT', url: '/api/auth/tema', cuerpo: { tema: 'azul' }, como: 'demo' });

  p.push({ nombre: 'admin crear empresa', metodo: 'POST', url: '/api/admin/empresas', cuerpo: { nombre: 'Empresa Smoke', iniciales: 'ES', cuit: '30-11111111-1' }, como: 'admin', guardar: 'empresa' });
  p.push({ nombre: 'admin módulos inválidos', metodo: 'PUT', url: ctx => `/api/admin/empresas/${ctx.empresa.id_empresa}/modulos`, cuerpo: { modulos: ['viajes'] }, como: 'admin' });
  p.push({ nombre: 'admin módulos válidos', metodo: 'PUT', url: ctx => `/api/admin/empresas/${ctx.empresa.id_empresa}/modulos`, cuerpo: { modulos: ['unidades', 'stock'] }, como: 'admin' });
  p.push({ nombre: 'admin crear usuario', metodo: 'POST', url: '/api/admin/usuarios', cuerpo: { nombre_usuario: 'smoke', contrasena: 'smoke123', id_empresa: 2, rol: 'OPERADOR' }, como: 'admin', guardar: 'usuario' });
  p.push({ nombre: 'admin listar usuarios', url: '/api/admin/usuarios', como: 'admin' });
  return p;
}

// ---------------------------------------------------------------- ejecución
async function login(clave, usuario, contrasena) {
  const r = await fetch(URL_BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre_usuario: usuario, contrasena })
  });
  const datos = await r.json();
  if (!datos.token) throw new Error(`No se pudo iniciar sesión como ${usuario}: ${JSON.stringify(datos)}`);
  tokens[clave] = datos.token;
  return datos;
}

async function principal() {
  const foto = {};
  const loginAdmin = await login('admin', process.env.SMOKE_ADMIN_USUARIO || 'admin', process.env.SMOKE_ADMIN_CLAVE || 'admin123');
  const loginDemo = await login('demo', process.env.SMOKE_USUARIO || 'demo', process.env.SMOKE_CLAVE || 'demo123');
  foto['login admin'] = { estado: 200, cuerpo: normalizar(loginAdmin) };
  foto['login demo'] = { estado: 200, cuerpo: normalizar(loginDemo) };

  const ctx = {};
  const pasos = [...pasosLectura(), ...(CON_ESCRITURA ? pasosEscritura() : [])];
  for (const paso of pasos) {
    const url = (typeof paso.url === 'function' ? paso.url(ctx) : paso.url).replace('__DEMO__', tokens.demo);
    const r = await llamar({ ...paso, url });
    if (paso.guardar && r.crudo) ctx[paso.guardar] = r.crudo;
    foto[paso.nombre] = { estado: r.estado, tipo: r.tipo, cuerpo: r.cuerpo };
  }

  if (ARCHIVO_GUARDAR) {
    fs.writeFileSync(ARCHIVO_GUARDAR, JSON.stringify(foto, null, 1));
    console.log(`✓ Foto guardada en ${ARCHIVO_GUARDAR} (${Object.keys(foto).length} pasos).`);
    return 0;
  }

  const referencia = JSON.parse(fs.readFileSync(ARCHIVO_COMPARAR, 'utf8'));
  const diferencias = [];
  for (const nombre of new Set([...Object.keys(referencia), ...Object.keys(foto)])) {
    const a = JSON.stringify(referencia[nombre]);
    const b = JSON.stringify(foto[nombre]);
    if (a !== b) diferencias.push({ nombre, antes: a && a.slice(0, 300), despues: b && b.slice(0, 300) });
  }
  if (diferencias.length === 0) {
    console.log(`✓ Sin diferencias: ${Object.keys(foto).length} pasos idénticos a ${ARCHIVO_COMPARAR}.`);
    return 0;
  }
  console.error(`✗ ${diferencias.length} diferencia(s):`);
  for (const d of diferencias) console.error(`  - ${d.nombre}\n      antes:   ${d.antes}\n      después: ${d.despues}`);
  return 1;
}

principal().then(code => process.exit(code)).catch(err => {
  console.error('Error en la prueba de humo:', err.message);
  process.exit(2);
});
