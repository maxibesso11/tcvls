#!/usr/bin/env node
// scripts/auditar-cuentas.js
// Auditoría de SOLO LECTURA de los movimientos automáticos de cuenta corriente.
// Recalcula, con las mismas reglas que usa el sistema, lo que cada viaje,
// consumo y gasto debería tener imputado y lo compara con lo guardado:
//   - movimientos faltantes, duplicados o huérfanos (su origen ya no existe),
//   - importes o cuentas distintos de lo que el sistema generaría hoy.
// Una diferencia significa que, si alguien edita ese registro, el saldo de la
// cuenta cambiaría. Sirve para validar una base antes y después de un deploy.
//
// Uso (desde la raíz, con el .env apuntando a la base a revisar):
//   node scripts/auditar-cuentas.js            resumen + primeras diferencias
//   node scripts/auditar-cuentas.js --todo     todas las diferencias
// Requiere la migración 023 (origen_tipo/origen_id en MOVIMIENTOS).
'use strict';
const pool = require('../backend/src/config/db');
const { calcularMontoCuentaCliente, calcularLiquidacionChofer } = require('../backend/src/modulos/viajes/viajes.calculos');
const { buscarCuentaPagador, obtenerChoferDelViaje, comprobanteDelViaje } = require('../backend/src/modulos/viajes/viajes.servicio');
const { buscarCuentaProveedor } = require('../backend/src/modulos/cuentas/cuentas.servicio');
const { discriminaIva } = require('../backend/src/lib/condicionFiscal');

const MOSTRAR_TODO = process.argv.includes('--todo');
const TOLERANCIA = 0.01;
const r2 = n => Math.round(Number(n) * 100) / 100;

const hallazgos = [];
function anotar(tipo, detalle) { hallazgos.push({ tipo, detalle }); }

// Movimientos automáticos agrupados por "TIPO:id".
async function movimientosPorOrigen(idEmpresa) {
  const [filas] = await pool.query(
    `SELECT id_movimiento, id_cuenta, monto, origen_tipo, origen_id
       FROM MOVIMIENTOS WHERE id_empresa = ? AND origen_tipo IS NOT NULL`, [idEmpresa]);
  const mapa = new Map();
  for (const m of filas) {
    const clave = `${m.origen_tipo}:${m.origen_id}`;
    if (!mapa.has(clave)) mapa.set(clave, []);
    mapa.get(clave).push(m);
  }
  return mapa;
}

// Compara lo esperado ({ idCuenta, monto } o null) con lo guardado.
function comparar(mapa, clave, esperado, etiqueta) {
  const guardados = mapa.get(clave) || [];
  mapa.delete(clave);
  if (guardados.length > 1) {
    anotar('DUPLICADO', `${etiqueta}: ${guardados.length} movimientos (ids ${guardados.map(g => g.id_movimiento).join(', ')})`);
    return;
  }
  const g = guardados[0];
  if (!esperado) {
    if (g) anotar('SOBRANTE', `${etiqueta}: tiene el movimiento #${g.id_movimiento} ($${g.monto}) pero no le corresponde ninguno`);
    return;
  }
  if (!g) { anotar('FALTANTE', `${etiqueta}: falta el movimiento de $${r2(esperado.monto)}`); return; }
  if (esperado.idCuenta && g.id_cuenta !== esperado.idCuenta) {
    anotar('CUENTA', `${etiqueta}: movimiento #${g.id_movimiento} en la cuenta ${g.id_cuenta}; el sistema lo pondría en la ${esperado.idCuenta}`);
  }
  if (Math.abs(Number(g.monto) - r2(esperado.monto)) > TOLERANCIA) {
    anotar('IMPORTE', `${etiqueta}: movimiento #${g.id_movimiento} guardado $${g.monto}; recalculado $${r2(esperado.monto)} (dif. $${r2(r2(esperado.monto) - Number(g.monto))})`);
  }
}

