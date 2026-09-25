// backend/src/modulos/facturacion/facturacion.servicio.js
// Lógica de negocio de la facturación (Factura A y Nota de Crédito A):
//   - numeración correlativa por (empresa, clase, punto de venta),
//   - cálculo de importes (neto, IVA 21%, total),
//   - pedido del CAE a ARCA (integraciones/arca.js; sin ARCA → BORRADOR),
//   - alta del comprobante con sus ítems e imputación en la cuenta corriente,
// todo dentro de una transacción.
//
// Imputación en cuenta corriente (movimientos con origen formal):
//   - Factura manual (sin viaje) → débito propio (origen FACTURA).
//   - Factura de un viaje        → el débito lo genera el viaje, por su único
//                                  camino (viajes.servicio.js), por el total
//                                  de la factura.
//   - Nota de crédito            → crédito por el total (origen NOTA_CREDITO).
const pool = require('../../config/db');
const { solicitarCAE } = require('../../integraciones/arca');
const { IVA_ALICUOTA } = require('../../config/constantes');
const { ORIGEN, crearMovimientoAutomatico } = require('../cuentas/movimientos.servicio');
const { reconciliarMovimientos } = require('../viajes/viajes.servicio');
const { ErrorNegocio } = require('../../lib/errores');

const r2 = n => Math.round(Number(n) * 100) / 100;

// Importe facturable de un viaje: base (tarifa × resultado, o tarifa si es
// UNICA; sin resultado se usa la cantidad cargada) menos la comisión.
// Devuelve la base sin redondear y el neto redondeado a 2 decimales.
function importeFacturableDeViaje(viaje) {
  const base = viaje.tipo_tarifa === 'UNICA'
    ? Number(viaje.tarifa)
    : Number(viaje.tarifa) * Number(viaje.resultado != null ? viaje.resultado : (viaje.cantidad_cargada || 0));
  const neto = r2(base * (1 - (Number(viaje.comision) || 0) / 100));
  return { base, neto };
}

// Calcula el próximo número correlativo para empresa + clase + punto de venta.
// Facturas y notas de crédito llevan secuencias independientes.
async function proximoNumero(conexion, idEmpresa, clase, puntoVenta) {
  const [[fila]] = await conexion.query(
    `SELECT COALESCE(MAX(numero), 0) AS ultimo
       FROM FACTURAS WHERE id_empresa = ? AND clase = ? AND tipo_comprobante = 'A' AND punto_venta = ?`,
    [idEmpresa, clase, puntoVenta]
  );
  return fila.ultimo + 1;
}

// Ejecuta fn(conexion) dentro de una transacción propia.
async function enTransaccion(fn) {
  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    const resultado = await fn(conexion);
    await conexion.commit();
    return resultado;
  } catch (err) {
    try { await conexion.rollback(); } catch (e) { /* ya estaba sin transacción */ }
    throw err;
  } finally {
    conexion.release();
  }
}

