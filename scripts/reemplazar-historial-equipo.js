#!/usr/bin/env node
// scripts/reemplazar-historial-equipo.js
// Reconstruye el historial de uno o más equipos cuando se sabe que su
// composición cambió y el sistema no lo registró (por ejemplo, cambios hechos
// antes de existir EQUIPO_HISTORIAL). Reemplaza los períodos del equipo por
// los indicados, deja el equipo con la composición del último período y
// recalcula la foto de sus viajes y las liquidaciones que cambian de chofer.
//
// Uso (desde la raíz, con el .env de la base; en Docker:
//   docker compose run --rm -v "$PWD/historial.json:/tmp/h.json:ro" app \
//     node scripts/reemplazar-historial-equipo.js /tmp/h.json [--aplicar]):
//   node scripts/reemplazar-historial-equipo.js historial.json            vista previa
//   node scripts/reemplazar-historial-equipo.js historial.json --aplicar  aplica
//
// historial.json (fechas en hora argentina):
// { "id_empresa": 2,
//   "equipos": [
//     { "id_equipo": 10, "periodos": [
//         { "camion": "HKF072", "acoplado": "GFG347", "chofer": "CARLOS ALBERTO FERNANDEZ" },
//         { "desde": "2026-07-10 00:00", "camion": "HKF072", "acoplado": "GFG347", "chofer": "OLEKSIUK JOSE IGNACIO" },
//         { "desde": "2026-09-12 00:00", "camion": "EOR599", "acoplado": "IRE242", "chofer": "OLEKSIUK JOSE IGNACIO" } ] },
//     { "id_equipo": 11, "baja": "2026-09-10 00:00", "periodos": [ ... ] } ],
//   "eliminar_equipos": [16],                      equipos sin viajes ni consumos (duplicados)
//   "eliminar_unidades": ["aaaa0000", "bbbb0000"] } unidades inventadas, sin ninguna referencia
//
// - El primer período va sin "desde" (desde el alta) o con "desde" si el
//   equipo empezó a usar un camión que ya tenía historia en otro equipo.
// - "baja": el equipo se da de baja en esa fecha (cierra su último período).
'use strict';
const fs = require('fs');
const pool = require('../backend/src/config/db');
const { refotografiarViajes } = require('../backend/src/modulos/equipos/equipos.historial');

const [archivo] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const APLICAR = process.argv.includes('--aplicar');
if (!archivo) { console.error('Indicá el archivo JSON con los períodos.'); process.exit(2); }

const normalizar = f => {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?$/.exec(String(f || '').trim());
  if (!m) throw new Error(`Fecha inválida: "${f}" (usar AAAA-MM-DD HH:MM)`);
  return `${m[1]} ${m[2]}${m[3] || ':00'}`;
};

async function unidadPorPatente(db, idEmpresa, patente) {
  const [[u]] = await db.query('SELECT id_unidad FROM UNIDADES WHERE id_empresa = ? AND patente = ?', [idEmpresa, patente]);
  if (!u) throw new Error(`No existe la unidad ${patente} en la empresa ${idEmpresa}.`);
  return u.id_unidad;
}
async function choferPorNombre(db, idEmpresa, nombre) {
  const [filas] = await db.query('SELECT id_chofer FROM CHOFERES WHERE id_empresa = ? AND nombre = ?', [idEmpresa, nombre]);
  if (filas.length !== 1) throw new Error(`El chofer "${nombre}" no existe o está repetido en la empresa ${idEmpresa}.`);
  return filas[0].id_chofer;
}

async function fotos(db, idEquipo, idEmpresa) {
  const [filas] = await db.query(`
    SELECT v.id_viaje, DATE_FORMAT(v.fecha_origen, '%d/%m/%Y') AS fecha, up.patente AS camion, us.patente AS acoplado, ch.nombre AS chofer,
           (SELECT COALESCE(SUM(m.monto), 0) FROM MOVIMIENTOS m
             WHERE m.origen_tipo = 'VIAJE_LIQUIDACION' AND m.origen_id = v.id_viaje AND m.id_empresa = v.id_empresa) AS liquidacion
      FROM VIAJES v
      LEFT JOIN UNIDADES up ON up.id_unidad = v.id_unidad_principal
      LEFT JOIN UNIDADES us ON us.id_unidad = v.id_unidad_secundaria
      LEFT JOIN CHOFERES ch ON ch.id_chofer = v.id_chofer
     WHERE v.id_equipo = ? AND v.id_empresa = ? ORDER BY v.fecha_origen, v.id_viaje`, [idEquipo, idEmpresa]);
  return filas;
}