async function auditarViajes(idEmpresa, mapa) {
  const [viajes] = await pool.query('SELECT * FROM VIAJES WHERE id_empresa = ?', [idEmpresa]);
  for (const v of viajes) {
    const etiqueta = `Viaje #${v.id_viaje} (${v.estado})`;

    // Liquidación al chofer (FINALIZADO o FACTURADO)
    let liquidacion = null;
    if (v.estado === 'FINALIZADO' || v.estado === 'FACTURADO') {
      const chofer = await obtenerChoferDelViaje(pool, v, idEmpresa);
      if (chofer && chofer.id_cuenta) {
        const { monto, incompleto } = calcularLiquidacionChofer(v, chofer);
        if (monto !== 0 || incompleto) liquidacion = { idCuenta: chofer.id_cuenta, monto };
      }
    }
    comparar(mapa, `VIAJE_LIQUIDACION:${v.id_viaje}`, liquidacion, `${etiqueta} liquidación`);

    // Débito al pagador (FACTURADO). Si el viaje está en un comprobante
    // electrónico emitido, el débito es el del comprobante (origen FACTURA).
    let facturacion = null;
    if (v.estado === 'FACTURADO' && !(await comprobanteDelViaje(pool, v.id_viaje, idEmpresa))) {
      const cuenta = await buscarCuentaPagador(pool, v.pagador, idEmpresa);
      const monto = calcularMontoCuentaCliente(v, { conIva: await discriminaIva(idEmpresa) });
      if (cuenta && monto !== 0) facturacion = { idCuenta: cuenta.id_cuenta, monto: -Math.abs(monto) };
      if (!cuenta) anotar('PAGADOR', `${etiqueta}: el pagador "${v.pagador}" no tiene cuenta CLIENTE/PROVEEDOR`);
    }
    comparar(mapa, `VIAJE_FACTURACION:${v.id_viaje}`, facturacion, `${etiqueta} facturación`);
  }
}

async function auditarGastos(idEmpresa, mapa) {
  const fuentes = [
    { tabla: 'CONSUMOS_COMBUSTIBLE', id: 'id_consumo_combustible', origen: 'CONSUMO_COMBUSTIBLE', nombre: 'Consumo combustible',
      monto: c => Number(c.cantidad_litros) * Number(c.precio_por_litro) },
    { tabla: 'CONSUMOS_GENERALES', id: 'id_consumo_general', origen: 'CONSUMO_GENERAL', nombre: 'Consumo general',
      monto: c => Number(c.monto) },
    { tabla: 'GASTOS_ADMINISTRATIVOS', id: 'id_gasto_administrativo', origen: 'GASTO_ADMINISTRATIVO', nombre: 'Gasto administrativo',
      monto: c => Number(c.monto) }
  ];
  for (const f of fuentes) {
    const [filas] = await pool.query(`SELECT * FROM ${f.tabla} WHERE id_empresa = ?`, [idEmpresa]);
    for (const c of filas) {
      const cuenta = await buscarCuentaProveedor(c.proveedor, idEmpresa);
      const etiqueta = `${f.nombre} #${c[f.id]}`;
      if (!cuenta) anotar('PROVEEDOR', `${etiqueta}: el proveedor "${c.proveedor}" no tiene cuenta`);
      const esperado = cuenta ? { idCuenta: cuenta.id_cuenta, monto: Math.abs(f.monto(c)) } : null;
      comparar(mapa, `${f.origen}:${c[f.id]}`, esperado, etiqueta);
    }
  }
}

async function main() {
  const [empresas] = await pool.query('SELECT id_empresa, nombre FROM EMPRESAS ORDER BY id_empresa');
  for (const e of empresas) {
    const inicio = hallazgos.length;
    const mapa = await movimientosPorOrigen(e.id_empresa);
    await auditarViajes(e.id_empresa, mapa);
    await auditarGastos(e.id_empresa, mapa);
    // Lo que quedó en el mapa apunta a un viaje/consumo/gasto que ya no existe.
    // Facturas y notas de crédito no se recalculan: se validan por existencia.
    for (const [clave, movs] of mapa) {
      const [tipo, id] = clave.split(':');
      if (tipo === 'FACTURA' || tipo === 'NOTA_CREDITO') {
        const [[f]] = await pool.query('SELECT 1 FROM FACTURAS WHERE id_factura = ? AND id_empresa = ?', [id, e.id_empresa]);
        if (f) continue;
      }
      anotar('HUERFANO', `${clave}: ${movs.length} movimiento(s) cuyo origen no existe (ids ${movs.map(m => m.id_movimiento).join(', ')})`);
    }

    const propios = hallazgos.slice(inicio);
    console.log(`\n== Empresa ${e.id_empresa} — ${e.nombre}: ${propios.length === 0 ? 'sin diferencias' : propios.length + ' diferencia(s)'}`);
    const porTipo = {};
    propios.forEach(h => { porTipo[h.tipo] = (porTipo[h.tipo] || 0) + 1; });
    Object.entries(porTipo).forEach(([t, n]) => console.log(`   ${t}: ${n}`));
    (MOSTRAR_TODO ? propios : propios.slice(0, 15)).forEach(h => console.log(`   - [${h.tipo}] ${h.detalle}`));
    if (!MOSTRAR_TODO && propios.length > 15) console.log(`   … ${propios.length - 15} más (usar --todo)`);
  }
  await pool.end();
  process.exitCode = hallazgos.length === 0 ? 0 : 1;
}

main().catch(err => { console.error('Error en la auditoría:', err.message); process.exit(2); });
