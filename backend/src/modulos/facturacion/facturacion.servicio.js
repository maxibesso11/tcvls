// backend/src/modulos/facturacion/facturacion.servicio.js
// Facturación electrónica (comprobantes A, B y C, y sus notas de crédito).
//
// Flujo de un comprobante:
//   BORRADOR  → el usuario lo arma en el facturador (cliente, viajes, renglones
//               editables, observaciones, fechas). No tiene número.
//   PENDIENTE → al emitir: se toma el próximo número de ARCA y se REGISTRA
//               antes de pedir el CAE (si la conexión se corta, el comprobante
//               no se pierde: se verifica con ARCA por ese número).
//   EMITIDA   → ARCA dio el CAE: se imputa en la cuenta corriente del cliente
//               y sus viajes pasan a FACTURADO.
//   ANULADA   → se emitió su nota de crédito (total): la cuenta queda
//               compensada y los viajes vuelven a FINALIZADO (facturables).
// Si ARCA rechaza el comprobante, vuelve a BORRADOR sin número, con el motivo.
// Si la conexión se corta, queda PENDIENTE: se consulta a ARCA por su número y
// solo vuelve a BORRADOR si ARCA no lo tiene y ya pasaron unos minutos (un
// pedido cortado todavía podría estar procesándose). Mientras haya uno
// PENDIENTE no se emite otro del mismo tipo: tomaría el mismo número.
//
// La letra no se elige: sale de la condición frente al IVA de la empresa y
// del cliente (facturacion.reglas.js). Los números los asigna ARCA (último
// autorizado + 1), con un candado por empresa, punto de venta y tipo para que
// dos emisiones simultáneas no tomen el mismo.
const pool = require('../../config/db');
const arca = require('../../integraciones/arca');
const { ErrorNegocio } = require('../../lib/errores');
const { ahoraLocal } = require('../../config/constantes');
const R = require('./facturacion.reglas');
const P = require('./facturacion.plantillas');
const { ORIGEN, crearMovimientoAutomatico } = require('../cuentas/movimientos.servicio');
const { reconciliarMovimientos } = require('../viajes/viajes.servicio');

const hoy = () => ahoraLocal().slice(0, 10);
const sumarDias = (fecha, dias) => {
  const d = new Date(fecha + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + (Number(dias) || 0));
  return d.toISOString().slice(0, 10);
};
const nroComprobante = f => `${String(f.punto_venta).padStart(5, '0')}-${String(f.numero).padStart(8, '0')}`;
const NOMBRE_CLASE = { FACTURA: 'FACTURA', NOTA_CREDITO: 'NOTA DE CRÉDITO' };
// Tiempo que un comprobante PENDIENTE que ARCA no tiene se sigue esperando.
const esperaPendienteMs = () => {
  const v = Number(process.env.ARCA_ESPERA_PENDIENTE_MS);
  return Number.isFinite(v) && v >= 0 ? v : 3 * 60 * 1000;
};

async function enTransaccion(fn) {
  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    const r = await fn(conexion);
    await conexion.commit();
    return r;
  } catch (err) {
    try { await conexion.rollback(); } catch (e) { /* sin transacción */ }
    throw err;
  } finally {
    conexion.release();
  }
}

// ---------------------------------------------------------------- emisor

// Datos fiscales de la empresa que factura y si está lista para emitir.
async function configuracion(idEmpresa, db = pool) {
  const [[e]] = await db.query(
    `SELECT id_empresa, nombre, cuit, domicilio, telefono, email, condicion_iva, ingresos_brutos,
            inicio_actividades, punto_venta FROM EMPRESAS WHERE id_empresa = ?`, [idEmpresa]);
  if (!e) throw new ErrorNegocio('Empresa no encontrada.', 404);
  const [[cert]] = await db.query(
    `SELECT estado, fecha_vencimiento FROM CERTIFICADOS_ARCA
      WHERE id_empresa = ? ORDER BY id_certificado DESC LIMIT 1`, [idEmpresa]);
  const faltantes = [];
  const condicion = R.normalizarCondicion(e.condicion_iva);
  if (!R.CONDICIONES_EMISOR.includes(condicion)) faltantes.push('la condición frente al IVA de la empresa');
  if (!R.cuitValido(e.cuit)) faltantes.push('un CUIT válido de la empresa (11 dígitos con verificador)');
  if (!(Number(e.punto_venta) > 0)) faltantes.push('el punto de venta de factura electrónica');
  if (!e.domicilio) faltantes.push('el domicilio comercial');
  if (!e.inicio_actividades) faltantes.push('la fecha de inicio de actividades');
  if (!cert || cert.estado !== 'ACTIVO') faltantes.push('el certificado de ARCA activo');
  else if (cert.fecha_vencimiento && String(cert.fecha_vencimiento).slice(0, 10) < hoy()) faltantes.push('un certificado de ARCA vigente (el actual está vencido)');
  return {
    empresa: e,
    condicion,
    letras: condicion === 'RESPONSABLE INSCRIPTO' ? ['A', 'B'] : condicion ? ['C'] : [],
    entorno: arca.entornoActual(),
    lista: faltantes.length === 0,
    faltantes
  };
}