// Inserta un comprobante (factura o nota de crédito) con sus ítems usando la
// conexión (y transacción) de quien llama. Si ARCA está configurado, solicita
// el CAE. Devuelve el id del comprobante.
async function insertarComprobante(conexion, idEmpresa, { id_cuenta, id_viaje, items, observaciones, clase = 'FACTURA', id_factura_asociada = null }) {
  // Datos del emisor (empresa) y del receptor (cuenta)
  const [[empresa]] = await conexion.query('SELECT * FROM EMPRESAS WHERE id_empresa = ?', [idEmpresa]);
  if (!empresa) throw new ErrorNegocio('Empresa no encontrada.', 404);
  const [[cuenta]] = await conexion.query(
    'SELECT * FROM CUENTA WHERE id_cuenta = ? AND id_empresa = ?', [id_cuenta, idEmpresa]);
  if (!cuenta) throw new ErrorNegocio('La cuenta indicada no existe.', 404);
  if (!cuenta.cuil) throw new ErrorNegocio('La cuenta no tiene CUIT cargado; es obligatorio para Factura A.');

  // Calcular importes a partir de los ítems (precios sin IVA).
  // La unidad de medida (horas, km, toneladas, etc.) se guarda en su propio
  // campo y se muestra junto a la cantidad en el comprobante.
  const itemsCalc = items.map(it => {
    const cantidad = Number(it.cantidad) || 1;
    const precio = Number(it.precio_unitario) || 0;
    const unidad = String(it.unidad || '').trim().slice(0, 20) || null;
    return { descripcion: String(it.descripcion || '').trim().slice(0, 255), cantidad, unidad, precio_unitario: precio, subtotal: r2(cantidad * precio) };
  });
  const netoGravado = r2(itemsCalc.reduce((s, it) => s + it.subtotal, 0));
  const iva = r2(netoGravado * IVA_ALICUOTA);
  const total = r2(netoGravado + iva);
  if (netoGravado <= 0) throw new ErrorNegocio('El importe de la factura debe ser mayor a cero.');

  const puntoVenta = empresa.punto_venta || 1;

  // Intentar obtener el CAE de ARCA. Si ARCA está activo, el número del
  // comprobante lo determina ARCA (último autorizado + 1); si no, se usa el
  // contador interno y la factura queda como borrador.
  let numero, cae = null, caeVto = null, estado = 'BORRADOR';
  try {
    const resp = await solicitarCAE({
      id_empresa: idEmpresa, emisor_cuit: empresa.cuit, punto_venta: puntoVenta, clase,
      // La cuenta no guarda condición de IVA; en Factura A el receptor es
      // responsable inscripto (default en integraciones/arca.js).
      receptor_cuit: cuenta.cuil, receptor_condicion_iva: cuenta.condicion_iva || 'RESPONSABLE INSCRIPTO',
      neto_gravado: netoGravado, iva, total, fecha: new Date()
    });
    if (resp && resp.cae) {
      numero = resp.numero;
      cae = resp.cae;
      caeVto = resp.cae_vencimiento;
      estado = 'EMITIDA';
    }
  } catch (errArca) {
    // No se pudo emitir: quien llama deshace la transacción completa.
    // El mensaje de ARCA le sirve al usuario (dato rechazado, certificado
    // vencido…): se muestra tal cual.
    throw new ErrorNegocio('Error al solicitar el CAE a ARCA: ' + errArca.message, 502);
  }

  // Si ARCA no asignó número (modo borrador), usar el contador interno.
  if (numero == null) {
    numero = await proximoNumero(conexion, idEmpresa, clase, puntoVenta);
  }

  const [res] = await conexion.query(
    `INSERT INTO FACTURAS
      (id_empresa, clase, tipo_comprobante, punto_venta, numero, fecha_emision, id_cuenta, id_viaje, id_factura_asociada,
       receptor_cuit, receptor_nombre, receptor_domicilio, receptor_condicion_iva,
       neto_gravado, iva, total, cae, cae_vencimiento, estado, observaciones)
     VALUES (?, ?, 'A', ?, ?, CURDATE(), ?, ?, ?, ?, ?, ?, 'RESPONSABLE INSCRIPTO', ?, ?, ?, ?, ?, ?, ?)`,
    [idEmpresa, clase, puntoVenta, numero, id_cuenta, id_viaje || null, id_factura_asociada || null,
     cuenta.cuil, cuenta.nombre, cuenta.domicilio || null,
     netoGravado, iva, total, cae, caeVto, estado, (observaciones || '').slice(0, 255)]
  );
  const idFactura = res.insertId;

  for (const it of itemsCalc) {
    await conexion.query(
      `INSERT INTO FACTURA_ITEMS (id_factura, descripcion, cantidad, unidad, precio_unitario, subtotal)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [idFactura, it.descripcion, it.cantidad, it.unidad, it.precio_unitario, it.subtotal]
    );
  }

  // Imputar el comprobante en la cuenta corriente del cliente (ver encabezado).
  const numeroFmt = String(numero).padStart(8, '0');
  const ptoFmt = String(puntoVenta).padStart(4, '0');
  if (clase === 'NOTA_CREDITO') {
    await crearMovimientoAutomatico(conexion, {
      idEmpresa,
      idCuenta: id_cuenta,
      monto: Math.abs(total), // crédito: reduce lo que debe el cliente
      fecha: new Date(),
      concepto: `NOTA DE CREDITO A ${ptoFmt}-${numeroFmt} (anula factura)`,
      origenTipo: ORIGEN.NOTA_CREDITO,
      origenId: idFactura
    });
  } else if (!id_viaje) {
    await crearMovimientoAutomatico(conexion, {
      idEmpresa,
      idCuenta: id_cuenta,
      monto: -Math.abs(total), // débito: el cliente debe el total con IVA
      fecha: new Date(),
      concepto: `FACTURA A ${ptoFmt}-${numeroFmt} [IVA 21%]`,
      origenTipo: ORIGEN.FACTURA,
      origenId: idFactura
    });
  }

  return idFactura;
}

// Factura manual (o cualquier comprobante suelto) en su propia transacción.
async function crearFactura(idEmpresa, datos) {
  return enTransaccion(conexion => insertarComprobante(conexion, idEmpresa, datos));
}

// Factura un viaje en UNA transacción: emite la factura, marca el viaje como
// FACTURADO con modo FACTURA y regenera sus movimientos por el único camino
// del viaje (débito al cliente por el total de la factura y liquidación al
// chofer). Si algo falla, no queda nada a medias.
async function facturarViaje(idEmpresa, { id_viaje, id_cuenta, items, observaciones }) {
  return enTransaccion(async conexion => {
    const idFactura = await insertarComprobante(conexion, idEmpresa, { id_cuenta, id_viaje, items, observaciones });
    await conexion.query(
      `UPDATE VIAJES SET estado = 'FACTURADO', modo_facturacion = 'FACTURA'
        WHERE id_viaje = ? AND id_empresa = ?`,
      [id_viaje, idEmpresa]
    );
    await reconciliarMovimientos(conexion, id_viaje, idEmpresa);
    return idFactura;
  });
}

// Emite la nota de crédito que anula una factura y marca la factura como
// ANULADA, en una sola transacción.
async function emitirNotaCredito(idEmpresa, factura, { items, observaciones }) {
  return enTransaccion(async conexion => {
    const idNC = await insertarComprobante(conexion, idEmpresa, {
      id_cuenta: factura.id_cuenta,
      items,
      observaciones,
      clase: 'NOTA_CREDITO',
      id_factura_asociada: factura.id_factura
    });
    await conexion.query(`UPDATE FACTURAS SET estado = 'ANULADA' WHERE id_factura = ? AND id_empresa = ?`,
      [factura.id_factura, idEmpresa]);
    return idNC;
  });
}

module.exports = { crearFactura, facturarViaje, emitirNotaCredito, importeFacturableDeViaje, r2 };