async function main() {
  const plan = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  const idEmpresa = plan.id_empresa;
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    for (const eq of plan.equipos) {
      const periodos = [];
      for (const [i, p] of eq.periodos.entries()) {
        if (i > 0 && !p.desde) throw new Error(`Equipo ${eq.id_equipo}: el período ${i + 1} necesita "desde".`);
        periodos.push({
          desde: p.desde ? normalizar(p.desde) : null,
          up: await unidadPorPatente(db, idEmpresa, p.camion),
          us: await unidadPorPatente(db, idEmpresa, p.acoplado),
          ch: await choferPorNombre(db, idEmpresa, p.chofer),
          texto: `${p.camion}/${p.acoplado} · ${p.chofer}`
        });
      }
      for (let i = 1; i < periodos.length; i++) {
        if (periodos[i].desde <= (periodos[i - 1].desde || '')) throw new Error(`Equipo ${eq.id_equipo}: las fechas deben ir en orden creciente.`);
      }

      const baja = eq.baja ? normalizar(eq.baja) : null;
      if (baja && baja <= (periodos[periodos.length - 1].desde || '')) {
        throw new Error(`Equipo ${eq.id_equipo}: la baja tiene que ser posterior al inicio del último período.`);
      }
      if (baja) {
        const [[posterior]] = await db.query(
          'SELECT COUNT(*) AS n FROM VIAJES WHERE id_equipo = ? AND id_empresa = ? AND fecha_origen >= ?',
          [eq.id_equipo, idEmpresa, baja]);
        if (Number(posterior.n)) throw new Error(`Equipo ${eq.id_equipo}: tiene viajes posteriores a la baja (${baja}).`);
      }

      const antes = await fotos(db, eq.id_equipo, idEmpresa);
      await db.query('DELETE FROM EQUIPO_HISTORIAL WHERE id_equipo = ? AND id_empresa = ?', [eq.id_equipo, idEmpresa]);
      for (let i = 0; i < periodos.length; i++) {
        const p = periodos[i];
        const hasta = periodos[i + 1] ? periodos[i + 1].desde : baja;
        await db.query(
          `INSERT INTO EQUIPO_HISTORIAL (id_empresa, id_equipo, id_unidad_principal, id_unidad_secundaria, id_chofer, desde, hasta)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [idEmpresa, eq.id_equipo, p.up, p.us, p.ch, p.desde, hasta]);
      }
      await db.query('UPDATE EQUIPO SET activo = ?, fecha_baja = ? WHERE id_equipo = ? AND id_empresa = ?',
        [baja ? 0 : 1, baja, eq.id_equipo, idEmpresa]);
      const ultimo = periodos[periodos.length - 1];
      await db.query(
        'UPDATE EQUIPO SET id_unidad_principal = ?, id_unidad_secundaria = ?, id_chofer = ? WHERE id_equipo = ? AND id_empresa = ?',
        [ultimo.up, ultimo.us, ultimo.ch, eq.id_equipo, idEmpresa]);
      const cambiados = await refotografiarViajes(db, eq.id_equipo, idEmpresa);
      const despues = await fotos(db, eq.id_equipo, idEmpresa);

      console.log(`\n== Equipo ${eq.id_equipo}: ${periodos.length} período(s), ${cambiados} viaje(s) cambian`);
      periodos.forEach(p => console.log(`   desde ${p.desde || 'el alta'}: ${p.texto}`));
      if (baja) console.log(`   baja: ${baja}`);
      despues.forEach((d, i) => {
        const a = antes[i];
        const cambio = a.camion !== d.camion || a.acoplado !== d.acoplado || a.chofer !== d.chofer || Number(a.liquidacion) !== Number(d.liquidacion);
        if (cambio) {
          console.log(`   viaje #${d.id_viaje} ${d.fecha}: ${a.camion}/${a.acoplado} ${a.chofer} $${a.liquidacion}  →  ${d.camion}/${d.acoplado} ${d.chofer} $${d.liquidacion}`);
        }
      });
    }
    // Equipos duplicados: solo si no tienen viajes ni consumos de combustible.
    for (const idEquipo of plan.eliminar_equipos || []) {
      const [[uso]] = await db.query(
        `SELECT (SELECT COUNT(*) FROM VIAJES WHERE id_equipo = ?) AS viajes,
                (SELECT COUNT(*) FROM CONSUMOS_COMBUSTIBLE WHERE id_equipo = ?) AS consumos`, [idEquipo, idEquipo]);
      if (Number(uso.viajes) || Number(uso.consumos)) {
        throw new Error(`El equipo ${idEquipo} tiene ${uso.viajes} viaje(s) y ${uso.consumos} consumo(s): no se elimina.`);
      }
      const [r] = await db.query('DELETE FROM EQUIPO WHERE id_equipo = ? AND id_empresa = ?', [idEquipo, idEmpresa]);
      if (!r.affectedRows) throw new Error(`El equipo ${idEquipo} no existe en la empresa ${idEmpresa}.`);
      console.log(`\n== Equipo ${idEquipo} eliminado (sin viajes ni consumos)`);
    }

    // Unidades inventadas: solo si nada las referencia (si no, la base lo impide).
    for (const patente of plan.eliminar_unidades || []) {
      const id = await unidadPorPatente(db, idEmpresa, patente);
      const [[uso]] = await db.query(
        `SELECT (SELECT COUNT(*) FROM VIAJES WHERE id_unidad_principal = ? OR id_unidad_secundaria = ?) +
                (SELECT COUNT(*) FROM CONSUMOS_GENERALES WHERE id_unidad = ?) +
                (SELECT COUNT(*) FROM VENCIMIENTOS WHERE id_unidad = ?) +
                (SELECT COUNT(*) FROM MANTENIMIENTOS WHERE id_unidad = ?) +
                (SELECT COUNT(*) FROM CUBIERTAS WHERE id_unidad = ?) AS n`, [id, id, id, id, id, id]);
      if (Number(uso.n)) throw new Error(`La unidad ${patente} todavía tiene ${uso.n} registro(s) asociados: no se elimina.`);
      await db.query('DELETE FROM UNIDADES WHERE id_unidad = ? AND id_empresa = ?', [id, idEmpresa]);
      console.log(`== Unidad ${patente} eliminada`);
    }

    if (APLICAR) {
      await db.commit();
      console.log('\n✓ Aplicado.');
    } else {
      await db.rollback();
      console.log('\nVista previa: no se guardó nada. Para aplicar, agregá --aplicar.');
    }
  } catch (err) {
    await db.rollback();
    throw err;
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch(err => { console.error('✗ ' + err.message); process.exitCode = 1; });