// ---------------------------------------------------------------- actividades

// Actividades inscriptas de la empresa en ARCA (la que se indica en cada
// comprobante, como en el facturador web: transporte, logística…). Se
// guardan 6 horas por empresa y entorno para no consultar a ARCA cada vez.
// (ARCA_HORAS_CACHE_ACTIVIDADES lo cambia; los tests usan 0.)
const horasCacheActividades = () => {
  const v = Number(process.env.ARCA_HORAS_CACHE_ACTIVIDADES);
  return Number.isFinite(v) && v >= 0 ? v : 6;
};
const _actividades = new Map();
async function actividadesEmpresa(idEmpresa) {
  const conf = await configuracion(idEmpresa);
  if (!conf.lista) return [];
  const clave = `${idEmpresa}:${conf.entorno}`;
  const guardado = _actividades.get(clave);
  if (guardado && guardado.vence > Date.now()) return guardado.lista;
  const cliente = await arca.clienteEmpresa(idEmpresa);
  const lista = await cliente.actividades();
  _actividades.set(clave, { lista, vence: Date.now() + horasCacheActividades() * 3600e3 });
  return lista;
}

// Actividad del comprobante: si la empresa tiene una sola, va esa; si tiene
// varias, hay que elegir una de ellas (ARCA rechaza una que no esté inscripta).
async function resolverActividad(idEmpresa, actividadId) {
  let lista;
  try { lista = await actividadesEmpresa(idEmpresa); } catch (err) {
    // ARCA no respondió: el borrador se guarda igual; al emitir, ARCA valida la actividad.
    return { actividad_id: Number(actividadId) || null, actividad_descripcion: null };
  }
  if (!lista.length) return { actividad_id: null, actividad_descripcion: null };
  if (lista.length === 1 && !actividadId) return { actividad_id: lista[0].id, actividad_descripcion: lista[0].descripcion };
  const elegida = lista.find(a => a.id === Number(actividadId));
  if (!elegida) throw new ErrorNegocio('Elegí la actividad por la que facturás (por ejemplo, transporte o logística).');
  return { actividad_id: elegida.id, actividad_descripcion: elegida.descripcion };
}

// ---------------------------------------------------------------- viajes

const SQL_VIAJE = `
  SELECT v.*, up.patente AS patente_principal, us.patente AS patente_secundaria, ch.nombre AS chofer
    FROM VIAJES v
    LEFT JOIN UNIDADES up ON up.id_unidad = v.id_unidad_principal
    LEFT JOIN UNIDADES us ON us.id_unidad = v.id_unidad_secundaria
    LEFT JOIN CHOFERES ch ON ch.id_chofer = v.id_chofer`;

// Viajes de un cliente que se pueden facturar: finalizados, con ese pagador y
// que no estén en otro comprobante vigente (borrador, pendiente o emitido).
async function viajesFacturables(idEmpresa, idCuenta, { incluirFactura = null } = {}, db = pool) {
  const [[cuenta]] = await db.query('SELECT nombre FROM CUENTA WHERE id_cuenta = ? AND id_empresa = ?', [idCuenta, idEmpresa]);
  if (!cuenta) throw new ErrorNegocio('El cliente no existe.', 404);
  const [filas] = await db.query(`${SQL_VIAJE}
    WHERE v.id_empresa = ? AND v.pagador = ? AND v.estado = 'FINALIZADO'
      AND NOT EXISTS (
        SELECT 1 FROM FACTURA_VIAJES fv JOIN FACTURAS f ON f.id_factura = fv.id_factura
         WHERE fv.id_viaje = v.id_viaje AND f.estado IN ('BORRADOR', 'PENDIENTE', 'EMITIDA')
           AND f.id_factura <> ?)
    ORDER BY v.fecha_origen`, [idEmpresa, cuenta.nombre, incluirFactura || 0]);
  return filas;
}

// Cuentas a las que se puede facturar: los clientes y cualquier cuenta que
// figure como pagador de viajes (puede ser un PROVEEDOR, por ejemplo otro
// transportista que contrata el flete), con sus viajes pendientes de facturar.
async function cuentasFacturables(idEmpresa, db = pool) {
  const [filas] = await db.query(`
    SELECT c.id_cuenta, c.tipo, c.nombre, c.cuil, c.condicion_iva, c.domicilio, c.plazo_pago_dias,
           c.plantilla_item, c.plantilla_observaciones, c.actividad_arca,
           (SELECT COUNT(*) FROM VIAJES v
             WHERE v.id_empresa = c.id_empresa AND v.pagador = c.nombre AND v.estado = 'FINALIZADO'
               AND NOT EXISTS (SELECT 1 FROM FACTURA_VIAJES fv JOIN FACTURAS f ON f.id_factura = fv.id_factura
                                WHERE fv.id_viaje = v.id_viaje AND f.estado IN ('BORRADOR', 'PENDIENTE', 'EMITIDA'))) AS viajes_pendientes
      FROM CUENTA c
     WHERE c.id_empresa = ?
       AND (c.tipo = 'CLIENTE'
            OR (c.tipo = 'PROVEEDOR' AND EXISTS (SELECT 1 FROM VIAJES v2 WHERE v2.id_empresa = c.id_empresa AND v2.pagador = c.nombre)))
     ORDER BY viajes_pendientes > 0 DESC, c.nombre`, [idEmpresa]);
  return filas.map(f => ({ ...f, viajes_pendientes: Number(f.viajes_pendientes) }));
}

