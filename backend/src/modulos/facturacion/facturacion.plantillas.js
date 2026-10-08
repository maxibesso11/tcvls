// backend/src/modulos/facturacion/facturacion.plantillas.js
// Plantillas del facturador: arman el renglón de cada viaje y las
// observaciones del comprobante a partir del texto que define cada cliente
// (CUENTA.plantilla_item y plantilla_observaciones). Funciones puras, con
// tests en backend/test/facturacion.plantillas.test.js.
//
// Marcadores del renglón (uno por viaje):
//   {origen} {destino} {carga} {remito} {fecha} {fecha_llegada} {resultado}
//   {unidad} {tarifa} {patente} {acoplado} {chofer} {viaje}
// Marcadores de las observaciones (todos los viajes del comprobante):
//   {remitos} {cargas} {rutas} {viajes} {km_total} {toneladas_total} {periodo}
// Un marcador desconocido queda tal cual, así el usuario lo ve y lo corrige.
const { r2 } = require('./facturacion.reglas');

const PLANTILLA_ITEM = 'Flete de {carga} de {origen} a {destino} · Remito {remito} · {fecha}';
const PLANTILLA_OBSERVACIONES = '';

const fechaCorta = f => (f ? String(f).slice(0, 10).split('-').reverse().join('/') : '');
const unico = lista => [...new Set(lista.filter(Boolean))];
const numero = n => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 });

function reemplazar(plantilla, valores) {
  return String(plantilla || '').replace(/\{(\w+)\}/g, (todo, clave) =>
    (Object.prototype.hasOwnProperty.call(valores, clave) ? String(valores[clave] ?? '') : todo)
  ).replace(/\s+·\s+(?=·|$)/g, '').replace(/[ \t]{2,}/g, ' ').trim();
}

// Unidad y cantidad del renglón según la tarifa del viaje.
function cantidadDelViaje(v) {
  if (v.tipo_tarifa === 'UNICA') return { cantidad: 1, unidad: 'viaje' };
  const cantidad = Number(v.resultado != null ? v.resultado : v.cantidad_cargada) || 0;
  return { cantidad, unidad: v.tipo_tarifa === 'POR KM' ? 'km' : 'tn' };
}

// Renglón sugerido para un viaje. El precio unitario es la tarifa menos la
// comisión (lo que efectivamente se le cobra al cliente), sin IVA.
function itemDeViaje(v, plantilla) {
  const { cantidad, unidad } = cantidadDelViaje(v);
  const comision = Number(v.comision) || 0;
  const precio = r2(Number(v.tarifa) * (1 - comision / 100));
  return {
    id_viaje: v.id_viaje,
    descripcion: reemplazar(plantilla || PLANTILLA_ITEM, {
      origen: v.origen, destino: v.destino, carga: v.tipo_carga, remito: v.numero_remito,
      fecha: fechaCorta(v.fecha_origen), fecha_llegada: fechaCorta(v.fecha_llegada),
      resultado: numero(cantidad), unidad, tarifa: numero(v.tarifa),
      patente: v.patente_principal, acoplado: v.patente_secundaria, chofer: v.chofer, viaje: v.id_viaje
    }).slice(0, 255),
    cantidad,
    unidad,
    precio_unitario: precio
  };
}

// Observaciones del comprobante para el conjunto de viajes.
function observaciones(viajes, plantilla) {
  if (!plantilla) return '';
  const km = viajes.filter(v => v.tipo_tarifa === 'POR KM').reduce((s, v) => s + (Number(v.resultado) || 0), 0);
  const tn = viajes.filter(v => v.tipo_tarifa === 'POR TONELADA')
    .reduce((s, v) => s + (Number(v.resultado != null ? v.resultado : v.cantidad_cargada) || 0), 0);
  const fechas = viajes.map(v => String(v.fecha_origen).slice(0, 10)).sort();
  return reemplazar(plantilla, {
    remitos: unico(viajes.map(v => v.numero_remito)).join(', '),
    cargas: unico(viajes.map(v => v.tipo_carga)).join(', '),
    rutas: unico(viajes.map(v => `${v.origen} a ${v.destino}`)).join(', '),
    viajes: viajes.map(v => `#${v.id_viaje}`).join(', '),
    km_total: numero(km),
    toneladas_total: numero(tn),
    periodo: fechas.length ? `${fechaCorta(fechas[0])} al ${fechaCorta(fechas[fechas.length - 1])}` : ''
  });
}

module.exports = { PLANTILLA_ITEM, PLANTILLA_OBSERVACIONES, itemDeViaje, observaciones, cantidadDelViaje, reemplazar };
