// backend/src/modulos/facturacion/facturacion.reglas.js
// Reglas fiscales de los comprobantes, como funciones puras (con tests en
// backend/test/facturacion.reglas.test.js):
//   - qué letra corresponde según la condición frente al IVA del emisor (la
//     empresa que usa el sistema) y del receptor;
//   - los códigos de comprobante de ARCA;
//   - el cálculo de neto, IVA y total según la letra;
//   - el documento del receptor y la validación de CUIT.
//
// Letra del comprobante (RG 1415 y modificatorias):
//   Emisor RESPONSABLE INSCRIPTO → A a responsables inscriptos y monotributistas,
//                                  B a consumidores finales y exentos.
//   Emisor MONOTRIBUTO o EXENTO  → siempre C.
// Un monotributista nunca puede emitir A o B, y un responsable inscripto nunca C.
const { IVA_ALICUOTA } = require('../../config/constantes');

// Condición frente al IVA del receptor → id de ARCA (CondicionIVAReceptorId).
const CONDICION_RECEPTOR_ID = {
  'RESPONSABLE INSCRIPTO': 1,
  'EXENTO': 4,
  'CONSUMIDOR FINAL': 5,
  'MONOTRIBUTO': 6
};
const CONDICIONES_RECEPTOR = Object.keys(CONDICION_RECEPTOR_ID);
const CONDICIONES_EMISOR = ['RESPONSABLE INSCRIPTO', 'MONOTRIBUTO', 'EXENTO'];

// Receptores que reciben A de un responsable inscripto (ids de ARCA:
// 1 inscripto, 6 monotributo, 13 monotributista social, 16 trabajador promovido).
const RECEPTORES_DE_A = new Set([1, 6, 13, 16]);

// Códigos de comprobante de ARCA por letra y clase.
const CODIGOS = {
  A: { FACTURA: 1, NOTA_DEBITO: 2, NOTA_CREDITO: 3 },
  B: { FACTURA: 6, NOTA_DEBITO: 7, NOTA_CREDITO: 8 },
  C: { FACTURA: 11, NOTA_DEBITO: 12, NOTA_CREDITO: 13 }
};

// Id de alícuota de IVA de ARCA (21 % → 5).
const ALICUOTA_IVA_ID = 5;

// Tipos de documento del receptor (ARCA): 80 CUIT, 86 CUIL, 96 DNI, 99 sin identificar.
const DOC = { CUIT: 80, CUIL: 86, DNI: 96, SIN_IDENTIFICAR: 99 };

const r2 = n => Math.round(Number(n) * 100) / 100;
const soloDigitos = v => String(v || '').replace(/\D/g, '');

function normalizarCondicion(texto) {
  const t = String(texto || '').trim().toUpperCase();
  if (!t) return null;
  if (t.includes('INSCRIPTO')) return 'RESPONSABLE INSCRIPTO';
  if (t.includes('MONOTRIBUT')) return 'MONOTRIBUTO';
  if (t.includes('EXENTO')) return 'EXENTO';
  if (t.includes('CONSUMIDOR')) return 'CONSUMIDOR FINAL';
  return null;
}

// CUIT/CUIL válido: 11 dígitos y dígito verificador correcto (módulo 11).
function cuitValido(valor) {
  const d = soloDigitos(valor);
  if (d.length !== 11) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((s, p, i) => s + p * Number(d[i]), 0);
  let verificador = 11 - (suma % 11);
  if (verificador === 11) verificador = 0;
  if (verificador === 10) return false;
  return verificador === Number(d[10]);
}

// Letra que corresponde. Lanza un Error con mensaje para el usuario si la
// combinación no es posible.
function letraComprobante(condicionEmisor, condicionReceptor) {
  const emisor = normalizarCondicion(condicionEmisor);
  if (!CONDICIONES_EMISOR.includes(emisor)) {
    throw new Error('Cargá la condición frente al IVA de la empresa (Mi empresa → datos fiscales) antes de facturar.');
  }
  if (emisor === 'MONOTRIBUTO' || emisor === 'EXENTO') return 'C';
  const receptor = normalizarCondicion(condicionReceptor);
  if (!receptor) throw new Error('Indicá la condición frente al IVA del cliente.');
  return RECEPTORES_DE_A.has(CONDICION_RECEPTOR_ID[receptor]) ? 'A' : 'B';
}

function codigoComprobante(letra, clase = 'FACTURA') {
  const c = CODIGOS[letra] && CODIGOS[letra][clase];
  if (!c) throw new Error(`Comprobante no soportado: ${clase} ${letra}.`);
  return c;
}