// ---------------------------------------------------------------- borradores

// Propuesta de comprobante (sin guardar) para un cliente y sus viajes: letra,
// receptor, renglones y observaciones según las plantillas del cliente,
// período del servicio y vencimiento según su plazo de pago.
async function preparar(idEmpresa, { id_cuenta, viajes = [] }) {
  const conf = await configuracion(idEmpresa);
  const [[cuenta]] = await pool.query('SELECT * FROM CUENTA WHERE id_cuenta = ? AND id_empresa = ?', [id_cuenta, idEmpresa]);
  if (!cuenta) throw new ErrorNegocio('El cliente no existe.', 404);
  const disponibles = await viajesFacturables(idEmpresa, id_cuenta);
  const elegidos = disponibles.filter(v => viajes.map(Number).includes(v.id_viaje));
  if (elegidos.length !== viajes.length) {
    throw new ErrorNegocio('Alguno de los viajes no se puede facturar (no está finalizado, es de otro cliente o ya está en otro comprobante).');
  }
  let letra = null, avisoLetra = null;
  try { letra = R.letraComprobante(conf.condicion, cuenta.condicion_iva); } catch (e) { avisoLetra = e.message; }
  const fechas = elegidos.map(v => String(v.fecha_origen).slice(0, 10)).sort();
  const fecha = hoy();
  return {
    id_cuenta: cuenta.id_cuenta,
    cliente: { nombre: cuenta.nombre, cuit: cuenta.cuil, domicilio: cuenta.domicilio, condicion_iva: cuenta.condicion_iva,
      plazo_pago_dias: cuenta.plazo_pago_dias, plantilla_item: cuenta.plantilla_item, plantilla_observaciones: cuenta.plantilla_observaciones },
    letra, aviso_letra: avisoLetra,
    actividad_id: cuenta.actividad_arca || null,
    viajes: elegidos.map(v => v.id_viaje),
    items: elegidos.map(v => P.itemDeViaje(v, cuenta.plantilla_item)),
    observaciones: P.observaciones(elegidos, cuenta.plantilla_observaciones),
    fecha_emision: fecha,
    fecha_servicio_desde: fechas[0] || fecha,
    fecha_servicio_hasta: fechas[fechas.length - 1] || fecha,
    fecha_vto_pago: sumarDias(fecha, cuenta.plazo_pago_dias || 0)
  };
}

// Valida y normaliza los datos del facturador. Devuelve los datos del
// comprobante listos para guardar (sin número).
async function normalizarBorrador(db, idEmpresa, datos, idFactura) {
  const conf = await configuracion(idEmpresa, db);
  const [[cuenta]] = await db.query('SELECT * FROM CUENTA WHERE id_cuenta = ? AND id_empresa = ?', [datos.id_cuenta, idEmpresa]);
  if (!cuenta) throw new ErrorNegocio('Elegí el cliente.');
  const condicionReceptor = R.normalizarCondicion(datos.receptor_condicion_iva || cuenta.condicion_iva);
  let letra;
  try { letra = R.letraComprobante(conf.condicion, condicionReceptor); } catch (e) { throw new ErrorNegocio(e.message); }
  let doc;
  try { doc = R.documentoReceptor(letra, condicionReceptor, datos.receptor_documento ?? cuenta.cuil); } catch (e) { throw new ErrorNegocio(e.message); }
  let importes;
  try { importes = R.calcularImportes(datos.items, letra); } catch (e) { throw new ErrorNegocio(e.message); }

  // Viajes: tienen que ser facturables para este cliente.
  const idsViajes = [...new Set((datos.viajes || []).map(Number).filter(Boolean))];
  if (idsViajes.length) {
    const disponibles = (await viajesFacturables(idEmpresa, cuenta.id_cuenta, { incluirFactura: idFactura }, db)).map(v => v.id_viaje);
    const ajenos = idsViajes.filter(id => !disponibles.includes(id));
    if (ajenos.length) throw new ErrorNegocio(`Los viajes ${ajenos.map(i => '#' + i).join(', ')} no se pueden facturar (no están finalizados, son de otro cliente o ya están en otro comprobante).`);
  }
  for (const it of importes.items) {
    if (it.id_viaje && !idsViajes.includes(it.id_viaje)) it.id_viaje = null;
  }
  const actividad = await resolverActividad(idEmpresa, datos.actividad_id);
  return {
    cuenta, letra, doc, condicionReceptor, importes, idsViajes, conf,
    fila: {
      clase: 'FACTURA',
      tipo_comprobante: letra,
      codigo_arca: R.codigoComprobante(letra, 'FACTURA'),
      punto_venta: Number(conf.empresa.punto_venta) || 1,
      fecha_emision: datos.fecha_emision || hoy(),
      concepto: 2,
      ...actividad,
      fecha_servicio_desde: datos.fecha_servicio_desde || datos.fecha_emision || hoy(),
      fecha_servicio_hasta: datos.fecha_servicio_hasta || datos.fecha_emision || hoy(),
      fecha_vto_pago: datos.fecha_vto_pago || datos.fecha_emision || hoy(),
      id_cuenta: cuenta.id_cuenta,
      receptor_cuit: doc.numero,
      receptor_doc_tipo: doc.tipo,
      receptor_nombre: cuenta.nombre,
      receptor_domicilio: cuenta.domicilio || null,
      receptor_condicion_iva: condicionReceptor || (letra === 'C' ? 'CONSUMIDOR FINAL' : null),
      condicion_iva_receptor_id: R.CONDICION_RECEPTOR_ID[condicionReceptor] || R.CONDICION_RECEPTOR_ID['CONSUMIDOR FINAL'],
      emisor_condicion_iva: conf.condicion,
      neto_gravado: importes.neto,
      iva: importes.iva,
      total: importes.total,
      observaciones: String(datos.observaciones || '').trim().slice(0, 2000) || null
    }
  };
}

