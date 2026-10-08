#!/usr/bin/env node
// scripts/arca-diagnostico.js
// Verifica, paso a paso, que una empresa esté lista para facturar con ARCA:
//   1. Servidores de ARCA (no usa credenciales).
//   2. Certificado de la empresa y ticket de acceso (lo reutiliza si está
//      vigente; si hay que pedir uno nuevo, avisa y pide confirmación con
//      --pedir-acceso, porque pedirlo dos veces bloquea el certificado 12 h).
//   3. Puntos de venta habilitados para web service.
//   4. Condiciones de IVA del receptor que ARCA acepta para A, B y C.
//   5. Último comprobante autorizado de cada tipo en el punto de venta.
// No emite ningún comprobante.
//
// Uso: node scripts/arca-diagnostico.js --empresa 2 [--pedir-acceso]
'use strict';
const pool = require('../backend/src/config/db');
const arca = require('../backend/src/integraciones/arca');
const { CODIGOS } = require('../backend/src/modulos/facturacion/facturacion.reglas');

const arg = n => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null; };
const idEmpresa = Number(arg('empresa'));
const PEDIR = process.argv.includes('--pedir-acceso');

async function paso(titulo, fn) {
  process.stdout.write(`\n${titulo}\n`);
  try { return await fn(); } catch (err) { console.log(`  ✗ ${err.message}`); return undefined; }
}

async function main() {
  if (!idEmpresa) throw new Error('Uso: node scripts/arca-diagnostico.js --empresa N [--pedir-acceso]');
  console.log(`Entorno de ARCA: ${arca.entornoActual()}`);

  await paso('1. Servidores de ARCA', async () => {
    const d = await arca.dummy();
    console.log(`  aplicación ${d.app} · base ${d.db} · autenticación ${d.auth}`);
  });

  const cliente = await paso('2. Certificado y acceso', async () => {
    const c = await arca.clienteEmpresa(idEmpresa);
    console.log(`  CUIT ${c.cuit}: certificado activo.`);
    const t = await c.estadoTicket();
    const vigente = t && t.expira > new Date(Date.now() + 5 * 60000).toISOString().slice(0, 19).replace('T', ' ');
    if (vigente) console.log(`  Ticket de acceso guardado, vigente hasta ${t.expira} (UTC).`);
    else if (!PEDIR) {
      console.log('  No hay un ticket de acceso vigente guardado. Para pedirlo, repetí con --pedir-acceso');
      console.log('  (pedirlo dos veces seguidas bloquea el certificado hasta 12 horas).');
      return null;
    }
    return c;
  });
  if (!cliente) return;

  const pv = await paso('3. Puntos de venta para web service', async () => {
    const lista = await cliente.puntosDeVenta();
    if (!lista.length) console.log('  ARCA no informa puntos de venta habilitados para este CUIT.');
    lista.forEach(p => console.log(`  ${p.numero} · ${p.tipo}${p.bloqueado ? ' · BLOQUEADO' : ''}${p.baja ? ' · baja ' + p.baja : ''}`));
    return lista;
  });

  await paso('4. Condiciones de IVA del receptor aceptadas', async () => {
    for (const clase of ['A', 'B', 'C']) {
      const lista = await cliente.condicionesIvaReceptor(clase);
      console.log(`  ${clase}: ` + lista.map(c => `${c.id} ${c.descripcion}`).join(' · '));
    }
  });

  const [[empresa]] = await pool.query('SELECT punto_venta FROM EMPRESAS WHERE id_empresa = ?', [idEmpresa]);
  const puntoVenta = Number(arg('punto-venta')) || Number(empresa.punto_venta) || (pv && pv[0] && pv[0].numero) || 1;
  await paso(`5. Último comprobante autorizado (punto de venta ${puntoVenta})`, async () => {
    for (const [letra, clases] of Object.entries(CODIGOS)) {
      const f = await cliente.ultimoAutorizado(puntoVenta, clases.FACTURA);
      const nc = await cliente.ultimoAutorizado(puntoVenta, clases.NOTA_CREDITO);
      console.log(`  ${letra}: factura ${f} · nota de crédito ${nc}`);
    }
  });
}

main().catch(err => { console.error('✗ ' + err.message); process.exitCode = 1; }).finally(() => pool.end());