// Documento del receptor. A siempre exige CUIT. B a consumidor final admite
// DNI o "sin identificar" (99, número 0).
function documentoReceptor(letra, condicionReceptor, numero) {
  const d = soloDigitos(numero);
  if (d.length === 11) {
    if (!cuitValido(d)) throw new Error(`El CUIT/CUIL del cliente (${numero}) no es válido: revisá el número.`);
    return { tipo: DOC.CUIT, numero: d };
  }
  if (letra === 'A') throw new Error('Para una factura A el cliente tiene que tener un CUIT válido.');
  const receptor = normalizarCondicion(condicionReceptor);
  if (receptor !== 'CONSUMIDOR FINAL' && letra === 'B') {
    throw new Error('El cliente tiene que tener CUIT válido (solo un consumidor final puede ir con DNI o sin identificar).');
  }
  if (d.length >= 7 && d.length <= 8) return { tipo: DOC.DNI, numero: d };
  if (!d) return { tipo: DOC.SIN_IDENTIFICAR, numero: '0' };
  throw new Error(`El documento del cliente (${numero}) no es un CUIT (11 dígitos) ni un DNI (7 u 8 dígitos).`);
}

// Importes de los ítems. Los precios se cargan SIN IVA para A y B (el sistema
// suma el 21 %); para C, el precio es final (no hay IVA discriminado).
// Devuelve { items, neto, iva, total, alicuotas } redondeados a centavos, con
// total = neto + iva exacto (ARCA lo exige).
function calcularImportes(itemsEntrada, letra) {
  const items = (itemsEntrada || []).map(it => {
    const cantidad = Number(it.cantidad);
    const precio = Number(it.precio_unitario);
    if (!String(it.descripcion || '').trim()) throw new Error('Todos los renglones necesitan una descripción.');
    if (!(cantidad > 0)) throw new Error(`La cantidad de "${it.descripcion}" tiene que ser mayor a cero.`);
    if (!(precio > 0)) throw new Error(`El precio de "${it.descripcion}" tiene que ser mayor a cero.`);
    return {
      descripcion: String(it.descripcion).trim().slice(0, 255),
      cantidad: Math.round(cantidad * 1000) / 1000,
      unidad: String(it.unidad || '').trim().slice(0, 20) || null,
      precio_unitario: r2(precio),
      subtotal: r2(cantidad * precio),
      id_viaje: it.id_viaje ? Number(it.id_viaje) : null
    };
  });
  if (!items.length) throw new Error('El comprobante necesita al menos un renglón.');
  const neto = r2(items.reduce((s, it) => s + it.subtotal, 0));
  if (letra === 'C') {
    return { items, neto, iva: 0, total: neto, alicuotas: [] };
  }
  const iva = r2(neto * IVA_ALICUOTA);
  return {
    items, neto, iva, total: r2(neto + iva),
    alicuotas: [{ id: ALICUOTA_IVA_ID, base: neto, importe: iva }]
  };
}

// Fecha AAAA-MM-DD → AAAAMMDD (formato de ARCA) y viceversa.
const aArca = f => String(f).slice(0, 10).replace(/-/g, '');
const deArca = f => { const s = String(f || ''); return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null; };

// Días entre dos fechas AAAA-MM-DD.
const diasEntre = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);

// Fechas de un comprobante de servicios: la del comprobante puede estar hasta
// 10 días antes o después de hoy; el período del servicio, completo; el
// vencimiento del pago, no anterior a la fecha del comprobante.
function validarFechas({ fecha, servicioDesde, servicioHasta, vencimientoPago }, hoy) {
  const req = { fecha, servicioDesde, servicioHasta, vencimientoPago };
  for (const [k, v] of Object.entries(req)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))) throw new Error(`Falta la fecha (${k}) o no es válida.`);
  }
  if (Math.abs(diasEntre(hoy, fecha)) > 10) {
    throw new Error('La fecha del comprobante tiene que estar dentro de los 10 días anteriores o posteriores a hoy.');
  }
  if (servicioDesde > servicioHasta) throw new Error('El período facturado está al revés (desde es posterior a hasta).');
  if (vencimientoPago < fecha) throw new Error('El vencimiento del pago no puede ser anterior a la fecha del comprobante.');
}

// Contenido del QR obligatorio (RG 4892): URL de ARCA con los datos del
// comprobante en JSON y base64.
function urlQR({ fecha, cuitEmisor, puntoVenta, tipo, numero, total, docTipo, docNro, cae }) {
  const datos = {
    ver: 1, fecha: String(fecha).slice(0, 10), cuit: Number(soloDigitos(cuitEmisor)), ptoVta: Number(puntoVenta),
    tipoCmp: Number(tipo), nroCmp: Number(numero), importe: r2(total), moneda: 'PES', ctz: 1,
    tipoDocRec: Number(docTipo), nroDocRec: Number(docNro) || 0, tipoCodAut: 'E', codAut: Number(cae)
  };
  return 'https://www.afip.gob.ar/fe/qr/?p=' + Buffer.from(JSON.stringify(datos)).toString('base64');
}

module.exports = {
  CONDICION_RECEPTOR_ID, CONDICIONES_RECEPTOR, CONDICIONES_EMISOR, CODIGOS, ALICUOTA_IVA_ID, DOC,
  normalizarCondicion, cuitValido, letraComprobante, codigoComprobante, documentoReceptor,
  calcularImportes, validarFechas, aArca, deArca, diasEntre, urlQR, r2
};