async function guardarRenglones(db, idFactura, items, idsViajes) {
  await db.query('DELETE FROM FACTURA_ITEMS WHERE id_factura = ?', [idFactura]);
  await db.query('DELETE FROM FACTURA_VIAJES WHERE id_factura = ?', [idFactura]);
  for (const it of items) {
    await db.query(
      `INSERT INTO FACTURA_ITEMS (id_factura, id_viaje, descripcion, cantidad, unidad, precio_unitario, subtotal)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [idFactura, it.id_viaje, it.descripcion, it.cantidad, it.unidad, it.precio_unitario, it.subtotal]);
  }
  for (const idViaje of idsViajes) {
    await db.query('INSERT INTO FACTURA_VIAJES (id_factura, id_viaje) VALUES (?, ?)', [idFactura, idViaje]);
  }
}

// Cliente cargado en el momento desde el facturador (CUIT o DNI, razón social,
// domicilio y condición frente al IVA): si ese documento ya tiene una cuenta en
// la empresa se usa esa; si no, se da de alta como CLIENTE. Toda factura se
// imputa en una cuenta corriente, por eso el cliente queda registrado.
async function cuentaDeClienteNuevo(db, idEmpresa, nuevo, condicion) {
  const nombre = String(nuevo.nombre || '').trim().slice(0, 150);
  if (!nombre) throw new ErrorNegocio('Indicá la razón social o el nombre del cliente nuevo.');
  const doc = String(nuevo.documento || '').replace(/\D/g, '');
  const cond = R.normalizarCondicion(condicion);
  if (!cond) throw new ErrorNegocio('Indicá la condición frente al IVA del cliente nuevo.');
  let cuil;
  if (doc.length === 11) {
    if (!R.cuitValido(doc)) throw new ErrorNegocio(`El CUIT ${nuevo.documento} no es válido: revisá el número.`);
    cuil = `${doc.slice(0, 2)}-${doc.slice(2, 10)}-${doc.slice(10)}`;
  } else if ((doc.length === 7 || doc.length === 8) && cond === 'CONSUMIDOR FINAL') {
    cuil = doc;
  } else {
    throw new ErrorNegocio(cond === 'CONSUMIDOR FINAL'
      ? 'Indicá el CUIT (11 dígitos) o el DNI (7 u 8 dígitos) del cliente nuevo.'
      : 'Indicá el CUIT del cliente nuevo (11 dígitos).');
  }
  const [[existente]] = await db.query(
    "SELECT id_cuenta FROM CUENTA WHERE id_empresa = ? AND REPLACE(cuil, '-', '') = ? LIMIT 1", [idEmpresa, doc]);
  if (existente) return existente.id_cuenta;
  const [r] = await db.query(
    `INSERT INTO CUENTA (id_empresa, tipo, cuil, nombre, domicilio, condicion_iva) VALUES (?, 'CLIENTE', ?, ?, ?, ?)`,
    [idEmpresa, cuil, nombre, String(nuevo.domicilio || '').trim().slice(0, 150) || null, cond]);
  return r.insertId;
}

// Crea o actualiza un borrador. Si se pide, guarda las plantillas del cliente.
async function guardarBorrador(idEmpresa, datos, idFactura = null) {
  return enTransaccion(async db => {
    if (!datos.id_cuenta && datos.cliente_nuevo) {
      datos = { ...datos, id_cuenta: await cuentaDeClienteNuevo(db, idEmpresa, datos.cliente_nuevo, datos.receptor_condicion_iva), viajes: [] };
    }
    if (idFactura) {
      const [[f]] = await db.query('SELECT estado, clase FROM FACTURAS WHERE id_factura = ? AND id_empresa = ? FOR UPDATE', [idFactura, idEmpresa]);
      if (!f) throw new ErrorNegocio('Comprobante no encontrado.', 404);
      if (f.estado !== 'BORRADOR' || f.clase !== 'FACTURA') throw new ErrorNegocio('Solo se puede modificar un borrador de factura.');
    }
    const n = await normalizarBorrador(db, idEmpresa, datos, idFactura);
    if (idFactura) {
      await db.query('UPDATE FACTURAS SET ?, respuesta_arca = NULL WHERE id_factura = ? AND id_empresa = ?', [n.fila, idFactura, idEmpresa]);
    } else {
      const [r] = await db.query('INSERT INTO FACTURAS SET ?', [{ ...n.fila, id_empresa: idEmpresa, estado: 'BORRADOR' }]);
      idFactura = r.insertId;
    }
    await guardarRenglones(db, idFactura, n.importes.items, n.idsViajes);
    if (datos.guardar_plantillas) {
      await db.query('UPDATE CUENTA SET plantilla_item = ?, plantilla_observaciones = ? WHERE id_cuenta = ? AND id_empresa = ?',
        [datos.plantilla_item || null, datos.plantilla_observaciones || null, n.cuenta.id_cuenta, idEmpresa]);
    }
    if (n.fila.actividad_id) {
      await db.query('UPDATE CUENTA SET actividad_arca = ? WHERE id_cuenta = ? AND id_empresa = ?', [n.fila.actividad_id, n.cuenta.id_cuenta, idEmpresa]);
    }
    // Condición del cliente: si no la tenía cargada, queda guardada.
    if (!R.normalizarCondicion(n.cuenta.condicion_iva) && n.condicionReceptor) {
      await db.query('UPDATE CUENTA SET condicion_iva = ? WHERE id_cuenta = ?', [n.condicionReceptor, n.cuenta.id_cuenta]);
    }
    return idFactura;
  });
}

async function eliminarBorrador(idEmpresa, idFactura) {
  return enTransaccion(async db => {
    const [[f]] = await db.query('SELECT estado FROM FACTURAS WHERE id_factura = ? AND id_empresa = ? FOR UPDATE', [idFactura, idEmpresa]);
    if (!f) throw new ErrorNegocio('Comprobante no encontrado.', 404);
    if (f.estado !== 'BORRADOR') throw new ErrorNegocio('Solo se puede eliminar un borrador. Un comprobante emitido se anula con nota de crédito.');
    await db.query('DELETE FROM FACTURAS WHERE id_factura = ? AND id_empresa = ?', [idFactura, idEmpresa]);
  });
}

// ---------------------------------------------------------------- consultas

const leerJson = t => { try { return t ? JSON.parse(t) : null; } catch (e) { return { texto: String(t) }; } };

async function obtener(idEmpresa, idFactura, db = pool) {
  const [[f]] = await db.query('SELECT * FROM FACTURAS WHERE id_factura = ? AND id_empresa = ?', [idFactura, idEmpresa]);
  if (!f) throw new ErrorNegocio('Comprobante no encontrado.', 404);
  const [items] = await db.query('SELECT * FROM FACTURA_ITEMS WHERE id_factura = ? ORDER BY id_item', [idFactura]);
  const [viajes] = await db.query('SELECT id_viaje FROM FACTURA_VIAJES WHERE id_factura = ? ORDER BY id_viaje', [idFactura]);
  let asociada = null;
  if (f.id_factura_asociada) {
    const [[a]] = await db.query('SELECT * FROM FACTURAS WHERE id_factura = ? AND id_empresa = ?', [f.id_factura_asociada, idEmpresa]);
    asociada = a || null;
  }
  return { ...f, items, viajes: viajes.map(v => v.id_viaje), asociada,
    respuesta_arca: leerJson(f.respuesta_arca) };
}

// ---------------------------------------------------------------- emisión

// Completa un comprobante autorizado: CAE, cuenta corriente y viajes.
async function completarEmision(db, idEmpresa, f, autorizacion) {
  await db.query(
    `UPDATE FACTURAS SET estado = 'EMITIDA', cae = ?, cae_vencimiento = ?, respuesta_arca = ?
      WHERE id_factura = ? AND id_empresa = ?`,
    [autorizacion.cae, R.deArca(autorizacion.caeVencimiento), JSON.stringify({ observaciones: autorizacion.observaciones || [] }),
     f.id_factura, idEmpresa]);
  const [viajes] = await db.query('SELECT id_viaje FROM FACTURA_VIAJES WHERE id_factura = ?', [f.id_factura]);
  const etiqueta = `${f.clase === 'NOTA_CREDITO' ? 'NOTA DE CREDITO' : 'FACTURA'} ${f.tipo_comprobante} ${nroComprobante(f)}`;

  if (f.clase === 'FACTURA') {
    // Débito al cliente por el total del comprobante.
    await crearMovimientoAutomatico(db, {
      idEmpresa, idCuenta: f.id_cuenta, monto: -Math.abs(Number(f.total)), fecha: f.fecha_emision,
      concepto: `${etiqueta}` + (viajes.length ? `, viajes ${viajes.map(v => '#' + v.id_viaje).join(', ')}` : ''),
      origenTipo: ORIGEN.FACTURA, origenId: f.id_factura
    });
    // Los viajes pasan a FACTURADO con comprobante (su movimiento es el de la factura).
    for (const { id_viaje } of viajes) {
      await db.query(`UPDATE VIAJES SET estado = 'FACTURADO', modo_facturacion = 'FACTURA' WHERE id_viaje = ? AND id_empresa = ?`, [id_viaje, idEmpresa]);
      await reconciliarMovimientos(db, id_viaje, idEmpresa);
    }
  } else {
    // Nota de crédito: crédito al cliente, la factura queda anulada y sus
    // viajes vuelven a estar disponibles para facturar.
    await crearMovimientoAutomatico(db, {
      idEmpresa, idCuenta: f.id_cuenta, monto: Math.abs(Number(f.total)), fecha: f.fecha_emision,
      concepto: `${etiqueta} (anula comprobante asociado)`, origenTipo: ORIGEN.NOTA_CREDITO, origenId: f.id_factura
    });
    await db.query(`UPDATE FACTURAS SET estado = 'ANULADA' WHERE id_factura = ? AND id_empresa = ?`, [f.id_factura_asociada, idEmpresa]);
    const [viajesFactura] = await db.query('SELECT id_viaje FROM FACTURA_VIAJES WHERE id_factura = ?', [f.id_factura_asociada]);
    for (const { id_viaje } of viajesFactura) {
      await db.query(`UPDATE VIAJES SET estado = 'FINALIZADO', modo_facturacion = NULL WHERE id_viaje = ? AND id_empresa = ?`, [id_viaje, idEmpresa]);
      await reconciliarMovimientos(db, id_viaje, idEmpresa);
    }
  }
}

// Vuelve un comprobante PENDIENTE a BORRADOR sin número (ARCA no lo autorizó).
async function volverABorrador(db, idEmpresa, idFactura, respuesta) {
  await db.query(
    `UPDATE FACTURAS SET estado = 'BORRADOR', numero = NULL, cae = NULL, cae_vencimiento = NULL, respuesta_arca = ?
      WHERE id_factura = ? AND id_empresa = ? AND estado = 'PENDIENTE'`,
    [respuesta ? JSON.stringify(respuesta) : null, idFactura, idEmpresa]);
}

// Detalle para ARCA a partir del comprobante guardado.
function detalleArca(f, empresaCuit, asociada) {
  const importes = { neto: Number(f.neto_gravado), iva: Number(f.iva), total: Number(f.total) };
  return {
    puntoVenta: f.punto_venta, tipo: f.codigo_arca, numero: f.numero,
    concepto: f.concepto, docTipo: f.receptor_doc_tipo, docNro: f.receptor_cuit,
    fecha: R.aArca(f.fecha_emision),
    servicioDesde: R.aArca(f.fecha_servicio_desde), servicioHasta: R.aArca(f.fecha_servicio_hasta),
    vencimientoPago: R.aArca(f.fecha_vto_pago),
    total: importes.total, neto: importes.neto, iva: importes.iva,
    alicuotas: f.tipo_comprobante === 'C' ? [] : [{ id: R.ALICUOTA_IVA_ID, base: importes.neto, importe: importes.iva }],
    condicionIvaReceptor: f.condicion_iva_receptor_id,
    actividad: f.actividad_id || null,
    asociado: asociada ? {
      tipo: asociada.codigo_arca, puntoVenta: asociada.punto_venta, numero: asociada.numero,
      cuit: empresaCuit, fecha: R.aArca(asociada.fecha_emision)
    } : null
  };
}

const textoRespuesta = r => [...(r.errores || []), ...(r.observaciones || [])]
  .map(e => `[${e.codigo}] ${e.mensaje}`).join('; ') || 'ARCA rechazó el comprobante sin informar el motivo.';

// Emite un comprobante (factura o nota de crédito) que está en BORRADOR.
async function emitir(idEmpresa, idFactura) {
  const conf = await configuracion(idEmpresa);
  if (!conf.lista) throw new ErrorNegocio('Para emitir falta: ' + conf.faltantes.join(', ') + '.');
  const cliente = await arca.clienteEmpresa(idEmpresa);

  // Validación final con los datos guardados (la condición de la empresa pudo cambiar).
  const f0 = await obtener(idEmpresa, idFactura);
  if (f0.estado === 'PENDIENTE') return verificar(idEmpresa, idFactura);
  if (f0.estado !== 'BORRADOR') throw new ErrorNegocio('El comprobante ya fue emitido.');
  let letraEsperada;
  try {
    letraEsperada = f0.clase === 'NOTA_CREDITO' ? f0.asociada && f0.asociada.tipo_comprobante
      : R.letraComprobante(conf.condicion, f0.receptor_condicion_iva);
  } catch (e) { throw new ErrorNegocio(e.message); }
  if (letraEsperada !== f0.tipo_comprobante) {
    throw new ErrorNegocio(`Con la condición actual de la empresa corresponde comprobante ${letraEsperada}: abrí el borrador y guardalo de nuevo.`);
  }
  try { R.validarFechas({ fecha: String(f0.fecha_emision).slice(0, 10), servicioDesde: String(f0.fecha_servicio_desde).slice(0, 10),
    servicioHasta: String(f0.fecha_servicio_hasta).slice(0, 10), vencimientoPago: String(f0.fecha_vto_pago).slice(0, 10) }, hoy());
  } catch (e) { throw new ErrorNegocio(e.message); }

  // Candado por empresa + punto de venta + tipo: un número por vez.
  const candado = `tcv_cbte_${idEmpresa}_${f0.punto_venta}_${f0.codigo_arca}`;
  const conexionCandado = await pool.getConnection();
  try {
    const [[c]] = await conexionCandado.query('SELECT GET_LOCK(?, 90) AS ok', [candado]);
    if (Number(c.ok) !== 1) throw new ErrorNegocio('Se está emitiendo otro comprobante del mismo tipo. Probá de nuevo en un momento.');

    // Si quedó otro comprobante del mismo tipo esperando el CAE, primero se aclara.
    const [pendientes] = await pool.query(
      `SELECT id_factura FROM FACTURAS WHERE id_empresa = ? AND estado = 'PENDIENTE' AND entorno = ?
          AND punto_venta = ? AND codigo_arca = ? AND id_factura <> ?`,
      [idEmpresa, cliente.entorno, f0.punto_venta, f0.codigo_arca, idFactura]);
    for (const p of pendientes) {
      const r = await verificarSinCandado(idEmpresa, p.id_factura, cliente);
      if (r.estado === 'PENDIENTE') {
        throw new ErrorNegocio(`Hay un comprobante ${r.tipo_comprobante} ${nroComprobante(r)} esperando la confirmación de ARCA. ` +
          'Esperá unos minutos y tocá "Verificar con ARCA" en ese comprobante antes de emitir otro.', 409);
      }
    }

    // 1. Número: último autorizado en ARCA + 1, registrado ANTES de pedir el CAE.
    const numero = (await cliente.ultimoAutorizado(f0.punto_venta, f0.codigo_arca)) + 1;
    await enTransaccion(async db => {
      const [r] = await db.query(
        `UPDATE FACTURAS SET estado = 'PENDIENTE', numero = ?, entorno = ?, respuesta_arca = ?
          WHERE id_factura = ? AND id_empresa = ? AND estado = 'BORRADOR'`,
        [numero, cliente.entorno, JSON.stringify({ pendiente_desde: Date.now() }), idFactura, idEmpresa]);
      if (!r.affectedRows) throw new ErrorNegocio('El comprobante cambió mientras se emitía. Volvé a abrirlo.');
    });
    const f = { ...f0, numero, entorno: cliente.entorno };

    // 2. CAE.
    let resp;
    try {
      resp = await cliente.solicitarCAE(detalleArca(f, cliente.cuit, f0.asociada));
    } catch (err) {
      if (err.incierto) {
        // No se sabe si ARCA lo autorizó: se le pregunta por el número.
        let r = null;
        try { r = await verificarSinCandado(idEmpresa, idFactura, cliente); } catch (e2) { /* sigue pendiente */ }
        if (r && r.estado === 'EMITIDA') return r;
        if (r && r.estado === 'BORRADOR') {
          throw new ErrorNegocio('Se cortó la comunicación con ARCA y el comprobante no llegó a registrarse: no se emitió. Podés volver a emitirlo.', 502);
        }
        throw new ErrorNegocio(`Se cortó la comunicación con ARCA. El comprobante ${f.tipo_comprobante} ${nroComprobante(f)} quedó PENDIENTE: ` +
          'en unos minutos tocá "Verificar con ARCA" (no lo vuelvas a cargar).', 502);
      }
      await enTransaccion(db => volverABorrador(db, idEmpresa, idFactura, { errores: [{ codigo: err.codigo || 'ARCA', mensaje: err.message }] }));
      throw new ErrorNegocio('No se pudo emitir: ' + err.message, 502);
    }

    if (!resp.aprobado) {
      await enTransaccion(db => volverABorrador(db, idEmpresa, idFactura, resp));
      throw new ErrorNegocio('ARCA rechazó el comprobante: ' + textoRespuesta(resp), 422);
    }
    await enTransaccion(db => completarEmision(db, idEmpresa, f, resp));
    return obtener(idEmpresa, idFactura);
  } finally {
    try { await conexionCandado.query('SELECT RELEASE_LOCK(?)', [candado]); } catch (e) { /* se libera al cerrar */ }
    conexionCandado.release();
  }
}

// Aclara un comprobante PENDIENTE preguntándole a ARCA por su número.
async function verificarSinCandado(idEmpresa, idFactura, cliente) {
  const f = await obtener(idEmpresa, idFactura);
  if (f.estado !== 'PENDIENTE') return f;
  const encontrado = await cliente.consultar(f.punto_venta, f.codigo_arca, f.numero);
  if (encontrado && encontrado.resultado === 'A' && encontrado.cae) {
    if (Math.abs(encontrado.total - Number(f.total)) > 0.01) {
      await enTransaccion(db => volverABorrador(db, idEmpresa, idFactura, { errores: [{ codigo: 'NUMERO_USADO',
        mensaje: `ARCA tiene el número ${nroComprobante(f)} autorizado por otro importe ($${encontrado.total}): ese número lo usó otro sistema.` }] }));
      throw new ErrorNegocio(`El número ${nroComprobante(f)} figura en ARCA con otro importe: lo usó otro sistema. El comprobante volvió a borrador.`);
    }
    await enTransaccion(db => completarEmision(db, idEmpresa, f, { cae: encontrado.cae, caeVencimiento: encontrado.caeVencimiento }));
  } else {
    // ARCA no lo tiene. Si el pedido es reciente todavía podría estar
    // procesándose: se sigue esperando. Si no, el número no se usó y el
    // comprobante vuelve a borrador para reintentar.
    const desde = Number(f.respuesta_arca && f.respuesta_arca.pendiente_desde) || 0;
    if (Date.now() - desde < esperaPendienteMs()) return f;
    await enTransaccion(db => volverABorrador(db, idEmpresa, idFactura,
      { errores: [{ codigo: 'SIN_CAE', mensaje: 'ARCA no registró el comprobante: no se emitió. Podés volver a emitirlo.' }] }));
  }
  return obtener(idEmpresa, idFactura);
}

async function verificar(idEmpresa, idFactura) {
  const cliente = await arca.clienteEmpresa(idEmpresa);
  const f = await obtener(idEmpresa, idFactura);
  const candado = `tcv_cbte_${idEmpresa}_${f.punto_venta}_${f.codigo_arca}`;
  const conexion = await pool.getConnection();
  try {
    const [[c]] = await conexion.query('SELECT GET_LOCK(?, 90) AS ok', [candado]);
    if (Number(c.ok) !== 1) throw new ErrorNegocio('Se está emitiendo otro comprobante del mismo tipo. Probá de nuevo en un momento.');
    return await verificarSinCandado(idEmpresa, idFactura, cliente);
  } finally {
    try { await conexion.query('SELECT RELEASE_LOCK(?)', [candado]); } catch (e) { /* */ }
    conexion.release();
  }
}

// Nota de crédito por el total de un comprobante emitido: se arma con los
// mismos renglones y se emite en el momento.
async function anularConNotaCredito(idEmpresa, idFactura, { observaciones } = {}) {
  const f = await obtener(idEmpresa, idFactura);
  if (f.clase !== 'FACTURA') throw new ErrorNegocio('Solo se puede anular una factura.');
  if (f.estado !== 'EMITIDA') throw new ErrorNegocio('Solo se puede anular una factura emitida.');
  const [[existente]] = await pool.query(
    `SELECT id_factura, estado FROM FACTURAS WHERE id_factura_asociada = ? AND id_empresa = ? AND clase = 'NOTA_CREDITO'
        AND estado IN ('BORRADOR', 'PENDIENTE')`, [idFactura, idEmpresa]);
  const idNC = existente ? existente.id_factura : await enTransaccion(async db => {
    const [r] = await db.query('INSERT INTO FACTURAS SET ?', [{
      id_empresa: idEmpresa, clase: 'NOTA_CREDITO', tipo_comprobante: f.tipo_comprobante,
      codigo_arca: R.codigoComprobante(f.tipo_comprobante, 'NOTA_CREDITO'), punto_venta: f.punto_venta,
      fecha_emision: hoy(), concepto: f.concepto,
      actividad_id: f.actividad_id, actividad_descripcion: f.actividad_descripcion,
      fecha_servicio_desde: f.fecha_servicio_desde, fecha_servicio_hasta: f.fecha_servicio_hasta, fecha_vto_pago: hoy(),
      id_cuenta: f.id_cuenta, id_factura_asociada: f.id_factura,
      receptor_cuit: f.receptor_cuit, receptor_doc_tipo: f.receptor_doc_tipo, receptor_nombre: f.receptor_nombre,
      receptor_domicilio: f.receptor_domicilio, receptor_condicion_iva: f.receptor_condicion_iva,
      condicion_iva_receptor_id: f.condicion_iva_receptor_id, emisor_condicion_iva: f.emisor_condicion_iva,
      neto_gravado: f.neto_gravado, iva: f.iva, total: f.total, estado: 'BORRADOR',
      observaciones: String(observaciones || `Anula ${NOMBRE_CLASE.FACTURA} ${f.tipo_comprobante} ${nroComprobante(f)}`).slice(0, 2000)
    }]);
    for (const it of f.items) {
      await db.query(
        `INSERT INTO FACTURA_ITEMS (id_factura, id_viaje, descripcion, cantidad, unidad, precio_unitario, subtotal)
         VALUES (?, ?, ?, ?, ?, ?, ?)`, [r.insertId, it.id_viaje, it.descripcion, it.cantidad, it.unidad, it.precio_unitario, it.subtotal]);
    }
    return r.insertId;
  });
  return emitir(idEmpresa, idNC);
}

async function guardarPlantillas(idEmpresa, idCuenta, { plantilla_item, plantilla_observaciones }) {
  const [r] = await pool.query('UPDATE CUENTA SET plantilla_item = ?, plantilla_observaciones = ? WHERE id_cuenta = ? AND id_empresa = ?',
    [String(plantilla_item || '').slice(0, 255) || null, String(plantilla_observaciones || '').slice(0, 2000) || null, idCuenta, idEmpresa]);
  if (!r.affectedRows) throw new ErrorNegocio('El cliente no existe.', 404);
}

module.exports = {
  configuracion, actividadesEmpresa, cuentasFacturables, viajesFacturables, preparar, guardarBorrador, eliminarBorrador, obtener,
  emitir, verificar, anularConNotaCredito, guardarPlantillas, nroComprobante, detalleArca
};
